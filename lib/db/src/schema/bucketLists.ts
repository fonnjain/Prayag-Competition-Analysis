import { check, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { usersTable } from "./auth";

export type BucketRule = { division?: string; category?: string; range?: string };

export const bucketListsTable = pgTable("bucket_lists", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: varchar("owner_id").notNull().references(() => usersTable.id),
  name: text("name").notNull(),
  nameKey: text("name_key").notNull(),
  description: text("description"),
  type: text("type").$type<"included" | "excluded">().notNull(),
  visibility: text("visibility").$type<"everyone" | "only_me">().notNull().default("only_me"),
  // Parent changes/deletion are serialized by the bucket service. No cascading
  // deletion: children must freeze their resolved members before a parent goes.
  parentId: uuid("parent_id"),
  rules: jsonb("rules").$type<BucketRule[]>().notNull().default([]),
  addedCodes: jsonb("added_codes").$type<string[]>().notNull().default([]),
  removedCodes: jsonb("removed_codes").$type<string[]>().notNull().default([]),
  // Historical rule observations retain deleted/retired codes in the editor;
  // they do not keep a live product that stopped matching a rule in the set.
  observedCodes: jsonb("observed_codes").$type<string[]>().notNull().default([]),
  detachedNotice: text("detached_notice"),
  createdBy: varchar("created_by").notNull(),
  updatedBy: varchar("updated_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("bucket_lists_owner_name_key").on(t.ownerId, t.nameKey),
  check("bucket_list_type", sql`${t.type} IN ('included', 'excluded')`),
  check("bucket_list_visibility", sql`${t.visibility} IN ('everyone', 'only_me')`),
]);

export const bucketPreferencesTable = pgTable("bucket_preferences", {
  userId: varchar("user_id").primaryKey().references(() => usersTable.id),
  activeListId: uuid("active_list_id").references(() => bucketListsTable.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertBucketListSchema = createInsertSchema(bucketListsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type BucketListRecord = typeof bucketListsTable.$inferSelect;