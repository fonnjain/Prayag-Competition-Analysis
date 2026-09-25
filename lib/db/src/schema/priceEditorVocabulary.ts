import { createInsertSchema } from "drizzle-zod";
import { pgTable, serial, text, boolean, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const locallyAddedDivisionsTable = pgTable(
  "price_editor_local_divisions",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    normalizedKey: text("normalized_key").notNull(),
    actor: text("actor").notNull(),
    reason: text("reason").notNull(),
    salesMapped: boolean("sales_mapped").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("price_editor_local_divisions_normalized_key_idx").on(t.normalizedKey),
  ],
);

export const locallyAddedCategoriesTable = pgTable(
  "price_editor_local_categories",
  {
    id: serial("id").primaryKey(),
    division: text("division").notNull(),
    divisionKey: text("division_key").notNull(),
    name: text("name").notNull(),
    normalizedKey: text("normalized_key").notNull(),
    actor: text("actor").notNull(),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("price_editor_local_categories_division_name_key_idx").on(t.divisionKey, t.normalizedKey),
    index("price_editor_local_categories_division_idx").on(t.divisionKey),
  ],
);

export const locallyAddedSeriesTable = pgTable(
  "price_editor_local_series",
  {
    id: serial("id").primaryKey(),
    division: text("division").notNull(),
    divisionKey: text("division_key").notNull(),
    name: text("name").notNull(),
    normalizedKey: text("normalized_key").notNull(),
    actor: text("actor").notNull(),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("price_editor_local_series_division_name_key_idx").on(t.divisionKey, t.normalizedKey),
    index("price_editor_local_series_division_idx").on(t.divisionKey),
  ],
);

export const insertLocallyAddedDivisionSchema = createInsertSchema(locallyAddedDivisionsTable).omit({ id: true, createdAt: true });
export const insertLocallyAddedCategorySchema = createInsertSchema(locallyAddedCategoriesTable).omit({ id: true, createdAt: true });
export const insertLocallyAddedSeriesSchema = createInsertSchema(locallyAddedSeriesTable).omit({ id: true, createdAt: true });
export type InsertLocallyAddedDivision = z.infer<typeof insertLocallyAddedDivisionSchema>;
export type LocallyAddedDivision = typeof locallyAddedDivisionsTable.$inferSelect;
export type InsertLocallyAddedCategory = z.infer<typeof insertLocallyAddedCategorySchema>;
export type LocallyAddedCategory = typeof locallyAddedCategoriesTable.$inferSelect;
export type InsertLocallyAddedSeries = z.infer<typeof insertLocallyAddedSeriesSchema>;
export type LocallyAddedSeries = typeof locallyAddedSeriesTable.$inferSelect;