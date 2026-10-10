import { readFile } from "node:fs/promises";
import pg from "../lib/db/node_modules/pg/lib/index.js";
import { requireDevelopmentDatabase } from "./database-target-guard.mjs";

const dryRun = process.argv.includes("--dry-run");
if (process.argv.slice(2).some(arg => arg !== "--dry-run")) {
  throw new Error("Usage: node scripts/p055-undo-development.mjs [--dry-run]");
}
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  await requireDevelopmentDatabase(client);
  const undo = await readFile(new URL("./p055-undo-development.sql", import.meta.url), "utf8");
  if (dryRun) await client.query("BEGIN");
  const notices = [];
  client.on("notice", notice => notices.push(notice.message));
  await client.query(undo);
  if (dryRun) await client.query("ROLLBACK");
  console.log(dryRun ? "Undo dry-run passed; transaction rolled back." : "Development undo completed.");
  for (const notice of notices) console.log(notice);
} finally {
  await client.end();
}
