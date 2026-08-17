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
    // Append-only period flag. True for the newest effectiveDate per
    // (competitor, matchedPrayagCode) pair. Recomputed after every import.
    // Mirrors the same concept as mrp_price_history.isCurrent.
    isCurrent: boolean("is_current").notNull().default(true),
    // Price basis: 'MRP' = price is already MRP (use as-is);
    // 'Ex-GST' = price is ex-GST, multiply by (1 + gstPct/100) before comparing.
    // Null = legacy rows; fall back to checking the unit string.
    priceBasis: text("price_basis"),
    // GST percentage to apply when priceBasis = 'Ex-GST'. Default 18 when null.
    gstPct: doublePrecision("gst_pct"),
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
    index("competitor_prices_current_idx").on(t.competitor, t.isCurrent),
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

// ---------------------------------------------------------------------------
// PDF Catalogue Import — Staging System
// ---------------------------------------------------------------------------

// One row per import attempt. Covers both PDF and Excel/CSV uploads.
// Status lifecycle: 'pending' → 'approved' | 'discarded'.
// Multiple pending batches may coexist (one per upload); they are approved or
// discarded independently.
export const importBatchesTable = pgTable(
  "import_batches",
  {
    id: serial("id").primaryKey(),
    competitor: text("competitor").notNull(),
    effectiveDate: date("effective_date").notNull(),
    sourceFileName: text("source_file_name").notNull(),
    // 'MRP' = prices are final MRP, use as-is.
    // 'Ex-GST' = prices are ex-GST; apply gstPct before comparing to Prayag MRP.
    priceBasis: text("price_basis").notNull().default("MRP"),
    gstPct: doublePrecision("gst_pct"),
    // 'pending' = staged, awaiting user review.
    // 'approved' = committed to competitor_prices.
    // 'discarded' = staging rows deleted, batch kept for audit.
    status: text("status").notNull().default("pending"),
    // JSON summary: { ok, needs_review, not_found, new_products }
    rowCounts: text("row_counts"),
    // Claude model used for PDF extraction. Null for Excel/CSV imports.
    extractionModel: text("extraction_model"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("import_batches_status_idx").on(t.status),
    index("import_batches_competitor_idx").on(t.competitor),
  ],
);

// One row per extracted+matched item in a batch. Nothing touches
// competitor_prices until the batch is approved.
export const competitorPriceStagingTable = pgTable(
  "competitor_price_staging",
  {
    id: serial("id").primaryKey(),
    batchId: integer("batch_id").notNull(),
    competitor: text("competitor").notNull(),
    // The code as it appears in the existing competitor_prices mapping (master).
    competitorCodeMaster: text("competitor_code_master"),
    // The code as it appears in the uploaded catalogue (may differ via alias).
    competitorCodeCatalogue: text("competitor_code_catalogue"),
    matchedPrayagCode: text("matched_prayag_code"),
    // Expected product description from the existing Prayag mapping.
    description: text("description"),
    // Product description extracted from the PDF.
    catalogueDescription: text("catalogue_description"),
    // Size / variant qualifier extracted from the PDF (e.g. "15mm", "1 Mtr").
    variant: text("variant"),
    // Price currently stored in competitor_prices for this product.
    oldMrp: doublePrecision("old_mrp"),
    // Price extracted from the catalogue.
    newMrp: doublePrecision("new_mrp"),
    // (newMrp - oldMrp) / oldMrp * 100 — stored for display only.
    increasePct: doublePrecision("increase_pct"),
    // Live Prayag MRP at staging time (from mrp_price_history is_current = true).
    prayagMrpCurrent: doublePrecision("prayag_mrp_current"),
    // (effectiveCompetitorPrice - prayagMrp) / prayagMrp * 100.
    gapPct: doublePrecision("gap_pct"),
    // Page number in the source PDF where this item was found.
    page: integer("page"),
    // 'code+desc' = matched by code (and description/size agreed).
    // 'desc+size' = matched by description + size (code differed — renumbering).
    matchMethod: text("match_method"),
    // 'ok' = ready to approve.
    // 'needs_review' = code matched but description/size disagreed, or desc+size match.
    // 'not_found' = target not found in the catalogue at all.
    // 'new_product' = found in catalogue but not in the mapping.
    status: text("status").notNull().default("ok"),
    reviewReason: text("review_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("cps_batch_idx").on(t.batchId),
    index("cps_status_idx").on(t.status),
    index("cps_competitor_idx").on(t.competitor),
  ],
);

// Code aliases: when a competitor renumbers a product between catalogue
// versions, record the mapping here so future imports apply it automatically.
// Seeded with known Sparsh Pearl aliases from Vol 6.2.
export const competitorCodeAliasesTable = pgTable(
  "competitor_code_aliases",
  {
    id: serial("id").primaryKey(),
    competitor: text("competitor").notNull(),
    // Code used in the existing competitor_prices master mapping.
    oldCode: text("old_code").notNull(),
    // Code that appears in the catalogue (current/new code).
    newCode: text("new_code").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("cca_competitor_old_idx").on(t.competitor, t.oldCode),
  ],
);

export type CatalogProduct = typeof catalogProductsTable.$inferSelect;
export type MrpPriceRow = typeof mrpPriceHistoryTable.$inferSelect;
export type CodeConflict = typeof codeConflictsTable.$inferSelect;
export type CompetitorPrice = typeof competitorPricesTable.$inferSelect;
export type AcceptBatch = typeof acceptBatchesTable.$inferSelect;
export type DiscountSetting = typeof discountSettingsTable.$inferSelect;
export type ImportBatch = typeof importBatchesTable.$inferSelect;
export type CompetitorPriceStaging = typeof competitorPriceStagingTable.$inferSelect;
export type CompetitorCodeAlias = typeof competitorCodeAliasesTable.$inferSelect;
