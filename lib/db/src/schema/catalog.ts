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
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

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
    // Product remains live through the previous calendar day. Null means there
    // is no scheduled withdrawal.
    discontinuedFrom: date("discontinued_from", { mode: "string" }),
    discontinuedCheckedBy: text("discontinued_checked_by"),
    discontinuedStatusNote: text("discontinued_status_note"),
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

// Canonical official Prayag MRP workbooks, plus the internal manual-correction
// source used to preserve auditability when no workbook exists.
export const mrpSourcesTable = pgTable(
  "mrp_sources",
  {
    id: serial("id").primaryKey(),
    division: text("division").notNull(),
    sheetId: text("sheet_id").notNull(),
    sheetUrl: text("sheet_url").notNull(),
    expectedFileName: text("expected_file_name"),
    notes: text("notes"),
    sourceKind: text("source_kind").notNull().default("official"),
  },
  (t) => [
    uniqueIndex("mrp_sources_division_idx").on(t.division),
    uniqueIndex("mrp_sources_sheet_id_idx").on(t.sheetId),
  ],
);

// One auditable event per uploaded source snapshot. The checksum, rather than
// the filename, is the durable identity of a downloaded workbook.
export const mrpLoadBatchesTable = pgTable(
  "mrp_load_batches",
  {
    id: serial("id").primaryKey(),
    sourceId: integer("source_id")
      .notNull()
      .references(() => mrpSourcesTable.id),
    fileName: text("file_name").notNull(),
    fileSha256: text("file_sha256").notNull(),
    fileSizeBytes: integer("file_size_bytes").notNull(),
    // This comes from the person who exported the sheet; it is never inferred
    // from filesystem metadata.
    downloadedAt: date("downloaded_at", { mode: "string" }).notNull(),
    loadedAt: timestamp("loaded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    loadedBy: text("loaded_by"),
    rowCount: integer("row_count").notNull().default(0),
    notes: text("notes"),
  },
  (t) => [
    index("mrp_load_batches_source_loaded_idx").on(t.sourceId, t.loadedAt),
    index("mrp_load_batches_source_hash_idx").on(t.sourceId, t.fileSha256),
  ],
);

// An MRP upload is staged here before it is allowed to alter the catalogue or
// price history.  `payload` is the validated parse, not the source file, so an
// Apply always uses precisely the rows the reviewer saw in Preview.
export const mrpPendingBatchesTable = pgTable(
  "mrp_pending_batches",
  {
    id: serial("id").primaryKey(),
    sourceId: integer("source_id")
      .notNull()
      .references(() => mrpSourcesTable.id),
    fileName: text("file_name").notNull(),
    fileSha256: text("file_sha256").notNull(),
    fileSizeBytes: integer("file_size_bytes").notNull(),
    downloadedAt: date("downloaded_at", { mode: "string" }).notNull(),
    uploadedBy: text("uploaded_by"),
    status: text("status").notNull().default("pending"), // pending | applied | discarded | expired
    payload: text("payload").notNull(),
    preview: text("preview").notNull(),
    result: text("result"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    appliedBy: text("applied_by"),
    discardedAt: timestamp("discarded_at", { withTimezone: true }),
    discardedBy: text("discarded_by"),
    loadBatchId: integer("load_batch_id").references(() => mrpLoadBatchesTable.id),
  },
  (t) => [
    index("mrp_pending_batches_status_idx").on(t.status, t.expiresAt),
    index("mrp_pending_batches_source_hash_idx").on(t.sourceId, t.fileSha256),
  ],
);

// MRP price history is append-only for normal source loads. Source-invalid rows
// can be removed by a documented correction, and same-date manual corrections
// retain a dedicated audit batch. is_current is a recomputed cache only; every
// price and status resolver must derive truth from effective_date per item and
// variant instead of reading this stored boolean.
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
    // Imported anomalies stay pending and are ignored by every price resolver
    // until a reviewer explicitly approves them.
    reviewStatus: text("review_status").notNull().default("approved"),
    reviewReasons: text("review_reasons"),
    importBatchId: text("import_batch_id"),
    // Every active writer supplies an auditable batch. Null remains available
    // only so legacy rows can be detected and attached by the reconciliation
    // workflow.
    loadBatchId: integer("load_batch_id").references(() => mrpLoadBatchesTable.id),
    // The most recent controlled revision that touched this row. Full revision
    // history (including previous values) lives in mrp_revision_rows.
    lastRevisionBatchId: integer("last_revision_batch_id"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    // Colour / material variant within a single Cat No.  'Standard' is the base
    // article (= White for sanitaryware) and carries the existing behaviour.
    // Products with no colour options have only one 'Standard' row.
    variant: text("variant").notNull().default("Standard"),
  },
  (t) => [
    index("mrp_price_history_item_code_idx").on(t.itemCode),
    index("mrp_price_history_current_idx").on(t.itemCode, t.isCurrent),
    index("mrp_price_history_review_idx").on(t.reviewStatus, t.importBatchId),
    // Append-only safety: one price row per (item_code, effective_date, variant).
    // Makes duplicate prevention race-safe at the DB level, not just in app code.
    uniqueIndex("mrp_price_history_code_date_idx").on(
      t.itemCode,
      t.effectiveDate,
      t.variant,
    ),
  ],
);

export const mrpHistoryProvenanceEventsTable = pgTable(
  "mrp_history_provenance_events",
  {
    id: serial("id").primaryKey(),
    historyRowId: integer("history_row_id"),
    itemCode: text("item_code").notNull(),
    effectiveDate: date("effective_date", { mode: "string" }).notNull(),
    action: text("action").notNull(),
    reason: text("reason"),
    sourceFile: text("source_file"),
    loadBatchId: integer("load_batch_id"),
    previousMrp: doublePrecision("previous_mrp"),
    mrp: doublePrecision("mrp"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("mrp_history_provenance_history_idx").on(t.historyRowId),
    index("mrp_history_provenance_item_date_idx").on(t.itemCode, t.effectiveDate),
    index("mrp_history_provenance_action_idx").on(t.action),
  ],
);
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
    // Prayag MRP captured when the competitor row is reviewed/imported. This is
    // an audit snapshot only; the live analysis resolves Prayag MRP from
    // mrp_price_history for the selected as-of date so displayed gaps remain
    // consistent with the current period-aware catalog.
    prayagMrpAtCompare: doublePrecision("prayag_mrp_at_compare"),
    // Recomputed cache for the newest effectiveDate per competitor timeline.
    // Never use this stored boolean as a price or display-status source of truth;
    // derive Current/Upcoming/Superseded from effectiveDate at the requested date.
    isCurrent: boolean("is_current").notNull().default(true),
    // Price basis: 'MRP' = price is already MRP (use as-is);
    // 'Ex-GST' = price is ex-GST, multiply by (1 + gstPct/100) before comparing.
    // Null = legacy rows; fall back to checking the unit string.
    priceBasis: text("price_basis"),
    // GST percentage to apply when priceBasis = 'Ex-GST'. Default 18 when null.
    gstPct: doublePrecision("gst_pct"),
    // See mrp_price_history.last_revision_batch_id.
    lastRevisionBatchId: integer("last_revision_batch_id"),
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
    uniqueIndex("competitor_prices_editor_identity_idx").on(
      t.competitor,
      t.matchedPrayagCode,
      t.effectiveDate,
    ),
  ],
);

