var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// ../../.local/p049-step3-audit.ts
import fs from "node:fs";
import path from "node:path";
import * as XLSX5 from "/home/runner/workspace/node_modules/.pnpm/xlsx@0.18.5/node_modules/xlsx/xlsx.js";

// src/lib/authoritativeMrpMaster.ts
import * as XLSX from "/home/runner/workspace/node_modules/.pnpm/xlsx@0.18.5/node_modules/xlsx/xlsx.js";

// ../../lib/formatting/src/index.ts
var money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});
var RANGE_DIVISIONS = [
  "CP Fittings / Faucets",
  "CP (QUAA / FERN)",
  "PTMT & Plastic Fittings"
];
function supportsCatalogRange(division) {
  return RANGE_DIVISIONS.some((value) => value === division);
}
function masterClassification(row) {
  if (!row.category?.trim()) {
    throw new Error(`Product ${row.itemCode}: a real Category is required before insertion; CP/PTMT Range cannot be used as Category.`);
  }
  return {
    category: row.category.trim(),
    ...supportsCatalogRange(row.division) ? { seriesRange: row.series } : {}
  };
}
var moneyWhole = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0
});
var count = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 0
});

// src/lib/authoritativeMrpMaster.ts
import { and as and2, eq as eq3, sql as sql5 } from "/home/runner/workspace/node_modules/.pnpm/drizzle-orm@0.45.2_@types+pg@8.20.0_pg@8.20.0/node_modules/drizzle-orm/index.cjs";

// ../../lib/db/src/index.ts
import { drizzle } from "/home/runner/workspace/node_modules/.pnpm/drizzle-orm@0.45.2_@types+pg@8.20.0_pg@8.20.0/node_modules/drizzle-orm/node-postgres/index.cjs";
import pg from "/home/runner/workspace/node_modules/.pnpm/pg@8.20.0/node_modules/pg/lib/index.js";

// ../../lib/db/src/schema/index.ts
var schema_exports = {};
__export(schema_exports, {
  acceptBatchesTable: () => acceptBatchesTable,
  activityDailySummariesTable: () => activityDailySummariesTable,
  activityEventsTable: () => activityEventsTable,
  activitySessionDailySummariesTable: () => activitySessionDailySummariesTable,
  activitySessionsTable: () => activitySessionsTable,
  apiKeysTable: () => apiKeysTable,
  apolloReservationsTable: () => apolloReservationsTable,
  catalogPriceEditAuditsTable: () => catalogPriceEditAuditsTable,
  catalogProductClassificationCorrectionsTable: () => catalogProductClassificationCorrectionsTable,
  catalogProductNameCorrectionsTable: () => catalogProductNameCorrectionsTable,
  catalogProductsTable: () => catalogProductsTable,
  catalogSyncAuditsTable: () => catalogSyncAuditsTable,
  codeConflictsTable: () => codeConflictsTable,
  competitorCodeAliasesTable: () => competitorCodeAliasesTable,
  competitorMappingDecisionsTable: () => competitorMappingDecisionsTable,
  competitorPriceStagingTable: () => competitorPriceStagingTable,
  competitorPricesTable: () => competitorPricesTable,
  discountSettingsTable: () => discountSettingsTable,
  importBatchesTable: () => importBatchesTable,
  insertLocallyAddedCategorySchema: () => insertLocallyAddedCategorySchema,
  insertLocallyAddedDivisionSchema: () => insertLocallyAddedDivisionSchema,
  insertLocallyAddedSeriesSchema: () => insertLocallyAddedSeriesSchema,
  locallyAddedCategoriesTable: () => locallyAddedCategoriesTable,
  locallyAddedDivisionsTable: () => locallyAddedDivisionsTable,
  locallyAddedSeriesTable: () => locallyAddedSeriesTable,
  mrpGeneratorResultsTable: () => mrpGeneratorResultsTable,
  mrpGeneratorRunsTable: () => mrpGeneratorRunsTable,
  mrpGeneratorScenariosTable: () => mrpGeneratorScenariosTable,
  mrpHistoryProvenanceEventsTable: () => mrpHistoryProvenanceEventsTable,
  mrpLoadBatchesTable: () => mrpLoadBatchesTable,
  mrpPendingBatchesTable: () => mrpPendingBatchesTable,
  mrpPriceHistoryTable: () => mrpPriceHistoryTable,
  mrpProvenanceBackfillRunsTable: () => mrpProvenanceBackfillRunsTable,
  mrpRevisionBatchesTable: () => mrpRevisionBatchesTable,
  mrpRevisionRowsTable: () => mrpRevisionRowsTable,
  mrpSourcesTable: () => mrpSourcesTable,
  newProductPreviewStatesTable: () => newProductPreviewStatesTable,
  productLifecycleBatchesTable: () => productLifecycleBatchesTable,
  sessionsTable: () => sessionsTable,
  usersTable: () => usersTable
});

// ../../lib/db/src/schema/catalog.ts
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
  check
} from "/home/runner/workspace/node_modules/.pnpm/drizzle-orm@0.45.2_@types+pg@8.20.0_pg@8.20.0/node_modules/drizzle-orm/pg-core/index.cjs";
import { sql } from "/home/runner/workspace/node_modules/.pnpm/drizzle-orm@0.45.2_@types+pg@8.20.0_pg@8.20.0/node_modules/drizzle-orm/index.cjs";
var catalogProductsTable = pgTable(
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    uniqueIndex("catalog_products_item_code_idx").on(t.itemCode),
    index("catalog_products_division_idx").on(t.division),
    index("catalog_products_category_idx").on(t.category)
  ]
);
var productLifecycleBatchesTable = pgTable(
  "product_lifecycle_batches",
  {
    id: serial("id").primaryKey(),
    action: text("action").notNull(),
    // delete | retire
    itemCode: text("item_code").notNull(),
    actor: text("actor").notNull(),
    reason: text("reason"),
    snapshot: text("snapshot").notNull(),
    priceRowCount: integer("price_row_count").notNull().default(0),
    loadBatchId: integer("load_batch_id").references(() => mrpLoadBatchesTable.id),
    beforeCount: integer("before_count").notNull(),
    afterCount: integer("after_count"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    undoneAt: timestamp("undone_at", { withTimezone: true }),
    undoneBy: text("undone_by")
  },
  (t) => [
    index("product_lifecycle_batches_item_idx").on(t.itemCode, t.createdAt),
    index("product_lifecycle_batches_action_idx").on(t.action, t.createdAt)
  ]
);
var mrpSourcesTable = pgTable(
  "mrp_sources",
  {
    id: serial("id").primaryKey(),
    division: text("division").notNull(),
    sheetId: text("sheet_id").notNull(),
    sheetUrl: text("sheet_url").notNull(),
    expectedFileName: text("expected_file_name"),
    notes: text("notes"),
    sourceKind: text("source_kind").notNull().default("official")
  },
  (t) => [
    uniqueIndex("mrp_sources_division_idx").on(t.division),
    uniqueIndex("mrp_sources_sheet_id_idx").on(t.sheetId)
  ]
);
var mrpLoadBatchesTable = pgTable(
  "mrp_load_batches",
  {
    id: serial("id").primaryKey(),
    sourceId: integer("source_id").notNull().references(() => mrpSourcesTable.id),
    fileName: text("file_name"),
    fileSha256: text("file_sha256"),
    fileSizeBytes: integer("file_size_bytes"),
    // This comes from the person who exported the sheet; it is never inferred
    // from filesystem metadata.
    downloadedAt: date("downloaded_at", { mode: "string" }),
    loadedAt: timestamp("loaded_at", { withTimezone: true }).notNull().defaultNow(),
    loadedBy: text("loaded_by"),
    rowCount: integer("row_count").notNull().default(0),
    notes: text("notes")
  },
  (t) => [
    index("mrp_load_batches_source_loaded_idx").on(t.sourceId, t.loadedAt),
    index("mrp_load_batches_source_hash_idx").on(t.sourceId, t.fileSha256)
  ]
);
var mrpPendingBatchesTable = pgTable(
  "mrp_pending_batches",
  {
    id: serial("id").primaryKey(),
    sourceId: integer("source_id").notNull().references(() => mrpSourcesTable.id),
    fileName: text("file_name").notNull(),
    fileSha256: text("file_sha256").notNull(),
    fileSizeBytes: integer("file_size_bytes").notNull(),
    downloadedAt: date("downloaded_at", { mode: "string" }).notNull(),
    uploadedBy: text("uploaded_by"),
    status: text("status").notNull().default("pending"),
    // pending | applied | discarded | expired
    payload: text("payload").notNull(),
    preview: text("preview").notNull(),
    result: text("result"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    appliedBy: text("applied_by"),
    discardedAt: timestamp("discarded_at", { withTimezone: true }),
    discardedBy: text("discarded_by"),
    loadBatchId: integer("load_batch_id").references(() => mrpLoadBatchesTable.id)
  },
  (t) => [
    index("mrp_pending_batches_status_idx").on(t.status, t.expiresAt),
    index("mrp_pending_batches_source_hash_idx").on(t.sourceId, t.fileSha256)
  ]
);
var mrpPriceHistoryTable = pgTable(
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
    // Every history row must have an auditable load batch.
    loadBatchId: integer("load_batch_id").notNull().references(() => mrpLoadBatchesTable.id),
    // The most recent controlled revision that touched this row. Full revision
    // history (including previous values) lives in mrp_revision_rows.
    lastRevisionBatchId: integer("last_revision_batch_id"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    // Colour / material variant within a single Cat No.  'Standard' is the base
    // article (= White for sanitaryware) and carries the existing behaviour.
    // Products with no colour options have only one 'Standard' row.
    variant: text("variant").notNull().default("Standard")
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
      t.variant
    )
  ]
);
var mrpHistoryProvenanceEventsTable = pgTable(
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    index("mrp_history_provenance_history_idx").on(t.historyRowId),
    index("mrp_history_provenance_item_date_idx").on(t.itemCode, t.effectiveDate),
    index("mrp_history_provenance_action_idx").on(t.action)
  ]
);
var mrpProvenanceBackfillRunsTable = pgTable("mrp_provenance_backfill_runs", {
  id: serial("id").primaryKey(),
  status: text("status").notNull().default("preview"),
  // preview | applied | undone
  actor: text("actor").notNull(),
  preview: text("preview").notNull(),
  snapshot: text("snapshot").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
  undoneAt: timestamp("undone_at", { withTimezone: true })
});
var codeConflictsTable = pgTable("code_conflicts", {
  itemCode: text("item_code").primaryKey(),
  conflictingNames: text("conflicting_names"),
  sources: text("sources")
});
var competitorPricesTable = pgTable(
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
    // Provenance of competitorCode. Legacy rows are explicitly unverified until
    // reviewed; never infer supplier or locally assigned from the competitor.
    codeSource: text("code_source").notNull().default("unverified"),
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
    loadBatchId: integer("load_batch_id").references(() => mrpLoadBatchesTable.id),
    // See mrp_price_history.last_revision_batch_id.
    lastRevisionBatchId: integer("last_revision_batch_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    index("competitor_prices_matched_code_idx").on(t.matchedPrayagCode),
    index("competitor_prices_competitor_idx").on(t.competitor),
    index("competitor_prices_category_idx").on(t.category),
    index("competitor_prices_current_idx").on(t.competitor, t.isCurrent),
    uniqueIndex("competitor_prices_editor_identity_idx").on(
      t.competitor,
      t.matchedPrayagCode,
      t.effectiveDate
    ),
    check(
      "competitor_prices_code_source_check",
      sql`${t.codeSource} in ('supplier', 'locally_assigned', 'unverified')`
    )
  ]
);
var competitorMappingDecisionsTable = pgTable(
  "competitor_mapping_decisions",
  {
    id: serial("id").primaryKey(),
    competitor: text("competitor").notNull(),
    competitorCode: text("competitor_code").notNull(),
    prayagCode: text("prayag_code").notNull(),
    decision: text("decision").notNull(),
    // exclusion | confirmation
    reason: text("reason").notNull(),
    promptVersion: text("prompt_version").notNull(),
    actor: text("actor"),
    batchId: integer("batch_id"),
    previousRowSnapshot: text("previous_row_snapshot"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    undoneAt: timestamp("undone_at", { withTimezone: true }),
    undoneBy: text("undone_by")
  },
  (t) => [
    uniqueIndex("competitor_mapping_decision_identity_idx").on(
      t.competitor,
      t.competitorCode,
      t.prayagCode
    ),
    index("competitor_mapping_decision_lookup_idx").on(
      t.competitor,
      t.competitorCode,
      t.decision
    ),
    check("competitor_mapping_decision_type_check", sql`${t.decision} in ('exclusion','confirmation')`),
    check("competitor_mapping_decision_reason_check", sql`length(trim(${t.reason})) > 0`),
    check("competitor_mapping_decision_batch_check", sql`${t.batchId} is null or ${t.batchId} > 0`),
    check(
      "competitor_mapping_decision_undo_audit_check",
      sql`(${t.undoneAt} is null and ${t.undoneBy} is null) or (${t.undoneAt} is not null and ${t.undoneBy} is not null)`
    )
  ]
);
var mrpRevisionBatchesTable = pgTable(
  "mrp_revision_batches",
  {
    id: serial("id").primaryKey(),
    targetType: text("target_type").notNull(),
    // "mrp" | "competitor"
    competitor: text("competitor"),
    lockedEffectiveDate: date("locked_effective_date", { mode: "string" }),
    fileName: text("file_name").notNull(),
    fileSha256: text("file_sha256").notNull(),
    fileSizeBytes: integer("file_size_bytes").notNull(),
    uploadedBy: text("uploaded_by"),
    reason: text("reason"),
    status: text("status").notNull().default("preview"),
    // preview | applied | discarded | rolled_back
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    index("mrp_revision_batches_created_idx").on(t.createdAt),
    index("mrp_revision_batches_status_idx").on(t.status),
    index("mrp_revision_batches_hash_idx").on(t.fileSha256)
  ]
);
var mrpGeneratorScenariosTable = pgTable(
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
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    uniqueIndex("mrp_generator_scenarios_name_idx").on(t.name),
    index("mrp_generator_scenarios_created_idx").on(t.createdAt)
  ]
);
var mrpGeneratorRunsTable = pgTable(
  "mrp_generator_runs",
  {
    id: serial("id").primaryKey(),
    // Historical runs are independent of mutable competitive scenarios.
    scenarioId: integer("scenario_id").references(() => mrpGeneratorScenariosTable.id),
    modelKind: text("model_kind").notNull().default("competitive"),
    // competitive | historical
    asOf: date("as_of").notNull(),
    inputSnapshot: text("input_snapshot").notNull(),
    inputFingerprint: text("input_fingerprint").notNull(),
    summary: text("summary").notNull(),
    sourceFreshness: text("source_freshness").notNull(),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    index("mrp_generator_runs_scenario_idx").on(t.scenarioId, t.createdAt),
    index("mrp_generator_runs_fingerprint_idx").on(t.inputFingerprint)
  ]
);
var mrpGeneratorResultsTable = pgTable(
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
    // P014 evidence is immutable JSON captured with the result; these fields
    // are nullable so all pre-P014 rows remain readable.
    modelKind: text("model_kind"),
    series: text("series"),
    reason: text("reason"),
    evidence: text("evidence"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    index("mrp_generator_results_run_idx").on(t.runId, t.itemCode),
    uniqueIndex("mrp_generator_results_run_code_idx").on(t.runId, t.itemCode)
  ]
);
var mrpRevisionRowsTable = pgTable(
  "mrp_revision_rows",
  {
    id: serial("id").primaryKey(),
    batchId: integer("batch_id").notNull().references(() => mrpRevisionBatchesTable.id),
    rowNumber: integer("row_number").notNull(),
    itemCode: text("item_code"),
    effectiveDate: date("effective_date", { mode: "string" }),
    variant: text("variant").notNull().default("Standard"),
    competitor: text("competitor"),
    targetRowId: integer("target_row_id"),
    previousValue: doublePrecision("previous_value"),
    newValue: doublePrecision("new_value"),
    note: text("note"),
    // update changes an existing value; delete removes it and uses the snapshot
    // below so rollback can restore the exact row, including provenance fields.
    operation: text("operation").notNull().default("update"),
    // update | delete
    previousRowSnapshot: text("previous_row_snapshot"),
    outcome: text("outcome").notNull(),
    // change | noop | rejected
    rejectionReason: text("rejection_reason"),
    warningReasons: text("warning_reasons"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    index("mrp_revision_rows_batch_idx").on(t.batchId),
    index("mrp_revision_rows_target_idx").on(t.targetRowId),
    index("mrp_revision_rows_outcome_idx").on(t.batchId, t.outcome)
  ]
);
var acceptBatchesTable = pgTable(
  "accept_batches",
  {
    id: serial("id").primaryKey(),
    // "bulk" (Accept selected) | "auto" (Auto-accept all).
    kind: text("kind").notNull(),
    competitor: text("competitor"),
    competitorPriceIds: integer("competitor_price_ids").array().notNull(),
    count: integer("count").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [index("accept_batches_created_idx").on(t.createdAt)]
);
var discountSettingsTable = pgTable(
  "discount_settings",
  {
    id: serial("id").primaryKey(),
    scope: text("scope").notNull(),
    discountPct: doublePrecision("discount_pct").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [uniqueIndex("discount_settings_scope_idx").on(t.scope)]
);
var importBatchesTable = pgTable(
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
    loadBatchId: integer("load_batch_id").references(() => mrpLoadBatchesTable.id),
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    index("import_batches_status_idx").on(t.status),
    index("import_batches_competitor_idx").on(t.competitor)
  ]
);
var competitorPriceStagingTable = pgTable(
  "competitor_price_staging",
  {
    id: serial("id").primaryKey(),
    batchId: integer("batch_id").notNull(),
    competitor: text("competitor").notNull(),
    effectiveDate: date("effective_date", { mode: "string" }),
    // The code as it appears in the existing competitor_prices mapping (master).
    competitorCodeMaster: text("competitor_code_master"),
    // The code as it appears in the uploaded catalogue (may differ via alias).
    competitorCodeCatalogue: text("competitor_code_catalogue"),
    // Every row has an explicit provenance classification. Legacy/unknown
    // origins are unverified; do not infer supplier or locally assigned.
    codeSource: text("code_source").notNull().default("unverified"),
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    index("cps_batch_idx").on(t.batchId),
    index("cps_status_idx").on(t.status),
    index("cps_competitor_idx").on(t.competitor),
    check(
      "competitor_price_staging_code_source_check",
      sql`${t.codeSource} in ('supplier', 'locally_assigned', 'unverified')`
    )
  ]
);
var competitorCodeAliasesTable = pgTable(
  "competitor_code_aliases",
  {
    id: serial("id").primaryKey(),
    competitor: text("competitor").notNull(),
    // Code used in the existing competitor_prices master mapping.
    oldCode: text("old_code").notNull(),
    // Code that appears in the catalogue (current/new code).
    newCode: text("new_code").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    uniqueIndex("cca_competitor_old_idx").on(t.competitor, t.oldCode)
  ]
);
var catalogSyncAuditsTable = pgTable(
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
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true })
  },
  (t) => [
    index("catalog_sync_audits_started_idx").on(t.startedAt),
    index("catalog_sync_audits_bundle_idx").on(t.bundleSha256)
  ]
);
var catalogProductNameCorrectionsTable = pgTable(
  "catalog_product_name_corrections",
  {
    id: serial("id").primaryKey(),
    correctionKey: text("correction_key").notNull(),
    itemCode: text("item_code").notNull(),
    previousName: text("previous_name"),
    correctedName: text("corrected_name").notNull(),
    reason: text("reason").notNull(),
    loadBatchId: integer("load_batch_id").references(() => mrpLoadBatchesTable.id),
    actor: text("actor"),
    appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
    undoneAt: timestamp("undone_at", { withTimezone: true }),
    undoneBy: text("undone_by")
  },
  (t) => [
    uniqueIndex("catalog_product_name_corrections_key_idx").on(t.correctionKey),
    index("catalog_product_name_corrections_item_idx").on(t.itemCode),
    index("catalog_product_name_corrections_batch_idx").on(t.loadBatchId)
  ]
);
var catalogProductClassificationCorrectionsTable = pgTable(
  "catalog_product_classification_corrections",
  {
    id: serial("id").primaryKey(),
    correctionKey: text("correction_key").notNull(),
    itemCode: text("item_code").notNull(),
    siblingCode: text("sibling_code").notNull(),
    previousValues: text("previous_values").notNull(),
    correctedValues: text("corrected_values").notNull(),
    loadBatchId: integer("load_batch_id").references(() => mrpLoadBatchesTable.id),
    actor: text("actor"),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    undoneAt: timestamp("undone_at", { withTimezone: true }),
    undoneBy: text("undone_by")
  },
  (t) => [
    uniqueIndex("catalog_product_classification_correction_key_idx").on(t.correctionKey, t.itemCode),
    index("catalog_product_classification_correction_batch_idx").on(t.loadBatchId)
  ]
);
var catalogPriceEditAuditsTable = pgTable(
  "catalog_price_edit_audits",
  {
    id: serial("id").primaryKey(),
    actor: text("actor").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    itemCode: text("item_code").notNull(),
    series: text("series").notNull(),
    // Prayag MRP or configured competitor
    operationType: text("operation_type").notNull(),
    // save | reversal
    oldValue: doublePrecision("old_value"),
    previousResolvedValue: doublePrecision("previous_resolved_value"),
    newValue: doublePrecision("new_value"),
    effectiveDate: date("effective_date", { mode: "string" }).notNull(),
    remarks: text("remarks").notNull(),
    originalAuditId: integer("original_audit_id"),
    targetRowId: integer("target_row_id"),
    creationMetadata: text("creation_metadata")
  },
  (t) => [
    index("catalog_price_edit_audits_item_idx").on(t.itemCode, t.createdAt),
    index("catalog_price_edit_audits_original_idx").on(t.originalAuditId),
    uniqueIndex("catalog_price_edit_audits_reversal_once_idx").on(t.originalAuditId).where(sql`${t.operationType} = 'reversal'`),
    check(
      "catalog_price_edit_audits_operation_check",
      sql`${t.operationType} in ('save', 'reversal')`
    )
  ]
);
var newProductPreviewStatesTable = pgTable(
  "new_product_preview_states",
  {
    id: serial("id").primaryKey(),
    token: text("token").notNull(),
    payload: text("payload").notNull(),
    createdBy: text("created_by").notNull(),
    status: text("status").notNull().default("preview"),
    // preview | consumed | expired
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true })
  },
  (t) => [
    uniqueIndex("new_product_preview_states_token_idx").on(t.token),
    index("new_product_preview_states_expiry_idx").on(t.status, t.expiresAt)
  ]
);

