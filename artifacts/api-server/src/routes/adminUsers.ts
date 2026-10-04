import { Router, type IRouter } from "express";
import { deleteBucketDataForAccount } from "../lib/bucketLists";
import bcrypt from "bcryptjs";
import multer from "multer";
import { db, usersTable } from "@workspace/db";
import { eq, asc, inArray, sql } from "drizzle-orm";
import {
  ImportAdminUsersBody,
  ImportAdminUsersResponse,
  PreviewAdminUserImportResponse,
} from "@workspace/api-zod";
import { requireAdmin } from "../middlewares/authMiddleware";
import { parseAdminUserWorkbook } from "../lib/adminUserImport";
import {
  createAdminUserImportReceipt,
  verifyAdminUserImportReceipt,
} from "../lib/adminUserImportReceipt";

const router: IRouter = Router();
const userImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

router.use("/admin/users", requireAdmin);

function isSupportedUserWorkbook(fileName: string): boolean {
  const extension = fileName.toLowerCase().split(".").pop() ?? "";
  return ["xlsx", "xls", "csv"].includes(extension);
}

async function findExistingEmails(emails: string[]): Promise<Set<string>> {
  if (emails.length === 0) return new Set();
  const existing = await db
    .select({ email: usersTable.email })
    .from(usersTable)
    .where(inArray(sql<string>`lower(${usersTable.email})`, emails));
  return new Set(existing.flatMap((row) => (row.email ? [row.email.toLowerCase()] : [])));
}

/** POST /admin/users/import/preview — classify workbook rows without changing data. */
router.post(
  "/admin/users/import/preview",
  userImportUpload.single("file"),
  async (req, res): Promise<void> => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "Choose a salesperson workbook to preview." });
      return;
    }
    if (!isSupportedUserWorkbook(file.originalname)) {
      res.status(400).json({ error: "Upload an .xlsx, .xls, or .csv file." });
      return;
    }

    try {
      const parsed = parseAdminUserWorkbook(file.buffer);
      const existingEmails = await findExistingEmails(
        parsed.candidates.map((candidate) => candidate.email),
      );
      const response = {
        fileName: file.originalname,
        totalRows: parsed.totalRows,
        newUsers: parsed.candidates.length - existingEmails.size,
        existingUsers: existingEmails.size,
        duplicateRows: parsed.duplicateRows,
        invalidRows: parsed.invalidRows,
        issues: parsed.issues.slice(0, 25),
        ...createAdminUserImportReceipt(req.user!.id, file.buffer),
      };

      res.json(PreviewAdminUserImportResponse.parse(response));
    } catch (error) {
      req.log.warn({ err: error, fileName: file.originalname }, "User import preview failed");
      res.status(400).json({
        error: error instanceof Error ? error.message : "Could not read the user workbook.",
      });
    }
  },
);

