import {
  pgTable,
  serial,
  text,
  boolean,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// API keys for external read-only access to the Prayag pricing API.
// The full secret is NEVER stored — only a SHA-256 hash. key_prefix keeps the
// first characters (e.g. "pryg_a1b2c3") so users can identify keys in the UI.
// Revoked keys are kept (is_active=false, revoked_at set) for audit until
// explicitly deleted.
export const apiKeysTable = pgTable(
  "api_keys",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    keyPrefix: text("key_prefix").notNull(),
    keyHash: text("key_hash").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("api_keys_key_hash_idx").on(t.keyHash)],
);

export type ApiKeyRow = typeof apiKeysTable.$inferSelect;
