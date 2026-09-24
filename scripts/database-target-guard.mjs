import pg from "../lib/db/node_modules/pg/lib/index.js";

const PRODUCTION_DATABASES = new Set(["neondb"]);
const DEVELOPMENT_DATABASES = new Set(["heliumdb", "heliumdb_test"]);

export async function requireDevelopmentDatabase(client) {
  const { rows } = await client.query("SELECT current_database() AS name");
  const name = rows[0]?.name;
  if (!name || PRODUCTION_DATABASES.has(name) || !DEVELOPMENT_DATABASES.has(name)) {
    throw new Error(
      `Refusing standalone database mutation: PostgreSQL current_database() = "${name ?? "unknown"}" is not an allowed development/test database.`,
    );
  }
}

export async function checkDevelopmentDatabase() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    await requireDevelopmentDatabase(client);
  } finally {
    await client.end();
  }
}