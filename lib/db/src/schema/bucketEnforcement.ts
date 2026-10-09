import { check, integer, jsonb, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { bucketListsTable } from "./bucketLists";

/** At most one company-wide pointer. Absence/null means nothing in force.
 * Never bootstrap a list or an active enforcement on application startup. */
export const bucketEnforcementTable = pgTable("bucket_enforcement", {
  id: integer("id").primaryKey().default(1),
  listId: uuid("list_id").references(() => bucketListsTable.id, { onDelete: "restrict" }),
  version: integer("version").notNull().default(0),
  actorId: varchar("actor_id"),
  actorLabel: text("actor_label"),
  reason: text("reason"),
  enforcedAt: timestamp("enforced_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [check("bucket_enforcement_singleton", sql`${t.id} = 1`)]);

/** Immutable event snapshots survive later list edits/deletion and account
 * deletion. No FK to mutable definitions/actors, and no API to rewrite history. */
export const bucketEnforcementHistoryTable = pgTable("bucket_enforcement_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  version: integer("version").notNull(),
  action: text("action").$type<"enforced" | "replaced" | "released" | "edited">().notNull(),
  actorId: varchar("actor_id").notNull(),
  actorLabel: text("actor_label").notNull(),
  reason: text("reason").notNull(),
  listId: uuid("list_id").notNull(),
  listName: text("list_name").notNull(),
  listType: text("list_type").$type<"included" | "excluded">().notNull(),
  itemCount: integer("item_count").notNull(),
  competitorCount: integer("competitor_count").notNull(),
  competitorPriceCount: integer("competitor_price_count").notNull(),
  previousListName: text("previous_list_name"),
  beforeSnapshot: jsonb("before_snapshot").$type<Record<string, unknown> | null>(),
  snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [check("bucket_enforcement_history_action", sql`${t.action} IN ('enforced','replaced','released','edited')`)]);

export const insertBucketEnforcementSchema = createInsertSchema(bucketEnforcementTable);
export const insertBucketEnforcementHistorySchema = createInsertSchema(bucketEnforcementHistoryTable);
export type BucketEnforcementRecord = typeof bucketEnforcementTable.$inferSelect;
