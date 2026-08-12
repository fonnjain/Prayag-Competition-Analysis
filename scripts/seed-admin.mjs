/**
 * One-time script: upsert the admin user with a bcrypt password hash.
 * Run from workspace root: node --experimental-vm-modules scripts/seed-admin.mjs
 * Or: cd artifacts/api-server && node ../../scripts/seed-admin.mjs
 */
import { createRequire } from 'module';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Load bcryptjs from api-server deps
const bcrypt = require(resolve(__dirname, '../artifacts/api-server/node_modules/bcryptjs/index.js'));
// Load pg from db lib deps
const pg = require(resolve(__dirname, '../node_modules/.pnpm/pg@8.20.0/node_modules/pg/lib/index.js'));
const { Client } = pg;

const ADMIN_EMAIL = 'ceo@prayagindia.com';
const ADMIN_PASSWORD = 'pRAYAG@2026';
const ADMIN_FIRST_NAME = 'CEO';
const ADMIN_LAST_NAME = 'Prayag';

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const hash = await bcrypt.hash(ADMIN_PASSWORD, 12);

await client.query(
  `INSERT INTO users (email, first_name, last_name, password_hash)
   VALUES ($1, $2, $3, $4)
   ON CONFLICT (email) DO UPDATE
     SET password_hash = EXCLUDED.password_hash,
         first_name    = EXCLUDED.first_name,
         last_name     = EXCLUDED.last_name,
         updated_at    = now()`,
  [ADMIN_EMAIL, ADMIN_FIRST_NAME, ADMIN_LAST_NAME, hash],
);

console.log(`✓ Admin user upserted: ${ADMIN_EMAIL}`);
await client.end();
