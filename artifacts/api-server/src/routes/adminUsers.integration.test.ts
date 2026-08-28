import express from "express";
import supertest from "supertest";
import bcrypt from "bcryptjs";
import * as XLSX from "xlsx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, usersTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import routes from "./index";

const testEmails = [
  "existing@user-import.test",
  "new.user@user-import.test",
  "duplicate@user-import.test",
  "noname@user-import.test",
];

function buildWorkbook(): Buffer {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Salespeople import"],
    ["Generated for testing"],
    ["Name", "Email", "In app?"],
    ["  Priya   Sharma  ", " NEW.USER@USER-IMPORT.TEST ", "Yes"],
    ["Existing Person", "existing@user-import.test", "Yes"],
    ["Duplicate First", "duplicate@user-import.test", "Yes"],
    ["Duplicate Second", " DUPLICATE@USER-IMPORT.TEST ", "Yes"],
    ["Bad Email", "not-an-email", "Yes"],
    ["", "noname@user-import.test", "Yes"],
  ]);
  XLSX.utils.book_append_sheet(workbook, sheet, "Users");
  return Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
}

function requestAs(role: "admin" | "user" = "admin") {
  const app = express();
  app.use((req, _res, next) => {
    req.isAuthenticated = (() => true) as never;
    req.user = {
      id: "user-import-admin",
      email: "admin@user-import.test",
      mustChangePassword: false,
      role,
    };
    req.log = { info: vi.fn(), warn: vi.fn() } as never;
    next();
  });
  app.use(routes);
  return supertest(app);
}

async function clearTestUsers() {
  await db.delete(usersTable).where(inArray(usersTable.email, testEmails));
}

describe("admin user workbook import", () => {
  beforeEach(clearTestUsers);
  afterEach(clearTestUsers);

  it("requires a valid workbook and keeps the routes admin-only", async () => {
    const response = await requestAs().post("/admin/users/import/preview");
    expect(response.status).toBe(400);
    expect(response.body.error).toContain("workbook");

    const forbidden = await requestAs("user")
      .post("/admin/users/import/preview")
      .attach("file", buildWorkbook(), "salespeople.xlsx");
    expect(forbidden.status).toBe(403);

    const bypassAttempt = await requestAs()
      .post("/admin/users/import")
      .field("password", "TemporaryPass1")
      .field("confirmed", "true")
      .attach("file", buildWorkbook(), "salespeople.xlsx");
    expect(bypassAttempt.status).toBe(400);
    expect(bypassAttempt.body.error).toMatch(/preview|confirmation/i);
  });

  it("normalizes rows, preserves existing accounts, and remains idempotent", async () => {
    const existingHash = await bcrypt.hash("ExistingPass1", 4);
    await db.insert(usersTable).values({
      email: "existing@user-import.test",
      firstName: "Original",
      lastName: "Admin",
      passwordHash: existingHash,
      mustChangePassword: false,
      role: "admin",
    });

    const workbook = buildWorkbook();
    const preview = await requestAs()
      .post("/admin/users/import/preview")
      .attach("file", workbook, "salespeople.xlsx");

    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({
      totalRows: 6,
      newUsers: 1,
      existingUsers: 1,
      duplicateRows: 2,
      invalidRows: 2,
    });
    expect(preview.body.issues).toHaveLength(4);

    const firstImport = await requestAs()
      .post("/admin/users/import")
      .field("password", "TemporaryPass1")
      .field("previewToken", preview.body.previewToken)
      .field("confirmed", "true")
      .attach("file", workbook, "salespeople.xlsx");

    expect(firstImport.status).toBe(200);
    expect(firstImport.body).toMatchObject({
      created: 1,
      skippedExisting: 1,
      skippedDuplicates: 2,
      invalidRows: 2,
    });

    const imported = await db
      .select()
      .from(usersTable)
      .where(inArray(usersTable.email, testEmails));
    const newUser = imported.find((user) => user.email === "new.user@user-import.test");
    const unchanged = imported.find((user) => user.email === "existing@user-import.test");

    expect(newUser).toMatchObject({
      firstName: "Priya",
      lastName: "Sharma",
      role: "user",
      mustChangePassword: true,
    });
    expect(await bcrypt.compare("TemporaryPass1", newUser!.passwordHash!)).toBe(true);
    expect(imported.some((user) => user.email === "duplicate@user-import.test")).toBe(false);
    expect(unchanged).toMatchObject({
      firstName: "Original",
      lastName: "Admin",
      role: "admin",
      mustChangePassword: false,
      passwordHash: existingHash,
    });

    const secondImport = await requestAs()
      .post("/admin/users/import")
      .field("password", "AnotherTempPass1")
      .field("previewToken", preview.body.previewToken)
      .field("confirmed", "true")
      .attach("file", workbook, "salespeople.xlsx");

    expect(secondImport.status).toBe(200);
    expect(secondImport.body).toMatchObject({
      created: 0,
      skippedExisting: 2,
      skippedDuplicates: 2,
      invalidRows: 2,
    });
    const rerunUser = await db.query.usersTable.findFirst({
      where: (table, { eq }) => eq(table.email, "new.user@user-import.test"),
    });
    expect(await bcrypt.compare("TemporaryPass1", rerunUser!.passwordHash!)).toBe(true);
  });
});