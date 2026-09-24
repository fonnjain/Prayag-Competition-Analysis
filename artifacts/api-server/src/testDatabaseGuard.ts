import { pool } from "@workspace/db";

// This is an exact database-name allowlist, not a substring or URL check.
// No environment variable or command-line flag can expand it.
const ALLOWED_TEST_DATABASES = new Set(["heliumdb", "heliumdb_test"]);
const PRODUCTION_DATABASES = new Set(["neondb"]);

export function assertTestDatabaseName(name: string): void {
  if (PRODUCTION_DATABASES.has(name)) {
    throw new Error(`Refusing to run API tests: PostgreSQL current_database() = "${name}" is the production database.`);
  }
  if (!ALLOWED_TEST_DATABASES.has(name)) {
    throw new Error(`Refusing to run API tests: PostgreSQL current_database() = "${name}" is not an allowed development/test database.`);
  }
}

export default async function setup(): Promise<void> {
  try {
    // The connection string only connects. Identity comes from PostgreSQL itself.
    const result = await pool.query<{ name: string }>(
      'SELECT current_database() AS name',
    );
    const name = result.rows[0]?.name;
    if (!name) throw new Error("Refusing to run API tests: PostgreSQL did not return current_database().");
    assertTestDatabaseName(name);
  } finally {
    await pool.end();
  }
}