// A revision batch is a durable preview/apply record. Unlike an import batch,
// it never owns price rows: it only authorizes changes to rows that already
// exist. Revision rows retain the preview and before/after values so apply and
// rollback do not depend on the uploaded file remaining available.
export const mrpRevisionBatchesTable = pgTable(
  "mrp_revision_batches",
  {
    id: serial("id").primaryKey(),
    targetType: text("target_type").notNull(), // "mrp" | "competitor"
    competitor: text("competitor"),
    lockedEffectiveDate: date("locked_effective_date", { mode: "string" }),
    fileName: text("file_name").notNull(),
    fileSha256: text("file_sha256").notNull(),
    fileSizeBytes: integer("file_size_bytes").notNull(),
    uploadedBy: text("uploaded_by"),
    reason: text("reason"),
    status: text("status").notNull().default("preview"), // preview | applied | discarded | rolled_back
    warningAcknowledged: boolean("warning_acknowledged").notNull().default(false),
    rowsInFile: integer("rows_in_file").notNull().default(0),
    rowsChanged: integer("rows_changed").notNull().default(0),
    rowsNoop: integer("rows_noop").notNull().default(0),
    rowsRejected: integer("rows_rejected").notNull().default(0),
    warningCount: integer("warning_count").notNull().default(0),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    rolledBackAt: timestamp("rolled_back_at", { withTimezone: true }),
    appliedBy: text("applied_by"),
    rolledBackBy: text("rolled_back_by"),
    discardedAt: timestamp("discarded_at", { withTimezone: true }),
    discardedBy: text("discarded_by"),
    // Nullable provenance for previews produced by the deterministic MRP
    // generator. These columns intentionally do not change the existing
    // revision/apply lifecycle.
    scenarioId: integer("scenario_id"),
    runId: integer("run_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("mrp_revision_batches_created_idx").on(t.createdAt),
    index("mrp_revision_batches_status_idx").on(t.status),
    index("mrp_revision_batches_hash_idx").on(t.fileSha256),
  ],
);

// Named, immutable inputs to the deterministic MRP generator. JSONB is used
// for scope/rules so adding a validated rule type remains additive.
export const mrpGeneratorScenariosTable = pgTable(
  "mrp_generator_scenarios",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    scope: text("scope").notNull(),
    rules: text("rules").notNull(),
    version: integer("version").notNull().default(1),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("mrp_generator_scenarios_name_idx").on(t.name),
    index("mrp_generator_scenarios_created_idx").on(t.createdAt),
  ],
);