// ../../lib/db/src/schema/apiKeys.ts
import {
  pgTable as pgTable2,
  serial as serial2,
  text as text2,
  boolean as boolean2,
  timestamp as timestamp2,
  uniqueIndex as uniqueIndex2
} from "/home/runner/workspace/node_modules/.pnpm/drizzle-orm@0.45.2_@types+pg@8.20.0_pg@8.20.0/node_modules/drizzle-orm/pg-core/index.cjs";
var apiKeysTable = pgTable2(
  "api_keys",
  {
    id: serial2("id").primaryKey(),
    name: text2("name").notNull(),
    keyPrefix: text2("key_prefix").notNull(),
    keyHash: text2("key_hash").notNull(),
    isActive: boolean2("is_active").notNull().default(true),
    lastUsedAt: timestamp2("last_used_at", { withTimezone: true }),
    revokedAt: timestamp2("revoked_at", { withTimezone: true }),
    createdAt: timestamp2("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [uniqueIndex2("api_keys_key_hash_idx").on(t.keyHash)]
);

// ../../lib/db/src/schema/auth.ts
import { sql as sql2 } from "/home/runner/workspace/node_modules/.pnpm/drizzle-orm@0.45.2_@types+pg@8.20.0_pg@8.20.0/node_modules/drizzle-orm/index.cjs";
import { boolean as boolean3, index as index2, jsonb, pgTable as pgTable3, timestamp as timestamp3, varchar } from "/home/runner/workspace/node_modules/.pnpm/drizzle-orm@0.45.2_@types+pg@8.20.0_pg@8.20.0/node_modules/drizzle-orm/pg-core/index.cjs";
var sessionsTable = pgTable3(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp3("expire").notNull()
  },
  (table) => [index2("IDX_session_expire").on(table.expire)]
);
var usersTable = pgTable3("users", {
  id: varchar("id").primaryKey().default(sql2`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  passwordHash: varchar("password_hash"),
  mustChangePassword: boolean3("must_change_password").notNull().default(false),
  role: varchar("role").notNull().default("user"),
  createdAt: timestamp3("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp3("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => /* @__PURE__ */ new Date())
});

// ../../lib/db/src/schema/activity.ts
import {
  date as date2,
  index as index3,
  integer as integer2,
  jsonb as jsonb2,
  pgTable as pgTable4,
  serial as serial3,
  text as text3,
  timestamp as timestamp4,
  uniqueIndex as uniqueIndex3,
  varchar as varchar2
} from "/home/runner/workspace/node_modules/.pnpm/drizzle-orm@0.45.2_@types+pg@8.20.0_pg@8.20.0/node_modules/drizzle-orm/pg-core/index.cjs";
var activitySessionsTable = pgTable4(
  "activity_sessions",
  {
    id: varchar2("id", { length: 80 }).primaryKey(),
    userId: varchar2("user_id").notNull(),
    appSlug: text3("app_slug").notNull(),
    startedAt: timestamp4("started_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp4("last_seen_at", { withTimezone: true }).notNull(),
    lastActivityAt: timestamp4("last_activity_at", { withTimezone: true }).notNull(),
    endedAt: timestamp4("ended_at", { withTimezone: true }),
    lastState: text3("last_state").notNull().default("active"),
    activeSeconds: integer2("active_seconds").notNull().default(0),
    idleSeconds: integer2("idle_seconds").notNull().default(0),
    lastPagePath: text3("last_page_path"),
    createdAt: timestamp4("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index3("activity_sessions_user_started_idx").on(table.userId, table.startedAt),
    index3("activity_sessions_user_last_activity_idx").on(
      table.userId,
      table.lastActivityAt
    )
  ]
);
var activityEventsTable = pgTable4(
  "activity_events",
  {
    id: serial3("id").primaryKey(),
    eventId: varchar2("event_id", { length: 80 }).notNull(),
    sessionId: varchar2("session_id", { length: 80 }).notNull(),
    userId: varchar2("user_id").notNull(),
    appSlug: text3("app_slug").notNull(),
    eventType: text3("event_type").notNull(),
    activityDate: date2("activity_date", { mode: "string" }).notNull(),
    occurredAt: timestamp4("occurred_at", { withTimezone: true }).notNull(),
    pagePath: text3("page_path"),
    action: text3("action"),
    state: text3("state"),
    metadata: jsonb2("metadata"),
    createdAt: timestamp4("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex3("activity_events_event_id_idx").on(table.eventId),
    index3("activity_events_user_date_idx").on(table.userId, table.activityDate),
    index3("activity_events_session_occurred_idx").on(
      table.sessionId,
      table.occurredAt
    )
  ]
);
var activityDailySummariesTable = pgTable4(
  "activity_daily_summaries",
  {
    id: serial3("id").primaryKey(),
    userId: varchar2("user_id").notNull(),
    activityDate: date2("activity_date", { mode: "string" }).notNull(),
    activeSeconds: integer2("active_seconds").notNull().default(0),
    idleSeconds: integer2("idle_seconds").notNull().default(0),
    sessionCount: integer2("session_count").notNull().default(0),
    pageViewCount: integer2("page_view_count").notNull().default(0),
    actionCount: integer2("action_count").notNull().default(0),
    lastActivityAt: timestamp4("last_activity_at", { withTimezone: true }),
    updatedAt: timestamp4("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex3("activity_daily_user_date_idx").on(table.userId, table.activityDate),
    index3("activity_daily_date_idx").on(table.activityDate)
  ]
);
var activitySessionDailySummariesTable = pgTable4(
  "activity_session_daily_summaries",
  {
    id: serial3("id").primaryKey(),
    sessionId: varchar2("session_id", { length: 80 }).notNull(),
    userId: varchar2("user_id").notNull(),
    activityDate: date2("activity_date", { mode: "string" }).notNull(),
    activeSeconds: integer2("active_seconds").notNull().default(0),
    idleSeconds: integer2("idle_seconds").notNull().default(0),
    updatedAt: timestamp4("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex3("activity_session_daily_session_date_idx").on(
      table.sessionId,
      table.activityDate
    ),
    index3("activity_session_daily_user_date_idx").on(table.userId, table.activityDate)
  ]
);

// ../../lib/db/src/schema/apolloReservations.ts
import { integer as integer3, pgTable as pgTable5, serial as serial4, text as text4, uniqueIndex as uniqueIndex4 } from "/home/runner/workspace/node_modules/.pnpm/drizzle-orm@0.45.2_@types+pg@8.20.0_pg@8.20.0/node_modules/drizzle-orm/pg-core/index.cjs";
var apolloReservationsTable = pgTable5(
  "apollo_reservations",
  {
    id: serial4("id").primaryKey(),
    competitor: text4("competitor").notNull(),
    competitorCode: text4("competitor_code").notNull(),
    ownerIdentity: text4("owner_identity").notNull(),
    prayagCode: text4("prayag_code").notNull(),
    sourceSheet: text4("source_sheet").notNull(),
    sourceRow: integer3("source_row").notNull(),
    sourceFileName: text4("source_file_name")
  },
  (table) => [
    uniqueIndex4("apollo_reservations_competitor_code_idx").on(
      table.competitor,
      table.competitorCode
    )
  ]
);

// ../../lib/db/src/schema/priceEditorVocabulary.ts
import { createInsertSchema } from "/home/runner/workspace/node_modules/.pnpm/drizzle-zod@0.8.3_drizzle-orm@0.45.2_@types+pg@8.20.0_pg@8.20.0__zod@3.25.76/node_modules/drizzle-zod/index.cjs";
import { pgTable as pgTable6, serial as serial5, text as text5, boolean as boolean4, timestamp as timestamp5, uniqueIndex as uniqueIndex5, index as index4 } from "/home/runner/workspace/node_modules/.pnpm/drizzle-orm@0.45.2_@types+pg@8.20.0_pg@8.20.0/node_modules/drizzle-orm/pg-core/index.cjs";
var locallyAddedDivisionsTable = pgTable6(
  "price_editor_local_divisions",
  {
    id: serial5("id").primaryKey(),
    name: text5("name").notNull(),
    normalizedKey: text5("normalized_key").notNull(),
    actor: text5("actor").notNull(),
    reason: text5("reason").notNull(),
    salesMapped: boolean4("sales_mapped").notNull(),
    createdAt: timestamp5("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    uniqueIndex5("price_editor_local_divisions_normalized_key_idx").on(t.normalizedKey)
  ]
);
var locallyAddedCategoriesTable = pgTable6(
  "price_editor_local_categories",
  {
    id: serial5("id").primaryKey(),
    division: text5("division").notNull(),
    divisionKey: text5("division_key").notNull(),
    name: text5("name").notNull(),
    normalizedKey: text5("normalized_key").notNull(),
    actor: text5("actor").notNull(),
    reason: text5("reason").notNull(),
    createdAt: timestamp5("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    uniqueIndex5("price_editor_local_categories_division_name_key_idx").on(t.divisionKey, t.normalizedKey),
    index4("price_editor_local_categories_division_idx").on(t.divisionKey)
  ]
);
var locallyAddedSeriesTable = pgTable6(
  "price_editor_local_series",
  {
    id: serial5("id").primaryKey(),
    division: text5("division").notNull(),
    divisionKey: text5("division_key").notNull(),
    name: text5("name").notNull(),
    normalizedKey: text5("normalized_key").notNull(),
    actor: text5("actor").notNull(),
    reason: text5("reason").notNull(),
    createdAt: timestamp5("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (t) => [
    uniqueIndex5("price_editor_local_series_division_name_key_idx").on(t.divisionKey, t.normalizedKey),
    index4("price_editor_local_series_division_idx").on(t.divisionKey)
  ]
);
var insertLocallyAddedDivisionSchema = createInsertSchema(locallyAddedDivisionsTable).omit({ id: true, createdAt: true });
var insertLocallyAddedCategorySchema = createInsertSchema(locallyAddedCategoriesTable).omit({ id: true, createdAt: true });
var insertLocallyAddedSeriesSchema = createInsertSchema(locallyAddedSeriesTable).omit({ id: true, createdAt: true });

// ../../lib/db/src/index.ts
var { Pool } = pg;
if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?"
  );
}
var pool = new Pool({ connectionString: process.env.DATABASE_URL });
var db = drizzle(pool, { schema: schema_exports });

// src/lib/catalog.ts
import { sql as sql3 } from "/home/runner/workspace/node_modules/.pnpm/drizzle-orm@0.45.2_@types+pg@8.20.0_pg@8.20.0/node_modules/drizzle-orm/index.cjs";
async function recomputeCurrentFlags() {
  await db.transaction(async (tx) => {
    await recomputeCurrentFlagsInTransaction(tx);
  });
}
async function recomputeCurrentFlagsInTransaction(tx) {
  await tx.execute(sql3`SELECT pg_advisory_xact_lock(917_130)`);
  await tx.execute(sql3`UPDATE mrp_price_history SET is_current = false`);
  await tx.execute(sql3`
    UPDATE mrp_price_history m
    SET is_current = true
    FROM (
      SELECT DISTINCT ON (h.item_code, h.variant) h.id
      FROM mrp_price_history h
      JOIN catalog_products p ON p.item_code = h.item_code
      WHERE h.effective_date <= CURRENT_DATE
        AND h.review_status = 'approved'
        AND p.is_active IS TRUE
        AND (p.discontinued_from IS NULL OR p.discontinued_from > CURRENT_DATE)
      ORDER BY h.item_code, h.variant, h.effective_date DESC, h.id DESC
    ) latest
    WHERE m.id = latest.id
  `);
}
async function recomputeCompetitorCurrentFlagsInTransaction(competitor, tx) {
  await tx.execute(
    sql3`SELECT pg_advisory_xact_lock(hashtext(${"competitor-current-flags:" + competitor}))`
  );
  await tx.execute(
    sql3`UPDATE competitor_prices SET is_current = false WHERE competitor = ${competitor}`
  );
  await tx.execute(sql3`
    UPDATE competitor_prices
    SET is_current = true
    WHERE id IN (
      SELECT DISTINCT ON (competitor, matched_prayag_code) id
      FROM competitor_prices
      WHERE competitor = ${competitor}
        AND matched_prayag_code IS NOT NULL
        AND effective_date <= CURRENT_DATE
      ORDER BY competitor, matched_prayag_code, effective_date DESC NULLS LAST, id DESC
    )
  `);
  await tx.execute(sql3`
    UPDATE competitor_prices
    SET is_current = true
    WHERE competitor = ${competitor}
      AND matched_prayag_code IS NULL
      AND effective_date = (
        SELECT MAX(effective_date) FROM competitor_prices
        WHERE competitor = ${competitor}
          AND matched_prayag_code IS NULL
          AND effective_date <= CURRENT_DATE
      )
  `);
}
function normCode(s) {
  return String(s ?? "").trim().toUpperCase().replace(/\s+/g, "").replace(/\.0$/, "");
}

// src/lib/mrpProvenance.ts
import { createHash as createHash2 } from "node:crypto";
import { and, eq as eq2, inArray, isNull, lt, sql as sql4 } from "/home/runner/workspace/node_modules/.pnpm/drizzle-orm@0.45.2_@types+pg@8.20.0_pg@8.20.0/node_modules/drizzle-orm/index.cjs";

// src/lib/sanitarywareVariantAuditManifest.ts
var AUDITED_JANUARY_VARIANT_HISTORY_IDS = [
  64750,
  64752,
  64753,
  64756,
  64757,
  64760,
  64762,
  64763,
  64766,
  64767,
  64770,
  64772,
  64774,
  64776,
  64778,
  64780,
  64782,
  64784,
  64786,
  64787,
  64790,
  64792,
  64793,
  64796,
  64797,
  64800,
  64802,
  64804,
  64806,
  64808,
  64810,
  64812,
  64814,
  64816,
  64818,
  64820,
  64821,
  64824,
  64825,
  64828,
  64829,
  64832,
  64834,
  64836,
  64838,
  64839,
  64842,
  64843,
  64846,
  64847,
  64850,
  64852,
  64854,
  64856,
  64858,
  64860,
  64862,
  64863,
  64866,
  64867,
  64871,
  64873,
  64875,
  64877,
  64879,
  64881,
  64883,
  64884,
  64887,
  64889,
  64890,
  64893,
  64894,
  64897,
  64898,
  64901,
  64903,
  64905,
  64907,
  64910,
  64911,
  64914,
  64915,
  64918,
  64920,
  64922,
  64924,
  64926,
  64928,
  64930,
  64932,
  64934,
  64936,
  64938,
  64940,
  64942,
  64944,
  64946,
  64948,
  64950,
  64952,
  64954,
  64956,
  64958,
  64960,
  64962,
  64964,
  64966,
  64968,
  64970,
  64972,
  64974,
  64975,
  64978,
  64979,
  64982,
  64984,
  64986,
  64988,
  64990,
  64992,
  64993,
  64996,
  64997,
  65e3,
  65001,
  65004,
  65006,
  65007,
  65010,
  65012,
  65014,
  65016,
  65018,
  65020,
  65022,
  65026,
  65028,
  65030,
  65032,
  65034,
  65036,
  65038,
  65040,
  65042,
  65044,
  65046,
  65048
];
var AUDITED_JANUARY_VARIANT_IDENTITY_MD5 = "70c6e1a55bfd0c294bf79284367c00cf";

// src/lib/sanitarywareVariantSource.ts
import { createHash } from "node:crypto";

// src/data/sanitaryware-variant-seed.json
var sanitaryware_variant_seed_default = [
  {
    itemCode: "4010",
    mrp: 2350,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4010",
    mrp: 2580,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4011",
    mrp: 1660,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4011",
    mrp: 1730,
    effectiveDate: "2026-01-15",
    variant: "Pink / Green / Blue"
  },
  {
    itemCode: "4011",
    mrp: 1790,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4011",
    mrp: 1860,
    effectiveDate: "2026-05-01",
    variant: "Pink / Green / Blue"
  },
  {
    itemCode: "4012",
    mrp: 2140,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4012",
    mrp: 2230,
    effectiveDate: "2026-01-15",
    variant: "Pink / Green / Blue"
  },
  {
    itemCode: "4012",
    mrp: 2349.803921568628,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4012",
    mrp: 2450,
    effectiveDate: "2026-05-01",
    variant: "Pink / Green / Blue"
  },
  {
    itemCode: "4016",
    mrp: 2980,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4016",
    mrp: 3290,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4018",
    mrp: 2490,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4018",
    mrp: 2950,
    effectiveDate: "2026-01-15",
    variant: "Pink / Green / Blue"
  },
  {
    itemCode: "4018",
    mrp: 2730,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4018",
    mrp: 3230,
    effectiveDate: "2026-05-01",
    variant: "Pink / Green / Blue"
  },
  {
    itemCode: "4019",
    mrp: 2490,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4019",
    mrp: 2950,
    effectiveDate: "2026-01-15",
    variant: "Pink / Green / Blue"
  },
  {
    itemCode: "4019",
    mrp: 2730,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4019",
    mrp: 3230,
    effectiveDate: "2026-05-01",
    variant: "Pink / Green / Blue"
  },
  {
    itemCode: "4020",
    mrp: 4240,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4020",
    mrp: 4570,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4020-P",
    mrp: 4240,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4020-P",
    mrp: 4570,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4021",
    mrp: 9580,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4021",
    mrp: 10530,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4022",
    mrp: 3750,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4022",
    mrp: 3990,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4023",
    mrp: 8920,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4023",
    mrp: 9790,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4030",
    mrp: 11130,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4030",
    mrp: 11990,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4031",
    mrp: 5785,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4031",
    mrp: 6290,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4032",
    mrp: 5785,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4032",
    mrp: 6290,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4051",
    mrp: 2240,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4051",
    mrp: 2570,
    effectiveDate: "2026-01-15",
    variant: "Pink / Green / Blue"
  },
  {
    itemCode: "4051",
    mrp: 2420,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4051",
    mrp: 2780,
    effectiveDate: "2026-05-01",
    variant: "Pink / Green / Blue"
  },
  {
    itemCode: "4052",
    mrp: 2610,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4052",
    mrp: 2850,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4053",
    mrp: 2100,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4053",
    mrp: 2420,
    effectiveDate: "2026-01-15",
    variant: "Pink / Green / Blue"
  },
  {
    itemCode: "4053",
    mrp: 2310,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4053",
    mrp: 2660,
    effectiveDate: "2026-05-01",
    variant: "Pink / Green / Blue"
  },
  {
    itemCode: "4054",
    mrp: 2520,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4054",
    mrp: 2890,
    effectiveDate: "2026-01-15",
    variant: "Pink / Green / Blue"
  },
  {
    itemCode: "4054",
    mrp: 2740,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4054",
    mrp: 3140,
    effectiveDate: "2026-05-01",
    variant: "Pink / Green / Blue"
  },
  {
    itemCode: "4055",
    mrp: 3040,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4055",
    mrp: 3360,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4056",
    mrp: 2430,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4056",
    mrp: 2660,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4057",
    mrp: 2480,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4057",
    mrp: 2690,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4230",
    mrp: 12320,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4230",
    mrp: 13550,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4240",
    mrp: 12760,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4240",
    mrp: 13570,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4252",
    mrp: 15180,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4252",
    mrp: 16460,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4253",
    mrp: 15180,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4253",
    mrp: 16460,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4254",
    mrp: 15180,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4254",
    mrp: 16460,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4257",
    mrp: 19850,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4257",
    mrp: 21840,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4260",
    mrp: 13110,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4260",
    mrp: 14410,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4270",
    mrp: 15840,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4270",
    mrp: 13800,
    effectiveDate: "2026-01-15",
    variant: "White with Jet"
  },
  {
    itemCode: "4270",
    mrp: 17330,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4270",
    mrp: 15200,
    effectiveDate: "2026-05-01",
    variant: "White with Jet"
  },
  {
    itemCode: "4271",
    mrp: 15840,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4271",
    mrp: 13800,
    effectiveDate: "2026-01-15",
    variant: "White with Jet"
  },
  {
    itemCode: "4271",
    mrp: 17330,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4271",
    mrp: 15200,
    effectiveDate: "2026-05-01",
    variant: "White with Jet"
  },
  {
    itemCode: "4281",
    mrp: 14950,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4281",
    mrp: 13800,
    effectiveDate: "2026-01-15",
    variant: "White with Jet"
  },
  {
    itemCode: "4281",
    mrp: 16390,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4281",
    mrp: 14470,
    effectiveDate: "2026-05-01",
    variant: "White with Jet"
  },
  {
    itemCode: "4282",
    mrp: 12990,
    effectiveDate: "2026-01-15",
    variant: "White with Jet"
  },
  {
    itemCode: "4282",
    mrp: 14280,
    effectiveDate: "2026-05-01",
    variant: "White with Jet"
  },
  {
    itemCode: "4291",
    mrp: 15800,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4291",
    mrp: 17310.47040971168,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4292",
    mrp: 15800,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4292",
    mrp: 17310.47040971168,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4302",
    mrp: 12500,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4302",
    mrp: 10480,
    effectiveDate: "2026-01-15",
    variant: "White with Jet"
  },
  {
    itemCode: "4302",
    mrp: 13640,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4302",
    mrp: 11580,
    effectiveDate: "2026-05-01",
    variant: "White with Jet"
  },
  {
    itemCode: "4303",
    mrp: 12500,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4303",
    mrp: 10480,
    effectiveDate: "2026-01-15",
    variant: "White with Jet"
  },
  {
    itemCode: "4303",
    mrp: 13640,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4303",
    mrp: 11580,
    effectiveDate: "2026-05-01",
    variant: "White with Jet"
  },
  {
    itemCode: "4304",
    mrp: 12500,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4304",
    mrp: 10480,
    effectiveDate: "2026-01-15",
    variant: "White with Jet"
  },
  {
    itemCode: "4304",
    mrp: 13640,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4304",
    mrp: 11580,
    effectiveDate: "2026-05-01",
    variant: "White with Jet"
  },
  {
    itemCode: "4305",
    mrp: 11500,
    effectiveDate: "2026-01-15",
    variant: "White with Jet"
  },
  {
    itemCode: "4305",
    mrp: 12700,
    effectiveDate: "2026-05-01",
    variant: "White with Jet"
  },
  {
    itemCode: "4330",
    mrp: 12320,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4330",
    mrp: 13550,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4351",
    mrp: 15870,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4351",
    mrp: 17190,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4352",
    mrp: 15870,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4352",
    mrp: 17190,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4353",
    mrp: 17380,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4353",
    mrp: 19120,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4357",
    mrp: 19850,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4357",
    mrp: 21840,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4361",
    mrp: 14080,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4361",
    mrp: 13400,
    effectiveDate: "2026-01-15",
    variant: "White with Jet"
  },
  {
    itemCode: "4361",
    mrp: 15360,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4361",
    mrp: 14760,
    effectiveDate: "2026-05-01",
    variant: "White with Jet"
  },
  {
    itemCode: "4362",
    mrp: 14080,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4362",
    mrp: 13400,
    effectiveDate: "2026-01-15",
    variant: "White with Jet"
  },
  {
    itemCode: "4362",
    mrp: 15360,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4362",
    mrp: 14760,
    effectiveDate: "2026-05-01",
    variant: "White with Jet"
  },
  {
    itemCode: "4363",
    mrp: 19060,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4364",
    mrp: 14080,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4364",
    mrp: 15360,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4365",
    mrp: 14080,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4365",
    mrp: 15360,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4375",
    mrp: 14080,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4375",
    mrp: 15360,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4376",
    mrp: 13340,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4376",
    mrp: 14670,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4377",
    mrp: 13340,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4377",
    mrp: 14670,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4380",
    mrp: 13340,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4380",
    mrp: 14670,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4381",
    mrp: 14950,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4381",
    mrp: 13800,
    effectiveDate: "2026-01-15",
    variant: "White with Jet"
  },
  {
    itemCode: "4381",
    mrp: 16390,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4381",
    mrp: 14470,
    effectiveDate: "2026-05-01",
    variant: "White with Jet"
  },
  {
    itemCode: "4390",
    mrp: 11800,
    effectiveDate: "2026-01-15",
    variant: "White with Jet"
  },
  {
    itemCode: "4390",
    mrp: 13120,
    effectiveDate: "2026-05-01",
    variant: "White with Jet"
  },
  {
    itemCode: "4402",
    mrp: 12500,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4402",
    mrp: 10480,
    effectiveDate: "2026-01-15",
    variant: "White with Jet"
  },
  {
    itemCode: "4402",
    mrp: 13640,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4402",
    mrp: 11580,
    effectiveDate: "2026-05-01",
    variant: "White with Jet"
  },
  {
    itemCode: "4403",
    mrp: 12500,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4403",
    mrp: 10480,
    effectiveDate: "2026-01-15",
    variant: "White with Jet"
  },
  {
    itemCode: "4403",
    mrp: 13640,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4403",
    mrp: 11580,
    effectiveDate: "2026-05-01",
    variant: "White with Jet"
  },
  {
    itemCode: "4404",
    mrp: 12500,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4404",
    mrp: 10480,
    effectiveDate: "2026-01-15",
    variant: "White with Jet"
  },
  {
    itemCode: "4404",
    mrp: 13640,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4404",
    mrp: 11580,
    effectiveDate: "2026-05-01",
    variant: "White with Jet"
  },
  {
    itemCode: "4405",
    mrp: 11500,
    effectiveDate: "2026-01-15",
    variant: "White with Jet"
  },
  {
    itemCode: "4405",
    mrp: 12700,
    effectiveDate: "2026-05-01",
    variant: "White with Jet"
  },
  {
    itemCode: "4430",
    mrp: 12320,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4430",
    mrp: 13550,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4440",
    mrp: 12760,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4440",
    mrp: 13570,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4460",
    mrp: 13110,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4460",
    mrp: 14410,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4463",
    mrp: 19060,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4470",
    mrp: 15840,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4470",
    mrp: 13800,
    effectiveDate: "2026-01-15",
    variant: "White with Jet"
  },
  {
    itemCode: "4470",
    mrp: 17330,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4470",
    mrp: 15200,
    effectiveDate: "2026-05-01",
    variant: "White with Jet"
  },
  {
    itemCode: "4480",
    mrp: 14950,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4480",
    mrp: 13800,
    effectiveDate: "2026-01-15",
    variant: "White with Jet"
  },
  {
    itemCode: "4480",
    mrp: 16390,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4480",
    mrp: 14470,
    effectiveDate: "2026-05-01",
    variant: "White with Jet"
  },
  {
    itemCode: "4482",
    mrp: 12990,
    effectiveDate: "2026-01-15",
    variant: "White with Jet"
  },
  {
    itemCode: "4482",
    mrp: 14280,
    effectiveDate: "2026-05-01",
    variant: "White with Jet"
  },
  {
    itemCode: "4490",
    mrp: 15800,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4490",
    mrp: 17310.47040971168,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4505",
    mrp: 9080,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4505",
    mrp: 9990,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4521",
    mrp: 11200,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4521",
    mrp: 11940,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4522",
    mrp: 11600,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4522",
    mrp: 12320,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4523",
    mrp: 11100,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4523",
    mrp: 11940,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4535",
    mrp: 6070,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4535",
    mrp: 6650,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4545",
    mrp: 12078,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4545",
    mrp: 13160,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4550",
    mrp: 6578,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4550",
    mrp: 7120,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4555",
    mrp: 12078,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4555",
    mrp: 13070,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4561",
    mrp: 2120,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4561",
    mrp: 2290,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4565",
    mrp: 8150,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4565",
    mrp: 8890,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4570",
    mrp: 10439,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4570",
    mrp: 10980,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4575",
    mrp: 10626,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4575",
    mrp: 11530,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4580",
    mrp: 5480,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4580",
    mrp: 6009.579831932773,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4585",
    mrp: 9779,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4585",
    mrp: 10650,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4601",
    mrp: 5470,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4601",
    mrp: 5980,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4602",
    mrp: 4830,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4602",
    mrp: 5270,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4603",
    mrp: 5380,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4603",
    mrp: 5750,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4604",
    mrp: 4370,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4604",
    mrp: 4570,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4605",
    mrp: 4440,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4605",
    mrp: 4980,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4606",
    mrp: 5841,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4606",
    mrp: 6140,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4607",
    mrp: 5400,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4607",
    mrp: 5940,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4611",
    mrp: 4220,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4611",
    mrp: 4570,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4612",
    mrp: 4740,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4612",
    mrp: 5250,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4613",
    mrp: 4850,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4613",
    mrp: 5240,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4614",
    mrp: 4670,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4614",
    mrp: 5130.098522167487,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4641",
    mrp: 2760,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4641",
    mrp: 2980,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4642",
    mrp: 1990,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4642",
    mrp: 2410,
    effectiveDate: "2026-01-15",
    variant: "Pink / Green / Blue"
  },
  {
    itemCode: "4642",
    mrp: 2170,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4642",
    mrp: 2630.426829268293,
    effectiveDate: "2026-05-01",
    variant: "Pink / Green / Blue"
  },
  {
    itemCode: "4643",
    mrp: 2100,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4643",
    mrp: 2410,
    effectiveDate: "2026-01-15",
    variant: "Pink / Green / Blue"
  },
  {
    itemCode: "4643",
    mrp: 2280,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4643",
    mrp: 2620,
    effectiveDate: "2026-05-01",
    variant: "Pink / Green / Blue"
  },
  {
    itemCode: "4644",
    mrp: 3560,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4644",
    mrp: 3790,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4645",
    mrp: 2230,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4645",
    mrp: 2480,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4646",
    mrp: 1750,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4646",
    mrp: 1950,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4647",
    mrp: 3730,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4647",
    mrp: 4080,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4649",
    mrp: 4650,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4649",
    mrp: 5120,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4651",
    mrp: 1620,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4651",
    mrp: 1860,
    effectiveDate: "2026-01-15",
    variant: "Pink / Green / Blue"
  },
  {
    itemCode: "4651",
    mrp: 1770,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4651",
    mrp: 2040,
    effectiveDate: "2026-05-01",
    variant: "Pink / Green / Blue"
  },
  {
    itemCode: "4652",
    mrp: 1150,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4652",
    mrp: 1320,
    effectiveDate: "2026-01-15",
    variant: "Pink / Green / Blue"
  },
  {
    itemCode: "4652",
    mrp: 1280,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4652",
    mrp: 1470,
    effectiveDate: "2026-05-01",
    variant: "Pink / Green / Blue"
  },
  {
    itemCode: "4653",
    mrp: 1890,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4653",
    mrp: 2140,
    effectiveDate: "2026-01-15",
    variant: "Pink / Green / Blue"
  },
  {
    itemCode: "4653",
    mrp: 2050,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4653",
    mrp: 2320,
    effectiveDate: "2026-05-01",
    variant: "Pink / Green / Blue"
  },
  {
    itemCode: "4654",
    mrp: 2980,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4654",
    mrp: 3190,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4655",
    mrp: 1780,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4655",
    mrp: 2050,
    effectiveDate: "2026-01-15",
    variant: "Pink / Green / Blue"
  },
  {
    itemCode: "4655",
    mrp: 1970,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4655",
    mrp: 2270,
    effectiveDate: "2026-05-01",
    variant: "Pink / Green / Blue"
  },
  {
    itemCode: "4656",
    mrp: 2490,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4656",
    mrp: 2730.152284263959,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4657",
    mrp: 2560,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4657",
    mrp: 2760,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4658",
    mrp: 2280,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4658",
    mrp: 2490,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4659",
    mrp: 1660,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4659",
    mrp: 1820,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4660",
    mrp: 1880,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4660",
    mrp: 1990,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4661",
    mrp: 2120,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4661",
    mrp: 2290,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4663",
    mrp: 2410,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4663",
    mrp: 2410,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4663",
    mrp: 2620,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4663",
    mrp: 2620,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4664",
    mrp: 2410,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4664",
    mrp: 2550,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4666",
    mrp: 1290,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4666",
    mrp: 1430,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4704",
    mrp: 3130,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4704",
    mrp: 3390,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4706",
    mrp: 3260,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4706",
    mrp: 3589.662921348315,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4719",
    mrp: 5320,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4719",
    mrp: 5610,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4790",
    mrp: 3230,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4790",
    mrp: 3540,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4793",
    mrp: 3230,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4793",
    mrp: 3540,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4795",
    mrp: 3230,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4795",
    mrp: 3540,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4996",
    mrp: 3280,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4996",
    mrp: 3590,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4997",
    mrp: 6560,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4997",
    mrp: 7220,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4998",
    mrp: 6250,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4998",
    mrp: 6870,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  },
  {
    itemCode: "4999",
    mrp: 2030,
    effectiveDate: "2026-01-15",
    variant: "Ivory"
  },
  {
    itemCode: "4999",
    mrp: 2230.493827160494,
    effectiveDate: "2026-05-01",
    variant: "Ivory"
  }
];

// src/lib/sanitarywareVariantSource.ts
var SANITARYWARE_VARIANT_SOURCE = {
  division: "Ceramic Sanitaryware colour variants",
  sheetId: "prayag-sanitaryware-colour-variant-workbook",
  sheetUrl: "about:blank",
  expectedFileName: "Prayag_Sanitaryware_Variant_Prices.xlsx",
  sourceKind: "known_source",
  notes: "Known sanitaryware colour-variant source represented by the checked-in normalized payload. The original XLSX bytes are not retained; batch hashes identify period payloads, not workbook bytes."
};
function rowKey(row) {
  return `${row.itemCode}${row.effectiveDate}${row.variant}`;
}
function getSanitarywareVariantSourceAudit() {
  const rawRows = sanitaryware_variant_seed_default;
  const uniqueByKey = /* @__PURE__ */ new Map();
  const duplicateKeys = [];
  for (const row of rawRows) {
    const key = rowKey(row);
    const existing = uniqueByKey.get(key);
    if (existing) {
      if (existing.mrp !== row.mrp) {
        throw new Error(`Conflicting sanitaryware colour source rows for ${key}.`);
      }
      duplicateKeys.push(key);
      continue;
    }
    uniqueByKey.set(key, row);
  }
  const uniqueRows = [...uniqueByKey.values()];
  const periods = [...new Set(uniqueRows.map((row) => row.effectiveDate))].sort().map((effectiveDate) => {
    const rows = uniqueRows.filter(
      (row) => row.effectiveDate === effectiveDate
    );
    const payload = Buffer.from(JSON.stringify(rows));
    return {
      effectiveDate,
      rows,
      rowCount: rows.length,
      payloadSha256: createHash("sha256").update(payload).digest("hex"),
      payloadBytes: payload.length
    };
  });
  if (rawRows.length !== 300 || uniqueRows.length !== 298 || periods[0]?.effectiveDate !== "2026-01-15" || periods[0]?.rowCount !== 148 || periods[1]?.effectiveDate !== "2026-05-01" || periods[1]?.rowCount !== 150 || duplicateKeys.length !== 2 || !duplicateKeys.every((key) => key.startsWith("4663"))) {
    throw new Error(
      "The sanitaryware colour source shape changed; review its period and duplicate-key expectations before loading."
    );
  }
  return {
    rawRows,
    uniqueRows,
    duplicateKeys,
    periods
  };
}

// src/lib/mrpProvenance.ts
var HARDWARE_SOURCE_SHEET_ID = "1YxBT9NUfLD0mK0d1T2DbLRTkYwXZct5frrJkZnCXhIA";
var HARDWARE_REPLACEMENT_SNAPSHOT = {
  fileName: "Prayag_MRP_Authoritative_01Sep2026.xlsx",
  fileSha256: "a6cd9c4d82ab60a1b77644edba5446af90bf9df25174095e791b6c23f773cab2",
  fileSizeBytes: 379091,
  downloadedAt: "2026-08-31",
  effectiveDate: "2026-09-01",
  expectedRows: 285,
  expectedRevisions: 277,
  expectedAdditions: 8,
  notes: "Verified Hardware slice from the authoritative Prayag-returned 01 Sep 2026 master; replaces the legacy March-only Hardware snapshot."
};
var OFFICIAL_MRP_SOURCES = [
  {
    division: "Pipes & Fittings",
    sheetId: "1Xyb8skpqAMIm5PF5d2HgKp8vRc0y4UHxWFfItD3ZcJk",
    expectedFileName: "MRP w.e.f. 01st Feb, 2026 Pipe & Fitting.xlsx",
    notes: null
  },
  {
    division: "PTMT & Plastic Fittings",
    sheetId: "1PnzjXxDfnG-9asuvQ9nR_Vho26q-ulWeOwEL7hyBAFU",
    expectedFileName: "NEW PTMT MRP w.e.f. List as on 01st Sep, 2026.xlsx",
    notes: "The 19 Aug 2026 snapshot is known to differ from the live sheet in 600-series September price cells."
  },
  {
    division: "CP Fittings / Faucets",
    sheetId: "1-3boSoPGeSRIM-ruFX-FgHqaBBI3DBCuWoOWLl0RRAM",
    expectedFileName: "New CP MRP w.e.f. 01st Aug, 2026.xlsx",
    notes: null
  },
  {
    division: "Ceramic Sanitaryware",
    sheetId: "1TJ5Xg2GYMBHQzsrk0kKtM-iRI3tvG1eTmon5HZGU9F0",
    expectedFileName: "SANITARYWARE NEW MRP w.e.f. 01st May, 2026.xlsx",
    notes: null
  },
  {
    division: "Hardware",
    sheetId: HARDWARE_SOURCE_SHEET_ID,
    expectedFileName: HARDWARE_REPLACEMENT_SNAPSHOT.fileName,
    notes: "The linked Google Sheet remains March-only. The latest verified Hardware snapshot is the Hardware slice of the authoritative Prayag-returned 01 Sep 2026 master."
  },
  {
    division: "CP (QUAA / FERN)",
    sheetId: "1ViubLx1zOjUvFXJWDQUHAMBgqty8py8vHmEawYMe4qg",
    expectedFileName: "MRP w.e.f. 15th Feb, 2024 QUAA & FERN.xlsx",
    notes: null
  }
];
var AUTHORITATIVE_MASTER_SOURCE = {
  division: "Authoritative multi-division master",
  sheetId: "authoritative-master-2026-09-01",
  sheetUrl: "about:blank",
  expectedFileName: "Prayag_MRP_Authoritative_01Sep2026.xlsx",
  notes: "Authoritative master returned by Prayag, superseding the compiled 01 Sep list. SHA-256 and size identify the original source XLSX file bytes; a future upload whose bytes differ, including a normalized payload, will not match by design.",
  sourceKind: "authoritative"
};
var AUTHORITATIVE_MASTER_BATCH = {
  fileName: "Prayag_MRP_Authoritative_01Sep2026.xlsx",
  fileSha256: "a6cd9c4d82ab60a1b77644edba5446af90bf9df25174095e791b6c23f773cab2",
  expectedRows: 6226,
  checksumNote: "SHA-256 and size identify the original source XLSX file bytes; a future upload whose bytes differ, including a normalized payload, will not match by design."
};
var januaryVariantPayload = getSanitarywareVariantSourceAudit().periods.find(
  (period) => period.effectiveDate === "2026-01-15"
);
var AUDITED_JANUARY_VARIANT_SCOPE = {
  sourceSheetId: SANITARYWARE_VARIANT_SOURCE.sheetId,
  sourceDivision: SANITARYWARE_VARIANT_SOURCE.division,
  sourceFile: "Prayag_Sanitaryware_Variant_Prices.xlsx",
  effectiveDate: "2026-01-15",
  loadDate: "2026-08-19",
  productDivision: "Ceramic Sanitaryware",
  expectedRows: 148,
  expectedDistinctCodes: 121,
  historyRowIds: AUDITED_JANUARY_VARIANT_HISTORY_IDS,
  expectedIdentityMd5: AUDITED_JANUARY_VARIANT_IDENTITY_MD5,
  payloadSha256: januaryVariantPayload.payloadSha256,
  payloadBytes: januaryVariantPayload.payloadBytes
};
function sourceUrl(sheetId) {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
}
async function ensureOfficialMrpSources() {
  for (const source of OFFICIAL_MRP_SOURCES) {
    await db.insert(mrpSourcesTable).values({ ...source, sheetUrl: sourceUrl(source.sheetId), sourceKind: "official" }).onConflictDoUpdate({
      target: mrpSourcesTable.sheetId,
      set: {
        division: source.division,
        sheetUrl: sourceUrl(source.sheetId),
        expectedFileName: source.expectedFileName,
        notes: source.notes,
        sourceKind: "official"
      }
    });
  }
}
async function ensureHardwareReplacementSnapshot(loadedBy) {
  await ensureOfficialMrpSources();
  return db.transaction(async (tx) => {
    await tx.execute(sql4`SELECT pg_advisory_xact_lock(917_902)`);
    const [hardwareSource] = await tx.select({ id: mrpSourcesTable.id }).from(mrpSourcesTable).where(eq2(mrpSourcesTable.sheetId, HARDWARE_SOURCE_SHEET_ID)).limit(1);
    if (!hardwareSource) {
      throw new Error("The official Hardware provenance source is missing.");
    }
    const [existingBatch] = await tx.select({ id: mrpLoadBatchesTable.id }).from(mrpLoadBatchesTable).where(
      and(
        eq2(mrpLoadBatchesTable.sourceId, hardwareSource.id),
        eq2(
          mrpLoadBatchesTable.fileSha256,
          HARDWARE_REPLACEMENT_SNAPSHOT.fileSha256
        )
      )
    ).limit(1);
    if (existingBatch) {
      return {
        loadBatchId: existingBatch.id,
        rows: HARDWARE_REPLACEMENT_SNAPSHOT.expectedRows,
        revisions: HARDWARE_REPLACEMENT_SNAPSHOT.expectedRevisions,
        additions: HARDWARE_REPLACEMENT_SNAPSHOT.expectedAdditions
      };
    }
    const candidates = await tx.select({
      id: mrpPriceHistoryTable.id,
      itemCode: mrpPriceHistoryTable.itemCode,
      mrp: mrpPriceHistoryTable.mrp
    }).from(mrpPriceHistoryTable).innerJoin(
      catalogProductsTable,
      eq2(catalogProductsTable.itemCode, mrpPriceHistoryTable.itemCode)
    ).where(
      and(
        eq2(catalogProductsTable.division, "Hardware"),
        eq2(
          mrpPriceHistoryTable.effectiveDate,
          HARDWARE_REPLACEMENT_SNAPSHOT.effectiveDate
        ),
        eq2(mrpPriceHistoryTable.variant, "Standard"),
        inArray(
          mrpPriceHistoryTable.sourceFile,
          [
            HARDWARE_REPLACEMENT_SNAPSHOT.fileName,
            "Prayag_MRP_Authoritative_v2_01Sep2026.xlsx"
          ]
        )
      )
    );
    if (candidates.length !== HARDWARE_REPLACEMENT_SNAPSHOT.expectedRows) {
      throw new Error(
        `Hardware replacement requires ${HARDWARE_REPLACEMENT_SNAPSHOT.expectedRows} verified September rows; found ${candidates.length}.`
      );
    }
    const candidateCodes = candidates.map((row) => row.itemCode);
    const priorRows = await tx.selectDistinct({ itemCode: mrpPriceHistoryTable.itemCode }).from(mrpPriceHistoryTable).where(
      and(
        inArray(mrpPriceHistoryTable.itemCode, candidateCodes),
        lt(
          mrpPriceHistoryTable.effectiveDate,
          HARDWARE_REPLACEMENT_SNAPSHOT.effectiveDate
        ),
        eq2(mrpPriceHistoryTable.variant, "Standard")
      )
    );
    const revisions = priorRows.length;
    const additions = candidates.length - revisions;
    if (revisions !== HARDWARE_REPLACEMENT_SNAPSHOT.expectedRevisions || additions !== HARDWARE_REPLACEMENT_SNAPSHOT.expectedAdditions) {
      throw new Error(
        `Hardware replacement expected ${HARDWARE_REPLACEMENT_SNAPSHOT.expectedRevisions} revisions and ${HARDWARE_REPLACEMENT_SNAPSHOT.expectedAdditions} additions; found ${revisions} and ${additions}.`
      );
    }
    const loadBatchId = (await tx.insert(mrpLoadBatchesTable).values({
      sourceId: hardwareSource.id,
      fileName: HARDWARE_REPLACEMENT_SNAPSHOT.fileName,
      fileSha256: HARDWARE_REPLACEMENT_SNAPSHOT.fileSha256,
      fileSizeBytes: HARDWARE_REPLACEMENT_SNAPSHOT.fileSizeBytes,
      downloadedAt: HARDWARE_REPLACEMENT_SNAPSHOT.downloadedAt,
      loadedBy,
      rowCount: HARDWARE_REPLACEMENT_SNAPSHOT.expectedRows,
      notes: HARDWARE_REPLACEMENT_SNAPSHOT.notes
    }).returning({ id: mrpLoadBatchesTable.id }))[0].id;
    await tx.update(mrpPriceHistoryTable).set({ loadBatchId }).where(inArray(mrpPriceHistoryTable.id, candidates.map((row) => row.id)));
    const alreadyRecorded = await tx.select({ historyRowId: mrpHistoryProvenanceEventsTable.historyRowId }).from(mrpHistoryProvenanceEventsTable).where(
      and(
        eq2(mrpHistoryProvenanceEventsTable.action, "hardware_source_replaced"),
        eq2(mrpHistoryProvenanceEventsTable.loadBatchId, loadBatchId)
      )
    );
    const recordedIds = new Set(
      alreadyRecorded.map((row) => row.historyRowId).filter((id) => id != null)
    );
    const unrecorded = candidates.filter((row) => !recordedIds.has(row.id));
    for (let index5 = 0; index5 < unrecorded.length; index5 += 500) {
      await tx.insert(mrpHistoryProvenanceEventsTable).values(
        unrecorded.slice(index5, index5 + 500).map((row) => ({
          historyRowId: row.id,
          itemCode: row.itemCode,
          effectiveDate: HARDWARE_REPLACEMENT_SNAPSHOT.effectiveDate,
          action: "hardware_source_replaced",
          reason: HARDWARE_REPLACEMENT_SNAPSHOT.notes,
          sourceFile: HARDWARE_REPLACEMENT_SNAPSHOT.fileName,
          loadBatchId,
          mrp: row.mrp
        }))
      );
    }
    return {
      loadBatchId,
      rows: candidates.length,
      revisions,
      additions
    };
  });
}
function sha256ForBuffer(buffer) {
  return createHash2("sha256").update(buffer).digest("hex");
}
function isIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  return (/* @__PURE__ */ new Date(`${value}T00:00:00.000Z`)).toISOString().slice(0, 10) === value;
}

// src/lib/authoritativeMrpMaster.ts
var AUTHORITATIVE_MASTER_SHA256 = AUTHORITATIVE_MASTER_BATCH.fileSha256;
var AUTHORITATIVE_MASTER_FILE_NAME = AUTHORITATIVE_MASTER_BATCH.fileName;
var EXPECTED_DISCONTINUED_ROWS = 233;
var EXPECTED_EXCLUDED_ROWS = 142;
var AUTHORITATIVE_MASTER_V2_SHA256 = "e4463266dffdb44b5ae0c10ba5150cc786f6ea21e65619fab2dd57846e4fe23e";
var AUTHORITATIVE_MASTER_V2_FILE_NAME = "Prayag_MRP_Authoritative_v2_01Sep2026.xlsx";
var V2_NAME_PRESERVATION_EXCEPTIONS = [
  {
    itemCode: "CH72",
    preservedName: "Long Concealed Valve (Quarter Turn) 3\u20444 inch TRIANGULAR"
  },
  {
    itemCode: "CH72F",
    preservedName: "Full Turn Concealed Valve 3\u20444 inch TRIANGULAR"
  },
  {
    itemCode: "CH72QS",
    preservedName: "Short Concealed Valve (Quarter Turn) 3\u20444 inch TRIANGULAR"
  },
  {
    itemCode: "CH82",
    preservedName: "Long Concealed Valve (Quarter Turn) 1 inch TRIANGULAR"
  },
  {
    itemCode: "CH82F",
    preservedName: "Full Turn Concealed Valve 1 inch TRIANGULAR"
  },
  {
    itemCode: "UH-72",
    preservedName: "Long Concealed Valve (Quarter Turn) 3\u20444 inch TRIANGULAR mm"
  },
  {
    itemCode: "UH72-S",
    preservedName: "Short Concealed Valve (Quarter Turn) 3\u20444 inch TRIANGULAR mm"
  },
  {
    itemCode: "UH82",
    preservedName: "Long Concealed Valve (Quarter Turn) 1\u20442 inch TRIANGULAR mm"
  },
  {
    itemCode: "UH82-S",
    preservedName: "Short Concealed Valve (Quarter Turn) 1\u20442 inch TRIANGULAR mm"
  },
  {
    itemCode: "UH82-F",
    preservedName: "Full Turn Concealed Valve 1 inch TRIANGULAR",
    allowedCurrentNames: [
      "Full Turn Concealed Valve",
      "Full Turn Concealed Valve 1 inch TRIANGULER"
    ]
  },
  {
    itemCode: "UH82-L",
    preservedName: "Long Concealed Valve (Quarter Turn) 1 inch TRIANGULAR",
    allowedCurrentNames: [
      "Long Concealed Valve (Quarter Turn)",
      "Long Concealed Valve (Quarter Turn) 1 inch TRIANGULER"
    ]
  }
];
var AUTHORITATIVE_MASTER_PROFILES = [
  {
    fileName: AUTHORITATIVE_MASTER_FILE_NAME,
    fileSha256: AUTHORITATIVE_MASTER_SHA256,
    expectedProductRows: 6076,
    loadReason: "Authoritative master returned by Prayag, superseding the compiled 01 Sep list.",
    dataFlag: "authoritative_master_2026_09_01",
    namePreservationExceptions: []
  },
  {
    fileName: AUTHORITATIVE_MASTER_V2_FILE_NAME,
    fileSha256: AUTHORITATIVE_MASTER_V2_SHA256,
    expectedProductRows: 6106,
    loadReason: "Revised authoritative master from Prayag, superseding batch 15.",
    dataFlag: "authoritative_master_v2_2026_09_01",
    namePreservationExceptions: V2_NAME_PRESERVATION_EXCEPTIONS
  }
];
function text6(value) {
  return String(value ?? "").trim();
}
function nullableText(value) {
  const valueText = text6(value);
  return valueText ? valueText : null;
}
function authoritativeCode(value) {
  return text6(value).toUpperCase().replace(/\.0$/, "");
}
function positiveNumber(value, label) {
  const numberValue = typeof value === "number" ? value : Number(String(value ?? "").replace(/,/g, "").trim());
  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    throw new Error(`${label} must be a positive number.`);
  }
  return numberValue;
}
function recordsForSheet(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`Required sheet "${sheetName}" is missing.`);
  return XLSX.utils.sheet_to_json(sheet, {
    defval: null,
    raw: true
  });
}
function requireHeaders(rows, required, sheetName) {
  const first = rows[0];
  if (!first) throw new Error(`Sheet "${sheetName}" has no data rows.`);
  const headers = new Set(Object.keys(first));
  const missing = required.filter((header) => !headers.has(header));
  if (missing.length) {
    throw new Error(
      `Sheet "${sheetName}" is missing required columns: ${missing.join(", ")}.`
    );
  }
}
function isAuthoritativeMasterBuffer(buffer) {
  const hash = sha256ForBuffer(buffer);
  return AUTHORITATIVE_MASTER_PROFILES.some(
    (profile) => profile.fileSha256 === hash
  );
}
function profileForHash(hash) {
  const profile = AUTHORITATIVE_MASTER_PROFILES.find(
    (candidate) => candidate.fileSha256 === hash
  );
  if (!profile) {
    throw new Error(
      `Authoritative master checksum mismatch. Supported checksums: ${AUTHORITATIVE_MASTER_PROFILES.map((candidate) => candidate.fileSha256).join(", ")}; received ${hash}.`
    );
  }
  return profile;
}
function parseAuthoritativeMasterBuffer(buffer) {
  const actualHash = sha256ForBuffer(buffer);
  const profile = profileForHash(actualHash);
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const expectedSheets = [
    "products",
    "discontinued",
    "excluded_do_not_load",
    "notes"
  ];
  if (workbook.SheetNames.length !== expectedSheets.length || expectedSheets.some((sheet) => !workbook.SheetNames.includes(sheet))) {
    throw new Error(
      `Authoritative master must contain only: ${expectedSheets.join(", ")}.`
    );
  }
  const products = recordsForSheet(workbook, "products");
  const discontinued = recordsForSheet(workbook, "discontinued");
  const excluded = recordsForSheet(workbook, "excluded_do_not_load");
  if (products.length !== profile.expectedProductRows) {
    throw new Error(
      `Expected ${profile.expectedProductRows} product rows, found ${products.length}.`
    );
  }
  if (discontinued.length !== EXPECTED_DISCONTINUED_ROWS) {
    throw new Error(
      `Expected ${EXPECTED_DISCONTINUED_ROWS} discontinued rows, found ${discontinued.length}.`
    );
  }
  if (excluded.length !== EXPECTED_EXCLUDED_ROWS) {
    throw new Error(
      `Expected ${EXPECTED_EXCLUDED_ROWS} excluded rows, found ${excluded.length}.`
    );
  }
  requireHeaders(
    products,
    [
      "item_code",
      "division",
      "series",
      "product_name",
      "size",
      "mrp",
      "effective_date",
      "mrp_ivory",
      "mrp_white_with_jet",
      "mrp_pink_green_blue"
    ],
    "products"
  );
  requireHeaders(
    discontinued,
    [
      "item_code",
      "discontinued_from",
      "checked_by",
      "status_note"
    ],
    "discontinued"
  );
  requireHeaders(
    excluded,
    ["item_code", "status_note", "why excluded"],
    "excluded_do_not_load"
  );
  const seenProductCodes = /* @__PURE__ */ new Set();
  const productRows = [];
  const priceRows = [];
  const periodCounts = {};
  const periodDivisionCounts = {};
  const variantCounts = {
    Standard: 0,
    Ivory: 0,
    "White with Jet": 0,
    "Pink / Green / Blue": 0
  };
  const variants = [
    ["mrp_ivory", "Ivory"],
    ["mrp_white_with_jet", "White with Jet"],
    ["mrp_pink_green_blue", "Pink / Green / Blue"]
  ];
  products.forEach((row, index5) => {
    const rowNumber = index5 + 2;
    const itemCode = authoritativeCode(row.item_code);
    const division = text6(row.division);
    const productName = text6(row.product_name);
    const effectiveDate = text6(row.effective_date);
    if (!itemCode || !division || !productName || !isIsoDate(effectiveDate)) {
      throw new Error(
        `products row ${rowNumber} has an invalid code, division, product name, or effective date.`
      );
    }
    if (seenProductCodes.has(itemCode)) {
      throw new Error(`products row ${rowNumber} repeats item code ${itemCode}.`);
    }
    seenProductCodes.add(itemCode);
    const base = {
      itemCode,
      division,
      series: nullableText(row.series),
      category: nullableText(row.category),
      productName,
      size: nullableText(row.size),
      mrp: positiveNumber(row.mrp, `products row ${rowNumber} mrp`),
      effectiveDate,
      variant: "Standard"
    };
    productRows.push(base);
    priceRows.push(base);
    periodCounts[effectiveDate] = (periodCounts[effectiveDate] ?? 0) + 1;
    const periodDivisionKey = `${effectiveDate} \u2014 ${division}`;
    periodDivisionCounts[periodDivisionKey] = (periodDivisionCounts[periodDivisionKey] ?? 0) + 1;
    variantCounts.Standard += 1;
    variants.forEach(([column, variant]) => {
      if (row[column] == null || text6(row[column]) === "") return;
      priceRows.push({
        ...base,
        mrp: positiveNumber(
          row[column],
          `products row ${rowNumber} ${column}`
        ),
        variant
      });
      variantCounts[variant] += 1;
    });
  });
  const seenDiscontinued = /* @__PURE__ */ new Set();
  const discontinuedRows = discontinued.map((row, index5) => {
    const rowNumber = index5 + 2;
    const itemCode = authoritativeCode(row.item_code);
    const discontinuedFrom = text6(row.discontinued_from);
    const checkedBy = text6(row.checked_by);
    const statusNote = text6(row.status_note);
    if (!itemCode || !isIsoDate(discontinuedFrom) || !checkedBy || !statusNote) {
      throw new Error(
        `discontinued row ${rowNumber} has an invalid code, date, checked_by, or status_note.`
      );
    }
    if (seenDiscontinued.has(itemCode)) {
      throw new Error(
        `discontinued row ${rowNumber} repeats item code ${itemCode}.`
      );
    }
    seenDiscontinued.add(itemCode);
    return { itemCode, discontinuedFrom, checkedBy, statusNote };
  });
  const overlap = [...seenProductCodes].filter(
    (code) => seenDiscontinued.has(code)
  );
  if (overlap.length) {
    throw new Error(
      `Codes cannot be both priced and discontinued: ${overlap.join(", ")}.`
    );
  }
  const invalidExcludedCodes = excluded.filter((row) => /invalid input/i.test(text6(row.status_note))).map((row) => authoritativeCode(row.item_code)).sort();
  if (invalidExcludedCodes.join(",") !== ["20", "25", "32"].join(",")) {
    throw new Error(
      `The excluded invalid-input set changed: ${invalidExcludedCodes.join(", ")}.`
    );
  }
  const productRowsByCode = new Map(
    productRows.map((row) => [row.itemCode, row])
  );
  const preservedNameDisagreements = profile.namePreservationExceptions.flatMap((exception) => {
    const source = productRowsByCode.get(exception.itemCode);
    if (!source) {
      throw new Error(
        `Named product-name preservation exception is missing from the workbook: ${exception.itemCode}.`
      );
    }
    if (source.productName === exception.preservedName) return [];
    return [
      {
        itemCode: exception.itemCode,
        sourceName: source.productName,
        preservedName: exception.preservedName
      }
    ];
  });
  return {
    fileName: profile.fileName,
    fileSha256: profile.fileSha256,
    loadReason: profile.loadReason,
    dataFlag: profile.dataFlag,
    productRows,
    priceRows,
    discontinuedRows,
    excludedRows: excluded.length,
    invalidExcludedCodes,
    periodCounts,
    periodDivisionCounts,
    variantCounts,
    preservedNameDisagreements
  };
}
function planAuthoritativeClassifications(rows, products) {
  const existing = new Map(products.map((row) => [authoritativeCode(row.itemCode), row]));
  const acceptedCodes = /* @__PURE__ */ new Set();
  const newProducts = [];
  const rejectedRows = [];
  const classificationDifferences = [];
  let existingProducts = 0;
  let newNonRangeProducts = 0;
  let refusedNewRangeProducts = 0;
  rows.forEach((row, index5) => {
    const code = authoritativeCode(row.itemCode);
    const rangeDivision = supportsCatalogRange(row.division);
    const file2 = {
      division: row.division,
      category: rangeDivision ? row.category?.trim() || null : row.series?.trim() || null,
      seriesRange: rangeDivision ? row.series : null,
      categoryProvided: !rangeDivision || !!row.category?.trim(),
      rangeProvided: rangeDivision
    };
    const stored = existing.get(code);
    if (stored) {
      existingProducts++;
      acceptedCodes.add(code);
      const differingFields = [
        ...stored.division !== file2.division ? ["division"] : [],
        ...file2.categoryProvided && stored.category !== file2.category ? ["category"] : [],
        ...file2.rangeProvided && stored.seriesRange !== file2.seriesRange ? ["series_range"] : []
      ];
      if (differingFields.length) classificationDifferences.push({
        itemCode: stored.itemCode,
        message: "classification differs \u2014 not changed",
        differingFields,
        stored: { division: stored.division, category: stored.category, seriesRange: stored.seriesRange },
        file: file2
      });
      return;
    }
    if (rangeDivision && !row.category?.trim()) {
      refusedNewRangeProducts++;
      rejectedRows.push({
        itemCode: row.itemCode,
        row: index5 + 2,
        reason: "new CP/PTMT product needs a category: create it in the product editor"
      });
      return;
    }
    if (!rangeDivision && !file2.category) {
      rejectedRows.push({
        itemCode: row.itemCode,
        row: index5 + 2,
        reason: "new product needs a category in the master series column"
      });
      return;
    }
    const classification = masterClassification({ ...row, category: file2.category });
    newProducts.push({ itemCode: row.itemCode, ...classification });
    if (!rangeDivision) newNonRangeProducts++;
    acceptedCodes.add(code);
  });
  return {
    acceptedCodes,
    newProducts,
    rejectedRows,
    classificationDifferences,
    counts: { existingProducts, newNonRangeProducts, refusedNewRangeProducts }
  };
}
async function loadAuthoritativeMaster(input) {
  if (!isIsoDate(input.downloadedAt)) {
    throw new Error("downloadedAt must be a valid YYYY-MM-DD date.");
  }
  if (!input.buffer && !input.parsed) {
    throw new Error("An authoritative workbook buffer or validated payload is required.");
  }
  const parsed2 = input.parsed ?? parseAuthoritativeMasterBuffer(input.buffer);
  const preservedNamesByCode = new Map(
    parsed2.preservedNameDisagreements.map((row) => [
      row.itemCode,
      row.preservedName
    ])
  );
  const namePreservationNote = parsed2.preservedNameDisagreements.length ? ` Named product-name exceptions (${parsed2.preservedNameDisagreements.length}): ${parsed2.preservedNameDisagreements.map(
    (row) => `${row.itemCode}: "${row.sourceName}" -> "${row.preservedName}"`
  ).join("; ")}` : "";
  const loadNotes = `${parsed2.loadReason}${namePreservationNote}`;
  const load = async (tx) => {
    await tx.execute(sql5`SELECT pg_advisory_xact_lock(917_901)`);
    await tx.execute(sql5`LOCK TABLE catalog_products IN SHARE ROW EXCLUSIVE MODE`);
    await tx.insert(mrpSourcesTable).values(AUTHORITATIVE_MASTER_SOURCE).onConflictDoNothing({ target: mrpSourcesTable.sheetId });
    const sources = await tx.select({ id: mrpSourcesTable.id }).from(mrpSourcesTable).where(
      eq3(
        mrpSourcesTable.sheetId,
        AUTHORITATIVE_MASTER_SOURCE.sheetId
      )
    ).limit(1);
    const sourceId = sources[0]?.id;
    if (!sourceId) {
      throw new Error("Authoritative MRP provenance source could not be created.");
    }
    const existingBatches = await tx.select({
      id: mrpLoadBatchesTable.id,
      loadedAt: mrpLoadBatchesTable.loadedAt,
      downloadedAt: mrpLoadBatchesTable.downloadedAt
    }).from(mrpLoadBatchesTable).where(
      and2(
        eq3(mrpLoadBatchesTable.sourceId, sourceId),
        eq3(mrpLoadBatchesTable.fileSha256, parsed2.fileSha256)
      )
    );
    if (existingBatches.length) {
      return {
        duplicate: true,
        existingBatches
      };
    }
    const before = await tx.execute(sql5`
      SELECT
        (SELECT COUNT(*)::int FROM catalog_products) AS catalog_rows,
        (SELECT COUNT(*)::int FROM mrp_price_history) AS history_rows,
        (SELECT COUNT(DISTINCT item_code)::int FROM mrp_price_history) AS history_codes
    `);
    const catalogCodesBefore = new Set(
      (await tx.select({ itemCode: catalogProductsTable.itemCode }).from(catalogProductsTable)).map((row) => row.itemCode)
    );
    const existingProducts = await tx.select({
      itemCode: catalogProductsTable.itemCode,
      productName: catalogProductsTable.productName,
      division: catalogProductsTable.division,
      category: catalogProductsTable.category,
      seriesRange: catalogProductsTable.seriesRange
    }).from(catalogProductsTable);
    const classificationPlan = planAuthoritativeClassifications(parsed2.productRows, existingProducts);
    const canonicalCodes = new Map(existingProducts.map((row) => [authoritativeCode(row.itemCode), row.itemCode]));
    const eligiblePriceRows = parsed2.priceRows.filter((row) => classificationPlan.acceptedCodes.has(authoritativeCode(row.itemCode))).map((row) => ({ ...row, itemCode: canonicalCodes.get(authoritativeCode(row.itemCode)) ?? row.itemCode }));
    if (!eligiblePriceRows.length) throw new Error(classificationPlan.rejectedRows[0]?.reason ?? "No valid price rows would be written.");
    const periodCounts = {};
    const periodDivisionCounts = {};
    const variantCounts = { Standard: 0, Ivory: 0, "White with Jet": 0, "Pink / Green / Blue": 0 };
    for (const row of parsed2.productRows.filter((row2) => classificationPlan.acceptedCodes.has(authoritativeCode(row2.itemCode)))) {
      periodCounts[row.effectiveDate] = (periodCounts[row.effectiveDate] ?? 0) + 1;
      const key = `${row.effectiveDate} \u2014 ${row.division}`;
      periodDivisionCounts[key] = (periodDivisionCounts[key] ?? 0) + 1;
    }
    for (const row of eligiblePriceRows) variantCounts[row.variant]++;
    const newClassifications = new Map(classificationPlan.newProducts.map((row) => [authoritativeCode(row.itemCode), row]));
    const batch = await tx.insert(mrpLoadBatchesTable).values({
      sourceId,
      fileName: parsed2.fileName,
      fileSha256: parsed2.fileSha256,
      fileSizeBytes: input.buffer?.length ?? input.fileSizeBytes ?? 0,
      downloadedAt: input.downloadedAt,
      loadedBy: input.loadedBy,
      rowCount: eligiblePriceRows.length,
      notes: loadNotes
    }).returning({ id: mrpLoadBatchesTable.id });
    const loadBatchId = batch[0].id;
    const newProductRows = parsed2.productRows.filter((row) => newClassifications.has(authoritativeCode(row.itemCode)));
    for (let index5 = 0; index5 < newProductRows.length; index5 += 500) {
      const values = newProductRows.slice(index5, index5 + 500).map((row) => ({
        productName: preservedNamesByCode.get(row.itemCode) ?? row.productName,
        division: row.division,
        ...newClassifications.get(authoritativeCode(row.itemCode)),
        size: row.size,
        uom: "NOS",
        isActive: true,
        discontinuedFrom: null,
        discontinuedCheckedBy: null,
        discontinuedStatusNote: null,
        sourceFiles: parsed2.fileName,
        dataFlag: parsed2.dataFlag,
        updatedAt: /* @__PURE__ */ new Date()
      }));
      await tx.insert(catalogProductsTable).values(values);
    }
    const loadedHistory = [];
    const loadDate = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    for (let index5 = 0; index5 < eligiblePriceRows.length; index5 += 500) {
      const values = eligiblePriceRows.slice(index5, index5 + 500).map((row) => ({
        itemCode: row.itemCode,
        mrp: row.mrp,
        netPrice: null,
        discountPct: null,
        priceBasis: "MRP",
        effectiveDate: row.effectiveDate,
        loadDate,
        sourceFile: parsed2.fileName,
        isCurrent: false,
        notes: parsed2.loadReason,
        reviewStatus: "approved",
        reviewReasons: null,
        importBatchId: null,
        loadBatchId,
        reviewedAt: /* @__PURE__ */ new Date(),
        variant: row.variant
      }));
      const upserted = await tx.insert(mrpPriceHistoryTable).values(values).onConflictDoUpdate({
        target: [
          mrpPriceHistoryTable.itemCode,
          mrpPriceHistoryTable.effectiveDate,
          mrpPriceHistoryTable.variant
        ],
        set: {
          mrp: sql5`excluded.mrp`,
          netPrice: null,
          discountPct: null,
          priceBasis: "MRP",
          loadDate,
          sourceFile: parsed2.fileName,
          isCurrent: false,
          notes: parsed2.loadReason,
          reviewStatus: "approved",
          reviewReasons: null,
          importBatchId: null,
          loadBatchId,
          reviewedAt: /* @__PURE__ */ new Date()
        }
      }).returning({
        id: mrpPriceHistoryTable.id,
        itemCode: mrpPriceHistoryTable.itemCode,
        effectiveDate: mrpPriceHistoryTable.effectiveDate,
        mrp: mrpPriceHistoryTable.mrp
      });
      loadedHistory.push(...upserted);
    }
    for (let index5 = 0; index5 < loadedHistory.length; index5 += 500) {
      await tx.insert(mrpHistoryProvenanceEventsTable).values(
        loadedHistory.slice(index5, index5 + 500).map((row) => ({
          historyRowId: row.id,
          itemCode: row.itemCode,
          effectiveDate: row.effectiveDate,
          action: "authoritative_master_import",
          reason: parsed2.loadReason,
          sourceFile: parsed2.fileName,
          loadBatchId,
          mrp: row.mrp
        }))
      );
    }
    await recomputeCurrentFlagsInTransaction(tx);
    const after = await tx.execute(sql5`
      SELECT
        (SELECT COUNT(*)::int FROM catalog_products) AS catalog_rows,
        (SELECT COUNT(*)::int FROM mrp_price_history) AS history_rows,
        (SELECT COUNT(DISTINCT item_code)::int FROM mrp_price_history) AS history_codes
    `);
    const newCodes = (await tx.select({ itemCode: catalogProductsTable.itemCode }).from(catalogProductsTable)).map((row) => row.itemCode).filter((itemCode) => !catalogCodesBefore.has(itemCode)).sort();
    return {
      duplicate: false,
      loadBatchId,
      before: before.rows[0],
      after: after.rows[0],
      productRows: parsed2.productRows.length,
      priceRows: eligiblePriceRows.length,
      classificationCounts: classificationPlan.counts,
      classificationDifferences: classificationPlan.classificationDifferences,
      rejectedRows: classificationPlan.rejectedRows,
      newCodes,
      deactivatedCodes: [],
      discontinuedRows: 0,
      immediatelyWithdrawn: 0,
      sourceDiscontinuedRows: parsed2.discontinuedRows.length,
      excludedRows: parsed2.excludedRows,
      invalidExcludedCodes: parsed2.invalidExcludedCodes,
      periodCounts,
      periodDivisionCounts,
      variantCounts,
      preservedNameDisagreements: parsed2.preservedNameDisagreements
    };
  };
  const result = input.transaction ? await load(input.transaction) : await (input.database ?? db).transaction(load);
  return result;
}

// src/routes/catalogImportExport.ts
import { Router } from "/home/runner/workspace/node_modules/.pnpm/express@5.2.1/node_modules/express/index.js";
import { createHash as createHash4, randomUUID } from "node:crypto";
import multer from "/home/runner/workspace/node_modules/.pnpm/multer@2.2.0/node_modules/multer/index.js";
import * as XLSX4 from "/home/runner/workspace/node_modules/.pnpm/xlsx@0.18.5/node_modules/xlsx/xlsx.js";
import AdmZip from "/home/runner/workspace/node_modules/.pnpm/adm-zip@0.6.0/node_modules/adm-zip/adm-zip.js";
import { and as and3, eq as eq5, asc, desc, gt, inArray as inArray2, lte, sql as sql6 } from "/home/runner/workspace/node_modules/.pnpm/drizzle-orm@0.45.2_@types+pg@8.20.0_pg@8.20.0/node_modules/drizzle-orm/index.cjs";

// src/lib/auth.ts
import crypto from "crypto";
import { eq as eq4 } from "/home/runner/workspace/node_modules/.pnpm/drizzle-orm@0.45.2_@types+pg@8.20.0_pg@8.20.0/node_modules/drizzle-orm/index.cjs";
var SESSION_TTL = 7 * 24 * 60 * 60 * 1e3;

// src/middlewares/authMiddleware.ts
function requireAdmin(req, res, next) {
  if (process.env.NODE_ENV === "test" && typeof req.isAuthenticated !== "function") {
    next();
    return;
  }
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (req.user.mustChangePassword) {
    res.status(403).json({ error: "Password change required.", code: "PASSWORD_CHANGE_REQUIRED" });
    return;
  }
  if (req.user.role !== "admin") {
    res.status(403).json({ error: "Admin access required." });
    return;
  }
  next();
}

// src/lib/analysis.ts
var GST_MULTIPLIER = 1.18;
function effectivePrice(unit, price, priceBasis, gstPct) {
  if (priceBasis === "MRP") return price;
  if (priceBasis === "Ex-GST") return price * (1 + (gstPct ?? 18) / 100);
  if (unit != null && unit.trim() === "Rate (ex-GST)") {
    return price * GST_MULTIPLIER;
  }
  return price;
}

// src/lib/discontinuationPolicy.ts
function deriveConfirmedDiscontinuations(rows) {
  const byCode = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const itemCode = row.itemCode.trim();
    if (!itemCode) continue;
    const key = itemCode.toUpperCase();
    const group = byCode.get(key) ?? {
      itemCode,
      allRemoved: true,
      markerPeriods: /* @__PURE__ */ new Set(),
      latestPricedPeriod: null
    };
    group.allRemoved &&= row.isRemoved;
    if (row.markerPeriod) group.markerPeriods.add(row.markerPeriod);
    if (row.latestPricedPeriod && (!group.latestPricedPeriod || row.latestPricedPeriod > group.latestPricedPeriod)) {
      group.latestPricedPeriod = row.latestPricedPeriod;
    }
    byCode.set(key, group);
  }
  return [...byCode.values()].flatMap((group) => {
    if (!group.allRemoved || group.markerPeriods.size === 0) return [];
    const discontinuedFrom = [...group.markerPeriods].sort()[0];
    if (group.latestPricedPeriod && group.latestPricedPeriod > discontinuedFrom) {
      return [];
    }
    return [{ itemCode: group.itemCode, discontinuedFrom }];
  }).sort((a, b) => a.itemCode.localeCompare(b.itemCode));
}

// src/lib/priceHistoryStatus.ts
function derivePriceHistoryStatuses(rows, asOf, groupKey, isEligible = () => true) {
  const statuses = new Map(
    rows.map((row) => [row.id, "Superseded"])
  );
  const groups = /* @__PURE__ */ new Map();
  for (const row of rows) {
    if (!row.effectiveDate || !isEligible(row)) continue;
    const key = groupKey(row);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    const winnerByDate = /* @__PURE__ */ new Map();
    for (const row of group) {
      const existing = winnerByDate.get(row.effectiveDate);
      if (!existing || row.id > existing.id) {
        winnerByDate.set(row.effectiveDate, row);
      }
    }
    const revisions = [...winnerByDate.values()].sort(
      (a, b) => a.effectiveDate.localeCompare(b.effectiveDate)
    );
    const current = revisions.filter((row) => row.effectiveDate <= asOf).at(-1);
    for (const row of revisions) {
      statuses.set(
        row.id,
        row.id === current?.id ? "Current" : row.effectiveDate > asOf ? "Upcoming" : "Superseded"
      );
    }
  }
  return statuses;
}

// src/lib/princeMaster.ts
import { createHash as createHash3 } from "node:crypto";
import * as XLSX2 from "/home/runner/workspace/node_modules/.pnpm/xlsx@0.18.5/node_modules/xlsx/xlsx.js";
var PRINCE_COMPETITOR = "Prince";
var PRINCE_EFFECTIVE_DATE = "2026-03-01";
var PRINCE_CONTENT_FINGERPRINT = "2b5b79da680b5a9e386811ee3a845a461e91a58d5ea0943fd847609502beb7ff";
var PRINCE_REQUIRED_SHEETS = /* @__PURE__ */ new Set([
  "CPVC PIPE",
  "CPVC FITTINGS",
  "UPVC PIPE",
  "UPVC FITTINGS",
  "AGRI PIPE",
  "AGRI FITTINGS",
  "AGRI SMART FITTINGS",
  "SWR PIPE",
  "SWR FITTINGS",
  "CASING PIPE",
  "UGD PIPE",
  "PPR PIPE",
  "PPR FITTINGS"
]);
var PRINCE_EFFECTIVE_DATE_BY_SHEET = new Map(
  [...PRINCE_REQUIRED_SHEETS].map((sheet) => [
    sheet,
    sheet === "PPR PIPE" || sheet === "PPR FITTINGS" ? "2026-08-18" : PRINCE_EFFECTIVE_DATE
  ])
);
function isPrinceCompetitorMasterWorkbook(workbook) {
  const sheets = new Set(workbook.SheetNames.map((name) => name.trim().toUpperCase()));
  const requiredFound = [...PRINCE_REQUIRED_SHEETS].filter((name) => sheets.has(name)).length;
  if (requiredFound === 0) return false;
  if (requiredFound !== PRINCE_REQUIRED_SHEETS.size) {
    throw new Error(`Prince-like workbook is incomplete: found ${requiredFound} of 13 required worksheets.`);
  }
  const unexpected = [...sheets].filter((name) => !PRINCE_REQUIRED_SHEETS.has(name));
  if (unexpected.length) {
    throw new Error(`Prince master contains unexpected worksheets: ${unexpected.join(", ")}.`);
  }
  return true;
}
function classifyPrinceDuplicateAnomalies(rows, confirmedCompetitorCodes = /* @__PURE__ */ new Set()) {
  const groups = /* @__PURE__ */ new Map();
  for (const row of rows) {
    const code = normalizePrinceCode(row.princeCode);
    const group = groups.get(code) ?? [];
    group.push(row);
    groups.set(code, group);
  }
  const result = /* @__PURE__ */ new Map();
  for (const [code, group] of groups) {
    const prayagCodes = [...new Set(group.map((row) => row.canonicalPrayagCode ?? row.prayagCode))];
    if (prayagCodes.length < 2) continue;
    const confirmed = confirmedCompetitorCodes.has(code);
    for (const row of group) {
      result.set(`${code}|${normalizePrinceCode(row.canonicalPrayagCode ?? row.prayagCode)}`, {
        status: confirmed ? "ok" : "needs_review",
        reason: confirmed ? "Duplicate anomaly adjudicated: confirmed_by_decision; staging anomaly flag cleared." : `Duplicate anomaly: ${code} maps to multiple Prayag codes (${prayagCodes.join(", ")}).`,
        confirmedByDecision: confirmed
      });
    }
  }
  return result;
}
var clean = (value) => String(value ?? "").trim();
var normalizePrinceCode = (value) => clean(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
function numberCell(value) {
  if (value == null || clean(value) === "" || clean(value) === "-") return null;
  const number = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(number) ? number : null;
}
function dateValue(value) {
  if (value instanceof Date || Object.prototype.toString.call(value) === "[object Date]") {
    const date3 = value;
    return `${date3.getUTCFullYear()}-${String(date3.getUTCMonth() + 1).padStart(2, "0")}-${String(date3.getUTCDate()).padStart(2, "0")}`;
  }
  const text7 = clean(value).toLowerCase();
  if (/2026[-/ ]03[-/ ]01|2026.*mar.*01|01.*mar.*2026/i.test(text7)) return "2026-03-01";
  if (typeof value === "number") {
    const date3 = XLSX2.SSF.parse_date_code(value);
    return date3 ? `${date3.y}-${String(date3.m).padStart(2, "0")}-${String(date3.d).padStart(2, "0")}` : null;
  }
  const parsedTextDate = Date.parse(text7);
  if (Number.isFinite(parsedTextDate)) {
    const parsed2 = new Date(parsedTextDate);
    return `${parsed2.getUTCFullYear()}-${String(parsed2.getUTCMonth() + 1).padStart(2, "0")}-${String(parsed2.getUTCDate()).padStart(2, "0")}`;
  }
  return null;
}
function sheetLayout(sheetName) {
  const name = sheetName.trim().toUpperCase();
  if (name === "SWR PIPE") return { prayag: 5, prayagPrice: 6, prince: 7, princePrice: 8, length: 2 };
  if (name === "CASING PIPE" || name === "UGD PIPE") {
    return { prayag: 2, prayagPrice: 4, prince: 5, princePrice: 7, length: null };
  }
  if (name === "AGRI FITTINGS") return { prayag: 2, prayagPrice: 3, prince: 4, princePrice: 5, length: null };
  if (name === "AGRI SMART FITTINGS") return { prayag: 1, prayagPrice: 2, prince: 3, princePrice: 4, length: null };
  if (name === "AGRI PIPE") return { prayag: 2, prayagPrice: 3, prince: 4, princePrice: 5, length: null };
  if (name === "PPR PIPE") return { prayag: 2, prayagPrice: 4, prince: 5, princePrice: 7, length: null };
  if (name === "PPR FITTINGS") return { prayag: 3, prayagPrice: 4, prince: 5, princePrice: 6, length: null };
  return { prayag: 3, prayagPrice: 4, prince: 5, princePrice: 6, length: null };
}
function sheetLength(sheetName, row, lengthColumn) {
  if (lengthColumn != null) {
    const value = numberCell(row[lengthColumn]);
    if (value != null && value > 0) return value;
  }
  const text7 = `${sheetName} ${row.map(clean).join(" ")}`.toLowerCase();
  if (/\bcasing\b/.test(text7)) return 3;
  if (/\bugd\b/.test(text7)) return 6;
  if (/\bagri\s+pipe\b/.test(text7)) return 6;
  const match = text7.match(/(\d+(?:\.\d+)?)\s*(?:mtr|meter|metre|meters|metres)\b/);
  return match ? Number(match[1]) : null;
}
function parsePrinceCompetitorMaster(buffer, workbook, canonicalCodes) {
  const sourceSha256 = createHash3("sha256").update(buffer).digest("hex");
  const rows = [];
  const worksheetDiagnostics = [];
  const rejectedRows = [];
  const sourceSheets = workbook.SheetNames.filter((name) => PRINCE_REQUIRED_SHEETS.has(name.trim().toUpperCase()));
  if (workbook.SheetNames.length !== 13 || sourceSheets.length !== PRINCE_REQUIRED_SHEETS.size) {
    throw new Error(`Prince master must contain all 13 required worksheets; found ${sourceSheets.length}. Worksheets: ${workbook.SheetNames.join(", ")}`);
  }
  const effectiveDates = [];
  for (const sheetName of sourceSheets) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const grid = XLSX2.utils.sheet_to_json(sheet, { header: 1, defval: null });
    const layout = sheetLayout(sheetName);
    const princePrice = layout.princePrice;
    const headerDate = dateValue(grid[1]?.[princePrice]);
    const expectedDate = PRINCE_EFFECTIVE_DATE_BY_SHEET.get(sheetName.trim().toUpperCase());
    if (!headerDate || headerDate !== expectedDate) {
      throw new Error(
        `Prince sheet ${sheetName.trim()} must use effective date ${expectedDate} at audited position ${princePrice}; found ${headerDate ?? "none"}.`
      );
    }
    effectiveDates.push({ sheet: sheetName.trim(), effectiveDate: headerDate });
    const prince = layout.prince;
    const headerRow = Math.max(0, grid.findIndex((row) => row.some((cell, col) => col === prince && /item\s*code/i.test(clean(cell)))));
    const codeHeaders = (grid[headerRow] ?? []).flatMap((cell, col) => /item\s*code/i.test(clean(cell)) ? [col] : []);
    const prayag = layout.prayag;
    const counts = { sheet: sheetName.trim(), prayagCodes: 0, princePriced: 0 };
    for (const [sourceRowIndex, row] of grid.entries()) {
      if (sourceRowIndex <= headerRow) continue;
      const prayagCode = clean(row[prayag]);
      const princeCode = clean(row[prince]);
      const price = numberCell(row[princePrice]);
      if (!princeCode && !prayagCode) continue;
      if (/^(prayag|prince|item code)$/i.test(princeCode) || /^(prayag|item code)$/i.test(prayagCode)) continue;
      if (prayagCode) counts.prayagCodes++;
      if (princeCode && price != null) counts.princePriced++;
      if (!princeCode && (price === 0 || price == null) && prayagCode === "PMR-5") {
        rejectedRows.push({ sheet: sheetName.trim(), sourceRow: sourceRowIndex + 1, prayagCode, princeCode, price, reason: "PMR-5 has no Prince code and its zero price is explicitly rejected." });
        continue;
      }
      if (!princeCode) continue;
      if (price == null || price <= 0) {
        rejectedRows.push({ sheet: sheetName.trim(), sourceRow: sourceRowIndex + 1, prayagCode, princeCode, price, reason: "Prince price must be positive." });
        continue;
      }
      if (normalizePrinceCode(princeCode) === "SIM200032") {
        rejectedRows.push({ sheet: sheetName.trim(), sourceRow: sourceRowIndex + 1, prayagCode, princeCode, price, reason: "SIM200032 has conflicting Prince prices; both rows are rejected." });
        continue;
      }
      const canonical = canonicalCodes.get(normalizePrinceCode(prayagCode)) ?? null;
      const category = sheetName.trim();
      rows.push({
        sheet: category,
        category,
        prayagCode,
        princeCode,
        // Deliberately do not consume the stale Prayag price column.
        prayagPrice: null,
        price,
        prayagPriceBasis: "piece",
        princePriceBasis: "piece",
        lengthMeters: sheetLength(category, row, layout.length),
        catalogMatched: canonical != null,
        canonicalPrayagCode: canonical,
        sourceRow: sourceRowIndex + 1,
        effectiveDate: headerDate
      });
    }
    worksheetDiagnostics.push(counts);
  }
  const diagnostics = worksheetDiagnostics.map((row) => `${row.sheet}: ${row.prayagCodes}/${row.princePriced}`).join(", ");
  const unmatchedRows = rows.filter((row) => !row.catalogMatched);
  const lines = [
    ...rows.map((row) => `${normalizePrinceCode(row.prayagCode)}|${normalizePrinceCode(row.princeCode)}|${row.price.toFixed(2)}`),
    ...rejectedRows.filter((row) => row.princeCode && row.price != null && row.price > 0).map((row) => `${normalizePrinceCode(row.prayagCode)}|${normalizePrinceCode(row.princeCode)}|${row.price.toFixed(2)}`)
  ].sort();
  const contentFingerprint = createHash3("sha256").update(lines.join("\n"), "utf8").digest("hex");
  const priceSum = lines.reduce((sum, line) => sum + Number(line.slice(line.lastIndexOf("|") + 1)), 0);
  if (contentFingerprint !== PRINCE_CONTENT_FINGERPRINT) {
    throw new Error(`Prince content fingerprint mismatch: computed ${contentFingerprint}; row count ${lines.length}; price sum ${priceSum.toFixed(2)}; worksheets ${JSON.stringify(worksheetDiagnostics)}`);
  }
  const classified = [
    ...rows.map((row) => ({ prayagCode: row.prayagCode, canonical: row.canonicalPrayagCode })),
    ...rejectedRows.map((row) => ({ prayagCode: row.prayagCode, canonical: canonicalCodes.get(normalizePrinceCode(row.prayagCode)) ?? null }))
  ];
  const exactMatches = classified.filter((row) => row.canonical != null && clean(row.prayagCode).toUpperCase() === clean(row.canonical).toUpperCase()).length;
  return {
    rows,
    catalogMatchedRows: rows.filter((row) => row.catalogMatched),
    unmatchedRows,
    unmatchedCodes: [...new Set(unmatchedRows.map((row) => row.prayagCode).filter(Boolean))].sort(),
    sourceSha256,
    contentFingerprint,
    priceSum,
    worksheetDiagnostics,
    exactMatches,
    normalizedMatches: classified.filter((row) => row.canonical != null).length - exactMatches,
    rejectedRows,
    effectiveDate: PRINCE_EFFECTIVE_DATE,
    worksheetNames: sourceSheets.map((name) => name.trim()),
    effectiveDates
  };
}

// src/lib/competitorWorkbookSafety.ts
import * as XLSX3 from "/home/runner/workspace/node_modules/.pnpm/xlsx@0.18.5/node_modules/xlsx/xlsx.js";
var cleanCell = (value) => String(value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
var KNOWN_COMPETITOR_GROUPS = /* @__PURE__ */ new Set([
  "prayag",
  "apollo",
  "prince",
  "ashirvad",
  "sparsh pearl",
  "astral",
  "finolex",
  "supreme",
  "truflo",
  "vectus",
  "avonplast",
  "ori plast",
  "water tec",
  "parryware"
]);
function detectGroupedCompetitorBrands(workbook) {
  const brands = /* @__PURE__ */ new Set();
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = XLSX3.utils.sheet_to_json(sheet, {
      header: 1,
      raw: false,
      defval: null,
      range: 0
    }).slice(0, 3);
    for (const row of rows) {
      const labels = row.map(cleanCell);
      const recognized = labels.filter((label) => KNOWN_COMPETITOR_GROUPS.has(label));
      const qualified = [...KNOWN_COMPETITOR_GROUPS].filter(
        (brand) => brand !== "prayag" && labels.some((label) => {
          const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`).test(label) && /\b(?:price|mrp|rate|cost|net|item code|date)\b/.test(label);
        })
      );
      qualified.forEach((brand) => brands.add(brand));
      const hasPrayagReferenceGroup = labels.includes("prayag") && labels.some((label) => label && label !== "prayag" && !["item code", "mrp", "price", "rate", "cost"].includes(label));
      if (recognized.length >= 2 || hasPrayagReferenceGroup) {
        recognized.forEach((label) => brands.add(label));
        if (hasPrayagReferenceGroup && recognized.length < 2) {
          brands.add(labels.find((label) => label === "prayag"));
          const other = labels.find((label) => label && label !== "prayag" && !["item code", "mrp", "price", "rate", "cost"].includes(label));
          if (other) brands.add(other);
        }
      }
    }
  }
  return [...brands].sort();
}
function validateGenericWorkbookDate(sourceDates, selectedDate) {
  const dates = [...new Set(sourceDates.filter((date3) => Boolean(date3)))].sort();
  if (dates.length > 1) {
    throw new Error(`Workbook contains multiple competitor effective dates (${dates.join(", ")}); it cannot be staged as one brand period.`);
  }
  if (dates.length === 0) return null;
  const sourceDate = dates[0];
  if (sourceDate !== selectedDate) {
    throw new Error(`Selected effective date ${selectedDate} does not match the competitor date in the workbook ${sourceDate}. Upload refused.`);
  }
  return sourceDate;
}

