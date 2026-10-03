import { beforeAll, afterAll, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";

// Each suite gets its own catalogue and its own sequences. No fixture INSERT,
// UPDATE, DELETE, or nextval may reach public. Authentication fixtures remain
// test-local; no user, session, or credential values are copied.
const state = vi.hoisted(() => ({
  original: null as unknown as typeof import("@workspace/db"),
  handle: null as unknown as typeof import("@workspace/db").db,
}));
vi.mock("@workspace/db", async importOriginal => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  state.original = actual;
  return { ...actual, db: new Proxy(actual.db, {
    get(_target, key) {
      // Existing isolated suites install their own vi.spyOn database adapters.
      // Honour these rather than routing their fixtures into our outer copy.
      const override = Reflect.get(_target, key);
      if (typeof override === "function" && override._isMockFunction) return override;
      if (!state.handle) throw new Error("Private catalogue fixture is not ready; refusing public database access.");
      const value = Reflect.get(state.handle, key);
      return typeof value === "function" ? value.bind(state.handle) : value;
    },
  }) };
});
const connect = () => state.original.pool.connect();
let client: Awaited<ReturnType<typeof connect>> | null = null;
const schema = `p051_suite_${process.pid}_${Date.now().toString(36)}`;
const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;
beforeAll(async () => {
  client = await state.original.pool.connect();
  await client.query(`CREATE SCHEMA ${quote(schema)}`);
  const tables = await client.query<{ table_name: string }>(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_type='BASE TABLE'
      AND (table_name ~ '^(catalog_|mrp_|competitor_|locally_added_|product_|price_)'
        OR table_name IN ('code_conflicts', 'import_batches'))
    ORDER BY table_name
  `);
  for (const { table_name: table } of tables.rows) {
    const target = `${quote(schema)}.${quote(table)}`;
    await client.query(`CREATE TABLE ${target} (LIKE public.${quote(table)} INCLUDING ALL)`);
    const columns = await client.query<{ column_name: string }>(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema=$1 AND table_name=$2 AND column_default LIKE 'nextval(%'`, [schema, table]);
    for (const { column_name: column } of columns.rows) {
      const sequence = `${table}_${column}_private_seq`;
      await client.query(`CREATE SEQUENCE ${quote(schema)}.${quote(sequence)} OWNED BY ${target}.${quote(column)}`);
      await client.query(`ALTER TABLE ${target} ALTER COLUMN ${quote(column)} SET DEFAULT nextval('${schema}.${sequence}')`);
    }
    await client.query(`INSERT INTO ${target} SELECT * FROM public.${quote(table)}`);
    for (const { column_name: column } of columns.rows) {
      await client.query(`SELECT setval('${schema}.${table}_${column}_private_seq',
        COALESCE((SELECT MAX(${quote(column)})+1 FROM ${target}),1),false)`);
    }
  }
  await client.query(`SET search_path TO ${quote(schema)}, public`);
  state.handle = drizzle(client, { schema: state.original }) as unknown as typeof state.handle;
}, 60000);
afterAll(async () => {
  if (!client) return;
  await client.query("RESET search_path");
  await client.query(`DROP SCHEMA IF EXISTS ${quote(schema)} CASCADE`);
  client.release();
  client = null;
}, 60000);