export const mrpGeneratorRunsTable = pgTable(
  "mrp_generator_runs",
  {
    id: serial("id").primaryKey(),
    scenarioId: integer("scenario_id").notNull().references(() => mrpGeneratorScenariosTable.id),
    asOf: date("as_of").notNull(),
    inputSnapshot: text("input_snapshot").notNull(),
    inputFingerprint: text("input_fingerprint").notNull(),
    summary: text("summary").notNull(),
    sourceFreshness: text("source_freshness").notNull(),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("mrp_generator_runs_scenario_idx").on(t.scenarioId, t.createdAt),
    index("mrp_generator_runs_fingerprint_idx").on(t.inputFingerprint),
  ],
);

export const mrpGeneratorResultsTable = pgTable(
  "mrp_generator_results",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id").notNull().references(() => mrpGeneratorRunsTable.id),
    itemCode: text("item_code").notNull(),
    productName: text("product_name"),
    division: text("division"),
    category: text("category"),
    currentMrp: doublePrecision("current_mrp"),
    currentDate: date("current_date"),
    currentRowId: integer("current_row_id"),
    suggestedMrp: doublePrecision("suggested_mrp"),
    status: text("status").notNull(),
    exclusions: text("exclusions").notNull().default("[]"),
    competitorValues: text("competitor_values").notNull().default("[]"),
    trace: text("trace").notNull().default("[]"),
    competitiveTarget: doublePrecision("competitive_target"),
    bindingConstraint: text("binding_constraint"),
    changePercent: doublePrecision("change_percent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("mrp_generator_results_run_idx").on(t.runId, t.itemCode),
    uniqueIndex("mrp_generator_results_run_code_idx").on(t.runId, t.itemCode),
  ],
);

