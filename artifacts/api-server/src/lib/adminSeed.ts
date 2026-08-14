import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

const ADMIN_EMAIL = "ceo@prayagindia.com";
const ADMIN_PASSWORD = "pRAYAG@2026";
const ADMIN_FIRST_NAME = "CEO";
const ADMIN_LAST_NAME = "Prayag";

/**
 * Idempotent: inserts the admin user if they don't exist yet.
 * Safe to run on every startup — does nothing if the row is already present.
 */
export async function seedAdminUser(): Promise<void> {
  const [existing] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, ADMIN_EMAIL));

  if (existing) return; // already seeded

  const hash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  await db.insert(usersTable).values({
    email: ADMIN_EMAIL,
    firstName: ADMIN_FIRST_NAME,
    lastName: ADMIN_LAST_NAME,
    passwordHash: hash,
  });

  logger.info({ email: ADMIN_EMAIL }, "Admin user seeded");
}
