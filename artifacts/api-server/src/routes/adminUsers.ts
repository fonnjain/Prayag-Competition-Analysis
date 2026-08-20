import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";

const router: IRouter = Router();

/** Guard: only admin-role users can call these routes */
function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.isAuthenticated() || req.user.role !== "admin") {
    res.status(403).json({ error: "Admin access required." });
    return;
  }
  next();
}

router.use("/admin/users", requireAdmin);

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
      role: u.role as "admin" | "user",
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
  if (!role || !["admin", "user"].includes(role)) {
    res.status(400).json({ error: "Role must be 'admin' or 'user'." });
    return;
  }
  if (password !== undefined && (typeof password !== "string" || password.length < 8)) {
    res.status(400).json({ error: "Password must be at least 8 characters." });
    return;
  }

  const normalised = email.toLowerCase().trim();

  // Check for duplicate
  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, normalised));

  if (existing) {
    res.status(409).json({ error: "An account with that email already exists." });
    return;
  }

  const passwordHash = password ? await bcrypt.hash(password, 12) : null;

  const [created] = await db
    .insert(usersTable)
    .values({
      email: normalised,
      firstName: firstName ?? null,
      lastName: lastName ?? null,
      passwordHash,
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

  res.status(201).json({
    id: created.id,
    email: created.email ?? "",
    firstName: created.firstName ?? null,
    lastName: created.lastName ?? null,
    role: created.role as "admin" | "user",
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

  const [deleted] = await db
    .delete(usersTable)
    .where(eq(usersTable.id, id))
    .returning({ id: usersTable.id });

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
    .set({ passwordHash })
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

  if (!role || !["admin", "user"].includes(role)) {
    res.status(400).json({ error: "Role must be 'admin' or 'user'." });
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
    role: updated.role as "admin" | "user",
    createdAt: updated.createdAt.toISOString(),
  });
});

export default router;