// One row per uploaded revision row. target_row_id points to the exact
// existing price row that may be changed; null rows are rejected and can never
// be written. The target type determines whether old/new values refer to mrp
// or competitor_prices.price.
export const mrpRevisionRowsTable = pgTable(
  "mrp_revision_rows",
  {
    id: serial("id").primaryKey(),
    batchId: integer("batch_id")
      .notNull()
      .references(() => mrpRevisionBatchesTable.id),
    rowNumber: integer("row_number").notNull(),
    itemCode: text("item_code"),
    effectiveDate: date("effective_date", { mode: "string" }),
    variant: text("variant").notNull().default("Standard"),
    competitor: text("competitor"),
    targetRowId: integer("target_row_id"),
    previousValue: doublePrecision("previous_value"),
    newValue: doublePrecision("new_value"),
    note: text("note"),
    outcome: text("outcome").notNull(), // change | noop | rejected
    rejectionReason: text("rejection_reason"),
    warningReasons: text("warning_reasons"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("mrp_revision_rows_batch_idx").on(t.batchId),
    index("mrp_revision_rows_target_idx").on(t.targetRowId),
    index("mrp_revision_rows_outcome_idx").on(t.batchId, t.outcome),
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
    // Immutable identity of the uploaded source. This is audit metadata only:
    // the same PDF may be intentionally re-extracted to investigate variance.
    fileSha256: text("file_sha256"),
    fileSizeBytes: integer("file_size_bytes"),
    // Versioned extractor inputs make two batches comparable without relying on
    // filenames or deployment timestamps.
    extractorVersion: text("extractor_version"),
    catalogueProfileRevision: text("catalogue_profile_revision"),
    promptRevision: text("prompt_revision"),
    model: text("model"),
    // JSON array of original 1-based catalogue pages requested for extraction.
    pagesRequested: text("pages_requested"),
    // Two independent discovery reads always run; pages with disagreement get
    // one additional adjudication read.
    passesRun: integer("passes_run"),
    itemsAdjudicated: integer("items_adjudicated"),
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
    // JSON evidence of the independent discovery reads that found this code,
    // plus the final accepted pass. Keeps review decisions auditable.
    discoveryEvidence: text("discovery_evidence"),
    adjudicated: boolean("adjudicated").notNull().default(false),
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

// Durable audit for explicit development → production catalog bundle imports.
// The bundle itself is never stored; only its digest and before/after summaries.
export const catalogSyncAuditsTable = pgTable(
  "catalog_sync_audits",
  {
    id: serial("id").primaryKey(),
    bundleSha256: text("bundle_sha256").notNull(),
    bundleCreatedAt: timestamp("bundle_created_at", { withTimezone: true }).notNull(),
    actorEmail: text("actor_email").notNull(),
    status: text("status").notNull(),
    beforeSummary: text("before_summary").notNull(),
    afterSummary: text("after_summary"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("catalog_sync_audits_started_idx").on(t.startedAt),
    index("catalog_sync_audits_bundle_idx").on(t.bundleSha256),
  ],
);

// Durable, per-product audit trail for narrowly scoped catalogue-name repairs.
// Price corrections belong in MRP provenance instead and must never be written
// through this table.
export const catalogProductNameCorrectionsTable = pgTable(
  "catalog_product_name_corrections",
  {
    id: serial("id").primaryKey(),
    correctionKey: text("correction_key").notNull(),
    itemCode: text("item_code").notNull(),
    previousName: text("previous_name"),
    correctedName: text("corrected_name").notNull(),
    reason: text("reason").notNull(),
    appliedAt: timestamp("applied_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("catalog_product_name_corrections_key_idx").on(t.correctionKey),
    index("catalog_product_name_corrections_item_idx").on(t.itemCode),
  ],
);

// Immutable audit entries for the single-product price editor.  Price rows are
// deliberately not embedded here: this table remains useful when a first
// competitor mapping is added (there is no previous row/value) and when an
// edit is undone (the original entry is retained).
export const catalogPriceEditAuditsTable = pgTable(
  "catalog_price_edit_audits",
  {
    id: serial("id").primaryKey(),
    actor: text("actor").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    itemCode: text("item_code").notNull(),
    series: text("series").notNull(), // Prayag MRP or configured competitor
    operationType: text("operation_type").notNull(), // save | reversal
    oldValue: doublePrecision("old_value"),
    previousResolvedValue: doublePrecision("previous_resolved_value"),
    newValue: doublePrecision("new_value"),
    effectiveDate: date("effective_date", { mode: "string" }).notNull(),
    remarks: text("remarks").notNull(),
    originalAuditId: integer("original_audit_id"),
    targetRowId: integer("target_row_id"),
  },
  (t) => [
    index("catalog_price_edit_audits_item_idx").on(t.itemCode, t.createdAt),
    index("catalog_price_edit_audits_original_idx").on(t.originalAuditId),
    uniqueIndex("catalog_price_edit_audits_reversal_once_idx")
      .on(t.originalAuditId)
      .where(sql`${t.operationType} = 'reversal'`),
    check(
      "catalog_price_edit_audits_operation_check",
      sql`${t.operationType} in ('save', 'reversal')`,
    ),
  ],
);

export type CatalogProduct = typeof catalogProductsTable.$inferSelect;
export type MrpPriceRow = typeof mrpPriceHistoryTable.$inferSelect;
export type MrpPendingBatch = typeof mrpPendingBatchesTable.$inferSelect;

export type MrpHistoryProvenanceEvent =
  typeof mrpHistoryProvenanceEventsTable.$inferSelect;
export type CodeConflict = typeof codeConflictsTable.$inferSelect;
export type CompetitorPrice = typeof competitorPricesTable.$inferSelect;
export type AcceptBatch = typeof acceptBatchesTable.$inferSelect;
export type DiscountSetting = typeof discountSettingsTable.$inferSelect;
export type ImportBatch = typeof importBatchesTable.$inferSelect;
export type CompetitorPriceStaging = typeof competitorPriceStagingTable.$inferSelect;
export type CompetitorCodeAlias = typeof competitorCodeAliasesTable.$inferSelect;
export type CatalogSyncAudit = typeof catalogSyncAuditsTable.$inferSelect;
export type CatalogProductNameCorrection =
  typeof catalogProductNameCorrectionsTable.$inferSelect;
export type CatalogPriceEditAudit = typeof catalogPriceEditAuditsTable.$inferSelect;
