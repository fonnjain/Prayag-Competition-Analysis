import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

const ADMIN_PASSWORD = "pRAYAG@2026";

const ADMIN_USERS = [
  { email: "ceo@prayagindia.com",            firstName: "CEO",    lastName: "Prayag" },
  { email: "preeti.chauhan@prayagindia.com",  firstName: "Preeti", lastName: "Chauhan" },
  { email: "deepakj@prayagindia.com",         firstName: "Deepak", lastName: "J" },
];

/**
 * Idempotent: inserts each admin user if they don't exist yet.
 * Safe to run on every startup — skips rows that are already present.
 */
export async function seedAdminUser(): Promise<void> {
  const hash = await bcrypt.hash(ADMIN_PASSWORD, 12);

  for (const admin of ADMIN_USERS) {
    const [existing] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, admin.email));

    if (existing) continue; // already seeded

    await db.insert(usersTable).values({
      email: admin.email,
      firstName: admin.firstName,
      lastName: admin.lastName,
      passwordHash: hash,
      role: "admin",
    });

    logger.info({ email: admin.email }, "Admin user seeded");
  }
}