// src/routes/catalogImportExport.ts
var GAP_MIN_PCT = -80;
var GAP_MAX_PCT = 100;
var router = Router();
var upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }
});
var PENDING_MRP_BATCH_LIFETIME_MS = 24 * 60 * 60 * 1e3;
var NEW_PRODUCTS_SOURCE = {
  division: "New Products Upload",
  sheetId: "__new_products_upload__",
  sheetUrl: "internal://new-products-upload",
  expectedFileName: null,
  notes: "Prayag-only product creation uploads. Existing codes are rejected.",
  sourceKind: "new_products"
};
var P029_CLASSIFICATION_SOURCE = {
  division: "P029 UGD Classification",
  sheetId: "__p029_ugd_classification__",
  sheetUrl: "internal://p029-ugd-classification",
  expectedFileName: "P029 UGD Self Fit classification repair",
  notes: "P029 classification-only sibling copy; never writes price, name, or mappings.",
  sourceKind: "manual_correction"
};
var P029_CLASSIFICATION_FILE_HASH = createHash4("sha256").update("P029|UGD Self Fit classification sibling-copy contract|v1").digest("hex");
var P029_PAIRS = [
  ["U-11C", "U-11CS"],
  ["U-12C", "U-12CS"],
  ["U-13C", "U-13CS"],
  ["U-14C", "U-14CS"],
  ["U-15C", "U-15CS"],
  ["U-16C", "U-16CS"],
  ["U-11B", "U-11BS"],
  ["U-12B", "U-12BS"],
  ["U-13B", "U-13BS"],
  ["U-14B", "U-14BS"]
];
var P029_EXPECTED_MRPS = {
  "U-11C": 2987,
  "U-12C": 4582,
  "U-13C": 6322,
  "U-14C": 10005,
  "U-15C": 15805,
  "U-16C": 25230,
  "U-11B": 2196,
  "U-12B": 2896,
  "U-13B": 4790,
  "U-14B": 7368,
  "U-11CS": 2987,
  "U-12CS": 4582,
  "U-13CS": 6322,
  "U-14CS": 10005,
  "U-15CS": 15805,
  "U-16CS": 25230,
  "U-11BS": 2196,
  "U-12BS": 2896,
  "U-13BS": 4790,
  "U-14BS": 7368
};
var P029_CLASSIFICATION_FIELDS = [
  "division",
  "category",
  "seriesRange",
  "size",
  "uom",
  "kgCost"
];
function newProductHeaderKey(value) {
  return norm(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}
function previewReason(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function newProductDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed3 = XLSX4.SSF.parse_date_code(value);
    if (parsed3) {
      return `${String(parsed3.y).padStart(4, "0")}-${String(parsed3.m).padStart(2, "0")}-${String(parsed3.d).padStart(2, "0")}`;
    }
  }
  const text7 = norm(value);
  if (!text7) return null;
  const iso = text7.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (iso) {
    const candidate = `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
    return isIsoDate(candidate) ? candidate : null;
  }
  const parsed2 = new Date(text7);
  return Number.isNaN(parsed2.getTime()) ? null : parsed2.toISOString().slice(0, 10);
}
function parseNewProductsWorkbook(buffer) {
  const workbook = XLSX4.read(buffer, { type: "buffer", cellDates: true });
  const rows = [];
  const rejectedRows = [];
  const rangeWarnings = [];
  let foundHeaders = false;
  const aliases = {
    itemCode: ["itemcode", "catno", "catnumber", "productcode"],
    division: ["division"],
    series: ["seriesrange", "series", "range"],
    productName: ["productname", "product"],
    size: ["size"],
    mrp: ["mrp", "mrpw.e.f", "mrpw.eff", "mrpwith effect"],
    effectiveDate: ["priceinforcesince", "effectiveDate", "inforcesince"]
  };
  for (const sheetName of workbook.SheetNames) {
    const grid = XLSX4.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      defval: null,
      raw: true
    });
    if (!grid.some((row) => row.some((cell) => norm(cell))) || foundHeaders) continue;
    let headerRow = -1;
    let columns = /* @__PURE__ */ new Map();
    for (let index5 = 0; index5 < Math.min(grid.length, 20); index5 += 1) {
      const candidate = /* @__PURE__ */ new Map();
      (grid[index5] ?? []).forEach((cell, column) => {
        const key = newProductHeaderKey(cell);
        for (const [name, accepted] of Object.entries(aliases)) {
          if (accepted.some((alias) => key === newProductHeaderKey(alias) || key.startsWith(newProductHeaderKey(alias)))) {
            candidate.set(name, column);
          }
        }
      });
      if (["itemCode", "division", "productName", "size", "mrp", "effectiveDate"].every((name) => candidate.has(name))) {
        headerRow = index5;
        columns = candidate;
        break;
      }
    }
    if (headerRow < 0) continue;
    foundHeaders = true;
    for (let index5 = headerRow + 1; index5 < grid.length; index5 += 1) {
      const input = grid[index5] ?? [];
      if (!input.some((cell) => norm(cell))) continue;
      const itemCode = norm(input[columns.get("itemCode")]) || null;
      const division = norm(input[columns.get("division")]);
      const series = norm(input[columns.get("series")]) || null;
      if (series && !supportsCatalogRange(division)) {
        rangeWarnings.push({ row: index5 + 1, itemCode, reason: `Range "${series}" was supplied for ${division}, which is outside the approved Range divisions. The product is not refused; Range will not be stored.` });
      }
      const productName = norm(input[columns.get("productName")]);
      const size = norm(input[columns.get("size")]) || null;
      const rawMrp = input[columns.get("mrp")];
      const mrp = typeof rawMrp === "number" ? rawMrp : Number(String(rawMrp ?? "").replace(/[,₹Rs\s]/gi, ""));
      const effectiveDate = newProductDate(input[columns.get("effectiveDate")]);
      const reason = !itemCode ? "Missing item code." : !division ? "Missing division." : !productName ? "Missing product name." : !Number.isFinite(mrp) || mrp <= 0 ? "MRP must be a positive number." : !effectiveDate ? "Effective date must be a valid date." : null;
      if (reason) {
        rejectedRows.push({ row: index5 + 1, itemCode, reason });
      } else {
        rows.push({ itemCode, division, series: supportsCatalogRange(division) ? series : null, seriesRange: supportsCatalogRange(division) ? series : null, productName, size, mrp, effectiveDate, row: index5 + 1 });
      }
    }
  }
  if (!foundHeaders) throw new Error("Workbook must contain item_code, division, product_name, size, mrp, and effective_date. Range is optional.");
  return { rows, rejectedRows, rangeWarnings };
}
function newProductsResponse(batch) {
  const preview = JSON.parse(batch.preview);
  return {
    batchId: batch.id,
    status: batch.status,
    expiresAt: batch.expiresAt,
    fileName: batch.fileName,
    fileSha256: batch.fileSha256,
    catalogBefore: preview.catalogBefore,
    catalogAfter: preview.catalogAfter,
    willCreateCount: preview.willCreateCount,
    rejectedCount: preview.rejectedCount,
    immediateCount: preview.immediateCount,
    immediateMessage: preview.immediateMessage,
    preview,
    result: batch.result ? JSON.parse(batch.result) : null
  };
}
var P019_PRINCE_REMAP = {
  SIM200965: "U-11CS",
  SIM200960: "U-13CS",
  SIM200961: "U-14CS",
  SIM200962: "U-15CS",
  SIM200963: "U-16CS",
  SIM200955: "U-13BS",
  SIM200956: "U-14BS"
};
async function applyP019PrinceRematch(tx, createdRows, today) {
  const createdCodes = new Set(createdRows.map((row) => normCode(row.itemCode)));
  const products = await tx.select({
    itemCode: catalogProductsTable.itemCode,
    isActive: catalogProductsTable.isActive,
    discontinuedFrom: catalogProductsTable.discontinuedFrom
  }).from(catalogProductsTable);
  const canonicalProduct = new Map(products.map((row) => [normCode(row.itemCode), row]));
  const candidates = await tx.select({
    id: competitorPriceStagingTable.id,
    batchId: competitorPriceStagingTable.batchId,
    competitorCodeMaster: competitorPriceStagingTable.competitorCodeMaster,
    competitorCodeCatalogue: competitorPriceStagingTable.competitorCodeCatalogue,
    competitor: competitorPriceStagingTable.competitor,
    newMrp: competitorPriceStagingTable.newMrp,
    oldMrp: competitorPriceStagingTable.oldMrp,
    status: competitorPriceStagingTable.status,
    reviewReason: competitorPriceStagingTable.reviewReason
  }).from(competitorPriceStagingTable).where(and3(
    eq5(competitorPriceStagingTable.competitor, "Prince"),
    eq5(competitorPriceStagingTable.status, "needs_review"),
    sql6`${competitorPriceStagingTable.matchedPrayagCode} IS NULL`,
    eq5(competitorPriceStagingTable.reviewReason, "No verified Prayag product match.")
  ));
  const batches = await tx.select({
    id: importBatchesTable.id,
    effectiveDate: importBatchesTable.effectiveDate
  }).from(importBatchesTable).where(inArray2(importBatchesTable.id, [...new Set(candidates.map((row) => row.batchId))]));
  const batchDate = new Map(batches.map((row) => [row.id, row.effectiveDate]));
  const affectedCandidateBatchIds = new Set(candidates.map((row) => row.batchId));
  const moved = [];
  const affectedBatchIds = /* @__PURE__ */ new Set();
  for (const row of candidates) {
    const masterCode = normCode(row.competitorCodeMaster);
    const catalogueCode = normCode(row.competitorCodeCatalogue);
    const rawCompetitorCode = P019_PRINCE_REMAP[masterCode] ? masterCode : catalogueCode;
    const mappedCode = P019_PRINCE_REMAP[masterCode] ?? P019_PRINCE_REMAP[catalogueCode];
    if (!mappedCode || !createdCodes.has(normCode(mappedCode))) continue;
    const product = canonicalProduct.get(normCode(mappedCode));
    const effectiveDate = batchDate.get(row.batchId) ?? today;
    const activeOnDate = product?.isActive && (!product.discontinuedFrom || product.discontinuedFrom > effectiveDate);
    if (!product || !activeOnDate) continue;
    const targetDate = effectiveDate < today ? effectiveDate : today;
    const history = await tx.select({
      mrp: mrpPriceHistoryTable.mrp
    }).from(mrpPriceHistoryTable).where(and3(
      eq5(mrpPriceHistoryTable.itemCode, product.itemCode),
      eq5(mrpPriceHistoryTable.variant, "Standard"),
      eq5(mrpPriceHistoryTable.reviewStatus, "approved"),
      lte(mrpPriceHistoryTable.effectiveDate, targetDate)
    )).orderBy(desc(mrpPriceHistoryTable.effectiveDate), desc(mrpPriceHistoryTable.id)).limit(1);
    const prayagMrp = history[0]?.mrp ?? null;
    const competitorPrice = row.newMrp ?? row.oldMrp;
    const gapPct = prayagMrp != null && competitorPrice != null && prayagMrp !== 0 ? (competitorPrice - prayagMrp) / prayagMrp * 100 : null;
    await tx.update(competitorPriceStagingTable).set({
      matchedPrayagCode: product.itemCode,
      status: "ok",
      matchMethod: "trusted_prince_master_p019",
      reviewReason: null,
      prayagMrpCurrent: prayagMrp,
      gapPct
    }).where(eq5(competitorPriceStagingTable.id, row.id));
    moved.push({ competitorCode: rawCompetitorCode, prayagCode: product.itemCode, batchId: row.batchId });
    affectedBatchIds.add(row.batchId);
  }
  if (affectedBatchIds.size) {
    for (const batchId of affectedBatchIds) {
      const counts = await tx.select({
        status: competitorPriceStagingTable.status,
        count: sql6`count(*)::int`
      }).from(competitorPriceStagingTable).where(eq5(competitorPriceStagingTable.batchId, batchId)).groupBy(competitorPriceStagingTable.status);
      const [batch] = await tx.select({ rowCounts: importBatchesTable.rowCounts }).from(importBatchesTable).where(eq5(importBatchesTable.id, batchId)).limit(1);
      const prior = batch?.rowCounts ? JSON.parse(batch.rowCounts) : {};
      const next = { ...prior, ok: 0, needs_review: 0, not_found: 0, new_products: 0 };
      for (const count2 of counts) {
        if (count2.status in next) next[count2.status] = count2.count;
      }
      await tx.update(importBatchesTable).set({ rowCounts: JSON.stringify(next) }).where(eq5(importBatchesTable.id, batchId));
    }
  }
  const remaining = affectedCandidateBatchIds.size === 0 ? [] : await tx.select({
    batchId: competitorPriceStagingTable.batchId,
    competitorCodeMaster: competitorPriceStagingTable.competitorCodeMaster,
    competitorCodeCatalogue: competitorPriceStagingTable.competitorCodeCatalogue,
    matchedPrayagCode: competitorPriceStagingTable.matchedPrayagCode,
    status: competitorPriceStagingTable.status
  }).from(competitorPriceStagingTable).where(and3(
    eq5(competitorPriceStagingTable.competitor, "Prince"),
    eq5(competitorPriceStagingTable.status, "needs_review"),
    inArray2(competitorPriceStagingTable.batchId, [...affectedCandidateBatchIds])
  ));
  return {
    movedCount: moved.length,
    byCompetitor: { Prince: moved },
    remainingNeedsReview: remaining.map((row) => ({
      batchId: row.batchId,
      competitorCode: normCode(row.competitorCodeMaster ?? row.competitorCodeCatalogue),
      prayagCode: row.matchedPrayagCode,
      status: row.status
    }))
  };
}
function pendingAuthoritativePreview(parsed2, products, history) {
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const classification = planAuthoritativeClassifications(parsed2.productRows, products.map((row) => ({
    ...row,
    division: row.division ?? null,
    category: row.category ?? null,
    seriesRange: row.seriesRange ?? null
  })));
  const acceptedProducts = parsed2.productRows.filter((row) => classification.acceptedCodes.has(normCode(row.itemCode)));
  const acceptedPrices = parsed2.priceRows.filter((row) => classification.acceptedCodes.has(normCode(row.itemCode)));
  const productsByCode = new Map(products.map((row) => [normCode(row.itemCode), row]));
  const fileCodes = new Set(parsed2.productRows.map((row) => normCode(row.itemCode)));
  const knownPeriods = new Set(history.map((row) => row.effectiveDate));
  const currentByCode = /* @__PURE__ */ new Map();
  for (const row of history) {
    if (row.variant !== "Standard" || row.effectiveDate > today) continue;
    const code = normCode(row.itemCode);
    const prior = currentByCode.get(code);
    if (!prior || row.effectiveDate > prior.effectiveDate) {
      currentByCode.set(code, { mrp: row.mrp, effectiveDate: row.effectiveDate });
    }
  }
  const allPastPriceChanges = acceptedProducts.filter((row) => productsByCode.has(normCode(row.itemCode)) && row.effectiveDate <= today).flatMap((row) => {
    const old = currentByCode.get(normCode(row.itemCode));
    return old && old.mrp !== row.mrp ? [{ itemCode: row.itemCode, productName: productsByCode.get(normCode(row.itemCode))?.productName ?? null, oldMrp: old.mrp, newMrp: row.mrp, effectiveDate: row.effectiveDate, delta: row.mrp - (old.mrp ?? 0) }] : [];
  }).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const immediatePriceChanges = allPastPriceChanges.filter(
    (row) => currentByCode.get(normCode(row.itemCode))?.effectiveDate !== row.effectiveDate
  );
  const existingPeriodPriceRevisions = allPastPriceChanges.filter(
    (row) => currentByCode.get(normCode(row.itemCode))?.effectiveDate === row.effectiveDate
  );
  const acceptedPeriodCounts = {};
  for (const row of acceptedProducts) acceptedPeriodCounts[row.effectiveDate] = (acceptedPeriodCounts[row.effectiveDate] ?? 0) + 1;
  const periods = Object.entries(acceptedPeriodCounts).map(([effectiveDate, rowCount]) => ({
    effectiveDate,
    rowCount,
    isNew: !knownPeriods.has(effectiveDate),
    movedInCount: acceptedProducts.filter((row) => row.effectiveDate === effectiveDate && currentByCode.get(normCode(row.itemCode))?.effectiveDate !== effectiveDate).length
  })).sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
  const rejectedReasonSummary = {};
  for (const row of classification.rejectedRows) rejectedReasonSummary[row.reason] = (rejectedReasonSummary[row.reason] ?? 0) + 1;
  return {
    kind: "authoritative-master",
    rowsToWrite: acceptedPrices.length,
    productRows: parsed2.productRows.length,
    priceRows: acceptedPrices.length,
    classificationCounts: classification.counts,
    classificationDifferences: classification.classificationDifferences,
    classificationDifferenceCount: classification.classificationDifferences.length,
    classificationPolicy: "Existing products: prices only. classification differs \u2014 not changed. New non-Range products: master series \u2192 Category; no Range. New CP/PTMT products without Category: create in the product editor.",
    periods,
    immediatePriceChanges,
    immediatePriceChangeCount: immediatePriceChanges.length,
    existingPeriodPriceRevisions,
    existingPeriodPriceRevisionCount: existingPeriodPriceRevisions.length,
    newProducts: acceptedProducts.filter((row) => !productsByCode.has(normCode(row.itemCode))).map((row) => ({ itemCode: row.itemCode, productName: row.productName })),
    catalogueProductsAbsentFromFile: products.filter((row) => !fileCodes.has(normCode(row.itemCode))).map((row) => row.itemCode),
    discontinuations: { total: 0, immediate: 0, future: 0 },
    lifecyclePolicy: "Existing activation and discontinuation state is preserved \u2014 not changed by a price-only load.",
    protectedNameConflicts: parsed2.preservedNameDisagreements,
    rejectedRows: classification.rejectedRows,
    rejectedReasonSummary,
    canApply: acceptedPrices.length > 0,
    noChangeReason: acceptedPrices.length ? null : classification.rejectedRows[0]?.reason ?? "No valid rows would be written."
  };
}
var NET_KEYWORDS = ["net", "rate", "dealer", "scheme", "billing", "discount"];
var MRP_KEYWORDS = ["mrp", "list", "retail", "price"];
var PACKING_EXCLUDE_KEYWORDS = [
  "pack",
  "packing",
  "box",
  "pcs",
  "piece",
  "pieces",
  "carton",
  "case",
  "quantity",
  "qty",
  "count",
  "weight",
  "kg",
  "cost",
  "mass",
  "size",
  "dimension",
  "dimensions",
  "length",
  "width",
  "height",
  "depth",
  "diameter",
  "dia",
  "capacity",
  "volume"
];
var PACKING_SHEET_RE = /\bpacking\b/i;
var MASTER_SHEET_RE = /\bmaster\b/i;
function norm(s) {
  return String(s ?? "").trim();
}
function parseDiscontinuationCorrectionWorkbook(workbook) {
  const unmarkSheet = workbook.Sheets["1_UNMARK_not_discontinued"];
  const confirmedSheet = workbook.Sheets["2_Confirmed_discontinued"];
  if (!unmarkSheet || !confirmedSheet) return null;
  const unmarkedCodes = XLSX4.utils.sheet_to_json(unmarkSheet, { defval: null }).map((row) => String(row.item_code ?? "").trim()).filter(Boolean);
  const confirmedRows = XLSX4.utils.sheet_to_json(confirmedSheet, { defval: null }).map((row) => ({
    itemCode: String(row.item_code ?? "").trim(),
    discontinuedFrom: String(row.discontinued_from ?? "").trim()
  })).filter(
    (row) => row.itemCode.length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(row.discontinuedFrom)
  );
  if (!unmarkedCodes.length || !confirmedRows.length) {
    throw new Error("The discontinuation correction workbook has no usable rows.");
  }
  const confirmed = deriveConfirmedDiscontinuations([
    ...unmarkedCodes.map((itemCode) => ({
      itemCode,
      markerPeriod: null,
      latestPricedPeriod: null,
      isRemoved: false
    })),
    ...confirmedRows.map((row) => ({
      itemCode: row.itemCode,
      markerPeriod: row.discontinuedFrom,
      latestPricedPeriod: null,
      isRemoved: true
    }))
  ]);
  if (confirmed.length !== confirmedRows.length) {
    throw new Error(
      "The correction workbook has overlapping live and removed codes; resolve them by code before importing."
    );
  }
  return { unmarkedCodes, confirmed };
}
function parsePeriodHeader(value) {
  const text7 = norm(value).replace(/(\d{1,2})(st|nd|rd|th)\b/gi, "$1").replace(/\s+/g, " ");
  const iso = text7.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const match = text7.match(
    /^(\d{1,2})\s*[-,/ ]\s*(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s*,?\s*(\d{4})$/i
  );
  if (!match) return null;
  const months = {
    jan: "01",
    feb: "02",
    mar: "03",
    apr: "04",
    may: "05",
    jun: "06",
    jul: "07",
    aug: "08",
    sep: "09",
    oct: "10",
    nov: "11",
    dec: "12"
  };
  const month = months[match[2].slice(0, 3).toLowerCase()];
  if (!month) return null;
  return `${match[3]}-${month}-${match[1].padStart(2, "0")}`;
}
function hasResolvablePeriodHeader(grid) {
  return grid.slice(0, 15).some((row) => row.some((cell) => !!parsePeriodHeader(cell)));
}
function parseSheet(grid, knownCodes, requireHeaderPeriod) {
  const maxCols = Math.max(0, ...grid.map((r) => r.length));
  let headerRow = 0;
  for (let r = 0; r < Math.min(grid.length, 15); r++) {
    const strs = (grid[r] ?? []).filter(
      (v) => typeof v === "string" && norm(v).length > 0 && isNaN(Number(v))
    );
    if (strs.length >= 2) {
      headerRow = r;
      break;
    }
  }
  const rawHeaders = (grid[headerRow] ?? []).map((h) => norm(h));
  const headers = rawHeaders.map((h) => h.toLowerCase());
  const SERIAL_HEADER_TOKENS = ["s.no", "sno", "sr.no", "sl.no", "sr.", "sl.", "serial"];
  const isSerialHeader = (c) => {
    const h = (headers[c] ?? "").replace(/\s+/g, "").toLowerCase();
    if (h === "no" || h === "no." || h === "#") return true;
    return SERIAL_HEADER_TOKENS.some((t) => h === t || h.startsWith(t));
  };
  const isSequentialIntColumn = (c) => {
    const nums = [];
    for (let r = 0; r < grid.length; r++) {
      if (r === headerRow) continue;
      const v = grid[r]?.[c];
      const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
      if (!isNaN(n) && n > 0 && Number.isInteger(n)) nums.push(n);
    }
    if (nums.length < 3) return false;
    const sorted = [...nums].sort((a, b) => a - b);
    let consecutive = 0;
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] - sorted[i - 1] <= 1) consecutive++;
    }
    return consecutive / (sorted.length - 1) > 0.75;
  };
  const DIMENSION_TOKENS = ["size", "length", "width", "height", "dia", "weight", "capacity"];
  const isDimensionHeader = (c) => {
    const h = (headers[c] ?? "").toLowerCase();
    return DIMENSION_TOKENS.some((t) => h.includes(t));
  };
  const CODE_KEYWORDS = ["item code", "itemcode", "cat no", "catno", "cat. no"];
  let codeCol = -1;
  for (let c = 0; c < maxCols; c++) {
    if (isSerialHeader(c) || isDimensionHeader(c)) continue;
    const h = (headers[c] ?? "").toLowerCase().replace(/[\s.]/g, "");
    if (CODE_KEYWORDS.some((k) => k.replace(/[\s.]/g, "") === h || h.startsWith(k.replace(/[\s.]/g, "")))) {
      codeCol = c;
      break;
    }
  }
  if (codeCol === -1) {
    for (let c = 0; c < maxCols; c++) {
      if (isSerialHeader(c) || isDimensionHeader(c)) continue;
      const h = headers[c] ?? "";
      if (h.includes("code") || h.includes("item")) {
        codeCol = c;
        break;
      }
    }
  }
  if (codeCol === -1) {
    let bestOverlap = 0;
    for (let c = 0; c < maxCols; c++) {
      if (isSerialHeader(c) || isDimensionHeader(c) || isSequentialIntColumn(c)) continue;
      let overlap = 0;
      for (let r = 0; r < grid.length; r++) {
        if (r === headerRow) continue;
        if (knownCodes.has(normCode(grid[r]?.[c]))) overlap++;
      }
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        codeCol = c;
      }
    }
  }
  if (codeCol === -1) {
    return {
      rows: [],
      sourcePriceObservations: [],
      basis: "Verify",
      codeCol: -1,
      priceCol: -1,
      nameCol: -1,
      categoryCol: -1,
      codeColHeader: "",
      priceColHeader: "",
      skippedRows: [],
      hasHeaderPeriods: false,
      warnings: []
    };
  }
  const isPackingHeader = (h) => {
    const normalizedHeader = h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const headerTokens = new Set(normalizedHeader.split(/\s+/).filter(Boolean));
    return PACKING_EXCLUDE_KEYWORDS.some(
      (keyword) => headerTokens.has(keyword)
    );
  };
  const warnings = [];
  let netCol = -1;
  let mrpCol = -1;
  let newMrpCol = -1;
  let oldMrpCol = -1;
  for (let c = 0; c < maxCols; c++) {
    if (c === codeCol) continue;
    const h = headers[c] ?? "";
    if (isPackingHeader(h)) continue;
    if (NET_KEYWORDS.some((k) => h.includes(k)) && netCol === -1) {
      netCol = c;
    } else if (MRP_KEYWORDS.some((k) => h.includes(k))) {
      const isNew = h.includes("new");
      const isOld = h.includes("old");
      if (isNew && newMrpCol === -1) newMrpCol = c;
      else if (!isOld && !isNew && mrpCol === -1) mrpCol = c;
      else if (isOld && oldMrpCol === -1) oldMrpCol = c;
    }
  }
  const bestMrpCol = newMrpCol !== -1 ? newMrpCol : mrpCol !== -1 ? mrpCol : oldMrpCol;
  let priceCol = bestMrpCol !== -1 ? bestMrpCol : netCol;
  let basis = bestMrpCol !== -1 ? "MRP" : netCol !== -1 ? "Net" : "Verify";
  const NAME_KEYWORDS = ["description", "product name", "product", "name", "item name", "particulars", "article", "details", "item description"];
  let nameCol = -1;
  for (let c = 0; c < maxCols; c++) {
    if (c === codeCol || c === priceCol) continue;
    const h = (headers[c] ?? "").toLowerCase().trim();
    if (NAME_KEYWORDS.some((k) => h === k || h.startsWith(k))) {
      nameCol = c;
      break;
    }
  }
  if (nameCol === -1) {
    for (let c = 0; c < maxCols; c++) {
      if (c === codeCol || c === priceCol) continue;
      const h = headers[c] ?? "";
      if (h.includes("desc") || h.includes("product") || h.includes("particular")) {
        nameCol = c;
        break;
      }
    }
  }
  const CATEGORY_KEYWORDS = ["category", "type", "group", "series", "segment", "sub-category", "subcategory"];
  let categoryCol = -1;
  for (let c = 0; c < maxCols; c++) {
    if (c === codeCol || c === priceCol || c === nameCol) continue;
    const h = (headers[c] ?? "").toLowerCase().trim();
    if (CATEGORY_KEYWORDS.some((k) => h === k || h.includes(k))) {
      categoryCol = c;
      break;
    }
  }
  const codeColHeader = rawHeaders[codeCol] ?? String(codeCol);
  const datedPriceCols = rawHeaders.map((header, col) => ({ col, effectiveDate: parsePeriodHeader(header) })).filter(
    (entry) => entry.col !== codeCol && entry.effectiveDate !== null
  );
  if (datedPriceCols.length > 0) {
    const datedRows = [];
    const datedSkipped = [];
    const sourcePriceObservations2 = [];
    for (let r = 0; r < grid.length; r++) {
      if (r === headerRow) continue;
      const row = grid[r] ?? [];
      const code = normCode(row[codeCol]);
      if (!code) continue;
      const productName = nameCol !== -1 ? norm(row[nameCol]) || null : null;
      const category = categoryCol !== -1 ? norm(row[categoryCol]) || null : null;
      for (const { col, effectiveDate } of datedPriceCols) {
        const rawPrice = norm(row[col]);
        if (!rawPrice || rawPrice === "-") continue;
        if (/^removed$/i.test(rawPrice)) {
          sourcePriceObservations2.push({ itemCode: code, isRemoved: true, effectiveDate });
          datedSkipped.push({ rawCode: code, rawPrice, reason: "Marked REMOVED in source" });
          continue;
        }
        const price = Number(String(row[col]).replace(/,/g, ""));
        if (isNaN(price) || price <= 0) {
          datedSkipped.push({ rawCode: code, rawPrice, reason: "Price is not a positive number" });
          continue;
        }
        sourcePriceObservations2.push({ itemCode: code, isRemoved: false, effectiveDate });
        datedRows.push({ itemCode: code, price, productName, category, effectiveDate });
      }
    }
    return {
      rows: datedRows,
      sourcePriceObservations: sourcePriceObservations2,
      basis: "MRP",
      codeCol,
      priceCol: datedPriceCols[0]?.col ?? -1,
      nameCol,
      categoryCol,
      codeColHeader,
      priceColHeader: datedPriceCols.map(({ col }) => rawHeaders[col]).join(", "),
      skippedRows: datedSkipped,
      hasHeaderPeriods: true,
      warnings
    };
  }
  const SANITARYWARE_VARIANTS = /* @__PURE__ */ new Map([
    ["white", "Standard"],
    ["ivory", "Ivory"],
    ["white with jet", "White with Jet"],
    ["pink / green / blue", "Pink / Green / Blue"],
    ["pink/green/blue", "Pink / Green / Blue"]
  ]);
  const variantCols = [];
  for (let c = 0; c < maxCols; c++) {
    if (c === codeCol) continue;
    const h = (headers[c] ?? "").toLowerCase().trim();
    const variantName = SANITARYWARE_VARIANTS.get(h);
    if (variantName !== void 0) variantCols.push({ col: c, variant: variantName });
  }
  if (variantCols.length >= 2) {
    const variantRows = [];
    const variantSkipped = [];
    const sourcePriceObservations2 = [];
    for (let r = 0; r < grid.length; r++) {
      if (r === headerRow) continue;
      const row = grid[r] ?? [];
      const code = normCode(row[codeCol]);
      if (!code) continue;
      const productName = nameCol !== -1 ? norm(row[nameCol]) || null : null;
      const category = categoryCol !== -1 ? norm(row[categoryCol]) || null : null;
      for (const { col, variant } of variantCols) {
        const rawPrice = row[col];
        if (rawPrice == null || rawPrice === "") continue;
        if (/^removed$/i.test(norm(rawPrice))) {
          sourcePriceObservations2.push({ itemCode: code, isRemoved: true });
          variantSkipped.push({
            rawCode: code,
            rawPrice: norm(rawPrice),
            reason: "Marked REMOVED in source"
          });
          continue;
        }
        const price = Number(rawPrice);
        if (isNaN(price) || price <= 0) {
          variantSkipped.push({ rawCode: code, rawPrice: norm(rawPrice), reason: "Price is zero or negative" });
          continue;
        }
        sourcePriceObservations2.push({ itemCode: code, isRemoved: false });
        variantRows.push({ itemCode: code, price, productName, category, variant });
      }
    }
    return {
      rows: variantRows,
      sourcePriceObservations: sourcePriceObservations2,
      basis: "MRP",
      codeCol,
      priceCol: variantCols[0]?.col ?? -1,
      nameCol,
      categoryCol,
      codeColHeader,
      priceColHeader: "Variant MRP",
      skippedRows: variantSkipped,
      hasHeaderPeriods: false,
      warnings
    };
  }
  if (priceCol === -1) {
    warnings.push(
      "No explicit MRP, price, Net, or rate column was found. Numeric pack, weight, quantity, or dimension columns were not selected as prices; add a clearly labelled price column and re-upload."
    );
    const skippedRows2 = [];
    for (let r = 0; r < grid.length; r++) {
      if (r === headerRow) continue;
      const row = grid[r] ?? [];
      const rawCode = norm(row[codeCol]);
      const code = normCode(row[codeCol]);
      if (!code) continue;
      const numericCandidates = row.map((value, col) => ({ value, col })).filter(
        ({ value, col }) => col !== codeCol && value != null && norm(value) !== "" && Number.isFinite(Number(value))
      ).map(({ value }) => norm(value));
      skippedRows2.push({
        rawCode: rawCode || code,
        rawPrice: numericCandidates.join(", "),
        reason: "No accepted price or dated-period header; numeric values were left unpriced for review"
      });
    }
    return {
      rows: [],
      sourcePriceObservations: [],
      basis: "Verify",
      codeCol,
      priceCol: -1,
      nameCol,
      categoryCol,
      codeColHeader,
      priceColHeader: "",
      skippedRows: skippedRows2,
      hasHeaderPeriods: false,
      warnings
    };
  }
  const priceColHeader = rawHeaders[priceCol] ?? String(priceCol);
  const rows = [];
  const skippedRows = [];
  const sourcePriceObservations = [];
  for (let r = 0; r < grid.length; r++) {
    if (r === headerRow) continue;
    const row = grid[r] ?? [];
    const rawCodeVal = norm(row[codeCol]);
    const rawPriceVal = norm(row[priceCol]);
    if (!rawCodeVal && !rawPriceVal) continue;
    const code = normCode(row[codeCol]);
    if (!code) {
      if (rawCodeVal || rawPriceVal) {
        skippedRows.push({
          rawCode: rawCodeVal || "(blank)",
          rawPrice: rawPriceVal,
          reason: rawCodeVal ? "Item code could not be parsed" : "Item code is blank"
        });
      }
      continue;
    }
    if (/^removed$/i.test(rawPriceVal)) {
      sourcePriceObservations.push({ itemCode: code, isRemoved: true });
      skippedRows.push({
        rawCode: rawCodeVal,
        rawPrice: rawPriceVal,
        reason: "Marked REMOVED in source"
      });
      continue;
    }
    const price = Number(row[priceCol]);
    if (isNaN(price) || price <= 0) {
      skippedRows.push({ rawCode: rawCodeVal, rawPrice: rawPriceVal, reason: price <= 0 ? "Price is zero or negative" : "Price is not a number" });
      continue;
    }
    if (requireHeaderPeriod) {
      skippedRows.push({
        rawCode: rawCodeVal,
        rawPrice: rawPriceVal,
        reason: "No resolvable dated price column in source sheet"
      });
      continue;
    }
    sourcePriceObservations.push({ itemCode: code, isRemoved: false });
    const productName = nameCol !== -1 ? norm(row[nameCol]) || null : null;
    const category = categoryCol !== -1 ? norm(row[categoryCol]) || null : null;
    rows.push({ itemCode: code, price, productName, category });
  }
  return {
    rows,
    sourcePriceObservations,
    basis,
    codeCol,
    priceCol,
    nameCol,
    categoryCol,
    codeColHeader,
    priceColHeader,
    skippedRows,
    hasHeaderPeriods: false,
    warnings
  };
}
function anomalyReasons(price, previousMrp, division) {
  const reasons = [];
  if (price < 1) reasons.push("MRP is below \u20B91");
  const guardedDivision = /ptmt|cp fittings|faucet|sanitaryware/i.test(division ?? "");
  if (price < 50 && guardedDivision) {
    reasons.push(`MRP is below \u20B950 for ${division ?? "this guarded division"}`);
  }
  if (previousMrp != null && previousMrp > 0) {
    const changePct = (price - previousMrp) / previousMrp * 100;
    if (changePct > 60) {
      reasons.push(`MRP increased ${changePct.toFixed(1)}% (limit +60%)`);
    } else if (changePct < -20) {
      reasons.push(`MRP decreased ${Math.abs(changePct).toFixed(1)}% (limit -20%)`);
    }
  }
  return reasons;
}
function parseWorkbookBuffer(buffer, knownCodes) {
  const wb = XLSX4.read(buffer, { type: "buffer" });
  let rows = [];
  let basis = "Verify";
  let codeColHeader = "";
  let priceColHeader = "";
  let hasNameCol = false;
  let hasCategoryCol = false;
  let skippedUnparseable = 0;
  const skippedRows = [];
  const warnings = /* @__PURE__ */ new Set();
  const sourcePriceObservations = [];
  const workbookHasHeaderPeriods = wb.SheetNames.filter((name) => !PACKING_SHEET_RE.test(name)).some(
    (name) => hasResolvablePeriodHeader(
      XLSX4.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null })
    )
  );
  const masterSheet = wb.SheetNames.find((n) => MASTER_SHEET_RE.test(n));
  const sheetsToProcess = masterSheet && !workbookHasHeaderPeriods ? [masterSheet] : wb.SheetNames.filter((n) => !PACKING_SHEET_RE.test(n));
  for (const sheetName of sheetsToProcess) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    const grid = XLSX4.utils.sheet_to_json(sheet, {
      header: 1,
      defval: null
    });
    const parsed2 = parseSheet(grid, knownCodes, workbookHasHeaderPeriods);
    skippedUnparseable += parsed2.skippedRows.length;
    skippedRows.push(...parsed2.skippedRows);
    parsed2.warnings.forEach((warning) => warnings.add(warning));
    sourcePriceObservations.push(...parsed2.sourcePriceObservations);
    if (parsed2.nameCol !== -1) hasNameCol = true;
    if (parsed2.categoryCol !== -1) hasCategoryCol = true;
    if (parsed2.rows.length > 0) {
      rows = rows.concat(parsed2.rows);
      basis = parsed2.basis;
      if (!codeColHeader) codeColHeader = parsed2.codeColHeader;
      if (!priceColHeader) priceColHeader = parsed2.priceColHeader;
    } else {
      if (!codeColHeader && parsed2.codeColHeader) codeColHeader = parsed2.codeColHeader;
      if (!priceColHeader && parsed2.priceColHeader) priceColHeader = parsed2.priceColHeader;
      basis = parsed2.basis;
    }
  }
  return {
    rows,
    sourcePriceObservations,
    basis,
    codeColHeader,
    priceColHeader,
    hasNameCol,
    hasCategoryCol,
    skippedUnparseable,
    skippedRows,
    hasHeaderPeriods: workbookHasHeaderPeriods,
    warnings: [...warnings]
  };
}
var FILENAME_DIVISION_MAP = [
  { pattern: /ptmt/i, division: "PTMT & Plastic Fittings" },
  { pattern: /pipe|fitting/i, division: "Pipes & Fittings" },
  { pattern: /\bcp\b|chrome/i, division: "CP Fittings / Faucets" },
  { pattern: /sanitar/i, division: "Ceramic Sanitaryware" },
  { pattern: /quaa|fern/i, division: "QUAA & FERN" }
];
function divisionFromFilename(filename) {
  const base = filename.replace(/\.[^.]+$/, "").toLowerCase();
  for (const { pattern, division } of FILENAME_DIVISION_MAP) {
    if (pattern.test(base)) return division;
  }
  return null;
}
async function reconcileSourceDiscontinuations(tx, observations, effectiveDate, canonical) {
  if (observations.length === 0) return;
  const normalizedObservations = observations.map((observation) => ({
    ...observation,
    itemCode: canonical.get(normCode(observation.itemCode)) ?? observation.itemCode
  }));
  const itemCodes = [...new Set(normalizedObservations.map((row) => row.itemCode))];
  const products = await tx.select({
    itemCode: catalogProductsTable.itemCode,
    discontinuedFrom: catalogProductsTable.discontinuedFrom
  }).from(catalogProductsTable).where(inArray2(catalogProductsTable.itemCode, itemCodes));
  if (products.length === 0) return;
  const history = await tx.select({
    itemCode: mrpPriceHistoryTable.itemCode,
    effectiveDate: mrpPriceHistoryTable.effectiveDate
  }).from(mrpPriceHistoryTable).where(
    and3(
      inArray2(mrpPriceHistoryTable.itemCode, itemCodes),
      eq5(mrpPriceHistoryTable.reviewStatus, "approved"),
      eq5(mrpPriceHistoryTable.variant, "Standard")
    )
  ).orderBy(
    asc(mrpPriceHistoryTable.itemCode),
    desc(mrpPriceHistoryTable.effectiveDate),
    desc(mrpPriceHistoryTable.id)
  );
  const latestPriceByCode = /* @__PURE__ */ new Map();
  for (const row of history) {
    if (!latestPriceByCode.has(row.itemCode)) {
      latestPriceByCode.set(row.itemCode, String(row.effectiveDate));
    }
  }
  const confirmed = deriveConfirmedDiscontinuations(
    normalizedObservations.map((row) => ({
      itemCode: row.itemCode,
      markerPeriod: row.isRemoved ? effectiveDate : null,
      latestPricedPeriod: latestPriceByCode.get(row.itemCode) ?? null,
      isRemoved: row.isRemoved
    }))
  );
  const confirmedByCode = new Map(
    confirmed.map((row) => [normCode(row.itemCode), row.discontinuedFrom])
  );
  const liveInSource = new Set(
    normalizedObservations.filter((row) => !row.isRemoved).map((row) => normCode(row.itemCode))
  );
  for (const product of products) {
    const productKey = normCode(product.itemCode);
    const confirmedFrom = confirmedByCode.get(productKey);
    if (confirmedFrom) {
      if (product.discontinuedFrom !== confirmedFrom) {
        await tx.update(catalogProductsTable).set({ discontinuedFrom: confirmedFrom, updatedAt: /* @__PURE__ */ new Date() }).where(eq5(catalogProductsTable.itemCode, product.itemCode));
      }
      continue;
    }
    if (!product.discontinuedFrom) continue;
    const latestPrice = latestPriceByCode.get(product.itemCode);
    const hasLaterPrice = Boolean(latestPrice) && latestPrice > product.discontinuedFrom;
    const hasLiveSourceOccurrence = liveInSource.has(productKey) && effectiveDate >= product.discontinuedFrom;
    if (hasLaterPrice || hasLiveSourceOccurrence) {
      await tx.update(catalogProductsTable).set({ discontinuedFrom: null, updatedAt: /* @__PURE__ */ new Date() }).where(eq5(catalogProductsTable.itemCode, product.itemCode));
    }
  }
}
async function persistParsedRows(parsedRows, sourcePriceObservations, filename, effectiveDate, knownCodes, canonical, basis, codeColHeader, priceColHeader, skippedUnparseable, warnings, reviewBatchId, loadBatchId, transaction) {
  const byCodeVariant = /* @__PURE__ */ new Map();
  for (const r of parsedRows) {
    const variant = r.variant ?? "Standard";
    byCodeVariant.set(`${r.itemCode}__${variant}`, {
      itemCode: r.itemCode,
      price: r.price,
      productName: r.productName,
      category: r.category,
      variant
    });
  }
  if (byCodeVariant.size === 0) {
    if (sourcePriceObservations.length > 0) {
      const reconcile = async (tx) => {
        await reconcileSourceDiscontinuations(
          tx,
          sourcePriceObservations,
          effectiveDate,
          canonical
        );
      };
      if (transaction) await reconcile(transaction);
      else await db.transaction(reconcile);
    }
    return {
      file: filename,
      effectiveDate,
      basis,
      codeColHeader,
      priceColHeader,
      totalRows: 0,
      matchedProducts: 0,
      newProducts: 0,
      newHistoryRows: 0,
      skippedDuplicates: 0,
      skippedUnparseable,
      unmatchedCodes: [],
      warnings,
      lowMrpCount: 0,
      flaggedMrpCount: 0,
      flaggedRows: [],
      reviewBatchId: null,
      message: "No valid code-and-price rows could be read from the file. Check the sheet has a recognisable item-code column and a price/MRP column."
    };
  }
  const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const lowMrpCount = [...byCodeVariant.values()].filter((v) => v.price < 50).length;
  const summary = {
    file: filename,
    effectiveDate,
    basis,
    codeColHeader,
    priceColHeader,
    totalRows: byCodeVariant.size,
    matchedProducts: 0,
    newProducts: 0,
    newHistoryRows: 0,
    skippedDuplicates: 0,
    skippedUnparseable,
    unmatchedCodes: [],
    warnings,
    lowMrpCount,
    flaggedMrpCount: 0,
    flaggedRows: [],
    reviewBatchId: null
  };
  const inferredDivision = divisionFromFilename(filename);
  const write2 = async (tx) => {
    const existingPairs = await tx.select({
      itemCode: mrpPriceHistoryTable.itemCode,
      variant: mrpPriceHistoryTable.variant
    }).from(mrpPriceHistoryTable).where(eq5(mrpPriceHistoryTable.effectiveDate, effectiveDate));
    const dupSet = new Set(existingPairs.map((p) => `${normCode(p.itemCode)}__${p.variant}`));
    const existingRows = await tx.select({
      itemCode: catalogProductsTable.itemCode,
      productName: catalogProductsTable.productName,
      division: catalogProductsTable.division,
      category: catalogProductsTable.category
    }).from(catalogProductsTable);
    const existingMap = new Map(existingRows.map((r) => [r.itemCode, r]));
    const previousResult = await tx.execute(sql6`
      SELECT DISTINCT ON (item_code) item_code, mrp
      FROM mrp_price_history
      WHERE effective_date < ${effectiveDate}
        AND review_status = 'approved'
        AND mrp IS NOT NULL
        AND variant = 'Standard'
      ORDER BY item_code, effective_date DESC, id DESC
    `);
    const previousMrp = new Map(
      previousResult.rows.map((row) => [normCode(row.item_code), row.mrp])
    );
    const newProductValues = [];
    const historyValues = [];
    const backfillMap = /* @__PURE__ */ new Map();
    const processedItemCodes = /* @__PURE__ */ new Set();
    for (const [, { itemCode: code, price, productName, category, variant }] of byCodeVariant) {
      const isKnown = knownCodes.has(code);
      const storedCode = canonical.get(code) ?? code;
      const existing = existingMap.get(storedCode);
      const division = existing?.division ?? inferredDivision;
      const reasons = anomalyReasons(
        price,
        previousMrp.get(code) ?? null,
        division
      );
      if (!processedItemCodes.has(code)) {
        processedItemCodes.add(code);
        if (!isKnown) {
          newProductValues.push({
            itemCode: storedCode,
            productName: productName ?? null,
            division: inferredDivision,
            category: category ?? null,
            uom: "NOS",
            isActive: true,
            sourceFiles: filename,
            dataFlag: "new_from_load"
          });
          summary.newProducts++;
          summary.unmatchedCodes.push(storedCode);
          knownCodes.add(code);
          canonical.set(code, storedCode);
        } else {
          summary.matchedProducts++;
          if (existing) {
            const patch = {};
            if (!existing.productName && productName) patch.productName = productName;
            if (!existing.division && inferredDivision) patch.division = inferredDivision;
            if (!existing.category && category) patch.category = category;
            if (Object.keys(patch).length > 0) backfillMap.set(storedCode, patch);
          }
        }
      }
      const dupKey = `${code}__${variant}`;
      if (dupSet.has(dupKey)) {
        summary.skippedDuplicates++;
        continue;
      }
      historyValues.push({
        itemCode: storedCode,
        mrp: price,
        netPrice: basis === "Net" ? price : null,
        priceBasis: basis,
        effectiveDate,
        loadDate: today,
        sourceFile: filename,
        isCurrent: false,
        reviewStatus: reasons.length > 0 ? "pending" : "approved",
        reviewReasons: reasons.length > 0 ? JSON.stringify(reasons) : null,
        importBatchId: reviewBatchId,
        loadBatchId,
        reviewedAt: reasons.length > 0 ? null : /* @__PURE__ */ new Date(),
        variant
      });
      if (reasons.length > 0) {
        summary.flaggedRows.push({
          itemCode: storedCode,
          oldMrp: previousMrp.get(code) ?? null,
          newMrp: price,
          reasons
        });
        summary.flaggedMrpCount++;
        summary.reviewBatchId = reviewBatchId;
      }
      dupSet.add(dupKey);
      summary.newHistoryRows++;
    }
    if (newProductValues.length > 0) {
      for (let i = 0; i < newProductValues.length; i += 500) {
        await tx.insert(catalogProductsTable).values(newProductValues.slice(i, i + 500));
      }
    }
    if (historyValues.length > 0) {
      for (let i = 0; i < historyValues.length; i += 500) {
        const inserted = await tx.insert(mrpPriceHistoryTable).values(historyValues.slice(i, i + 500)).returning({
          id: mrpPriceHistoryTable.id,
          itemCode: mrpPriceHistoryTable.itemCode,
          effectiveDate: mrpPriceHistoryTable.effectiveDate,
          mrp: mrpPriceHistoryTable.mrp,
          sourceFile: mrpPriceHistoryTable.sourceFile,
          loadBatchId: mrpPriceHistoryTable.loadBatchId
        });
        await tx.insert(mrpHistoryProvenanceEventsTable).values(
          inserted.map((row) => ({
            historyRowId: row.id,
            itemCode: row.itemCode,
            effectiveDate: row.effectiveDate,
            action: "official_workbook_import",
            sourceFile: row.sourceFile,
            loadBatchId: row.loadBatchId,
            mrp: row.mrp
          }))
        );
      }
    }
    if (backfillMap.size > 0) {
      const byPatch = /* @__PURE__ */ new Map();
      for (const [code, patch] of backfillMap) {
        const key = JSON.stringify(patch);
        const list = byPatch.get(key) ?? [];
        list.push(code);
        byPatch.set(key, list);
      }
      for (const [patchJson, codes] of byPatch) {
        const patch = JSON.parse(patchJson);
        for (let i = 0; i < codes.length; i += 500) {
          await tx.update(catalogProductsTable).set(patch).where(inArray2(catalogProductsTable.itemCode, codes.slice(i, i + 500)));
        }
      }
    }
    await reconcileSourceDiscontinuations(
      tx,
      sourcePriceObservations,
      effectiveDate,
      canonical
    );
  };
  if (transaction) {
    await write2(transaction);
  } else {
    await db.transaction(write2);
  }
  if (summary.newHistoryRows === 0 && summary.skippedDuplicates > 0) {
    summary.message = `All ${summary.skippedDuplicates} rows already exist for effective date ${effectiveDate} \u2014 nothing added (re-load is safe).`;
  }
  return summary;
}
router.post("/catalog/new-products/preview", requireAdmin, upload.single("file"), async (req, res) => {
  const file2 = req.file;
  if (!file2) {
    res.status(400).json({ error: "No workbook uploaded." });
    return;
  }
  if (!/\.(xlsx|xls)$/i.test(file2.originalname)) {
    res.status(400).json({ error: "New products upload accepts .xlsx or .xls files only." });
    return;
  }
  if (!previewReason(req.body?.reason)) {
    res.status(400).json({ error: "A reason is required for a new-products upload." });
    return;
  }
  try {
    const parsed2 = parseNewProductsWorkbook(file2.buffer);
    const fileSha256 = sha256ForBuffer(file2.buffer);
    await db.insert(mrpSourcesTable).values(NEW_PRODUCTS_SOURCE).onConflictDoNothing({ target: mrpSourcesTable.sheetId });
    const [source] = await db.select().from(mrpSourcesTable).where(eq5(mrpSourcesTable.sheetId, NEW_PRODUCTS_SOURCE.sheetId)).limit(1);
    if (!source) throw new Error("New-products provenance source could not be created.");
    const [duplicateLoad] = await db.select({ id: mrpLoadBatchesTable.id }).from(mrpLoadBatchesTable).where(and3(eq5(mrpLoadBatchesTable.sourceId, source.id), eq5(mrpLoadBatchesTable.fileSha256, fileSha256))).limit(1);
    const [duplicatePending] = await db.select({ id: mrpPendingBatchesTable.id }).from(mrpPendingBatchesTable).where(and3(eq5(mrpPendingBatchesTable.sourceId, source.id), eq5(mrpPendingBatchesTable.fileSha256, fileSha256), eq5(mrpPendingBatchesTable.status, "pending"), gt(mrpPendingBatchesTable.expiresAt, /* @__PURE__ */ new Date()))).limit(1);
    if (duplicateLoad || duplicatePending) {
      res.status(409).json({ error: duplicatePending ? "This new-products workbook is already awaiting review." : "This new-products workbook has already been applied.", duplicate: true });
      return;
    }
    const existing = await db.select({ itemCode: catalogProductsTable.itemCode, productName: catalogProductsTable.productName }).from(catalogProductsTable);
    const existingCodes = new Set(existing.map((row) => normCode(row.itemCode)));
    const seen = /* @__PURE__ */ new Set();
    const rejectedRows = [...parsed2.rejectedRows];
    const accepted = [];
    for (const row of parsed2.rows) {
      const code = normCode(row.itemCode);
      if (existingCodes.has(code)) {
        rejectedRows.push({ row: row.row, itemCode: row.itemCode, reason: "This code already exists in the catalogue. Use the MRP revision upload to change its price." });
      } else if (seen.has(code)) {
        rejectedRows.push({ row: row.row, itemCode: row.itemCode, reason: "Duplicate item code in this workbook." });
      } else {
        seen.add(code);
        accepted.push(row);
      }
    }
    const history = await db.select({ effectiveDate: mrpPriceHistoryTable.effectiveDate }).from(mrpPriceHistoryTable);
    const periodCounts = /* @__PURE__ */ new Map();
    history.forEach((row) => periodCounts.set(row.effectiveDate, (periodCounts.get(row.effectiveDate) ?? 0) + 1));
    const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const periods = [...new Set(accepted.map((row) => row.effectiveDate))].sort().map((effectiveDate) => {
      const existingRowCount = periodCounts.get(effectiveDate) ?? 0;
      const createCount = accepted.filter((row) => row.effectiveDate === effectiveDate).length;
      return {
        effectiveDate,
        isNew: existingRowCount === 0,
        isExisting: existingRowCount > 0,
        existingRowCount,
        existingCount: existingRowCount,
        createCount,
        afterRowCount: existingRowCount + createCount,
        afterCount: existingRowCount + createCount,
        goesLiveImmediately: effectiveDate <= today,
        isImmediate: effectiveDate <= today
      };
    });
    const preview = {
      kind: "new-products",
      mode: "new_products",
      reason: req.body.reason.trim(),
      fileName: file2.originalname,
      fileSha256,
      willCreate: accepted,
      rejectedRows,
      rangeWarnings: parsed2.rangeWarnings,
      rowsToCreate: accepted.length,
      willCreateCount: accepted.length,
      rejectedCount: rejectedRows.length,
      catalogBeforeCount: existing.length,
      catalogAfterCount: existing.length + accepted.length,
      catalogBefore: existing.length,
      catalogAfter: existing.length + accepted.length,
      periods,
      immediateProductCount: accepted.filter((row) => row.effectiveDate <= today).length,
      immediateCount: accepted.filter((row) => row.effectiveDate <= today).length,
      immediateMessage: accepted.some((row) => row.effectiveDate <= today) ? `${accepted.filter((row) => row.effectiveDate <= today).length} product(s) will go live immediately because the effective date has passed.` : null,
      canApply: accepted.length > 0,
      noChangeReason: accepted.length > 0 ? null : "No valid new products would be created."
    };
    const [pending] = await db.insert(mrpPendingBatchesTable).values({
      sourceId: source.id,
      fileName: file2.originalname,
      fileSha256,
      fileSizeBytes: file2.size,
      downloadedAt: today,
      uploadedBy: req.user?.email ?? req.user?.id ?? null,
      payload: JSON.stringify({ kind: "new_products", reason: preview.reason, rows: accepted }),
      preview: JSON.stringify(preview),
      expiresAt: new Date(Date.now() + PENDING_MRP_BATCH_LIFETIME_MS)
    }).returning();
    res.json(newProductsResponse(pending));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Could not read new-products workbook." });
  }
});
router.get("/catalog/new-products/:batchId", requireAdmin, async (req, res) => {
  const id = Number(req.params.batchId);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "batchId must be a positive integer." });
    return;
  }
  const [batch] = await db.select().from(mrpPendingBatchesTable).where(eq5(mrpPendingBatchesTable.id, id)).limit(1);
  if (!batch) {
    res.status(404).json({ error: "New-products batch not found." });
    return;
  }
  const [source] = await db.select({ sourceKind: mrpSourcesTable.sourceKind }).from(mrpSourcesTable).where(eq5(mrpSourcesTable.id, batch.sourceId)).limit(1);
  if (source?.sourceKind !== "new_products") {
    res.status(404).json({ error: "New-products batch not found." });
    return;
  }
  res.json(newProductsResponse(batch));
});
router.post("/catalog/new-products/:batchId/discard", requireAdmin, async (req, res) => {
  const id = Number(req.params.batchId);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "batchId must be a positive integer." });
    return;
  }
  const [sourceForBatch] = await db.select({ sourceKind: mrpSourcesTable.sourceKind }).from(mrpPendingBatchesTable).innerJoin(mrpSourcesTable, eq5(mrpPendingBatchesTable.sourceId, mrpSourcesTable.id)).where(eq5(mrpPendingBatchesTable.id, id)).limit(1);
  if (sourceForBatch?.sourceKind !== "new_products") {
    res.status(404).json({ error: "New-products batch not found." });
    return;
  }
  const [batch] = await db.update(mrpPendingBatchesTable).set({
    status: "discarded",
    discardedAt: /* @__PURE__ */ new Date(),
    discardedBy: req.user?.email ?? req.user?.id ?? null
  }).where(and3(eq5(mrpPendingBatchesTable.id, id), eq5(mrpPendingBatchesTable.status, "pending"))).returning();
  if (!batch) {
    res.status(409).json({ error: "Only a pending new-products batch can be discarded." });
    return;
  }
  res.json(newProductsResponse(batch));
});
router.post("/catalog/new-products/:batchId/apply", requireAdmin, async (req, res) => {
  const id = Number(req.params.batchId);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "batchId must be a positive integer." });
    return;
  }
  const confirmed = Number(req.body?.rowsToCreate);
  try {
    const outcome = await db.transaction(async (tx) => {
      await tx.execute(sql6`SELECT pg_advisory_xact_lock(917_902)`);
      const [batch] = await tx.select().from(mrpPendingBatchesTable).where(eq5(mrpPendingBatchesTable.id, id)).limit(1);
      if (!batch) throw new Error("New-products batch not found.");
      const [source] = await tx.select({ sourceKind: mrpSourcesTable.sourceKind }).from(mrpSourcesTable).where(eq5(mrpSourcesTable.id, batch.sourceId)).limit(1);
      if (source?.sourceKind !== "new_products") throw new Error("New-products batch not found.");
      if (batch.status !== "pending") throw new Error(`New-products batch is ${batch.status}; only pending batches can be applied.`);
      if (batch.expiresAt <= /* @__PURE__ */ new Date()) {
        await tx.update(mrpPendingBatchesTable).set({ status: "expired" }).where(eq5(mrpPendingBatchesTable.id, id));
        throw new Error("New-products batch has expired and cannot be applied.");
      }
      const preview = JSON.parse(batch.preview);
      if (!preview.canApply) throw new Error(preview.noChangeReason ?? "No valid new products would be created.");
      if (confirmed !== preview.rowsToCreate) throw new Error(`Confirmation must repeat ${preview.rowsToCreate} products to create.`);
      const payload = JSON.parse(batch.payload);
      const existing = await tx.select({ itemCode: catalogProductsTable.itemCode }).from(catalogProductsTable);
      const existingCodes = new Set(existing.map((row) => normCode(row.itemCode)));
      if (payload.rows.some((row) => existingCodes.has(normCode(row.itemCode)))) throw new Error("One or more products now exist in the catalogue. Refresh the preview; no rows were written.");
      const [load] = await tx.insert(mrpLoadBatchesTable).values({
        sourceId: batch.sourceId,
        fileName: batch.fileName,
        fileSha256: batch.fileSha256,
        fileSizeBytes: batch.fileSizeBytes,
        downloadedAt: batch.downloadedAt,
        loadedBy: req.user?.email ?? req.user?.id ?? null,
        rowCount: payload.rows.length,
        notes: JSON.stringify({ mode: "new_products", reason: payload.reason ?? "" })
      }).returning({ id: mrpLoadBatchesTable.id });
      if (!load) throw new Error("Could not create load provenance batch.");
      const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
      await tx.insert(catalogProductsTable).values(payload.rows.map((row) => ({
        itemCode: row.itemCode,
        productName: row.productName,
        division: row.division,
        seriesRange: supportsCatalogRange(row.division) ? row.series : null,
        size: row.size,
        sourceFiles: batch.fileName,
        dataFlag: "new_products_upload"
      })));
      const insertedHistory = await tx.insert(mrpPriceHistoryTable).values(payload.rows.map((row) => ({
        itemCode: row.itemCode,
        mrp: row.mrp,
        priceBasis: "MRP",
        effectiveDate: row.effectiveDate,
        loadDate: today,
        sourceFile: batch.fileName,
        reviewStatus: "approved",
        reviewedAt: /* @__PURE__ */ new Date(),
        loadBatchId: load.id,
        variant: "Standard",
        notes: "Created by new-products upload"
      }))).returning({ id: mrpPriceHistoryTable.id, itemCode: mrpPriceHistoryTable.itemCode, effectiveDate: mrpPriceHistoryTable.effectiveDate, mrp: mrpPriceHistoryTable.mrp });
      await tx.insert(mrpHistoryProvenanceEventsTable).values(insertedHistory.map((row) => ({
        historyRowId: row.id,
        itemCode: row.itemCode,
        effectiveDate: row.effectiveDate,
        action: "new_product_upload",
        sourceFile: batch.fileName,
        loadBatchId: load.id,
        mrp: row.mrp
      })));
      await recomputeCurrentFlagsInTransaction(tx);
      const competitorEffect = await applyP019PrinceRematch(tx, payload.rows, today);
      const result = {
        kind: "new_products",
        mode: "new_products",
        loadBatchId: load.id,
        createdProducts: payload.rows.length,
        createdCount: payload.rows.length,
        catalogBefore: preview.catalogBefore,
        catalogAfter: preview.catalogAfter,
        periods: preview.periods,
        competitorEffect
      };
      await tx.update(mrpPendingBatchesTable).set({
        status: "applied",
        appliedAt: /* @__PURE__ */ new Date(),
        appliedBy: req.user?.email ?? req.user?.id ?? null,
        loadBatchId: load.id,
        result: JSON.stringify(result)
      }).where(eq5(mrpPendingBatchesTable.id, id));
      return { batchId: id, status: "applied", preview, result };
    });
    res.json(outcome);
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : "Could not apply new-products batch." });
  }
});
router.get("/catalog/mrp-loads/:batchId", requireAdmin, async (req, res) => {
  const id = Number(req.params.batchId);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "batchId must be a positive integer." });
    return;
  }
  const [batch] = await db.select().from(mrpPendingBatchesTable).where(eq5(mrpPendingBatchesTable.id, id)).limit(1);
  if (!batch) {
    res.status(404).json({ error: "Pending MRP batch not found." });
    return;
  }
  res.json({
    ...batch,
    payload: void 0,
    preview: JSON.parse(batch.preview),
    result: batch.result ? JSON.parse(batch.result) : null
  });
});
router.post("/catalog/mrp-loads/:batchId/discard", requireAdmin, async (req, res) => {
  const id = Number(req.params.batchId);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "batchId must be a positive integer." });
    return;
  }
  const [batch] = await db.update(mrpPendingBatchesTable).set({
    status: "discarded",
    discardedAt: /* @__PURE__ */ new Date(),
    discardedBy: req.user?.email ?? req.user?.id ?? null
  }).where(and3(eq5(mrpPendingBatchesTable.id, id), eq5(mrpPendingBatchesTable.status, "pending"))).returning();
  if (!batch) {
    res.status(409).json({ error: "Only a pending MRP batch can be discarded." });
    return;
  }
  res.json({
    ...batch,
    payload: void 0,
    preview: JSON.parse(batch.preview),
    result: batch.result ? JSON.parse(batch.result) : null
  });
});
router.post("/catalog/mrp-loads/:batchId/apply", requireAdmin, async (req, res) => {
  const id = Number(req.params.batchId);
  const confirmedRows = Number(req.body?.rowsToWrite);
  const confirmedImmediate = Number(req.body?.immediatePriceChanges);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "batchId must be a positive integer." });
    return;
  }
  try {
    await db.update(mrpPendingBatchesTable).set({ status: "expired" }).where(
      and3(
        eq5(mrpPendingBatchesTable.id, id),
        eq5(mrpPendingBatchesTable.status, "pending"),
        lte(mrpPendingBatchesTable.expiresAt, /* @__PURE__ */ new Date())
      )
    );
    const outcome = await db.transaction(async (tx) => {
      await tx.execute(sql6`SELECT pg_advisory_xact_lock(${917902 + id})`);
      const [batch] = await tx.select().from(mrpPendingBatchesTable).where(eq5(mrpPendingBatchesTable.id, id)).limit(1);
      if (!batch) throw new Error("Pending MRP batch not found.");
      if (batch.status !== "pending") throw new Error(`MRP batch is ${batch.status}; only pending batches can be applied.`);
      const preview = JSON.parse(batch.preview);
      if (!preview.canApply) throw new Error(preview.noChangeReason ?? "This preview has no changes to apply.");
      if (confirmedRows !== preview.rowsToWrite || confirmedImmediate !== preview.immediatePriceChangeCount) {
        throw new Error(`Confirmation must repeat ${preview.rowsToWrite} rows to write and ${preview.immediatePriceChangeCount} immediate price changes.`);
      }
      const payload = JSON.parse(batch.payload);
      let result;
      let appliedLoadBatchId;
      if ("kind" in payload && payload.kind === "ordinary") {
        const [load] = await tx.insert(mrpLoadBatchesTable).values({
          sourceId: batch.sourceId,
          fileName: batch.fileName,
          fileSha256: batch.fileSha256,
          fileSizeBytes: batch.fileSizeBytes,
          downloadedAt: batch.downloadedAt,
          loadedBy: req.user?.email ?? req.user?.id ?? null,
          rowCount: 0
        }).returning({ id: mrpLoadBatchesTable.id });
        appliedLoadBatchId = load.id;
        const products = await tx.select({ itemCode: catalogProductsTable.itemCode }).from(catalogProductsTable);
        const knownCodes = new Set(products.map((row) => normCode(row.itemCode)));
        const canonical = new Map(products.map((row) => [normCode(row.itemCode), row.itemCode]));
        const summaries = [];
        for (const entry of payload.entries) {
          summaries.push(await persistParsedRows(
            entry.rows,
            entry.sourcePriceObservations,
            entry.fileName,
            entry.effectiveDate,
            knownCodes,
            canonical,
            entry.basis,
            entry.codeColHeader,
            entry.priceColHeader,
            entry.skippedUnparseable,
            entry.warnings,
            payload.reviewBatchId,
            appliedLoadBatchId,
            tx
          ));
        }
        const rowsWritten = summaries.reduce((count2, summary) => count2 + summary.newHistoryRows, 0);
        await tx.update(mrpLoadBatchesTable).set({ rowCount: rowsWritten }).where(eq5(mrpLoadBatchesTable.id, appliedLoadBatchId));
        await recomputeCurrentFlagsInTransaction(tx);
        result = { kind: "ordinary", loadBatchId: appliedLoadBatchId, summaries, rowsWritten };
      } else {
        const authoritative = await loadAuthoritativeMaster({
          parsed: payload,
          fileSizeBytes: batch.fileSizeBytes,
          downloadedAt: batch.downloadedAt,
          loadedBy: req.user?.email ?? req.user?.id ?? null,
          transaction: tx
        });
        if (authoritative.duplicate) throw new Error("This source snapshot was already applied.");
        if (authoritative.priceRows !== preview.rowsToWrite) {
          throw new Error("Catalogue membership changed since preview. Discard this batch and preview again before applying.");
        }
        appliedLoadBatchId = authoritative.loadBatchId;
        result = authoritative;
      }
      await tx.update(mrpPendingBatchesTable).set({
        status: "applied",
        appliedAt: /* @__PURE__ */ new Date(),
        appliedBy: req.user?.email ?? req.user?.id ?? null,
        loadBatchId: appliedLoadBatchId,
        result: JSON.stringify(result)
      }).where(eq5(mrpPendingBatchesTable.id, id));
      return { result, preview };
    });
    let hardwareSourceReplacement = null;
    let hardwareSourceWarning = null;
    if (!outcome.result.kind) {
      try {
        hardwareSourceReplacement = await ensureHardwareReplacementSnapshot(
          req.user?.email ?? req.user?.id ?? null
        );
      } catch (error) {
        hardwareSourceWarning = error instanceof Error ? error.message : "Hardware source reconciliation could not be confirmed.";
        req.log.error(
          { err: error, pendingBatchId: id },
          "MRP batch applied but Hardware source reconciliation failed"
        );
      }
    }
    res.json({
      batchId: id,
      status: "applied",
      preview: outcome.preview,
      result: outcome.result,
      hardwareSourceReplacement,
      hardwareSourceWarning
    });
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : "Could not apply MRP batch." });
  }
});
router.post("/catalog/load-mrp", requireAdmin, upload.single("file"), async (req, res) => {
  const file2 = req.file;
  if (!file2) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }
  const effectiveDate = typeof req.body.effectiveDate === "string" && req.body.effectiveDate.trim() ? req.body.effectiveDate.trim() : null;
  if (effectiveDate && !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
    res.status(400).json({ error: "effectiveDate must be YYYY-MM-DD" });
    return;
  }
  const name = file2.originalname;
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (!["xlsx", "xls", "csv", "zip"].includes(ext)) {
    res.status(400).json({ error: "Upload an .xlsx, .xls, .csv, or .zip file" });
    return;
  }
  try {
    const reviewBatchId = randomUUID();
    let authoritativeWorkbook = false;
    if (ext === "xlsx" || ext === "xls") {
      const workbook = XLSX4.read(file2.buffer, { type: "buffer" });
      const correction = parseDiscontinuationCorrectionWorkbook(workbook);
      if (correction) {
        res.status(400).json({
          error: "This is a discontinuation correction workbook. It is not accepted by the MRP loader because uploads are preview-only; use the dedicated discontinuation correction tool."
        });
        return;
      }
      const authoritativeSheets = [
        "products",
        "discontinued",
        "excluded_do_not_load",
        "notes"
      ];
      const looksAuthoritative = authoritativeSheets.every(
        (sheet) => workbook.SheetNames.includes(sheet)
      );
      if (looksAuthoritative && !isAuthoritativeMasterBuffer(file2.buffer)) {
        res.status(400).json({
          error: "Authoritative master checksum mismatch. The file was not loaded."
        });
        return;
      }
      authoritativeWorkbook = looksAuthoritative;
    }
    if (authoritativeWorkbook) {
      const downloadedAt2 = req.body.downloadedAt;
      if (!isIsoDate(downloadedAt2)) {
        res.status(400).json({
          error: "Enter the date this file was downloaded (YYYY-MM-DD)."
        });
        return;
      }
      const parsed2 = parseAuthoritativeMasterBuffer(file2.buffer);
      let [source2] = await db.select({ id: mrpSourcesTable.id }).from(mrpSourcesTable).where(eq5(mrpSourcesTable.sheetId, AUTHORITATIVE_MASTER_SOURCE.sheetId)).limit(1);
      if (!source2) {
        await db.insert(mrpSourcesTable).values(AUTHORITATIVE_MASTER_SOURCE).onConflictDoNothing({ target: mrpSourcesTable.sheetId });
        [source2] = await db.select({ id: mrpSourcesTable.id }).from(mrpSourcesTable).where(eq5(mrpSourcesTable.sheetId, AUTHORITATIVE_MASTER_SOURCE.sheetId)).limit(1);
      }
      if (!source2) throw new Error("Authoritative MRP provenance source could not be created.");
      const existingBatches = await db.select({
        id: mrpLoadBatchesTable.id,
        loadedAt: mrpLoadBatchesTable.loadedAt,
        downloadedAt: mrpLoadBatchesTable.downloadedAt
      }).from(mrpLoadBatchesTable).where(and3(eq5(mrpLoadBatchesTable.sourceId, source2.id), eq5(mrpLoadBatchesTable.fileSha256, parsed2.fileSha256)));
      const pendingMatch = await db.select({ id: mrpPendingBatchesTable.id }).from(mrpPendingBatchesTable).where(and3(
        eq5(mrpPendingBatchesTable.sourceId, source2.id),
        eq5(mrpPendingBatchesTable.fileSha256, parsed2.fileSha256),
        eq5(mrpPendingBatchesTable.status, "pending"),
        gt(mrpPendingBatchesTable.expiresAt, /* @__PURE__ */ new Date())
      )).limit(1);
      const products = await db.select({
        itemCode: catalogProductsTable.itemCode,
        productName: catalogProductsTable.productName,
        discontinuedFrom: catalogProductsTable.discontinuedFrom,
        division: catalogProductsTable.division,
        category: catalogProductsTable.category,
        seriesRange: catalogProductsTable.seriesRange
      }).from(catalogProductsTable);
      const history = await db.select({
        itemCode: mrpPriceHistoryTable.itemCode,
        effectiveDate: mrpPriceHistoryTable.effectiveDate,
        mrp: mrpPriceHistoryTable.mrp,
        variant: mrpPriceHistoryTable.variant
      }).from(mrpPriceHistoryTable);
      const preview2 = pendingAuthoritativePreview(parsed2, products, history);
      if (existingBatches.length || pendingMatch.length) {
        res.status(409).json({
          error: pendingMatch.length ? "This authoritative master is already awaiting review." : "This authoritative master has already been loaded.",
          // Identical snapshots still cannot be applied twice, but the current
          // classification/price preview remains inspectable without staging.
          preview: {
            ...preview2,
            canApply: false,
            noChangeReason: pendingMatch.length ? "Review the existing pending batch." : "This identical source was already loaded; no duplicate Apply is allowed."
          },
          duplicate: {
            sourceDivision: "Authoritative multi-division master",
            fileSha256: parsed2.fileSha256,
            matches: existingBatches.map((batch) => ({
              loadBatchId: batch.id,
              loadedAt: batch.loadedAt,
              downloadedAt: batch.downloadedAt
            }))
          }
        });
        return;
      }
      const [pending2] = await db.insert(mrpPendingBatchesTable).values({
        sourceId: source2.id,
        fileName: file2.originalname,
        fileSha256: parsed2.fileSha256,
        fileSizeBytes: file2.size,
        downloadedAt: downloadedAt2,
        uploadedBy: req.user?.email ?? req.user?.id ?? null,
        payload: JSON.stringify(parsed2),
        preview: JSON.stringify(preview2),
        expiresAt: new Date(Date.now() + PENDING_MRP_BATCH_LIFETIME_MS)
      }).returning({ id: mrpPendingBatchesTable.id, expiresAt: mrpPendingBatchesTable.expiresAt });
      res.json({
        batchId: pending2.id,
        status: "pending",
        expiresAt: pending2.expiresAt,
        preview: preview2
      });
      return;
    }
    const sourceId = Number(req.body.sourceId);
    const downloadedAt = req.body.downloadedAt;
    if (!Number.isInteger(sourceId) || sourceId <= 0) {
      res.status(400).json({
        error: "Choose the official MRP source before loading a price sheet."
      });
      return;
    }
    if (!isIsoDate(downloadedAt)) {
      res.status(400).json({
        error: "Enter the date this file was downloaded (YYYY-MM-DD)."
      });
      return;
    }
    await ensureOfficialMrpSources();
    const sourceRows = await db.select().from(mrpSourcesTable).where(eq5(mrpSourcesTable.id, sourceId)).limit(1);
    const source = sourceRows[0];
    if (!source) {
      res.status(400).json({
        error: "The selected MRP source no longer exists. Refresh and choose a source again."
      });
      return;
    }
    const fileSha256 = sha256ForBuffer(file2.buffer);
    const duplicateBatches = await db.select().from(mrpLoadBatchesTable).where(
      and3(
        eq5(mrpLoadBatchesTable.sourceId, source.id),
        eq5(mrpLoadBatchesTable.fileSha256, fileSha256)
      )
    ).orderBy(desc(mrpLoadBatchesTable.loadedAt));
    const pendingDuplicate = await db.select({ id: mrpPendingBatchesTable.id }).from(mrpPendingBatchesTable).where(and3(
      eq5(mrpPendingBatchesTable.sourceId, source.id),
      eq5(mrpPendingBatchesTable.fileSha256, fileSha256),
      eq5(mrpPendingBatchesTable.status, "pending"),
      gt(mrpPendingBatchesTable.expiresAt, /* @__PURE__ */ new Date())
    )).limit(1);
    const confirmDuplicate = req.body.confirmDuplicate === "true";
    if (duplicateBatches.length > 0 || pendingDuplicate.length > 0) {
      res.status(409).json({
        error: pendingDuplicate.length ? "This identical file is already awaiting review; no second pending batch was created." : `This file matches ${duplicateBatches.length} prior load${duplicateBatches.length === 1 ? "" : "s"} for this source.`,
        duplicate: {
          sourceDivision: source.division,
          fileSha256,
          matches: duplicateBatches.map((batch) => ({
            loadBatchId: batch.id,
            fileName: batch.fileName,
            loadedAt: batch.loadedAt,
            downloadedAt: batch.downloadedAt
          }))
        }
      });
      return;
    }
    const existingProductsForPreview = await db.select({
      itemCode: catalogProductsTable.itemCode,
      productName: catalogProductsTable.productName
    }).from(catalogProductsTable);
    const previewKnownCodes = new Set(existingProductsForPreview.map((p) => normCode(p.itemCode)));
    const entries = [];
    if (ext === "zip") {
      if (!effectiveDate) {
        res.status(400).json({ error: "effectiveDate is required for ZIP imports until each entry carries a resolvable dated price column." });
        return;
      }
      const zipEntries = new AdmZip(file2.buffer).getEntries().filter((entry) => !entry.isDirectory && ["xlsx", "xls", "csv"].includes(entry.name.toLowerCase().split(".").pop() ?? "")).filter((entry) => !entry.entryName.startsWith("__MACOSX") && !entry.name.startsWith("._")).sort((a, b) => a.name.localeCompare(b.name));
      if (!zipEntries.length) {
        res.status(400).json({ error: "The ZIP file contains no .xlsx / .xls / .csv files." });
        return;
      }
      for (const entry of zipEntries) {
        const parsed2 = parseWorkbookBuffer(entry.getData(), previewKnownCodes);
        entries.push({
          fileName: entry.name,
          effectiveDate,
          rows: parsed2.rows.map((row) => ({ ...row, effectiveDate })),
          sourcePriceObservations: parsed2.sourcePriceObservations.map((row) => ({
            ...row,
            effectiveDate
          })),
          basis: parsed2.basis,
          codeColHeader: parsed2.codeColHeader,
          priceColHeader: parsed2.priceColHeader,
          skippedUnparseable: parsed2.skippedUnparseable,
          skippedRows: parsed2.skippedRows,
          warnings: parsed2.warnings
        });
      }
    } else {
      const parsed2 = parseWorkbookBuffer(file2.buffer, previewKnownCodes);
      if (!parsed2.hasHeaderPeriods && !effectiveDate) {
        res.status(400).json({ error: "No dated price column was found. Supply an explicit effectiveDate; the loader will never default it to the load date." });
        return;
      }
      const periods = parsed2.hasHeaderPeriods ? [...new Set(parsed2.rows.map((row) => row.effectiveDate).filter((date3) => !!date3))] : [effectiveDate];
      if (!periods.length) {
        res.status(400).json({ error: "No price rows with a resolvable source period were found." });
        return;
      }
      for (const period of periods) {
        entries.push({
          fileName: name,
          effectiveDate: period,
          rows: parsed2.rows.filter((row) => !parsed2.hasHeaderPeriods || row.effectiveDate === period).map((row) => ({ ...row, effectiveDate: period })),
          sourcePriceObservations: parsed2.sourcePriceObservations.filter((row) => !parsed2.hasHeaderPeriods || row.effectiveDate === period).map((row) => ({ ...row, effectiveDate: period })),
          basis: parsed2.basis,
          codeColHeader: parsed2.codeColHeader,
          priceColHeader: parsed2.priceColHeader,
          skippedUnparseable: parsed2.skippedUnparseable,
          skippedRows: parsed2.skippedRows,
          warnings: parsed2.warnings
        });
      }
    }
    const historyForPreview = await db.select({
      itemCode: mrpPriceHistoryTable.itemCode,
      effectiveDate: mrpPriceHistoryTable.effectiveDate,
      mrp: mrpPriceHistoryTable.mrp,
      variant: mrpPriceHistoryTable.variant
    }).from(mrpPriceHistoryTable);
    const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const knownPeriods = new Set(historyForPreview.map((row) => row.effectiveDate));
    const latest = /* @__PURE__ */ new Map();
    for (const row of historyForPreview) if (row.variant === "Standard" && row.effectiveDate <= today && (!latest.get(normCode(row.itemCode)) || latest.get(normCode(row.itemCode)).effectiveDate < row.effectiveDate)) latest.set(normCode(row.itemCode), { mrp: row.mrp, effectiveDate: row.effectiveDate });
    const allRows = entries.flatMap((entry) => entry.rows);
    const historyByKey = new Map(
      historyForPreview.map((row) => [
        `${normCode(row.itemCode)}${row.effectiveDate}${row.variant}`,
        row.mrp
      ])
    );
    const rowsThatWrite = allRows.filter(
      (row) => historyByKey.get(
        `${normCode(row.itemCode)}${row.effectiveDate}${row.variant ?? "Standard"}`
      ) !== row.price
    );
    const immediatePriceChanges = allRows.filter((row) => (row.variant ?? "Standard") === "Standard" && row.effectiveDate <= today && previewKnownCodes.has(normCode(row.itemCode)) && latest.get(normCode(row.itemCode))?.mrp !== row.price).map((row) => ({ itemCode: row.itemCode, oldMrp: latest.get(normCode(row.itemCode))?.mrp ?? null, newMrp: row.price, effectiveDate: row.effectiveDate, delta: row.price - (latest.get(normCode(row.itemCode))?.mrp ?? 0) })).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    const rejectedRows = entries.flatMap((entry) => entry.skippedRows);
    const rejectedReasonSummary = rejectedRows.reduce((out2, row) => {
      out2[row.reason] = (out2[row.reason] ?? 0) + 1;
      return out2;
    }, {});
    const discontinuationDates = entries.flatMap((entry) => entry.sourcePriceObservations.filter((row) => row.isRemoved).map((row) => row.effectiveDate ?? entry.effectiveDate));
    const preview = {
      kind: "ordinary",
      rowsToWrite: rowsThatWrite.length,
      productRows: allRows.length,
      priceRows: allRows.length,
      periods: entries.map((entry) => ({ effectiveDate: entry.effectiveDate, rowCount: entry.rows.length, isNew: !knownPeriods.has(entry.effectiveDate), movedInCount: entry.rows.filter((row) => latest.get(normCode(row.itemCode))?.effectiveDate !== entry.effectiveDate).length })),
      immediatePriceChanges,
      immediatePriceChangeCount: immediatePriceChanges.length,
      newProducts: [...new Set(allRows.filter((row) => !previewKnownCodes.has(normCode(row.itemCode))).map((row) => row.itemCode))],
      catalogueProductsAbsentFromFile: existingProductsForPreview.filter((row) => !allRows.some((input) => normCode(input.itemCode) === normCode(row.itemCode))).map((row) => row.itemCode),
      discontinuations: {
        total: discontinuationDates.length,
        immediate: discontinuationDates.filter((date3) => date3 <= today).length,
        future: discontinuationDates.filter((date3) => date3 > today).length
      },
      protectedNameConflicts: [],
      rejectedRows,
      rejectedReasonSummary,
      canApply: rowsThatWrite.length > 0 || discontinuationDates.length > 0,
      noChangeReason: rowsThatWrite.length > 0 || discontinuationDates.length > 0 ? null : allRows.length ? "Every parsed price already exists with the same value, and no discontinuation would change." : "No valid rows would be written."
    };
    const [pending] = await db.insert(mrpPendingBatchesTable).values({
      sourceId: source.id,
      fileName: name,
      fileSha256,
      fileSizeBytes: file2.size,
      downloadedAt,
      uploadedBy: req.user?.email ?? req.user?.id ?? null,
      payload: JSON.stringify({ kind: "ordinary", reviewBatchId, entries }),
      preview: JSON.stringify(preview),
      expiresAt: new Date(Date.now() + PENDING_MRP_BATCH_LIFETIME_MS)
    }).returning({ id: mrpPendingBatchesTable.id, expiresAt: mrpPendingBatchesTable.expiresAt });
    res.json({ batchId: pending.id, status: "pending", expiresAt: pending.expiresAt, preview });
    return;
  } catch (err) {
    req.log.error({ err, file: name }, "load-mrp preview failed");
    res.status(500).json({ error: "Failed to parse and preview file" });
  }
});
router.post("/catalog/mrp-review-batches/:batchId/approve", requireAdmin, async (req, res) => {
  const batchId = req.params.batchId;
  const approved = await db.transaction(async (tx) => {
    const pending = await tx.select({
      id: mrpPriceHistoryTable.id,
      itemCode: mrpPriceHistoryTable.itemCode,
      effectiveDate: mrpPriceHistoryTable.effectiveDate,
      mrp: mrpPriceHistoryTable.mrp,
      sourceFile: mrpPriceHistoryTable.sourceFile,
      loadBatchId: mrpPriceHistoryTable.loadBatchId
    }).from(mrpPriceHistoryTable).where(
      sql6`${mrpPriceHistoryTable.importBatchId} = ${batchId}
          AND ${mrpPriceHistoryTable.reviewStatus} = 'pending'`
    );
    if (pending.length === 0) return [];
    await tx.update(mrpPriceHistoryTable).set({ reviewStatus: "approved", reviewedAt: /* @__PURE__ */ new Date() }).where(inArray2(mrpPriceHistoryTable.id, pending.map((row) => row.id)));
    await tx.insert(mrpHistoryProvenanceEventsTable).values(
      pending.map((row) => ({
        historyRowId: row.id,
        itemCode: row.itemCode,
        effectiveDate: row.effectiveDate,
        action: "review_approved",
        sourceFile: row.sourceFile,
        loadBatchId: row.loadBatchId,
        mrp: row.mrp
      }))
    );
    return pending;
  });
  if (approved.length === 0) {
    res.status(404).json({ error: "No pending MRP rows found for this review batch" });
    return;
  }
  await recomputeCurrentFlags();
  res.json({ ok: true, approved: approved.length });
});
router.post("/catalog/mrp-review-batches/:batchId/cancel", requireAdmin, async (req, res) => {
  const batchId = req.params.batchId;
  const removed = await db.transaction(async (tx) => {
    const pending = await tx.select({
      id: mrpPriceHistoryTable.id,
      itemCode: mrpPriceHistoryTable.itemCode,
      effectiveDate: mrpPriceHistoryTable.effectiveDate,
      mrp: mrpPriceHistoryTable.mrp,
      sourceFile: mrpPriceHistoryTable.sourceFile,
      loadBatchId: mrpPriceHistoryTable.loadBatchId
    }).from(mrpPriceHistoryTable).where(
      sql6`${mrpPriceHistoryTable.importBatchId} = ${batchId}
          AND ${mrpPriceHistoryTable.reviewStatus} = 'pending'`
    );
    if (pending.length === 0) return [];
    await tx.insert(mrpHistoryProvenanceEventsTable).values(
      pending.map((row) => ({
        historyRowId: row.id,
        itemCode: row.itemCode,
        effectiveDate: row.effectiveDate,
        action: "review_cancelled",
        sourceFile: row.sourceFile,
        loadBatchId: row.loadBatchId,
        mrp: row.mrp
      }))
    );
    await tx.delete(mrpPriceHistoryTable).where(inArray2(mrpPriceHistoryTable.id, pending.map((row) => row.id)));
    return pending;
  });
  if (removed.length === 0) {
    res.status(404).json({ error: "No pending MRP rows found for this review batch" });
    return;
  }
  await recomputeCurrentFlags();
  res.json({ ok: true, cancelled: removed.length });
});
router.get("/catalog/export", async (req, res) => {
  const type = String(req.query.type ?? "catalog");
  const format = String(req.query.format ?? "xlsx");
  const scope = req.query.scope === "revisions" ? "revisions" : "in-force";
  const asOf = typeof req.query.asOf === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.asOf) ? req.query.asOf : (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  let aoa;
  let sheetName;
  let fileBase;
  let summaryAoa = null;
  if (type === "history") {
    sheetName = "MRP History";
    fileBase = "prayag-mrp-history";
    const rows = await db.select().from(mrpPriceHistoryTable).where(eq5(mrpPriceHistoryTable.reviewStatus, "approved")).orderBy(
      asc(mrpPriceHistoryTable.itemCode),
      desc(mrpPriceHistoryTable.effectiveDate),
      desc(mrpPriceHistoryTable.id)
    );
    const statuses = derivePriceHistoryStatuses(
      rows.map((row) => ({
        ...row,
        effectiveDate: String(row.effectiveDate)
      })),
      asOf,
      (row) => `${row.itemCode}\0${row.variant}`,
      (row) => row.mrp != null
    );
    const header = [
      "Item Code",
      "MRP",
      "Net Price",
      "Discount %",
      "Basis",
      "Effective Date",
      "Load Date",
      "Source File",
      "Is Current",
      "Notes"
    ];
    const body = rows.map((r) => [
      r.itemCode,
      r.mrp,
      r.netPrice,
      r.discountPct,
      r.priceBasis,
      r.effectiveDate,
      r.loadDate,
      r.sourceFile,
      statuses.get(r.id) === "Current" ? "Yes" : "No",
      r.notes
    ]);
    aoa = [header, ...body];
  } else {
    sheetName = scope === "revisions" ? "MRP Revisions" : "MRP In Force";
    fileBase = scope === "revisions" ? `prayag-mrp-revisions-effective-${asOf}` : `prayag-mrp-list-in-force-${asOf}`;
    const result = scope === "revisions" ? await db.execute(sql6`
            SELECT
              h.item_code,
              p.product_name,
              p.division,
              p.category,
              p.series_range,
              p.size,
              p.uom,
              h.mrp,
              h.price_basis,
              h.effective_date,
              h.load_date,
              h.source_file,
              p.data_flag,
              p.discontinued_from
            FROM mrp_price_history h
            JOIN catalog_products p ON p.item_code = h.item_code
            WHERE h.effective_date = ${asOf}
              AND h.review_status = 'approved'
              AND h.variant = 'Standard'
              AND h.mrp IS NOT NULL
              AND p.is_active IS TRUE
              AND (p.discontinued_from IS NULL OR p.discontinued_from > ${asOf})
            ORDER BY h.item_code, h.id DESC
          `) : await db.execute(sql6`
            SELECT DISTINCT ON (h.item_code)
              h.item_code,
              p.product_name,
              p.division,
              p.category,
              p.series_range,
              p.size,
              p.uom,
              h.mrp,
              h.price_basis,
              h.effective_date,
              h.load_date,
              h.source_file,
              p.data_flag,
              p.discontinued_from
            FROM mrp_price_history h
            JOIN catalog_products p ON p.item_code = h.item_code
            WHERE h.effective_date <= ${asOf}
              AND h.review_status = 'approved'
              AND h.variant = 'Standard'
              AND h.mrp IS NOT NULL
              AND p.is_active IS TRUE
              AND (p.discontinued_from IS NULL OR p.discontinued_from > ${asOf})
            ORDER BY h.item_code, h.effective_date DESC, h.id DESC
          `);
    const header = [
      "Item Code",
      "Product Name",
      "Division",
      "Category",
      "Range",
      "Size",
      "UOM",
      scope === "revisions" ? "Revised MRP" : "MRP In Force",
      "Basis",
      "Effective Date",
      "Load Date",
      "Source File",
      "Data Flag",
      "Discontinued From"
    ];
    const body = result.rows.map((row) => [
      row.item_code,
      row.product_name,
      row.division,
      row.category,
      row.series_range,
      row.size,
      row.uom,
      row.mrp,
      row.price_basis,
      row.effective_date,
      row.load_date,
      row.source_file,
      row.data_flag,
      row.discontinued_from
    ]);
    aoa = [header, ...body];
    summaryAoa = [
      [
        "Scope",
        scope === "revisions" ? `Prayag MRP revisions effective exactly ${asOf}` : `Prayag MRP list in force on ${asOf}`
      ],
      ["Product count", body.length],
      ["Requested date", asOf],
      [
        "Resolution rule",
        scope === "revisions" ? "Approved Standard MRP rows whose effective date equals the requested date." : "Latest approved Standard MRP on or before the requested date for each live product."
      ],
      [
        "Availability rule",
        "Active catalogue products excluding products discontinued on or before the requested date."
      ]
    ];
  }
  const ws = XLSX4.utils.aoa_to_sheet(aoa);
  if (format === "csv") {
    const csv2 = XLSX4.utils.sheet_to_csv(ws);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileBase}.csv"`
    );
    res.send(csv2);
    return;
  }
  const wb = XLSX4.utils.book_new();
  if (summaryAoa) {
    const summaryWs = XLSX4.utils.aoa_to_sheet(summaryAoa);
    XLSX4.utils.book_append_sheet(wb, summaryWs, "Summary");
  }
  XLSX4.utils.book_append_sheet(wb, ws, sheetName);
  const buf = XLSX4.write(wb, { type: "buffer", bookType: "xlsx" });
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${fileBase}.xlsx"`
  );
  res.send(buf);
});
var SPARSH_MASTER_SHEET = "competitor_mapping";
var SPARSH_MASTER_COMPETITOR = "Sparsh Pearl";
var SPARSH_MASTER_ROW_COUNT = 150;
var ASHIRVAD_MASTER_COMPETITOR = "Ashirvad";
var ASHIRVAD_MASTER_ROW_COUNT = 669;
var ASHIRVAD_MASTER_EFFECTIVE_DATE = "2025-03-01";
var APOLLO_PIPE_SHEETS = /* @__PURE__ */ new Set([
  "agri pipe",
  "casing pipe",
  "cpvc pipe",
  "ppr pipe",
  "swr pipe",
  "ugd pipe",
  "upvc pipe"
]);
var APOLLO_COMPETITOR = "Apollo";
function normalizedSheetName(value) {
  return value.replace(/\s+/gu, " ").trim().toLowerCase();
}
function isApolloRawMaster(workbook) {
  const pipeSheets = workbook.SheetNames.filter(
    (name) => APOLLO_PIPE_SHEETS.has(normalizedSheetName(name))
  );
  return pipeSheets.length === APOLLO_PIPE_SHEETS.size;
}
var ASHIRVAD_MASTER_SHA256 = "5dfa4fdcc76595e4e3c090734808a506d85eb3902137428263274272e2b0e499";
var SPARSH_MASTER_PERIOD_FIELDS = [
  { key: "vol_4_8", label: "Vol 4.8", priceKey: "vol_4_8_mrp", dateKey: "vol_4_8_effective_from" },
  { key: "vol_6_2", label: "Vol 6.2", priceKey: "vol_6_2_mrp", dateKey: "vol_6_2_effective_from" }
];
function parseAshirvadCompetitorMaster(buffer, workbook, canonicalCodes) {
  const sheet = workbook.Sheets[SPARSH_MASTER_SHEET];
  if (!sheet) return null;
  const headerRow = XLSX4.utils.sheet_to_json(sheet, { header: 1, defval: null })[0] ?? [];
  const headers = new Set(headerRow.map((value) => String(value ?? "").trim()));
  const requiredColumns = [
    "prayag_code",
    "competitor",
    "competitor_code",
    "competitor_mrp",
    "effective_from"
  ];
  if (!requiredColumns.every((column) => headers.has(column))) return null;
  if (sha256ForBuffer(buffer) !== ASHIRVAD_MASTER_SHA256) {
    throw new Error("Ashirvad master checksum does not match the approved trusted snapshot.");
  }
  const rows = XLSX4.utils.sheet_to_json(sheet, {
    defval: null
  });
  if (rows.length !== ASHIRVAD_MASTER_ROW_COUNT) {
    throw new Error(
      `Ashirvad master must contain exactly ${ASHIRVAD_MASTER_ROW_COUNT} mapping rows; found ${rows.length}.`
    );
  }
  const prayagCodes = /* @__PURE__ */ new Set();
  const competitorCodes = /* @__PURE__ */ new Set();
  const parsed2 = [];
  for (const [index5, row] of rows.entries()) {
    const rowNumber = index5 + 2;
    const rawPrayagCode = norm(row.prayag_code);
    const competitorCode = norm(row.competitor_code);
    const canonicalPrayagCode = canonicalCodes.get(normCode(rawPrayagCode));
    if (norm(row.competitor) !== ASHIRVAD_MASTER_COMPETITOR) {
      throw new Error(`Ashirvad master row ${rowNumber} has an unexpected competitor.`);
    }
    if (!rawPrayagCode || !competitorCode || !canonicalPrayagCode) {
      throw new Error(
        `Ashirvad master row ${rowNumber} has a missing or unknown Prayag code, or missing competitor code.`
      );
    }
    const prayagKey = normCode(canonicalPrayagCode);
    const competitorKey = normCode(competitorCode);
    if (prayagCodes.has(prayagKey) || competitorCodes.has(competitorKey)) {
      throw new Error(`Ashirvad master row ${rowNumber} duplicates a Prayag or competitor code.`);
    }
    const price = Number(row.competitor_mrp);
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error(`Ashirvad master row ${rowNumber} has an invalid competitor_mrp value.`);
    }
    if (toDateStr(row.effective_from) !== ASHIRVAD_MASTER_EFFECTIVE_DATE) {
      throw new Error(
        `Ashirvad master row ${rowNumber} must have effective_from ${ASHIRVAD_MASTER_EFFECTIVE_DATE}.`
      );
    }
    prayagCodes.add(prayagKey);
    competitorCodes.add(competitorKey);
    parsed2.push({
      prayagCode: canonicalPrayagCode,
      competitorCode,
      price,
      description: norm(row.prayag_name) || null,
      category: norm(row.category) || null
    });
  }
  return parsed2;
}
function parseSparshCompetitorMaster(workbook, canonicalCodes) {
  const sheet = workbook.Sheets[SPARSH_MASTER_SHEET];
  if (!sheet) return null;
  const rows = XLSX4.utils.sheet_to_json(sheet, { defval: null });
  const requiredColumns = [
    "prayag_code",
    "prayag_name",
    "prayag_series",
    "competitor",
    "competitor_code",
    ...SPARSH_MASTER_PERIOD_FIELDS.flatMap((period) => [period.priceKey, period.dateKey])
  ];
  const headers = new Set(
    XLSX4.utils.sheet_to_json(sheet, { header: 1, defval: null })[0]?.map((value) => String(value ?? "").trim()) ?? []
  );
  const missingColumns = requiredColumns.filter((column) => !headers.has(column));
  if (missingColumns.length > 0) {
    return null;
  }
  if (rows.length !== SPARSH_MASTER_ROW_COUNT) {
    throw new Error(
      `Sparsh master must contain exactly ${SPARSH_MASTER_ROW_COUNT} mapping rows; found ${rows.length}.`
    );
  }
  const periods = SPARSH_MASTER_PERIOD_FIELDS.map((period) => {
    const dates = new Set(
      rows.map((row) => toDateStr(row[period.dateKey])).filter((date3) => Boolean(date3))
    );
    if (dates.size !== 1) {
      throw new Error(
        `Sparsh master must contain one consistent ${period.dateKey} value across all rows.`
      );
    }
    const sourceEffectiveDate = [...dates][0];
    if (!isIsoDate(sourceEffectiveDate)) {
      throw new Error(`Sparsh master has an invalid ${period.dateKey} value.`);
    }
    return { ...period, sourceEffectiveDate };
  });
  if (new Set(periods.map((period) => period.sourceEffectiveDate)).size !== periods.length) {
    throw new Error("Sparsh master period dates must be distinct.");
  }
  const competitorCodes = /* @__PURE__ */ new Set();
  const prayagCodes = /* @__PURE__ */ new Set();
  const parsed2 = [];
  const missingPrayagCodes = [];
  for (const [index5, row] of rows.entries()) {
    const rowNumber = index5 + 2;
    const competitor = norm(row.competitor);
    const rawPrayagCode = norm(row.prayag_code);
    const rawCompetitorCode = norm(row.competitor_code);
    if (competitor !== SPARSH_MASTER_COMPETITOR) {
      throw new Error(`Sparsh master row ${rowNumber} has an unexpected competitor.`);
    }
    if (!rawPrayagCode || !rawCompetitorCode) {
      throw new Error(`Sparsh master row ${rowNumber} is missing a Prayag or competitor code.`);
    }
    const prayagCode = canonicalCodes.get(normCode(rawPrayagCode));
    if (!prayagCode) {
      missingPrayagCodes.push(rawPrayagCode);
      continue;
    }
    const competitorCodeKey = normCode(rawCompetitorCode);
    const prayagCodeKey = normCode(prayagCode);
    if (competitorCodes.has(competitorCodeKey) || prayagCodes.has(prayagCodeKey)) {
      throw new Error(`Sparsh master row ${rowNumber} duplicates a competitor or Prayag mapping code.`);
    }
    const prices = {};
    for (const period of periods) {
      const effectiveDate = toDateStr(row[period.dateKey]);
      const price = Number(row[period.priceKey]);
      if (effectiveDate !== period.sourceEffectiveDate) {
        throw new Error(
          `Sparsh master row ${rowNumber} has an unexpected ${period.dateKey} value.`
        );
      }
      if (!Number.isFinite(price) || price <= 0) {
        throw new Error(`Sparsh master row ${rowNumber} has an invalid ${period.priceKey} value.`);
      }
      prices[period.sourceEffectiveDate] = price;
    }
    competitorCodes.add(competitorCodeKey);
    prayagCodes.add(prayagCodeKey);
    parsed2.push({
      prayagCode,
      description: norm(row.prayag_name) || null,
      series: norm(row.prayag_series) || null,
      competitorCode: rawCompetitorCode,
      prices
    });
  }
  if (missingPrayagCodes.length > 0) {
    throw new Error(
      `Sparsh master refers to Prayag code(s) that are not in the official catalog: ${missingPrayagCodes.join(", ")}.`
    );
  }
  return { rows: parsed2, periods };
}
function resolveSparshEffectiveDates(periods, rawOverrides) {
  if (rawOverrides == null || rawOverrides === "") {
    return periods.map((period) => period.sourceEffectiveDate);
  }
  let overrides = rawOverrides;
  if (typeof rawOverrides === "string") {
    try {
      overrides = JSON.parse(rawOverrides);
    } catch {
      throw new Error("periodDates must be a JSON array of YYYY-MM-DD dates.");
    }
  }
  if (!Array.isArray(overrides) || overrides.length !== periods.length) {
    throw new Error(`periodDates must contain exactly ${periods.length} effective date(s).`);
  }
  const effectiveDates = overrides.map((value, index5) => {
    if (typeof value !== "string" || !isIsoDate(value)) {
      throw new Error(`periodDates[${index5}] must be a valid calendar date (YYYY-MM-DD).`);
    }
    return value;
  });
  if (new Set(effectiveDates).size !== effectiveDates.length) {
    throw new Error("Each Sparsh source period must have a distinct effective date.");
  }
  return effectiveDates;
}
function findCol(headers, include, exclude = []) {
  for (let c = 0; c < headers.length; c++) {
    const h = headers[c] ?? "";
    if (!h) continue;
    if (exclude.some((k) => h.includes(k))) continue;
    if (include.some((k) => h.includes(k))) return c;
  }
  return -1;
}
function toDateStr(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") {
    const d = XLSX4.SSF.parse_date_code(v);
    if (!d) return null;
    const p = (n) => String(n).padStart(2, "0");
    return `${d.y}-${p(d.m)}-${p(d.d)}`;
  }
  const s = String(v).trim();
  const m = s.match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : s.slice(0, 10) || null;
}
function parseCompetitorSheet(grid, knownCodes) {
  const maxCols = Math.max(0, ...grid.map((r) => r.length));
  let headerRow = 0;
  for (let r = 0; r < Math.min(grid.length, 15); r++) {
    const strs = (grid[r] ?? []).filter(
      (v) => typeof v === "string" && norm(v).length > 0 && isNaN(Number(v))
    );
    if (strs.length >= 2) {
      headerRow = r;
      break;
    }
  }
  const headers = (grid[headerRow] ?? []).map((h) => norm(h).toLowerCase());
  let codeCol = findCol(headers, ["matched", "prayag_code", "prayag code"]);
  if (codeCol === -1) {
    const dataRows = Math.max(0, grid.length - 1);
    const minOverlap = Math.max(5, Math.floor(dataRows * 0.25));
    let best = 0;
    let bestCol = -1;
    for (let c = 0; c < maxCols; c++) {
      let overlap = 0;
      for (let r = 0; r < grid.length; r++) {
        if (r === headerRow) continue;
        if (knownCodes.has(normCode(grid[r]?.[c]))) overlap++;
      }
      if (overlap > best) {
        best = overlap;
        bestCol = c;
      }
    }
    if (best >= minOverlap) codeCol = bestCol;
  }
  let priceCol = findCol(
    headers,
    ["price", "rate", "cost", "mrp"],
    ["prayag", "diff"]
  );
  if (priceCol === -1) {
    for (let c = 0; c < maxCols; c++) {
      if (c === codeCol) continue;
      let numericCount = 0;
      for (let r = 0; r < grid.length; r++) {
        if (r === headerRow) continue;
        const v = grid[r]?.[c];
        if (v != null && v !== "" && !isNaN(Number(v))) numericCount++;
      }
      if (numericCount > grid.length / 3) {
        priceCol = c;
        break;
      }
    }
  }
  if (priceCol === -1) return [];
  const catCol = findCol(headers, ["category"]);
  const descCol = findCol(headers, ["desc", "name", "product"]);
  const sizeCol = findCol(headers, ["size"]);
  const unitCol = findCol(headers, ["unit"]);
  const dateCol = findCol(headers, ["eff", "date"]);
  const rows = [];
  for (let r = 0; r < grid.length; r++) {
    if (r === headerRow) continue;
    const row = grid[r] ?? [];
    const price = Number(row[priceCol]);
    if (isNaN(price) || price <= 0) continue;
    const rawCode = codeCol !== -1 ? normCode(row[codeCol]) : "";
    rows.push({
      category: catCol !== -1 ? norm(row[catCol]) || null : null,
      description: descCol !== -1 ? norm(row[descCol]) || null : null,
      size: sizeCol !== -1 ? norm(row[sizeCol]) || null : null,
      price,
      unit: unitCol !== -1 ? norm(row[unitCol]) || null : null,
      effectiveDate: dateCol !== -1 ? toDateStr(row[dateCol]) : null,
      matchedPrayagCode: rawCode || null
    });
  }
  return rows;
}
router.get("/catalog/competitor-brands", async (_req, res) => {
  const rows = await db.selectDistinct({
    competitor: competitorPricesTable.competitor,
    effectiveDate: competitorPricesTable.effectiveDate
  }).from(competitorPricesTable).orderBy(
    asc(competitorPricesTable.competitor),
    asc(competitorPricesTable.effectiveDate)
  );
  const periodMap = /* @__PURE__ */ new Map();
  for (const row of rows) {
    if (!periodMap.has(row.competitor)) periodMap.set(row.competitor, []);
    if (row.effectiveDate) periodMap.get(row.competitor).push(row.effectiveDate);
  }
  const brands = [...periodMap.keys()].sort();
  const brandPeriods = brands.map((brand) => ({
    brand,
    effectiveDates: periodMap.get(brand) ?? []
  }));
  res.json({ brands, brandPeriods });
});
router.post(
  "/catalog/preview-competitor",
  requireAdmin,
  upload.single("file"),
  async (req, res) => {
    const file2 = req.file;
    if (!file2) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }
    const ext = file2.originalname.toLowerCase().split(".").pop() ?? "";
    if (!["xlsx", "xls", "csv"].includes(ext)) {
      res.json({ isSparshMaster: false, isAshirvadMaster: false, isPrinceMaster: false });
      return;
    }
    const selectedCompetitor = typeof req.body.competitor === "string" ? req.body.competitor.trim() : "";
    const selectedBrand = selectedCompetitor.toLocaleLowerCase("en");
    if (!selectedBrand) {
      res.json({
        isSparshMaster: false,
        isAshirvadMaster: false,
        isPrinceMaster: false,
        periods: [],
        requiresCompetitor: true
      });
      return;
    }
    try {
      const existingProducts = await db.select({ itemCode: catalogProductsTable.itemCode }).from(catalogProductsTable);
      const canonical = new Map(
        existingProducts.map((product) => [normCode(product.itemCode), product.itemCode])
      );
      const princeCanonical = new Map(
        existingProducts.map((product) => [normalizePrinceCode(product.itemCode), product.itemCode])
      );
      const workbook = XLSX4.read(file2.buffer, { type: "buffer" });
      const ashirvadMaster = selectedBrand === ASHIRVAD_MASTER_COMPETITOR.toLocaleLowerCase("en") ? parseAshirvadCompetitorMaster(file2.buffer, workbook, canonical) : null;
      const sparshMaster = selectedBrand === SPARSH_MASTER_COMPETITOR.toLocaleLowerCase("en") ? parseSparshCompetitorMaster(workbook, canonical) : null;
      const princeMaster = (() => {
        if (selectedBrand !== PRINCE_COMPETITOR.toLocaleLowerCase("en")) return null;
        if (!isPrinceCompetitorMasterWorkbook(workbook)) return null;
        try {
          return parsePrinceCompetitorMaster(file2.buffer, workbook, princeCanonical);
        } catch (error) {
          if (error instanceof Error && /checksum/i.test(error.message)) return null;
          throw error;
        }
      })();
      const liveCheckCodes = ["C133", "PMR-8", "PMR-9"];
      const liveProducts = existingProducts.filter((row) => liveCheckCodes.includes(row.itemCode));
      const liveMrps = await db.execute(sql6`
        SELECT DISTINCT ON (item_code) item_code, mrp
        FROM mrp_price_history
        WHERE item_code IN ('C133', 'PMR-8', 'PMR-9')
          AND variant = 'Standard' AND review_status = 'approved'
          AND effective_date <= CURRENT_DATE
        ORDER BY item_code, effective_date DESC, id DESC
      `);
      const liveMrpByCode = new Map(liveMrps.rows.map((row) => [row.item_code, row.mrp]));
      const liveCatalogueChecks = liveCheckCodes.map((itemCode) => ({
        itemCode,
        exists: liveProducts.some((row) => row.itemCode === itemCode),
        hasCurrentPrice: liveMrpByCode.get(itemCode) != null,
        currentMrp: liveMrpByCode.get(itemCode) ?? null
      }));
      res.json({
        isSparshMaster: Boolean(sparshMaster),
        isAshirvadMaster: Boolean(ashirvadMaster),
        isPrinceMaster: Boolean(princeMaster),
        prince: princeMaster ? {
          rows: princeMaster.rows.length + princeMaster.rejectedRows.filter((row) => row.princeCode && row.price != null).length,
          loadableRows: princeMaster.rows.length,
          catalogMatched: princeMaster.catalogMatchedRows.length,
          unmatched: princeMaster.unmatchedRows.length,
          unmatchedCodes: princeMaster.unmatchedCodes,
          effectiveDate: princeMaster.effectiveDate,
          sourceSha256: princeMaster.sourceSha256,
          contentFingerprint: princeMaster.contentFingerprint,
          priceSum: princeMaster.priceSum,
          exactMatches: princeMaster.exactMatches,
          normalizedMatches: princeMaster.normalizedMatches,
          rejectedRows: princeMaster.rejectedRows,
          worksheetDiagnostics: princeMaster.worksheetDiagnostics,
          worksheetNames: princeMaster.worksheetNames,
          effectiveDates: princeMaster.effectiveDates,
          liveCatalogueChecks
        } : null,
        periods: sparshMaster?.periods.map((period) => ({
          key: period.key,
          label: period.label,
          sourceEffectiveDate: period.sourceEffectiveDate
        })) ?? []
      });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Could not read competitor workbook."
      });
    }
  }
);
router.post(
  "/catalog/stage-competitor-workbook",
  requireAdmin,
  upload.single("file"),
  async (req, res) => {
    const file2 = req.file;
    if (!file2) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }
    const competitor = typeof req.body.competitor === "string" ? req.body.competitor.trim() : "";
    if (!competitor) {
      res.status(400).json({ error: "competitor name is required" });
      return;
    }
    const ext = file2.originalname.toLowerCase().split(".").pop() ?? "";
    if (!["xlsx", "xls", "csv"].includes(ext)) {
      res.status(400).json({ error: "Upload an .xlsx, .xls, or .csv file" });
      return;
    }
    const selectedBrand = competitor.toLocaleLowerCase("en");
    if (selectedBrand === "apollo") {
      res.status(409).json({
        error: "Apollo workbooks must be previewed through the brand-specific Apollo loader.",
        code: "APOLLO_BRAND_PREVIEW_REQUIRED"
      });
      return;
    }
    try {
      const products = await db.select({ itemCode: catalogProductsTable.itemCode }).from(catalogProductsTable);
      const knownCodes = new Set(products.map((p) => normCode(p.itemCode)));
      const canonical = new Map(products.map((p) => [normCode(p.itemCode), p.itemCode]));
      const princeCanonical = new Map(products.map((p) => [normalizePrinceCode(p.itemCode), p.itemCode]));
      const workbook = XLSX4.read(file2.buffer, { type: "buffer" });
      const ashirvadMaster = selectedBrand === ASHIRVAD_MASTER_COMPETITOR.toLocaleLowerCase("en") ? parseAshirvadCompetitorMaster(file2.buffer, workbook, canonical) : null;
      const sparshMaster = selectedBrand === SPARSH_MASTER_COMPETITOR.toLocaleLowerCase("en") ? parseSparshCompetitorMaster(workbook, canonical) : null;
      const princeMaster = (() => {
        if (selectedBrand !== PRINCE_COMPETITOR.toLocaleLowerCase("en")) return null;
        if (!isPrinceCompetitorMasterWorkbook(workbook)) return null;
        try {
          return parsePrinceCompetitorMaster(file2.buffer, workbook, princeCanonical);
        } catch (error) {
          if (error instanceof Error && /checksum/i.test(error.message)) return null;
          throw error;
        }
      })();
      if (competitor === PRINCE_COMPETITOR && !princeMaster) {
        res.status(409).json({
          error: "Prince imports must use the trusted 13-sheet Competitor Master and pass its content and date gates.",
          code: "TRUSTED_PRINCE_MASTER_REQUIRED"
        });
        return;
      }
      if (!princeMaster && !ashirvadMaster && !sparshMaster) {
        const groupedBrands = detectGroupedCompetitorBrands(workbook);
        if (groupedBrands.length > 0) {
          res.status(409).json({
            error: `This workbook contains brand-specific columns (${groupedBrands.join(", ")}) and cannot be staged with generic numeric-column detection. Select a supported brand-specific loader.`,
            code: "GROUPED_COMPETITOR_BRAND_SCOPE_REQUIRED",
            brands: groupedBrands
          });
          return;
        }
      }
      const sourceHash = sha256ForBuffer(file2.buffer);
      const priceBasis = req.body.priceBasis === "Ex-GST" ? "Ex-GST" : "MRP";
      const gstPct = priceBasis === "Ex-GST" && !isNaN(Number(req.body.gstPct)) ? Number(req.body.gstPct) : priceBasis === "Ex-GST" ? 18 : null;
      const createBatch = async (batchCompetitor, effectiveDate2, rows2, counts, loadBatchId) => {
        let resolvedLoadBatchId = loadBatchId ?? null;
        if (resolvedLoadBatchId == null) {
          const sourceSheetId = `competitor-${batchCompetitor.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
          const [source] = await db.insert(mrpSourcesTable).values({
            division: `${batchCompetitor} competitor`,
            sheetId: sourceSheetId,
            sheetUrl: `internal://${sourceSheetId}`,
            expectedFileName: file2.originalname,
            notes: "Uploaded competitor workbook staged for review and approval.",
            sourceKind: "competitor"
          }).onConflictDoNothing().returning();
          const sourceRow = source ?? (await db.select({ id: mrpSourcesTable.id }).from(mrpSourcesTable).where(eq5(mrpSourcesTable.sheetId, sourceSheetId)).limit(1))[0];
          if (!sourceRow) throw new Error("Could not create competitor provenance source.");
          const [load] = await db.insert(mrpLoadBatchesTable).values({
            sourceId: sourceRow.id,
            fileName: file2.originalname,
            fileSha256: sourceHash,
            fileSizeBytes: file2.size,
            downloadedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
            loadedBy: req.user?.email ?? req.user?.id ?? null,
            rowCount: rows2.length,
            notes: JSON.stringify({ staged: true, competitor: batchCompetitor })
          }).returning({ id: mrpLoadBatchesTable.id });
          resolvedLoadBatchId = load?.id ?? null;
        }
        if (resolvedLoadBatchId == null) throw new Error("Could not create competitor provenance load batch.");
        const [batch] = await db.insert(importBatchesTable).values({
          competitor: batchCompetitor,
          effectiveDate: effectiveDate2,
          sourceFileName: file2.originalname,
          priceBasis,
          gstPct,
          status: "pending",
          fileSha256: sourceHash,
          fileSizeBytes: file2.size,
          rowCounts: JSON.stringify(counts),
          loadBatchId: resolvedLoadBatchId
        }).returning();
        if (!batch) throw new Error("Could not create import batch.");
        if (rows2.length) {
          await db.insert(competitorPriceStagingTable).values(rows2.map((row) => ({
            batchId: batch.id,
            competitor: batchCompetitor,
            effectiveDate: row.effectiveDate ?? effectiveDate2,
            competitorCodeMaster: row.competitorCode,
            competitorCodeCatalogue: row.competitorCode,
            matchedPrayagCode: row.prayagCode,
            description: row.description,
            catalogueDescription: row.description,
            variant: row.variant,
            oldMrp: null,
            newMrp: row.price,
            increasePct: null,
            prayagMrpCurrent: row.prayagMrp ?? null,
            gapPct: null,
            page: null,
            discoveryEvidence: null,
            adjudicated: false,
            matchMethod: row.prayagCode ? "code+desc" : null,
            status: row.status,
            reviewReason: row.reviewReason ?? (row.prayagCode ? null : "No verified Prayag product match.")
          })));
        }
        return batch.id;
      };
      if (princeMaster) {
        if (competitor !== PRINCE_COMPETITOR) {
          res.status(400).json({ error: `The trusted Prince master must be imported as ${PRINCE_COMPETITOR}.` });
          return;
        }
        const existingPrinceBatch = await db.select().from(importBatchesTable).where(and3(eq5(importBatchesTable.competitor, PRINCE_COMPETITOR), eq5(importBatchesTable.effectiveDate, PRINCE_EFFECTIVE_DATE))).orderBy(desc(importBatchesTable.id));
        const existingContent = existingPrinceBatch.find((batch) => batch.status === "approved" && (() => {
          try {
            return JSON.parse(batch.rowCounts ?? "{}").content_fingerprint === princeMaster.contentFingerprint;
          } catch {
            return false;
          }
        })());
        if (existingContent) {
          const activeDecisions = await db.select({
            competitorCode: competitorMappingDecisionsTable.competitorCode,
            prayagCode: competitorMappingDecisionsTable.prayagCode,
            decision: competitorMappingDecisionsTable.decision,
            reason: competitorMappingDecisionsTable.reason
          }).from(competitorMappingDecisionsTable).where(and3(
            eq5(competitorMappingDecisionsTable.competitor, PRINCE_COMPETITOR),
            sql6`${competitorMappingDecisionsTable.undoneAt} IS NULL`
          ));
          const excluded = activeDecisions.filter((decision) => decision.decision === "exclusion");
          const confirmed = activeDecisions.filter((decision) => decision.decision === "confirmation");
          const currentPrinceRows = await db.select().from(competitorPricesTable).where(eq5(competitorPricesTable.competitor, PRINCE_COMPETITOR));
          const sourceMappings = (() => {
            try {
              return JSON.parse(existingContent.rowCounts ?? "{}").source_mappings ?? [];
            } catch {
              return [];
            }
          })();
          const observedMappings = [
            ...sourceMappings,
            ...princeMaster.rows.map((row) => ({ princeCode: row.princeCode, prayagCode: row.canonicalPrayagCode ?? row.prayagCode })),
            ...princeMaster.rejectedRows.map((row) => ({ princeCode: row.princeCode, prayagCode: row.prayagCode }))
          ];
          const excludedRows = observedMappings.filter((mapping) => excluded.some(
            (decision) => normalizePrinceCode(decision.competitorCode) === normalizePrinceCode(mapping.princeCode ?? ("competitorCode" in mapping ? mapping.competitorCode : void 0)) && normCode(decision.prayagCode) === normCode(mapping.prayagCode ?? "")
          ));
          const confirmedRows = currentPrinceRows.filter((mapping) => confirmed.some(
            (decision) => normalizePrinceCode(decision.competitorCode) === normalizePrinceCode(mapping.competitorCode)
          )).map((mapping) => ({
            competitorCode: mapping.competitorCode,
            prayagCode: mapping.matchedPrayagCode,
            decision: "confirmation"
          }));
          res.status(200).json({
            batchId: existingContent.id,
            batchIds: [existingContent.id],
            status: existingContent.status,
            idempotent: true,
            excluded_by_decision: excludedRows,
            excluded_by_decision_count: excludedRows.length,
            active_excluded_decisions: excludedRows.length ? [] : excluded,
            active_excluded_decision_count: excludedRows.length ? 0 : excluded.length,
            confirmed_by_decision: confirmedRows.length ? confirmedRows : confirmed,
            confirmed_by_decision_count: confirmedRows.length || confirmed.length,
            decisions: activeDecisions
          });
          return;
        }
        const decisions = await db.select().from(competitorMappingDecisionsTable).where(and3(
          eq5(competitorMappingDecisionsTable.competitor, PRINCE_COMPETITOR),
          sql6`${competitorMappingDecisionsTable.undoneAt} IS NULL`
        ));
        const excludedPairs = new Set(
          decisions.filter((d) => d.decision === "exclusion").map((d) => `${normalizePrinceCode(d.competitorCode)}|${normCode(d.prayagCode)}`)
        );
        const confirmedCodes = new Set(
          decisions.filter((d) => d.decision === "confirmation").map((d) => normalizePrinceCode(d.competitorCode))
        );
        const excludedByDecision = [];
        const shouldExclude = (competitorCode, prayagCode) => {
          const key = `${normalizePrinceCode(competitorCode)}|${normCode(prayagCode ?? "")}`;
          const excluded = excludedPairs.has(key);
          if (excluded) {
            const decision = decisions.find(
              (d) => d.decision === "exclusion" && normalizePrinceCode(d.competitorCode) === normalizePrinceCode(competitorCode) && normCode(d.prayagCode) === normCode(prayagCode ?? "")
            );
            excludedByDecision.push({ competitorCode: competitorCode ?? "", prayagCode, reason: decision?.reason ?? "Excluded by decision." });
          }
          return excluded;
        };
        const stagedRowsBeforeAnomalyClassification = [
          ...princeMaster.rows.map((row) => ({
            prayagCode: row.canonicalPrayagCode,
            description: null,
            variant: row.lengthMeters ? `${row.lengthMeters} m` : null,
            price: row.price,
            competitorCode: row.princeCode,
            status: row.catalogMatched ? "ok" : "needs_review",
            reviewReason: row.catalogMatched ? null : "No verified Prayag product match.",
            effectiveDate: row.effectiveDate
          })),
          ...princeMaster.rejectedRows.map((row) => ({
            prayagCode: row.prayagCode,
            description: null,
            variant: null,
            price: row.price,
            competitorCode: row.princeCode || null,
            status: "needs_review",
            reviewReason: row.reason,
            effectiveDate: PRINCE_EFFECTIVE_DATE
          }))
        ].filter((row) => !shouldExclude(row.competitorCode, row.prayagCode));
        const retainedPrinceRows = princeMaster.rows.filter((row) => !excludedPairs.has(
          `${normalizePrinceCode(row.princeCode)}|${normCode(row.canonicalPrayagCode ?? row.prayagCode)}`
        ));
        const duplicateAnomalies = classifyPrinceDuplicateAnomalies(retainedPrinceRows, confirmedCodes);
        const stagedRows = stagedRowsBeforeAnomalyClassification.map((staged) => {
          const anomaly = duplicateAnomalies.get(
            `${normalizePrinceCode(staged.competitorCode)}|${normCode(staged.prayagCode ?? "")}`
          );
          return anomaly ? { ...staged, status: anomaly.status, reviewReason: anomaly.reason } : staged;
        });
        const confirmedByDecision = princeMaster.rows.filter((row) => confirmedCodes.has(normalizePrinceCode(row.princeCode))).map((row) => ({
          competitorCode: row.princeCode,
          prayagCode: row.canonicalPrayagCode ?? row.prayagCode,
          decision: "confirmation",
          reason: decisions.find((d) => d.decision === "confirmation" && normalizePrinceCode(d.competitorCode) === normalizePrinceCode(row.princeCode))?.reason ?? "Confirmed by decision."
        }));
        const excludedRejectedRows = new Set(excludedByDecision.map(
          (row) => `${normalizePrinceCode(row.competitorCode)}|${normCode(row.prayagCode ?? "")}`
        ));
        const rejectedRowsForReport = princeMaster.rejectedRows.filter(
          (row) => !excludedRejectedRows.has(`${normalizePrinceCode(row.princeCode)}|${normCode(row.prayagCode)}`)
        );
        const stagedOkCount = stagedRows.filter((row) => row.status === "ok").length;
        const stagedReviewCount = stagedRows.filter((row) => row.status === "needs_review").length;
        const actor = req.user?.email ?? req.user?.id ?? null;
        let provenanceLoadBatchId = null;
        const [source] = await db.insert(mrpSourcesTable).values({
          division: "Prince competitor",
          sheetId: "prince-competitor-master",
          sheetUrl: "internal://prince-competitor-master",
          expectedFileName: null,
          notes: "Trusted P027r2 Prince competitor source",
          sourceKind: "competitor"
        }).onConflictDoNothing().returning();
        const sourceRow = source ?? (await db.select({ id: mrpSourcesTable.id }).from(mrpSourcesTable).where(eq5(mrpSourcesTable.sheetId, "prince-competitor-master")).limit(1))[0];
        if (sourceRow) {
          const [load] = await db.insert(mrpLoadBatchesTable).values({
            sourceId: sourceRow.id,
            fileName: file2.originalname,
            fileSha256: princeMaster.sourceSha256,
            fileSizeBytes: file2.size,
            downloadedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
            loadedBy: actor,
            rowCount: princeMaster.contentFingerprint ? 950 : princeMaster.rows.length,
            notes: JSON.stringify({ contentFingerprint: princeMaster.contentFingerprint })
          }).returning();
          provenanceLoadBatchId = load?.id ?? null;
        }
        const batchId2 = await createBatch(
          PRINCE_COMPETITOR,
          PRINCE_EFFECTIVE_DATE,
          stagedRows,
          {
            total: stagedRows.length,
            ok: stagedOkCount,
            needs_review: stagedReviewCount,
            not_found: stagedReviewCount,
            new_products: 0,
            unmatched_prayag_codes: princeMaster.unmatchedCodes,
            rejected_rows: rejectedRowsForReport,
            excluded_by_decision: excludedByDecision,
            excluded_by_decision_count: excludedByDecision.length,
            confirmed_by_decision: confirmedByDecision,
            confirmed_by_decision_count: confirmedByDecision.length,
            duplicate_anomalies: [...duplicateAnomalies.values()].filter((value) => value.status === "needs_review").length,
            duplicate_anomalies_cleared_by_decision: [...duplicateAnomalies.values()].filter((value) => value.confirmedByDecision).length,
            content_fingerprint: princeMaster.contentFingerprint,
            price_sum: princeMaster.priceSum,
            exact_matches: princeMaster.exactMatches,
            normalized_matches: princeMaster.normalizedMatches,
            worksheet_diagnostics: princeMaster.worksheetDiagnostics,
            source: "trusted_prince_competitor_master",
            source_sha256: princeMaster.sourceSha256,
            source_effective_date: "per-worksheet"
          },
          provenanceLoadBatchId
        );
        await db.transaction(async (tx) => {
          await tx.execute(sql6`SELECT pg_advisory_xact_lock(340342)`);
          const activeExclusions = await tx.select().from(competitorMappingDecisionsTable).where(and3(
            eq5(competitorMappingDecisionsTable.competitor, PRINCE_COMPETITOR),
            eq5(competitorMappingDecisionsTable.decision, "exclusion"),
            sql6`${competitorMappingDecisionsTable.undoneAt} IS NULL`
          ));
          for (const decision of activeExclusions) {
            await tx.execute(sql6`
              DELETE FROM competitor_price_staging
              WHERE batch_id = ${batchId2}
                AND competitor_code_master = ${decision.competitorCode}
                AND matched_prayag_code = ${decision.prayagCode}
            `);
          }
        });
        res.status(201).json({
          batchId: batchId2,
          batchIds: [batchId2],
          status: "pending",
          summary: {
            total: stagedRows.length,
            matched: stagedOkCount,
            unmatched: stagedReviewCount,
            unmatchedCodes: princeMaster.unmatchedCodes,
            effectiveDate: PRINCE_EFFECTIVE_DATE,
            contentFingerprint: princeMaster.contentFingerprint,
            rejectedRows: rejectedRowsForReport,
            excludedByDecision,
            excludedByDecisionCount: excludedByDecision.length,
            confirmedByDecision,
            confirmedByDecisionCount: confirmedByDecision.length,
            duplicateAnomalies: [...duplicateAnomalies.values()].filter((value) => value.status === "needs_review").length,
            duplicateAnomaliesClearedByDecision: [...duplicateAnomalies.values()].filter((value) => value.confirmedByDecision).length
          }
        });
        return;
      }
      if (ashirvadMaster) {
        if (competitor !== ASHIRVAD_MASTER_COMPETITOR) {
          res.status(400).json({ error: `The trusted Ashirvad master must be imported as ${ASHIRVAD_MASTER_COMPETITOR}.` });
          return;
        }
        const batchId2 = await createBatch(
          ASHIRVAD_MASTER_COMPETITOR,
          ASHIRVAD_MASTER_EFFECTIVE_DATE,
          ashirvadMaster.map((row) => ({
            prayagCode: row.prayagCode,
            description: row.description,
            variant: null,
            price: row.price,
            competitorCode: row.competitorCode,
            status: "ok"
          })),
          {
            ok: ashirvadMaster.length,
            needs_review: 0,
            not_found: 0,
            new_products: 0,
            source: "trusted_ashirvad_competitor_master",
            source_sha256: ASHIRVAD_MASTER_SHA256,
            source_effective_date: ASHIRVAD_MASTER_EFFECTIVE_DATE,
            reason: "Trusted one-to-one Ashirvad competitor mapping; review-only Prayag fields ignored."
          }
        );
        res.status(201).json({ batchId: batchId2, batchIds: [batchId2], status: "pending" });
        return;
      }
      if (sparshMaster) {
        if (competitor !== SPARSH_MASTER_COMPETITOR) {
          res.status(400).json({ error: `The ${SPARSH_MASTER_SHEET} workbook must be imported as ${SPARSH_MASTER_COMPETITOR}.` });
          return;
        }
        let dates;
        try {
          dates = resolveSparshEffectiveDates(sparshMaster.periods, req.body.periodDates);
        } catch (error) {
          res.status(400).json({ error: error instanceof Error ? error.message : "Invalid Sparsh effective dates." });
          return;
        }
        const batchIds = await Promise.all(sparshMaster.periods.map((period, index5) => createBatch(
          SPARSH_MASTER_COMPETITOR,
          dates[index5],
          sparshMaster.rows.map((row) => ({
            prayagCode: row.prayagCode,
            description: row.description,
            variant: null,
            price: row.prices[period.sourceEffectiveDate],
            competitorCode: row.competitorCode,
            status: "ok"
          })),
          {
            ok: sparshMaster.rows.length,
            needs_review: 0,
            not_found: 0,
            new_products: 0,
            source: "authoritative_sparsh_competitor_master",
            source_effective_date: period.sourceEffectiveDate,
            effective_date_overridden: dates[index5] !== period.sourceEffectiveDate
          }
        )));
        res.status(201).json({ batchId: batchIds[0], batchIds, status: "pending" });
        return;
      }
      const effectiveDate = typeof req.body.effectiveDate === "string" ? req.body.effectiveDate.trim() : "";
      if (!isIsoDate(effectiveDate)) {
        res.status(400).json({ error: "effectiveDate is required and must be a valid YYYY-MM-DD calendar date." });
        return;
      }
      const currentMrpResult = await db.execute(sql6`
        SELECT DISTINCT ON (h.item_code) h.item_code, h.mrp FROM mrp_price_history h
        JOIN catalog_products p ON p.item_code = h.item_code
        WHERE h.effective_date <= CURRENT_DATE AND h.review_status = 'approved'
          AND h.variant = 'Standard' AND p.is_active IS TRUE
          AND (p.discontinued_from IS NULL OR p.discontinued_from > CURRENT_DATE)
        ORDER BY h.item_code, h.effective_date DESC, h.id DESC`);
      const currentMrp = new Map(currentMrpResult.rows.filter((r) => r.mrp != null).map((r) => [normCode(r.item_code), r.mrp]));
      let parsed2 = [];
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) continue;
        const candidate = parseCompetitorSheet(XLSX4.utils.sheet_to_json(sheet, { header: 1, defval: null }), knownCodes);
        if (candidate.length > parsed2.length) parsed2 = candidate;
      }
      let sourceEffectiveDate;
      try {
        sourceEffectiveDate = validateGenericWorkbookDate(
          parsed2.map((row) => row.effectiveDate),
          effectiveDate
        );
      } catch (error) {
        res.status(400).json({ error: error instanceof Error ? error.message : "Workbook date does not match the selected competitor period." });
        return;
      }
      let matched = 0;
      let needsReview = 0;
      const rows = parsed2.map((row) => {
        const norm2 = row.matchedPrayagCode;
        let matchedCode = !!norm2 && knownCodes.has(norm2);
        const prayagMrp = matchedCode ? currentMrp.get(norm2) ?? null : null;
        if (matchedCode && prayagMrp && prayagMrp > 0) {
          const gap = (effectivePrice(row.unit, row.price) - prayagMrp) / prayagMrp * 100;
          if (gap < GAP_MIN_PCT || gap > GAP_MAX_PCT) matchedCode = false;
        }
        if (matchedCode) matched++;
        else needsReview++;
        return {
          prayagCode: matchedCode ? canonical.get(norm2) ?? norm2 : null,
          description: row.description,
          variant: row.size,
          price: row.price,
          competitorCode: null,
          status: matchedCode ? "ok" : "needs_review",
          prayagMrp: matchedCode ? prayagMrp : null
        };
      });
      const resolvedEffectiveDate = sourceEffectiveDate ?? effectiveDate;
      const batchId = await createBatch(competitor, resolvedEffectiveDate, rows, {
        ok: matched,
        needs_review: needsReview,
        not_found: 0,
        new_products: 0,
        total: rows.length,
        source_effective_date: sourceEffectiveDate,
        operator_effective_date: effectiveDate
      });
      res.status(201).json({ batchId, batchIds: [batchId], status: "pending" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not stage competitor workbook.";
      res.status(400).json({ error: message });
    }
  }
);
router.post(
  "/catalog/load-competitor",
  requireAdmin,
  upload.single("file"),
  async (req, res) => {
    const file2 = req.file;
    if (!file2) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }
    const competitor = typeof req.body.competitor === "string" && req.body.competitor.trim() ? req.body.competitor.trim() : null;
    if (!competitor) {
      res.status(400).json({ error: "competitor name is required" });
      return;
    }
    if (competitor === PRINCE_COMPETITOR) {
      res.status(410).json({
        error: "Prince trusted workbooks must use preview \u2192 stage \u2192 approve; the legacy direct-load route is disabled.",
        code: "TRUSTED_STAGE_REQUIRED",
        noWrites: true
      });
      return;
    }
    if (competitor.trim().toLowerCase() !== APOLLO_COMPETITOR.toLowerCase()) {
      res.status(410).json({
        error: "Direct competitor price writes are disabled. Use POST /catalog/stage-competitor-workbook, then approve the staged batch.",
        code: "COMPETITOR_STAGED_PATH_REQUIRED",
        noWrites: true
      });
      return;
    }
    const name = file2.originalname;
    const ext = name.toLowerCase().split(".").pop() ?? "";
    if (!["xlsx", "xls", "csv"].includes(ext)) {
      res.status(400).json({ error: "Upload an .xlsx, .xls, or .csv file" });
      return;
    }
    try {
      const existingProducts = await db.select({ itemCode: catalogProductsTable.itemCode }).from(catalogProductsTable);
      const knownCodes = new Set(
        existingProducts.map((p) => normCode(p.itemCode))
      );
      const canonical = new Map(
        existingProducts.map((p) => [normCode(p.itemCode), p.itemCode])
      );
      const wb = XLSX4.read(file2.buffer, { type: "buffer" });
      const ashirvadMaster = parseAshirvadCompetitorMaster(
        file2.buffer,
        wb,
        canonical
      );
      const sparshMaster = parseSparshCompetitorMaster(wb, canonical);
      const princeMaster = competitor.trim().toLowerCase() === "apollo" ? null : (() => {
        try {
          return parsePrinceCompetitorMaster(file2.buffer, wb, canonical);
        } catch (error) {
          if (error instanceof Error && /checksum/i.test(error.message)) return null;
          throw error;
        }
      })();
      if (princeMaster) {
        if (competitor !== PRINCE_COMPETITOR) {
          res.status(400).json({
            error: `The trusted Prince master must be imported as ${PRINCE_COMPETITOR}.`
          });
          return;
        }
        const sourceHash = princeMaster.sourceSha256;
        const existingBatch = await db.select({ id: importBatchesTable.id, rowCounts: importBatchesTable.rowCounts }).from(importBatchesTable).where(and3(
          eq5(importBatchesTable.competitor, PRINCE_COMPETITOR),
          eq5(importBatchesTable.effectiveDate, PRINCE_EFFECTIVE_DATE),
          eq5(importBatchesTable.fileSha256, sourceHash),
          eq5(importBatchesTable.status, "approved")
        )).limit(1);
        if (existingBatch.length > 0) {
          res.json({
            results: {
              competitor: PRINCE_COMPETITOR,
              file: name,
              totalRows: princeMaster.rows.length,
              inserted: princeMaster.catalogMatchedRows.length,
              matched: princeMaster.catalogMatchedRows.length,
              unmatched: princeMaster.unmatchedRows.length,
              unmatchedCodes: princeMaster.unmatchedCodes,
              effectiveDate: PRINCE_EFFECTIVE_DATE,
              fileSha256: sourceHash,
              idempotent: true,
              batchId: existingBatch[0].id,
              sourceMappings: existingBatch[0].rowCounts ? JSON.parse(existingBatch[0].rowCounts).source_mappings ?? [] : []
            }
          });
          return;
        }
        const values2 = princeMaster.catalogMatchedRows.map((row) => ({
          competitor: PRINCE_COMPETITOR,
          category: row.category,
          description: null,
          size: row.lengthMeters ? `${row.lengthMeters} m` : null,
          price: row.price,
          unit: "MRP",
          competitorCode: row.princeCode,
          effectiveDate: PRINCE_EFFECTIVE_DATE,
          matchedPrayagCode: row.canonicalPrayagCode,
          matchStatus: "matched",
          matchConfidence: "High",
          prayagMrpAtCompare: null,
          isCurrent: false,
          priceBasis: "MRP",
          gstPct: null
        }));
        let insertedBatchId = null;
        await db.transaction(async (tx) => {
          await tx.delete(competitorPricesTable).where(and3(
            eq5(competitorPricesTable.competitor, PRINCE_COMPETITOR),
            eq5(competitorPricesTable.effectiveDate, PRINCE_EFFECTIVE_DATE)
          ));
          const [batch] = await tx.insert(importBatchesTable).values({
            competitor: PRINCE_COMPETITOR,
            effectiveDate: PRINCE_EFFECTIVE_DATE,
            sourceFileName: name,
            priceBasis: "MRP",
            gstPct: null,
            status: "approved",
            rowCounts: JSON.stringify({
              total: princeMaster.rows.length,
              matched: values2.length,
              unmatched: princeMaster.unmatchedRows.length,
              unmatched_prayag_codes: princeMaster.unmatchedCodes,
              source_mappings: princeMaster.rows.map((row) => ({
                sourceRow: row.sourceRow,
                sheet: row.sheet,
                category: row.category,
                prayagCode: row.prayagCode,
                princeCode: row.princeCode,
                lengthMeters: row.lengthMeters,
                price: row.price,
                catalogMatched: row.catalogMatched
              })),
              source: "trusted_prince_competitor_master",
              source_sha256: sourceHash,
              source_effective_date: PRINCE_EFFECTIVE_DATE
            }),
            extractionModel: null,
            fileSha256: sourceHash,
            fileSizeBytes: file2.size,
            extractorVersion: null,
            catalogueProfileRevision: null,
            promptRevision: null,
            model: null,
            pagesRequested: null,
            passesRun: null,
            itemsAdjudicated: null
          }).returning({ id: importBatchesTable.id });
          insertedBatchId = batch?.id ?? null;
          for (let index5 = 0; index5 < values2.length; index5 += 200) {
            await tx.insert(competitorPricesTable).values(values2.slice(index5, index5 + 200));
          }
          await recomputeCompetitorCurrentFlagsInTransaction(PRINCE_COMPETITOR, tx);
        });
        res.json({
          results: {
            competitor: PRINCE_COMPETITOR,
            file: name,
            totalRows: princeMaster.rows.length,
            inserted: values2.length,
            matched: values2.length,
            unmatched: princeMaster.unmatchedRows.length,
            unmatchedCodes: princeMaster.unmatchedCodes,
            effectiveDate: PRINCE_EFFECTIVE_DATE,
            fileSha256: sourceHash,
            batchId: insertedBatchId,
            sourceMappings: princeMaster.rows.map((row) => ({
              sourceRow: row.sourceRow,
              sheet: row.sheet,
              category: row.category,
              prayagCode: row.prayagCode,
              princeCode: row.princeCode,
              lengthMeters: row.lengthMeters,
              price: row.price,
              catalogMatched: row.catalogMatched
            }))
          }
        });
        return;
      }
      if (ashirvadMaster) {
        if (competitor !== ASHIRVAD_MASTER_COMPETITOR) {
          res.status(400).json({
            error: `The trusted Ashirvad master must be imported as ${ASHIRVAD_MASTER_COMPETITOR}.`
          });
          return;
        }
        const sourceHash = sha256ForBuffer(file2.buffer);
        const values2 = ashirvadMaster.map((row) => ({
          competitor: ASHIRVAD_MASTER_COMPETITOR,
          category: row.category,
          description: row.description,
          size: null,
          price: row.price,
          unit: "MRP",
          competitorCode: row.competitorCode,
          effectiveDate: ASHIRVAD_MASTER_EFFECTIVE_DATE,
          matchedPrayagCode: row.prayagCode,
          matchStatus: "matched",
          matchConfidence: "High",
          // Never source this from prayag_mrp_reference in the upload.
          prayagMrpAtCompare: null,
          isCurrent: false,
          priceBasis: "MRP",
          gstPct: null
        }));
        await db.transaction(async (tx) => {
          await tx.delete(competitorPricesTable).where(
            and3(
              eq5(competitorPricesTable.competitor, ASHIRVAD_MASTER_COMPETITOR),
              eq5(competitorPricesTable.effectiveDate, ASHIRVAD_MASTER_EFFECTIVE_DATE)
            )
          );
          await tx.insert(importBatchesTable).values({
            competitor: ASHIRVAD_MASTER_COMPETITOR,
            effectiveDate: ASHIRVAD_MASTER_EFFECTIVE_DATE,
            sourceFileName: name,
            priceBasis: "MRP",
            gstPct: null,
            status: "approved",
            rowCounts: JSON.stringify({
              total: values2.length,
              matched: values2.length,
              direct_code: values2.length,
              source: "trusted_ashirvad_competitor_master",
              source_sha256: ASHIRVAD_MASTER_SHA256,
              source_effective_date: ASHIRVAD_MASTER_EFFECTIVE_DATE,
              reason: "Trusted one-to-one Ashirvad competitor mapping; review-only Prayag fields ignored."
            }),
            extractionModel: null,
            fileSha256: sourceHash,
            fileSizeBytes: file2.size,
            extractorVersion: null,
            catalogueProfileRevision: null,
            promptRevision: null,
            model: null,
            pagesRequested: null,
            passesRun: null,
            itemsAdjudicated: null
          });
          await tx.insert(competitorPricesTable).values(values2);
          await recomputeCompetitorCurrentFlagsInTransaction(
            ASHIRVAD_MASTER_COMPETITOR,
            tx
          );
        });
        req.log?.info(
          { rows: values2.length, effectiveDate: ASHIRVAD_MASTER_EFFECTIVE_DATE },
          "Adopted trusted Ashirvad competitor master"
        );
        res.json({
          results: {
            competitor: ASHIRVAD_MASTER_COMPETITOR,
            file: name,
            totalRows: values2.length,
            inserted: values2.length,
            matched: values2.length,
            unmatched: 0,
            rejectedByGap: 0,
            effectiveDate: ASHIRVAD_MASTER_EFFECTIVE_DATE,
            fileSha256: sourceHash
          }
        });
        return;
      }
      if (sparshMaster) {
        if (competitor !== SPARSH_MASTER_COMPETITOR) {
          res.status(400).json({
            error: `The ${SPARSH_MASTER_SHEET} workbook must be imported as ${SPARSH_MASTER_COMPETITOR}.`
          });
          return;
        }
        let effectiveDates;
        try {
          effectiveDates = resolveSparshEffectiveDates(
            sparshMaster.periods,
            req.body.periodDates
          );
        } catch (error) {
          res.status(400).json({
            error: error instanceof Error ? error.message : "Invalid Sparsh effective dates."
          });
          return;
        }
        const sourceHash = sha256ForBuffer(file2.buffer);
        const directMatchCount = sparshMaster.rows.length;
        const values2 = sparshMaster.periods.flatMap(
          (period, periodIndex) => sparshMaster.rows.map((row) => ({
            competitor: SPARSH_MASTER_COMPETITOR,
            category: row.series,
            description: row.description,
            size: null,
            price: row.prices[period.sourceEffectiveDate],
            unit: "MRP",
            competitorCode: row.competitorCode,
            effectiveDate: effectiveDates[periodIndex],
            matchedPrayagCode: row.prayagCode,
            matchStatus: "matched",
            // The workbook carries a verified direct mapping, rather than a
            // guessed description/size result, so the generic gap guardrail
            // intentionally does not demote these audited rows.
            matchConfidence: "High",
            prayagMrpAtCompare: null,
            isCurrent: false,
            priceBasis: "MRP",
            gstPct: null
          }))
        );
        await db.transaction(async (tx) => {
          await tx.delete(competitorPricesTable).where(eq5(competitorPricesTable.competitor, SPARSH_MASTER_COMPETITOR));
          for (const [periodIndex, period] of sparshMaster.periods.entries()) {
            const effectiveDate2 = effectiveDates[periodIndex];
            const periodValues = values2.filter(
              (value) => value.effectiveDate === effectiveDate2
            );
            await tx.insert(importBatchesTable).values({
              competitor: SPARSH_MASTER_COMPETITOR,
              effectiveDate: effectiveDate2,
              sourceFileName: name,
              priceBasis: "MRP",
              gstPct: null,
              status: "approved",
              rowCounts: JSON.stringify({
                total: periodValues.length,
                matched: directMatchCount,
                direct_code: directMatchCount,
                desc_size: 0,
                source: "authoritative_sparsh_competitor_master",
                source_effective_date: period.sourceEffectiveDate,
                effective_date_overridden: effectiveDate2 !== period.sourceEffectiveDate
              }),
              extractionModel: null,
              fileSha256: sourceHash,
              fileSizeBytes: file2.size,
              extractorVersion: null,
              catalogueProfileRevision: null,
              promptRevision: null,
              model: null,
              pagesRequested: null,
              passesRun: null,
              itemsAdjudicated: null
            });
            await tx.insert(competitorPricesTable).values(periodValues);
          }
          await recomputeCompetitorCurrentFlagsInTransaction(
            SPARSH_MASTER_COMPETITOR,
            tx
          );
        });
        req.log?.info(
          {
            rows: values2.length,
            periods: sparshMaster.periods.map((period, index5) => ({
              sourceEffectiveDate: period.sourceEffectiveDate,
              effectiveDate: effectiveDates[index5]
            }))
          },
          "Adopted authoritative Sparsh competitor master"
        );
        res.json({
          results: {
            competitor: SPARSH_MASTER_COMPETITOR,
            file: name,
            totalRows: values2.length,
            inserted: values2.length,
            matched: values2.length,
            unmatched: 0,
            rejectedByGap: 0,
            periods: sparshMaster.periods.map((period, index5) => ({
              label: period.label,
              sourceEffectiveDate: period.sourceEffectiveDate,
              effectiveDate: effectiveDates[index5],
              overridden: effectiveDates[index5] !== period.sourceEffectiveDate,
              inserted: directMatchCount,
              directMatches: directMatchCount,
              descSizeMatches: 0
            }))
          }
        });
        return;
      }
      if (isApolloRawMaster(wb)) {
        if (competitor.trim().toLowerCase() === APOLLO_COMPETITOR.toLowerCase()) {
          res.status(410).json({
            error: "Legacy direct Apollo writes are disabled. Use POST /catalog/apollo-load/preview, then apply the staged batch.",
            code: "APOLLO_STAGED_PATH_REQUIRED",
            noWrites: true
          });
          return;
        }
        res.status(422).json({
          error: "P045 Apollo raw master rejected: grouped two-row headers require explicit column mapping review; no rows were written.",
          code: "APOLLO_RAW_MASTER_MAPPING_REQUIRED",
          limitation: "The importer does not safely distinguish Apollo price columns from Prayag reference columns in this workbook format.",
          noWrites: true
        });
        return;
      }
      if (competitor.trim().toLowerCase() === APOLLO_COMPETITOR.toLowerCase()) {
        res.status(422).json({
          error: "P045 Apollo upload rejected: competitor code provenance was not explicitly parsed; no rows were written.",
          code: "APOLLO_PROVENANCE_REQUIRED",
          noWrites: true
        });
        return;
      }
      const effectiveDateBody = typeof req.body.effectiveDate === "string" && req.body.effectiveDate.trim() ? req.body.effectiveDate.trim() : null;
      if (!effectiveDateBody) {
        res.status(400).json({ error: "effectiveDate (YYYY-MM-DD) is required" });
        return;
      }
      if (!isIsoDate(effectiveDateBody)) {
        res.status(400).json({ error: "effectiveDate must be a valid calendar date (YYYY-MM-DD)" });
        return;
      }
      const effectiveDate = effectiveDateBody;
      const currentMrpResult = await db.execute(sql6`
        SELECT DISTINCT ON (h.item_code) h.item_code, h.mrp
        FROM mrp_price_history h
        JOIN catalog_products p ON p.item_code = h.item_code
        WHERE h.effective_date <= CURRENT_DATE
          AND h.review_status = 'approved'
          AND h.variant = 'Standard'
          AND p.is_active IS TRUE
          AND (p.discontinued_from IS NULL OR p.discontinued_from > CURRENT_DATE)
        ORDER BY h.item_code, h.effective_date DESC, h.id DESC
      `);
      const currentMrp = /* @__PURE__ */ new Map();
      for (const r of currentMrpResult.rows) {
        if (r.mrp != null) currentMrp.set(normCode(r.item_code), r.mrp);
      }
      let parsed2 = [];
      for (const sheetName of wb.SheetNames) {
        const sheet = wb.Sheets[sheetName];
        if (!sheet) continue;
        const grid = XLSX4.utils.sheet_to_json(sheet, {
          header: 1,
          defval: null
        });
        const sheetRows = parseCompetitorSheet(grid, knownCodes);
        if (sheetRows.length > parsed2.length) parsed2 = sheetRows;
      }
      if (parsed2.length === 0) {
        res.json({
          results: {
            competitor,
            file: name,
            totalRows: 0,
            inserted: 0,
            matched: 0,
            unmatched: 0,
            message: "No price rows detected. Check the sheet has a price column."
          }
        });
        return;
      }
      let matched = 0;
      let rejectedByGap = 0;
      const values = parsed2.map((r) => {
        const norm2 = r.matchedPrayagCode;
        let isMatched = !!norm2 && knownCodes.has(norm2);
        let prayagMrpSnapshot = null;
        if (isMatched) {
          const prayagMrp = currentMrp.get(norm2);
          if (prayagMrp != null && prayagMrp > 0) {
            prayagMrpSnapshot = prayagMrp;
            const eff = effectivePrice(r.unit, r.price);
            const gapPct = (eff - prayagMrp) / prayagMrp * 100;
            if (gapPct < GAP_MIN_PCT || gapPct > GAP_MAX_PCT) {
              isMatched = false;
              rejectedByGap++;
            }
          }
        }
        if (!isMatched) prayagMrpSnapshot = null;
        if (isMatched) matched++;
        return {
          competitor,
          category: r.category,
          description: r.description,
          size: r.size,
          price: r.price,
          unit: r.unit,
          // Use the form's effectiveDate — more reliable than parsing from the sheet
          effectiveDate,
          matchedPrayagCode: isMatched ? canonical.get(norm2) ?? norm2 : null,
          codeSource: "supplier",
          matchStatus: isMatched ? "matched" : "no match (review)",
          matchConfidence: isMatched ? "High" : null,
          prayagMrpAtCompare: prayagMrpSnapshot,
          // All new rows start as not current; recompute below sets the flag.
          isCurrent: false
        };
      });
      await db.transaction(async (tx) => {
        await tx.delete(competitorPricesTable).where(
          sql6`competitor = ${competitor} AND effective_date = ${effectiveDate}`
        );
        for (let i = 0; i < values.length; i += 500) {
          await tx.insert(competitorPricesTable).values(values.slice(i, i + 500));
        }
        await recomputeCompetitorCurrentFlagsInTransaction(competitor, tx);
      });
      res.json({
        results: {
          competitor,
          file: name,
          totalRows: parsed2.length,
          inserted: values.length,
          matched,
          unmatched: values.length - matched,
          rejectedByGap
        }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to parse and load file";
      const httpStatus = typeof err === "object" && err !== null && "httpStatus" in err ? Number(err.httpStatus) : 0;
      if (httpStatus >= 400 && httpStatus < 500) {
        res.status(httpStatus).json({ error: message, noWrites: true });
        return;
      }
      if (message.startsWith("Sparsh master ")) {
        res.status(400).json({ error: message });
        return;
      }
      req.log?.error({ err, file: name }, "load-competitor failed");
      res.status(500).json({ error: "Failed to parse and load file" });
    }
  }
);
router.get("/catalog/mrp-periods", async (_req, res) => {
  const rows = await db.select({
    effectiveDate: mrpPriceHistoryTable.effectiveDate,
    count: sql6`cast(count(*) as integer)`
  }).from(mrpPriceHistoryTable).groupBy(mrpPriceHistoryTable.effectiveDate).orderBy(desc(mrpPriceHistoryTable.effectiveDate));
  res.json({ periods: rows.map((r) => ({ effectiveDate: r.effectiveDate, count: r.count })) });
});
router.delete("/catalog/mrp-period/:date", requireAdmin, async (req, res) => {
  const date3 = String(req.params.date ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date3)) {
    res.status(400).json({ error: "date param must be YYYY-MM-DD" });
    return;
  }
  try {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql6`LOCK TABLE mrp_price_history IN SHARE ROW EXCLUSIVE MODE`
      );
      const allPeriods = await tx.selectDistinct({ effectiveDate: mrpPriceHistoryTable.effectiveDate }).from(mrpPriceHistoryTable);
      const target = allPeriods.find((p) => p.effectiveDate === date3);
      if (!target) {
        throw Object.assign(
          new Error(`No MRP period found for date ${date3}`),
          { httpStatus: 404 }
        );
      }
      if (allPeriods.length <= 1) {
        throw Object.assign(
          new Error("Cannot delete the only remaining MRP period. At least one price period must exist."),
          { httpStatus: 409 }
        );
      }
      const rowsToDelete = await tx.select({
        id: mrpPriceHistoryTable.id,
        itemCode: mrpPriceHistoryTable.itemCode,
        effectiveDate: mrpPriceHistoryTable.effectiveDate,
        mrp: mrpPriceHistoryTable.mrp,
        sourceFile: mrpPriceHistoryTable.sourceFile,
        loadBatchId: mrpPriceHistoryTable.loadBatchId
      }).from(mrpPriceHistoryTable).where(eq5(mrpPriceHistoryTable.effectiveDate, date3));
      await tx.insert(mrpHistoryProvenanceEventsTable).values(
        rowsToDelete.map((row) => ({
          historyRowId: row.id,
          itemCode: row.itemCode,
          effectiveDate: row.effectiveDate,
          action: "period_deleted",
          sourceFile: row.sourceFile,
          loadBatchId: row.loadBatchId,
          mrp: row.mrp
        }))
      );
      await tx.delete(mrpPriceHistoryTable).where(eq5(mrpPriceHistoryTable.effectiveDate, date3));
      await tx.execute(sql6`UPDATE mrp_price_history SET is_current = false`);
      await tx.execute(sql6`
        UPDATE mrp_price_history m
        SET is_current = true
        FROM (
          SELECT DISTINCT ON (h.item_code, h.variant) h.id
          FROM mrp_price_history h
          JOIN catalog_products p ON p.item_code = h.item_code
          WHERE h.effective_date <= CURRENT_DATE
            AND h.review_status = 'approved'
            AND p.is_active IS TRUE
            AND (p.discontinued_from IS NULL OR p.discontinued_from > CURRENT_DATE)
          ORDER BY h.item_code, h.variant, h.effective_date DESC, h.id DESC
        ) latest
        WHERE m.id = latest.id
      `);
    });
  } catch (err) {
    const status = err.httpStatus ?? 500;
    if (status < 500) {
      res.status(status).json({ error: err.message });
    } else {
      req.log.error({ err, date: date3 }, "mrp-period delete failed");
      res.status(500).json({ error: "Failed to delete MRP period" });
    }
    return;
  }
  res.json({ deleted: date3 });
});
router.patch("/catalog/mrp-period-date", requireAdmin, async (req, res) => {
  const currentEffectiveDate = String(req.body?.currentEffectiveDate ?? "").trim();
  const newEffectiveDate = String(req.body?.newEffectiveDate ?? "").trim();
  if (!isIsoDate(currentEffectiveDate) || !isIsoDate(newEffectiveDate)) {
    res.status(400).json({ error: "Both effective dates must be YYYY-MM-DD" });
    return;
  }
  if (currentEffectiveDate === newEffectiveDate) {
    res.json({ moved: 0, effectiveDate: currentEffectiveDate });
    return;
  }
  try {
    const moved = await db.transaction(async (tx) => {
      await tx.execute(sql6`LOCK TABLE mrp_price_history IN SHARE ROW EXCLUSIVE MODE`);
      const [source, destination] = await Promise.all([
        tx.select({ id: mrpPriceHistoryTable.id }).from(mrpPriceHistoryTable).where(eq5(mrpPriceHistoryTable.effectiveDate, currentEffectiveDate)).limit(1),
        tx.select({ id: mrpPriceHistoryTable.id }).from(mrpPriceHistoryTable).where(eq5(mrpPriceHistoryTable.effectiveDate, newEffectiveDate)).limit(1)
      ]);
      if (source.length === 0) {
        throw Object.assign(new Error(`No MRP period found for date ${currentEffectiveDate}`), { httpStatus: 404 });
      }
      if (destination.length > 0) {
        throw Object.assign(new Error(`An MRP period already exists for ${newEffectiveDate}. Choose an unused date.`), { httpStatus: 409 });
      }
      const rows = await tx.select({
        id: mrpPriceHistoryTable.id,
        itemCode: mrpPriceHistoryTable.itemCode,
        sourceFile: mrpPriceHistoryTable.sourceFile,
        loadBatchId: mrpPriceHistoryTable.loadBatchId,
        mrp: mrpPriceHistoryTable.mrp
      }).from(mrpPriceHistoryTable).where(eq5(mrpPriceHistoryTable.effectiveDate, currentEffectiveDate));
      await tx.insert(mrpHistoryProvenanceEventsTable).values(rows.map((row) => ({
        historyRowId: row.id,
        itemCode: row.itemCode,
        effectiveDate: newEffectiveDate,
        action: "period_effective_date_changed",
        reason: `Effective date corrected from ${currentEffectiveDate} to ${newEffectiveDate}`,
        sourceFile: row.sourceFile,
        loadBatchId: row.loadBatchId,
        mrp: row.mrp
      })));
      await tx.update(mrpPriceHistoryTable).set({ effectiveDate: newEffectiveDate, isCurrent: false }).where(eq5(mrpPriceHistoryTable.effectiveDate, currentEffectiveDate));
      await tx.execute(sql6`
        UPDATE mrp_price_history m SET is_current = true
        FROM (
          SELECT DISTINCT ON (h.item_code, h.variant) h.id
          FROM mrp_price_history h JOIN catalog_products p ON p.item_code = h.item_code
          WHERE h.effective_date <= CURRENT_DATE AND h.review_status = 'approved'
            AND p.is_active IS TRUE
            AND (p.discontinued_from IS NULL OR p.discontinued_from > CURRENT_DATE)
          ORDER BY h.item_code, h.variant, h.effective_date DESC, h.id DESC
        ) latest WHERE m.id = latest.id
      `);
      return rows.length;
    });
    res.json({ moved, previousEffectiveDate: currentEffectiveDate, effectiveDate: newEffectiveDate });
  } catch (err) {
    const status = err.httpStatus ?? 500;
    if (status < 500) res.status(status).json({ error: err.message });
    else {
      req.log.error({ err, currentEffectiveDate, newEffectiveDate }, "mrp period date update failed");
      res.status(500).json({ error: "Failed to change MRP period date" });
    }
  }
});
router.patch("/catalog/competitor-period-date", requireAdmin, async (req, res) => {
  const competitor = String(req.body?.competitor ?? "").trim();
  const currentEffectiveDate = String(req.body?.currentEffectiveDate ?? "").trim();
  const newEffectiveDate = String(req.body?.newEffectiveDate ?? "").trim();
  if (!competitor || !isIsoDate(currentEffectiveDate) || !isIsoDate(newEffectiveDate)) {
    res.status(400).json({ error: "competitor and both YYYY-MM-DD effective dates are required" });
    return;
  }
  if (currentEffectiveDate === newEffectiveDate) {
    res.json({ moved: 0, competitor, effectiveDate: currentEffectiveDate });
    return;
  }
  try {
    const moved = await db.transaction(async (tx) => {
      await tx.execute(sql6`LOCK TABLE competitor_prices IN SHARE ROW EXCLUSIVE MODE`);
      const [source, destination] = await Promise.all([
        tx.select({ id: competitorPricesTable.id }).from(competitorPricesTable).where(and3(eq5(competitorPricesTable.competitor, competitor), eq5(competitorPricesTable.effectiveDate, currentEffectiveDate))).limit(1),
        tx.select({ id: competitorPricesTable.id }).from(competitorPricesTable).where(and3(eq5(competitorPricesTable.competitor, competitor), eq5(competitorPricesTable.effectiveDate, newEffectiveDate))).limit(1)
      ]);
      if (source.length === 0) {
        throw Object.assign(new Error(`No ${competitor} period found for ${currentEffectiveDate}`), { httpStatus: 404 });
      }
      if (destination.length > 0) {
        throw Object.assign(new Error(`${competitor} already has a period for ${newEffectiveDate}. Choose an unused date.`), { httpStatus: 409 });
      }
      const result = await tx.update(competitorPricesTable).set({ effectiveDate: newEffectiveDate, isCurrent: false, updatedAt: /* @__PURE__ */ new Date() }).where(and3(eq5(competitorPricesTable.competitor, competitor), eq5(competitorPricesTable.effectiveDate, currentEffectiveDate))).returning({ id: competitorPricesTable.id });
      await recomputeCompetitorCurrentFlagsInTransaction(competitor, tx);
      return result.length;
    });
    res.json({ moved, competitor, previousEffectiveDate: currentEffectiveDate, effectiveDate: newEffectiveDate });
  } catch (err) {
    const status = err.httpStatus ?? 500;
    if (status < 500) res.status(status).json({ error: err.message });
    else {
      req.log.error({ err, competitor, currentEffectiveDate, newEffectiveDate }, "competitor period date update failed");
      res.status(500).json({ error: "Failed to change competitor period date" });
    }
  }
});
router.post("/catalog/ugd-classification/preview", requireAdmin, async (req, res) => {
  try {
    const products = await db.select().from(catalogProductsTable).where(inArray2(catalogProductsTable.itemCode, P029_PAIRS.flat()));
    const byCode = new Map(products.map((row) => [row.itemCode, row]));
    const rows = P029_PAIRS.map(([siblingCode, itemCode]) => {
      const sibling = byCode.get(siblingCode);
      const target = byCode.get(itemCode);
      if (!sibling || !target) throw new Error(`P029 product pair is incomplete: ${siblingCode} -> ${itemCode}`);
      if (sibling.size !== null || target.size !== null || sibling.size !== target.size) {
        throw new Error(`P029 preview stopped: size must be null on both ${siblingCode} and ${itemCode}.`);
      }
      const previousValues = Object.fromEntries(P029_CLASSIFICATION_FIELDS.map((field) => [field, target[field]]));
      const correctedValues = Object.fromEntries(P029_CLASSIFICATION_FIELDS.map((field) => [field, sibling[field]]));
      return {
        siblingCode,
        itemCode,
        previousValues,
        correctedValues,
        name: target.productName,
        siblingName: sibling.productName
      };
    });
    const prices = await db.select({
      itemCode: mrpPriceHistoryTable.itemCode,
      mrp: mrpPriceHistoryTable.mrp
    }).from(mrpPriceHistoryTable).where(and3(
      inArray2(mrpPriceHistoryTable.itemCode, P029_PAIRS.flat()),
      eq5(mrpPriceHistoryTable.variant, "Standard"),
      eq5(mrpPriceHistoryTable.reviewStatus, "approved")
    )).orderBy(desc(mrpPriceHistoryTable.effectiveDate), desc(mrpPriceHistoryTable.id));
    const latest = /* @__PURE__ */ new Map();
    for (const row of prices) if (!latest.has(row.itemCode)) latest.set(row.itemCode, row.mrp);
    const priceChecks = P029_PAIRS.map(([siblingCode, itemCode]) => ({
      siblingCode,
      itemCode,
      siblingMrp: latest.get(siblingCode) ?? null,
      targetMrp: latest.get(itemCode) ?? null,
      expectedMrp: P029_EXPECTED_MRPS[siblingCode],
      matches: latest.get(siblingCode) === latest.get(itemCode) && latest.get(siblingCode) === P029_EXPECTED_MRPS[siblingCode]
    }));
    if (priceChecks.some((row) => !row.matches)) {
      throw new Error("P029 preview stopped: every sibling and Self Fit MRP must match the exact P029 expected MRP.");
    }
    const correctionKey = randomUUID();
    const actor = req.user?.email ?? req.user?.id ?? null;
    await db.insert(catalogProductClassificationCorrectionsTable).values(rows.map((row) => ({
      correctionKey,
      itemCode: row.itemCode,
      siblingCode: row.siblingCode,
      previousValues: JSON.stringify(row.previousValues),
      correctedValues: JSON.stringify(row.correctedValues),
      actor
    })));
    res.json({
      correctionKey,
      status: "preview",
      rows,
      priceChecks,
      copiedFields: P029_CLASSIFICATION_FIELDS,
      sizeAction: "unchanged: all siblings and targets verified null",
      canApply: true
    });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Could not create P029 preview." });
  }
});
router.post("/catalog/ugd-classification/:correctionKey/apply", requireAdmin, async (req, res) => {
  const correctionKey = String(req.params.correctionKey ?? "").trim();
  if (!correctionKey) {
    res.status(400).json({ error: "correctionKey is required." });
    return;
  }
  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql6`SELECT pg_advisory_xact_lock(929007)`);
      const rows = await tx.select().from(catalogProductClassificationCorrectionsTable).where(and3(eq5(catalogProductClassificationCorrectionsTable.correctionKey, correctionKey), sql6`${catalogProductClassificationCorrectionsTable.appliedAt} IS NULL`));
      if (rows.length !== P029_PAIRS.length) throw new Error("P029 preview not found, already applied, or incomplete.");
      const products = await tx.select().from(catalogProductsTable).where(inArray2(catalogProductsTable.itemCode, P029_PAIRS.flat())).for("update");
      if (products.length !== P029_PAIRS.length * 2) throw new Error("P029 apply stopped: one or more locked products is missing.");
      const byCode = new Map(products.map((row) => [row.itemCode, row]));
      for (const row of rows) {
        const current = byCode.get(row.itemCode);
        if (!current || JSON.stringify(Object.fromEntries(P029_CLASSIFICATION_FIELDS.map((field) => [field, current[field]]))) !== row.previousValues) {
          throw new Error(`P029 preview is stale for ${row.itemCode}; create a new preview.`);
        }
      }
      const mrpRows = await tx.select({
        itemCode: mrpPriceHistoryTable.itemCode,
        mrp: mrpPriceHistoryTable.mrp
      }).from(mrpPriceHistoryTable).where(and3(
        inArray2(mrpPriceHistoryTable.itemCode, P029_PAIRS.flat()),
        eq5(mrpPriceHistoryTable.variant, "Standard"),
        eq5(mrpPriceHistoryTable.reviewStatus, "approved")
      )).orderBy(desc(mrpPriceHistoryTable.effectiveDate), desc(mrpPriceHistoryTable.id));
      const latestMrp = /* @__PURE__ */ new Map();
      for (const row of mrpRows) if (!latestMrp.has(row.itemCode)) latestMrp.set(row.itemCode, row.mrp);
      for (const [siblingCode, itemCode] of P029_PAIRS) {
        if (!latestMrp.has(siblingCode) || !latestMrp.has(itemCode) || latestMrp.get(siblingCode) !== latestMrp.get(itemCode) || latestMrp.get(siblingCode) !== P029_EXPECTED_MRPS[siblingCode]) {
          throw new Error(`P029 apply stopped: MRP mismatch for ${siblingCode} -> ${itemCode}; create a new preview.`);
        }
      }
      await tx.insert(mrpSourcesTable).values(P029_CLASSIFICATION_SOURCE).onConflictDoNothing();
      const [source] = await tx.select({ id: mrpSourcesTable.id }).from(mrpSourcesTable).where(eq5(mrpSourcesTable.sheetId, P029_CLASSIFICATION_SOURCE.sheetId)).limit(1);
      if (!source) throw new Error("P029 provenance source could not be created.");
      const actor = req.user?.email ?? req.user?.id ?? null;
      const [load] = await tx.insert(mrpLoadBatchesTable).values({
        sourceId: source.id,
        fileName: P029_CLASSIFICATION_SOURCE.expectedFileName,
        fileSha256: P029_CLASSIFICATION_FILE_HASH,
        fileSizeBytes: Buffer.byteLength("P029|UGD Self Fit classification sibling-copy contract|v1"),
        downloadedAt: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
        loadedBy: actor,
        rowCount: rows.length,
        notes: "P029 classification-only correction; no price rows written."
      }).returning({ id: mrpLoadBatchesTable.id });
      if (!load) throw new Error("P029 provenance batch could not be created.");
      for (const row of rows) {
        const updated = await tx.update(catalogProductsTable).set({
          ...JSON.parse(row.correctedValues),
          updatedAt: /* @__PURE__ */ new Date()
        }).where(eq5(catalogProductsTable.itemCode, row.itemCode)).returning({ id: catalogProductsTable.id });
        if (updated.length !== 1) throw new Error(`P029 apply stopped: compare-and-swap failed for ${row.itemCode}.`);
      }
      const audited = await tx.update(catalogProductClassificationCorrectionsTable).set({ loadBatchId: load.id, actor, appliedAt: /* @__PURE__ */ new Date() }).where(and3(eq5(catalogProductClassificationCorrectionsTable.correctionKey, correctionKey), sql6`${catalogProductClassificationCorrectionsTable.appliedAt} IS NULL`));
      if (audited.rowCount !== P029_PAIRS.length) throw new Error("P029 apply stopped: audit rows changed concurrently.");
      return { correctionKey, loadBatchId: load.id, changed: rows.length, status: "applied" };
    }, { isolationLevel: "serializable" });
    res.json(result);
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : "Could not apply P029 correction." });
  }
});
router.post("/catalog/ugd-classification/:correctionKey/undo", requireAdmin, async (req, res) => {
  const correctionKey = String(req.params.correctionKey ?? "").trim();
  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql6`SELECT pg_advisory_xact_lock(929007)`);
      const rows = await tx.select().from(catalogProductClassificationCorrectionsTable).where(and3(eq5(catalogProductClassificationCorrectionsTable.correctionKey, correctionKey), sql6`${catalogProductClassificationCorrectionsTable.appliedAt} IS NOT NULL AND ${catalogProductClassificationCorrectionsTable.undoneAt} IS NULL`));
      if (rows.length !== P029_PAIRS.length) throw new Error("P029 correction is not applied, already undone, or incomplete.");
      const products = await tx.select().from(catalogProductsTable).where(inArray2(catalogProductsTable.itemCode, rows.map((row) => row.itemCode))).for("update");
      if (products.length !== P029_PAIRS.length) {
        throw new Error("P029 undo stopped: one or more locked products is missing.");
      }
      const byCode = new Map(products.map((row) => [row.itemCode, row]));
      const currentValues = (row) => {
        const current = byCode.get(row.itemCode);
        return current ? JSON.stringify(Object.fromEntries(P029_CLASSIFICATION_FIELDS.map((field) => [field, current[field]]))) : null;
      };
      const alreadyRestored = rows.every((row) => currentValues(row) === row.previousValues);
      const stillApplied = rows.every((row) => currentValues(row) === row.correctedValues);
      if (!alreadyRestored && !stillApplied) {
        throw new Error("P029 undo stopped: one or more products changed after apply.");
      }
      if (!alreadyRestored) {
        for (const row of rows) {
          const restored = await tx.update(catalogProductsTable).set({ ...JSON.parse(row.previousValues), updatedAt: /* @__PURE__ */ new Date() }).where(eq5(catalogProductsTable.itemCode, row.itemCode)).returning({ id: catalogProductsTable.id });
          if (restored.length !== 1) {
            throw new Error(`P029 undo stopped: compare-and-swap failed for ${row.itemCode}.`);
          }
        }
      }
      const audited = await tx.update(catalogProductClassificationCorrectionsTable).set({ undoneAt: /* @__PURE__ */ new Date(), undoneBy: req.user?.email ?? req.user?.id ?? null }).where(and3(eq5(catalogProductClassificationCorrectionsTable.correctionKey, correctionKey), sql6`${catalogProductClassificationCorrectionsTable.undoneAt} IS NULL`));
      if (audited.rowCount !== P029_PAIRS.length) {
        throw new Error("P029 undo stopped: audit rows changed concurrently.");
      }
      return {
        correctionKey,
        restored: alreadyRestored ? 0 : rows.length,
        alreadyRestored,
        status: "undone"
      };
    }, { isolationLevel: "serializable" });
    res.json(result);
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : "Could not undo P029 correction." });
  }
});

