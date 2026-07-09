import {
  pgTable,
  serial,
  integer,
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

// Competitor price points (one row per competitor SKU). Kept generic via the
// `competitor` column so other brands (Finolex, Astral, Supreme, ...) load in
// the same shape. matched_prayag_code links to catalog_products.item_code when
// a mapping exists; diff% vs Prayag's current MRP is always computed live.
export const competitorPricesTable = pgTable(
  "competitor_prices",
  {
    id: serial("id").primaryKey(),
    competitor: text("competitor").notNull(),
    category: text("category"),
    description: text("description"),
    size: text("size"),
    // Nullable: a verified mapping can exist (competitor code known) before the
    // competitor's MRP is available. Null-price rows are stored but excluded
    // from all live gap computations.
    price: doublePrecision("price"),
    unit: text("unit"),
    // Competitor's own catalogue number (e.g. Sparsh Pearl "ED-950"), when the
    // source sheet provides one.
    competitorCode: text("competitor_code"),
    effectiveDate: date("effective_date"),
    matchedPrayagCode: text("matched_prayag_code"),
    matchStatus: text("match_status").notNull().default("no match (review)"),
    // Mapping quality tier: "High" | "Medium" | "Low" | null. Provided by
    // prebuilt competitor mappings (e.g. Ashirvad) or "High" for exact-code
    // matches; null when unknown. High/Medium are auto-accepted; Low + no-match
    // go to manual review.
    matchConfidence: text("match_confidence"),
    // Period-matched Prayag MRP captured at compare/import time, taken straight
    // from the verified competitor sheet's prayag_mrp (or snapshotted from the
    // catalog at import time for auto-matched uploads). The competitor gap is
    // computed ONLY against this persisted value — never a fresh
    // catalog_products / mrp_price_history lookup — so a row's comparison stays
    // stable even as the master catalog MRP changes over time.
    prayagMrpAtCompare: doublePrecision("prayag_mrp_at_compare"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("competitor_prices_matched_code_idx").on(t.matchedPrayagCode),
    index("competitor_prices_competitor_idx").on(t.competitor),
    index("competitor_prices_category_idx").on(t.category),
  ],
);

// Audit trail of bulk/auto accept batches so reviewers can revert a batch even
// after dismissing the success toast or navigating away. Each row records the
// exact competitor_prices ids that were accepted together; a revert re-runs the
// bulk PATCH against those ids and then deletes the batch.
export const acceptBatchesTable = pgTable(
  "accept_batches",
  {
    id: serial("id").primaryKey(),
    // "bulk" (Accept selected) | "auto" (Auto-accept all).
    kind: text("kind").notNull(),
    competitor: text("competitor"),
    competitorPriceIds: integer("competitor_price_ids").array().notNull(),
    count: integer("count").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("accept_batches_created_idx").on(t.createdAt)],
);

// Per-scope discount settings for the Net-to-Net comparison mode on the
// Competition Analysis dashboard. One row per scope: scope "prayag" holds
// Prayag's own discount; every other scope is a competitor brand name. Values
// are percentages (0-100). Net prices are always computed live from these — the
// discounts are never baked into stored prices.
export const discountSettingsTable = pgTable(
  "discount_settings",
  {
    id: serial("id").primaryKey(),
    scope: text("scope").notNull(),
    discountPct: doublePrecision("discount_pct").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("discount_settings_scope_idx").on(t.scope)],
);

export type CatalogProduct = typeof catalogProductsTable.$inferSelect;
export type MrpPriceRow = typeof mrpPriceHistoryTable.$inferSelect;
export type CodeConflict = typeof codeConflictsTable.$inferSelect;
export type CompetitorPrice = typeof competitorPricesTable.$inferSelect;
export type AcceptBatch = typeof acceptBatchesTable.$inferSelect;
export type DiscountSetting = typeof discountSettingsTable.$inferSelect;