/** POST /admin/users/import — create missing normal users after an explicit preview. */
router.post(
  "/admin/users/import",
  userImportUpload.single("file"),
  async (req, res): Promise<void> => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "Choose a salesperson workbook to import." });
      return;
    }
    if (!isSupportedUserWorkbook(file.originalname)) {
      res.status(400).json({ error: "Upload an .xlsx, .xls, or .csv file." });
      return;
    }

    const body = ImportAdminUsersBody.pick({
      password: true,
      previewToken: true,
    }).safeParse(req.body);
    if (!body.success || req.body.confirmed !== "true") {
      res.status(400).json({
        error: "Preview receipt, explicit confirmation, and an 8-character password are required.",
      });
      return;
    }
    if (
      !verifyAdminUserImportReceipt(
        body.data.previewToken,
        req.user!.id,
        file.buffer,
      )
    ) {
      res.status(400).json({
        error: "This preview is missing, expired, or belongs to a different workbook. Preview again.",
      });
      return;
    }

    try {
      const parsed = parseAdminUserWorkbook(file.buffer);
      const passwordHash = await bcrypt.hash(body.data.password, 12);
      const inserted = await db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext('prayag_users_normalized_email_write'))`,
        );
        const emails = parsed.candidates.map((candidate) => candidate.email);
        const existing =
          emails.length === 0
            ? []
            : await tx
                .select({ email: usersTable.email })
                .from(usersTable)
                .where(inArray(sql<string>`lower(${usersTable.email})`, emails));
        const existingEmails = new Set(
          existing.flatMap((row) => (row.email ? [row.email.toLowerCase()] : [])),
        );
        const missing = parsed.candidates.filter(
          (candidate) => !existingEmails.has(candidate.email),
        );
        if (missing.length === 0) return [];

        return tx
          .insert(usersTable)
          .values(
            missing.map((candidate) => ({
              email: candidate.email,
              firstName: candidate.firstName,
              lastName: candidate.lastName,
              passwordHash,
              mustChangePassword: true,
              role: "user",
            })),
          )
          .onConflictDoNothing()
          .returning({ id: usersTable.id });
      });

      const skippedExisting = parsed.candidates.length - inserted.length;
      req.log.info(
        {
          fileName: file.originalname,
          totalRows: parsed.totalRows,
          created: inserted.length,
          skippedExisting,
          skippedDuplicates: parsed.duplicateRows,
          invalidRows: parsed.invalidRows,
        },
        "Admin imported workspace users",
      );
      res.json(
        ImportAdminUsersResponse.parse({
          fileName: file.originalname,
          totalRows: parsed.totalRows,
          created: inserted.length,
          skippedExisting,
          skippedDuplicates: parsed.duplicateRows,
          invalidRows: parsed.invalidRows,
        }),
      );
    } catch (error) {
      req.log.warn({ err: error, fileName: file.originalname }, "User import failed");
      res.status(400).json({
        error: error instanceof Error ? error.message : "Could not import the user workbook.",
      });
    }
  },
);

/** GET /admin/users — list all workspace users */
router.get("/admin/users", async (_req, res) => {
  const users = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      role: usersTable.role,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .orderBy(asc(usersTable.createdAt));

  res.json({
    users: users.map((u) => ({
      id: u.id,
      email: u.email ?? "",
      firstName: u.firstName ?? null,
      lastName: u.lastName ?? null,
      role: u.role as "admin" | "user" | "counter",
      createdAt: u.createdAt.toISOString(),
    })),
  });
});

/** POST /admin/users — create a new user */
router.post("/admin/users", async (req, res) => {
  const { email, firstName, lastName, password, role } = req.body ?? {};

  if (!email || typeof email !== "string" || !email.includes("@")) {
    res.status(400).json({ error: "Valid email is required." });
    return;
  }
  if (!role || !["admin", "user", "counter"].includes(role)) {
    res.status(400).json({ error: "Role must be 'admin', 'user', or 'counter'." });
    return;
  }
  if (password !== undefined && (typeof password !== "string" || password.length < 8)) {
    res.status(400).json({ error: "Password must be at least 8 characters." });
    return;
  }

  const normalised = email.toLowerCase().trim();

  const passwordHash = password ? await bcrypt.hash(password, 12) : null;
  const created = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('prayag_users_normalized_email_write'))`,
    );
    const [existing] = await tx
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(sql<string>`lower(${usersTable.email})`, normalised));
    if (existing) return null;

    const [inserted] = await tx
      .insert(usersTable)
      .values({
        email: normalised,
        firstName: firstName ?? null,
        lastName: lastName ?? null,
        passwordHash,
        mustChangePassword: Boolean(password),
        role,
      })
      .returning({
        id: usersTable.id,
        email: usersTable.email,
        firstName: usersTable.firstName,
        lastName: usersTable.lastName,
        role: usersTable.role,
        createdAt: usersTable.createdAt,
      });
    return inserted;
  });
  if (!created) {
    res.status(409).json({ error: "An account with that email already exists." });
    return;
  }

  res.status(201).json({
    id: created.id,
    email: created.email ?? "",
    firstName: created.firstName ?? null,
    lastName: created.lastName ?? null,
    role: created.role as "admin" | "user" | "counter",
    createdAt: created.createdAt.toISOString(),
  });
});

/** DELETE /admin/users/:id — remove a user */
router.delete("/admin/users/:id", async (req, res) => {
  const { id } = req.params;

  // Prevent admin from deleting themselves
  if (req.user?.id === id) {
    res.status(400).json({ error: "You cannot delete your own account." });
    return;
  }

  const deleted = await db.transaction(async tx => {
    const [existing] = await tx.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, id));
    if (!existing) return undefined;
    await deleteBucketDataForAccount(id, req.user?.email ?? req.user?.id ?? "Administrator", tx);
    const [removed] = await tx.delete(usersTable).where(eq(usersTable.id, id)).returning({ id: usersTable.id });
    return removed;
  });

  if (!deleted) {
    res.status(404).json({ error: "User not found." });
    return;
  }

  res.json({ ok: true });
});

/** PUT /admin/users/:id/password — reset a user's password */
router.put("/admin/users/:id/password", async (req, res) => {
  const { id } = req.params;
  const { password } = req.body ?? {};

  if (!password || typeof password !== "string" || password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters." });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const [updated] = await db
    .update(usersTable)
    .set({ passwordHash, mustChangePassword: true })
    .where(eq(usersTable.id, id))
    .returning({ id: usersTable.id });

  if (!updated) {
    res.status(404).json({ error: "User not found." });
    return;
  }

  res.json({ ok: true });
});

/** PATCH /admin/users/:id/role — update a user's role */
router.patch("/admin/users/:id/role", async (req, res) => {
  const { id } = req.params;
  const { role } = req.body ?? {};

  if (!role || !["admin", "user", "counter"].includes(role)) {
    res.status(400).json({ error: "Role must be 'admin', 'user', or 'counter'." });
    return;
  }

  // Prevent admin from demoting themselves
  if (req.user?.id === id && role !== "admin") {
    res.status(400).json({ error: "You cannot remove your own admin role." });
    return;
  }

  const [updated] = await db
    .update(usersTable)
    .set({ role })
    .where(eq(usersTable.id, id))
    .returning({
      id: usersTable.id,
      email: usersTable.email,
      firstName: usersTable.firstName,
      lastName: usersTable.lastName,
      role: usersTable.role,
      createdAt: usersTable.createdAt,
    });

  if (!updated) {
    res.status(404).json({ error: "User not found." });
    return;
  }

  res.json({
    id: updated.id,
    email: updated.email ?? "",
    firstName: updated.firstName ?? null,
    lastName: updated.lastName ?? null,
    role: updated.role as "admin" | "user" | "counter",
    createdAt: updated.createdAt.toISOString(),
  });
});

export default router;