// ../../.local/p049-step3-audit.ts
var root = path.resolve("../..");
var out = path.join(root, "reports/p049-step-3");
var clock = (/* @__PURE__ */ new Date()).toLocaleString("sv-SE", { timeZone: "Asia/Kolkata" });
var csv = (file2) => {
  const workbook = XLSX5.read(fs.readFileSync(file2, "utf8"), { type: "string", raw: true });
  return XLSX5.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: null });
};
var writeCSV = (name, rows, headers) => fs.writeFileSync(
  path.join(out, name),
  XLSX5.utils.sheet_to_csv(XLSX5.utils.json_to_sheet(rows, headers ? { header: headers } : void 0), { forceQuotes: true })
);
var file = "Prayag_MRP_Authoritative_v2_01Sep2026_1788783858192.xlsx";
var parsed = parseAuthoritativeMasterBuffer(fs.readFileSync(path.join(root, "attached_assets", file)));
var results = {};
for (const environment of ["development", "production"]) {
  const snapshot = csv(path.join(out, `${environment}-classification-before.csv`));
  const products = snapshot.map((row) => ({
    itemCode: row.item_code,
    productName: null,
    discontinuedFrom: null,
    division: row.division,
    category: row.category,
    seriesRange: row.series_range
  }));
  const preview = pendingAuthoritativePreview(parsed, products, []);
  if (environment === "development") {
    fs.writeFileSync(path.join(out, "development-ui-duplicate-fixture.json"), JSON.stringify({
      error: "This authoritative master has already been loaded.",
      duplicate: { sourceDivision: "Authoritative multi-division master", fileSha256: parsed.fileSha256, matches: [] },
      preview: { ...preview, canApply: false, noChangeReason: "This identical source was already loaded; no duplicate Apply is allowed." }
    }, null, 2));
  }
  results[environment] = {
    environment,
    auditIST: clock,
    sourceFile: file,
    sourceSHA256: parsed.fileSha256,
    masterRows: parsed.productRows.length,
    priceRows: preview.priceRows,
    classificationCounts: preview.classificationCounts,
    rejectedRows: preview.rejectedRows,
    classificationDifferences: preview.classificationDifferences,
    sourceSnapshot: `${environment}-classification-before.csv`,
    liveApplyPerformed: false
  };
  writeCSV(`${environment}-classification-differences.csv`, preview.classificationDifferences.map((row) => ({
    environment,
    audit_ist: clock,
    item_code: row.itemCode,
    message: row.message,
    differing_fields: row.differingFields.join("; "),
    stored_division: row.stored.division,
    file_division: row.file.division,
    stored_category: row.stored.category,
    file_category: row.file.category,
    category_provided: row.file.categoryProvided,
    stored_series_range: row.stored.seriesRange,
    file_series_range: row.file.seriesRange,
    range_provided: row.file.rangeProvided
  })), [
    "environment",
    "audit_ist",
    "item_code",
    "message",
    "differing_fields",
    "stored_division",
    "file_division",
    "stored_category",
    "file_category",
    "category_provided",
    "stored_series_range",
    "file_series_range",
    "range_provided"
  ]);
  const candidates = snapshot.filter((row) => row.category && row.category === row.series_range && RANGE_DIVISIONS.some((division) => row.division === division));
  const labels = [...new Set(candidates.map((row) => row.category))].sort();
  console.log(environment, "labels", JSON.stringify(labels));
  const combined = snapshot.filter((row) => typeof row.division === "string" && row.division.includes("|"));
  writeCSV(`${environment}-combined-division-review.csv`, combined.map((row) => ({
    environment,
    audit_ist: clock,
    ...row,
    status: "wait for combined-division prompt"
  })));
  fs.writeFileSync(path.join(out, `${environment}-range-candidates.json`), JSON.stringify(candidates, null, 2));
  console.log(
    environment,
    clock,
    "master",
    parsed.productRows.length,
    "classification",
    preview.classificationCounts,
    "refused",
    preview.rejectedRows.length,
    "differs",
    preview.classificationDifferences.length,
    "review candidates",
    candidates.length,
    "by division",
    Object.fromEntries(RANGE_DIVISIONS.map((division) => [division, candidates.filter((row) => row.division === division).length])),
    "combined",
    combined.length
  );
}
fs.writeFileSync(path.join(out, "master-preview-audit.json"), JSON.stringify(results, null, 2));
