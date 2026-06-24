import {
  pgTable,
  serial,
  text,
  doublePrecision,
  boolean,
  date,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Central product catalog (one row per unique product). Namespaced as
// `catalog_products` to avoid colliding with the Competition Console `products`
// table that shares this database.
export const catalogProductsTable = pgTable(
  "catalog_products",
  {
    id: serial("id").primaryKey(),
    itemCode: text("item_code").notNull(),
    productName: text("product_name"),
    division: text("division"),
    category: text("category"),
    seriesRange: text("series_range"),
    size: text("size"),
    uom: text("uom").notNull().default("NOS"),
    kgCost: doublePrecision("kg_cost"),
    isActive: boolean("is_active").notNull().default(true),
    sourceFiles: text("source_files"),
    dataFlag: text("data_flag"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("catalog_products_item_code_idx").on(t.itemCode),
    index("catalog_products_division_idx").on(t.division),
    index("catalog_products_category_idx").on(t.category),
  ],
);

// Append-only MRP price history. Every load INSERTs new rows; old rows are
// never updated or deleted. is_current is recomputed per item_code (latest
// effective_date) after each load.
export const mrpPriceHistoryTable = pgTable(
  "mrp_price_history",
  {
    id: serial("id").primaryKey(),
    itemCode: text("item_code").notNull(),
    mrp: doublePrecision("mrp"),
    netPrice: doublePrecision("net_price"),
    discountPct: doublePrecision("discount_pct"),
    priceBasis: text("price_basis").notNull().default("Verify"),
    effectiveDate: date("effective_date").notNull(),
    loadDate: date("load_date").notNull(),
    sourceFile: text("source_file"),
    isCurrent: boolean("is_current").notNull().default(false),
    notes: text("notes"),
  },
  (t) => [
    index("mrp_price_history_item_code_idx").on(t.itemCode),
    index("mrp_price_history_current_idx").on(t.itemCode, t.isCurrent),
    // Append-only safety: one price row per (item_code, effective_date).
    // Makes duplicate prevention race-safe at the DB level, not just in app code.
    uniqueIndex("mrp_price_history_code_date_idx").on(
      t.itemCode,
      t.effectiveDate,
    ),
  ],
);

// Known item-code conflicts flagged during cleaning (same code, different
// names across source files). Surfaced on the Data Health page.
export const codeConflictsTable = pgTable("code_conflicts", {
  itemCode: text("item_code").primaryKey(),
  conflictingNames: text("conflicting_names"),
  sources: text("sources"),
});

export type CatalogProduct = typeof catalogProductsTable.$inferSelect;
export type MrpPriceRow = typeof mrpPriceHistoryTable.$inferSelect;
export type CodeConflict = typeof codeConflictsTable.$inferSelect;
