import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { asc, sql } from "drizzle-orm";
import {
  catalogProductsTable,
  catalogSyncAuditsTable,
  codeConflictsTable,
  competitorCodeAliasesTable,
  competitorPricesTable,
  db,
  mrpHistoryProvenanceEventsTable,
  mrpLoadBatchesTable,
  mrpPriceHistoryTable,
  mrpSourcesTable,
} from "@workspace/db";

export const CATALOG_ADMIN_EMAIL = "ceo@prayagindia.com";
export const CATALOG_SYNC_CONFIRMATION = "REPLACE PRODUCTION CATALOG";
export const CATALOG_SYNC_FORMAT = "prayag-catalog-sync";
export const CATALOG_SYNC_VERSION = 1;
const PREFLIGHT_TTL_MS = 15 * 60 * 1000;

export const CATALOG_SYNC_TABLES = [
  "catalogProducts",
  "mrpSources",
  "mrpLoadBatches",
  "mrpPriceHistory",
  "mrpHistoryProvenanceEvents",
  "codeConflicts",
  "competitorPrices",
  "competitorCodeAliases",
] as const;

export type CatalogSyncTableName = (typeof CATALOG_SYNC_TABLES)[number];
export type CatalogSyncData = Record<CatalogSyncTableName, Record<string, unknown>[]>;
export type CatalogSyncCounts = Record<CatalogSyncTableName, number>;

export type CatalogSyncSummary = {
  counts: CatalogSyncCounts;
  distinctHistoryCodes: number;
  unlinkedHistoryRows: number;
  discontinuedProducts: number;
  resolvedSparshMappings: number;
};

export type CatalogSyncBundle = {
  manifest: {
    format: typeof CATALOG_SYNC_FORMAT;
    version: typeof CATALOG_SYNC_VERSION;
    createdAt: string;
    sourceEnvironment: "development";
    counts: CatalogSyncCounts;
    tableSha256: Record<CatalogSyncTableName, string>;
    payloadSha256: string;
    signature: string;
  };
  data: CatalogSyncData;
};

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value) throw new Error("SESSION_SECRET is required for catalog sync.");
  return value;
}

function signingKey(): Buffer {
  return createHmac("sha256", secret())
    .update("prayag-catalog-sync-signing-v1")
    .digest();
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sign(value: string): string {
  return createHmac("sha256", signingKey()).update(value).digest("hex");
}

function safeEqualHex(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function manifestSigningPayload(manifest: Omit<CatalogSyncBundle["manifest"], "signature">): string {
  return JSON.stringify(manifest);
}

function countData(data: CatalogSyncData): CatalogSyncCounts {
  return Object.fromEntries(
    CATALOG_SYNC_TABLES.map((table) => [table, data[table].length]),
  ) as CatalogSyncCounts;
}

function summarizeData(data: CatalogSyncData): CatalogSyncSummary {
  const historyCodes = new Set(
    data.mrpPriceHistory.map((row) => String(row.itemCode ?? "")),
  );
  return {
    counts: countData(data),
    distinctHistoryCodes: historyCodes.size,
    unlinkedHistoryRows: data.mrpPriceHistory.filter((row) => row.loadBatchId == null).length,
    discontinuedProducts: data.catalogProducts.filter(
      (row) => row.discontinuedFrom != null,
    ).length,
    resolvedSparshMappings: data.competitorPrices.filter(
      (row) =>
        row.competitor === "Sparsh Pearl" &&
        row.matchStatus === "matched" &&
        row.matchedPrayagCode != null,
    ).length,
  };
}

export function createCatalogSyncBundleFromData(data: CatalogSyncData): CatalogSyncBundle {
  const counts = countData(data);
  const tableSha256 = Object.fromEntries(
    CATALOG_SYNC_TABLES.map((table) => [table, sha256(JSON.stringify(data[table]))]),
  ) as Record<CatalogSyncTableName, string>;
  const unsignedManifest = {
    format: CATALOG_SYNC_FORMAT as typeof CATALOG_SYNC_FORMAT,
    version: CATALOG_SYNC_VERSION as typeof CATALOG_SYNC_VERSION,
    createdAt: new Date().toISOString(),
    sourceEnvironment: "development" as const,
    counts,
    tableSha256,
    payloadSha256: sha256(JSON.stringify(data)),
  };
  return {
    manifest: {
      ...unsignedManifest,
      signature: sign(manifestSigningPayload(unsignedManifest)),
    },
    data,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

type ValueValidator = (value: unknown) => boolean;

const text: ValueValidator = (value) => typeof value === "string";
const nonEmptyText: ValueValidator = (value) =>
  typeof value === "string" && value.length > 0;
const positiveInteger: ValueValidator = (value) =>
  typeof value === "number" && Number.isInteger(value) && value > 0;
const nonNegativeInteger: ValueValidator = (value) =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;
const finiteNumber: ValueValidator = (value) =>
  typeof value === "number" && Number.isFinite(value);
const bool: ValueValidator = (value) => typeof value === "boolean";
const isoDate: ValueValidator = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
};
const isoTimestamp: ValueValidator = (value) => {
  if (typeof value !== "string") return false;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(
      value,
    );
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[10] == null ? 0 : Number(match[10]);
  const offsetMinute = match[11] == null ? 0 : Number(match[11]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return (
    year >= 1000 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth[month - 1]! &&
    hour >= 0 &&
    hour <= 23 &&
    minute >= 0 &&
    minute <= 59 &&
    second >= 0 &&
    second <= 59 &&
    offsetHour >= 0 &&
    offsetHour <= 23 &&
    offsetMinute >= 0 &&
    offsetMinute <= 59 &&
    !Number.isNaN(Date.parse(value))
  );
};
const sha256Hex: ValueValidator = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
const nullable =
  (validator: ValueValidator): ValueValidator =>
  (value) =>
    value === null || validator(value);

const TABLE_SCHEMAS: Record<
  CatalogSyncTableName,
  Record<string, ValueValidator>
> = {
  catalogProducts: {
    id: positiveInteger,
    itemCode: nonEmptyText,
    productName: nullable(text),
    division: nullable(text),
    category: nullable(text),
    seriesRange: nullable(text),
    size: nullable(text),
    uom: nonEmptyText,
    kgCost: nullable(finiteNumber),
    isActive: bool,
    discontinuedFrom: nullable(isoDate),
    sourceFiles: nullable(text),
    dataFlag: nullable(text),
    createdAt: isoTimestamp,
    updatedAt: isoTimestamp,
  },
  mrpSources: {
    id: positiveInteger,
    division: nonEmptyText,
    sheetId: nonEmptyText,
    sheetUrl: nonEmptyText,
    expectedFileName: nullable(text),
    notes: nullable(text),
    sourceKind: nonEmptyText,
  },
  mrpLoadBatches: {
    id: positiveInteger,
    sourceId: positiveInteger,
    fileName: nonEmptyText,
    fileSha256: sha256Hex,
    fileSizeBytes: nonNegativeInteger,
    downloadedAt: isoDate,
    loadedAt: isoTimestamp,
    loadedBy: nullable(text),
    rowCount: nonNegativeInteger,
    notes: nullable(text),
  },
  mrpPriceHistory: {
    id: positiveInteger,
    itemCode: nonEmptyText,
    mrp: nullable(finiteNumber),
    netPrice: nullable(finiteNumber),
    discountPct: nullable(finiteNumber),
    priceBasis: nonEmptyText,
    effectiveDate: isoDate,
    loadDate: isoDate,
    sourceFile: nullable(text),
    isCurrent: bool,
    notes: nullable(text),
    reviewStatus: nonEmptyText,
    reviewReasons: nullable(text),
    importBatchId: nullable(text),
    loadBatchId: nullable(positiveInteger),
    reviewedAt: nullable(isoTimestamp),
  },
  mrpHistoryProvenanceEvents: {
    id: positiveInteger,
    historyRowId: nullable(positiveInteger),
    itemCode: nonEmptyText,
    effectiveDate: isoDate,
    action: nonEmptyText,
    reason: nullable(text),
    sourceFile: nullable(text),
    loadBatchId: nullable(positiveInteger),
    previousMrp: nullable(finiteNumber),
    mrp: nullable(finiteNumber),
    createdAt: isoTimestamp,
  },
  codeConflicts: {
    itemCode: nonEmptyText,
    conflictingNames: nullable(text),
    sources: nullable(text),
  },
  competitorPrices: {
    id: positiveInteger,
    competitor: nonEmptyText,
    category: nullable(text),
    description: nullable(text),
    size: nullable(text),
    price: nullable(finiteNumber),
    unit: nullable(text),
    competitorCode: nullable(text),
    effectiveDate: nullable(isoDate),
    matchedPrayagCode: nullable(text),
    matchStatus: nonEmptyText,
    matchConfidence: nullable(text),
    prayagMrpAtCompare: nullable(finiteNumber),
    isCurrent: bool,
    priceBasis: nullable(text),
    gstPct: nullable(finiteNumber),
    createdAt: isoTimestamp,
    updatedAt: isoTimestamp,
  },
  competitorCodeAliases: {
    id: positiveInteger,
    competitor: nonEmptyText,
    oldCode: nonEmptyText,
    newCode: nonEmptyText,
    note: nullable(text),
    createdAt: isoTimestamp,
  },
};

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    throw new Error(`${label} contains missing or unexpected fields.`);
  }
}

function assertTableSchemas(data: CatalogSyncData): void {
  for (const table of CATALOG_SYNC_TABLES) {
    const schema = TABLE_SCHEMAS[table];
    for (const [index, row] of data[table].entries()) {
      assertExactKeys(row, Object.keys(schema), `${table}[${index}]`);
      for (const [field, validator] of Object.entries(schema)) {
        if (!validator(row[field])) {
          throw new Error(`${table}[${index}].${field} has an invalid value.`);
        }
      }
    }
  }
}

function assertUnique(
  rows: Record<string, unknown>[],
  table: CatalogSyncTableName,
  field: string,
): void {
  const seen = new Set<unknown>();
  for (const row of rows) {
    if (seen.has(row[field])) {
      throw new Error(`${table} contains a duplicate ${field}.`);
    }
    seen.add(row[field]);
  }
}

function assertBundleRelationships(data: CatalogSyncData): void {
  if (data.catalogProducts.length === 0 || data.mrpPriceHistory.length === 0) {
    throw new Error("Catalog sync bundle cannot contain an empty catalog or MRP history.");
  }
  for (const table of CATALOG_SYNC_TABLES) {
    if (table !== "codeConflicts") assertUnique(data[table], table, "id");
  }
  assertUnique(data.catalogProducts, "catalogProducts", "itemCode");
  assertUnique(data.mrpSources, "mrpSources", "sheetId");

  const productCodes = new Set(data.catalogProducts.map((row) => row.itemCode));
  const sourceIds = new Set(data.mrpSources.map((row) => row.id));
  const loadBatchIds = new Set(data.mrpLoadBatches.map((row) => row.id));

  for (const [index, row] of data.mrpLoadBatches.entries()) {
    if (!sourceIds.has(row.sourceId)) {
      throw new Error(`mrpLoadBatches[${index}] refers to a missing MRP source.`);
    }
  }
  for (const [index, row] of data.mrpPriceHistory.entries()) {
    if (!productCodes.has(row.itemCode)) {
      throw new Error(`mrpPriceHistory[${index}] refers to a missing product.`);
    }
    if (row.loadBatchId != null && !loadBatchIds.has(row.loadBatchId)) {
      throw new Error(`mrpPriceHistory[${index}] refers to a missing load batch.`);
    }
  }
  // Provenance is intentionally not foreign-keyed to live catalog rows:
  // documented source corrections retain events after invalid history rows,
  // products, or superseded batches are removed.
  for (const [index, row] of data.competitorPrices.entries()) {
    if (row.matchedPrayagCode != null && !productCodes.has(row.matchedPrayagCode)) {
      throw new Error(`competitorPrices[${index}] refers to a missing product.`);
    }
  }
}

export function parseAndValidateCatalogSyncBundle(buffer: Buffer): CatalogSyncBundle {
  let raw: unknown;
  try {
    raw = JSON.parse(buffer.toString("utf8"));
  } catch {
    throw new Error("Catalog sync bundle is not valid JSON.");
  }
  if (!isRecord(raw) || !isRecord(raw.manifest) || !isRecord(raw.data)) {
    throw new Error("Catalog sync bundle is missing its manifest or data.");
  }
  assertExactKeys(raw, ["manifest", "data"], "Catalog sync bundle");
  const manifest = raw.manifest;
  const manifestCreatedAt = manifest.createdAt;
  assertExactKeys(
    manifest,
    [
      "format",
      "version",
      "createdAt",
      "sourceEnvironment",
      "counts",
      "tableSha256",
      "payloadSha256",
      "signature",
    ],
    "Catalog sync manifest",
  );
  if (
    manifest.format !== CATALOG_SYNC_FORMAT ||
    manifest.version !== CATALOG_SYNC_VERSION ||
    manifest.sourceEnvironment !== "development" ||
    typeof manifestCreatedAt !== "string" ||
    !isoTimestamp(manifestCreatedAt) ||
    !isRecord(manifest.counts) ||
    !isRecord(manifest.tableSha256) ||
    typeof manifest.payloadSha256 !== "string" ||
    typeof manifest.signature !== "string"
  ) {
    throw new Error("Catalog sync bundle manifest is unsupported.");
  }
  assertExactKeys(raw.data, CATALOG_SYNC_TABLES, "Catalog sync data");
  assertExactKeys(manifest.counts, CATALOG_SYNC_TABLES, "Catalog sync counts");
  assertExactKeys(
    manifest.tableSha256,
    CATALOG_SYNC_TABLES,
    "Catalog sync table checksums",
  );

  const data = {} as CatalogSyncData;
  for (const table of CATALOG_SYNC_TABLES) {
    const rows = raw.data[table];
    if (!Array.isArray(rows) || !rows.every(isRecord)) {
      throw new Error(`Catalog sync table ${table} is invalid.`);
    }
    data[table] = rows;
  }

  assertTableSchemas(data);
  assertBundleRelationships(data);

  const counts = countData(data);
  const tableSha256 = Object.fromEntries(
    CATALOG_SYNC_TABLES.map((table) => [table, sha256(JSON.stringify(data[table]))]),
  ) as Record<CatalogSyncTableName, string>;
  for (const table of CATALOG_SYNC_TABLES) {
    if (
      Number(manifest.counts[table]) !== counts[table] ||
      manifest.tableSha256[table] !== tableSha256[table]
    ) {
      throw new Error(`Catalog sync table ${table} failed its integrity check.`);
    }
  }
  const payloadSha256 = sha256(JSON.stringify(data));
  if (!safeEqualHex(manifest.payloadSha256, payloadSha256)) {
    throw new Error("Catalog sync payload checksum does not match.");
  }
  const unsignedManifest = {
    format: CATALOG_SYNC_FORMAT as typeof CATALOG_SYNC_FORMAT,
    version: CATALOG_SYNC_VERSION as typeof CATALOG_SYNC_VERSION,
    createdAt: manifestCreatedAt,
    sourceEnvironment: "development" as const,
    counts,
    tableSha256,
    payloadSha256,
  };
  const expectedSignature = sign(manifestSigningPayload(unsignedManifest));
  if (!safeEqualHex(manifest.signature, expectedSignature)) {
    throw new Error("Catalog sync bundle signature is invalid.");
  }
  return {
    manifest: { ...unsignedManifest, signature: manifest.signature },
    data,
  };
}

async function readCatalogSyncData(executor: any): Promise<CatalogSyncData> {
  const catalogProducts = await executor
    .select()
    .from(catalogProductsTable)
    .orderBy(asc(catalogProductsTable.id));
  const mrpSources = await executor
    .select()
    .from(mrpSourcesTable)
    .orderBy(asc(mrpSourcesTable.id));
  const mrpLoadBatches = await executor
    .select()
    .from(mrpLoadBatchesTable)
    .orderBy(asc(mrpLoadBatchesTable.id));
  const mrpPriceHistory = await executor
    .select()
    .from(mrpPriceHistoryTable)
    .orderBy(asc(mrpPriceHistoryTable.id));
  const mrpHistoryProvenanceEvents = await executor
    .select()
    .from(mrpHistoryProvenanceEventsTable)
    .orderBy(asc(mrpHistoryProvenanceEventsTable.id));
  const codeConflicts = await executor
    .select()
    .from(codeConflictsTable)
    .orderBy(asc(codeConflictsTable.itemCode));
  const competitorPrices = await executor
    .select()
    .from(competitorPricesTable)
    .orderBy(asc(competitorPricesTable.id));
  const competitorCodeAliases = await executor
    .select()
    .from(competitorCodeAliasesTable)
    .orderBy(asc(competitorCodeAliasesTable.id));

  return {
    catalogProducts,
    mrpSources,
    mrpLoadBatches,
    mrpPriceHistory,
    mrpHistoryProvenanceEvents,
    codeConflicts,
    competitorPrices,
    competitorCodeAliases,
  } as unknown as CatalogSyncData;
}

async function readConsistentCatalogSyncData(): Promise<CatalogSyncData> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`
      LOCK TABLE
        catalog_products,
        mrp_sources,
        mrp_load_batches,
        mrp_price_history,
        mrp_history_provenance_events,
        code_conflicts,
        competitor_prices,
        competitor_code_aliases
      IN SHARE MODE
    `);
    return readCatalogSyncData(tx);
  });
}

export async function exportCatalogSyncBundle(): Promise<CatalogSyncBundle> {
  return createCatalogSyncBundleFromData(await readConsistentCatalogSyncData());
}

export async function getCatalogSyncSnapshot(): Promise<{
  checksum: string;
  summary: CatalogSyncSummary;
}> {
  const data = await readConsistentCatalogSyncData();
  return {
    checksum: sha256(JSON.stringify(data)),
    summary: summarizeData(data),
  };
}

async function getCurrentCatalogSyncSummaryWith(
  executor: any,
): Promise<CatalogSyncSummary> {
  const result = await executor.execute(sql`
    SELECT
      (SELECT COUNT(*)::int FROM catalog_products) AS products,
      (SELECT COUNT(*)::int FROM mrp_price_history) AS "historyRows",
      (SELECT COUNT(DISTINCT item_code)::int FROM mrp_price_history) AS "distinctHistoryCodes",
      (SELECT COUNT(*)::int FROM mrp_price_history WHERE load_batch_id IS NULL) AS "unlinkedHistoryRows",
      (SELECT COUNT(*)::int FROM catalog_products WHERE discontinued_from IS NOT NULL) AS "discontinuedProducts",
      (SELECT COUNT(*)::int FROM mrp_sources) AS "mrpSources",
      (SELECT COUNT(*)::int FROM mrp_load_batches) AS "mrpLoadBatches",
      (SELECT COUNT(*)::int FROM mrp_history_provenance_events) AS "provenanceEvents",
      (SELECT COUNT(*)::int FROM code_conflicts) AS "codeConflicts",
      (SELECT COUNT(*)::int FROM competitor_prices) AS "competitorPrices",
      (SELECT COUNT(*)::int FROM competitor_code_aliases) AS "competitorAliases",
      (SELECT COUNT(*)::int FROM competitor_prices
       WHERE competitor = 'Sparsh Pearl'
         AND match_status = 'matched'
         AND matched_prayag_code IS NOT NULL) AS "resolvedSparshMappings"
  `) as {
    rows: Array<{
    products: number;
    historyRows: number;
    distinctHistoryCodes: number;
    unlinkedHistoryRows: number;
    discontinuedProducts: number;
    mrpSources: number;
    mrpLoadBatches: number;
    provenanceEvents: number;
    codeConflicts: number;
    competitorPrices: number;
    competitorAliases: number;
    resolvedSparshMappings: number;
    }>;
  };
  const row = result.rows[0]!;
  return {
    counts: {
      catalogProducts: row.products,
      mrpSources: row.mrpSources,
      mrpLoadBatches: row.mrpLoadBatches,
      mrpPriceHistory: row.historyRows,
      mrpHistoryProvenanceEvents: row.provenanceEvents,
      codeConflicts: row.codeConflicts,
      competitorPrices: row.competitorPrices,
      competitorCodeAliases: row.competitorAliases,
    },
    distinctHistoryCodes: row.distinctHistoryCodes,
    unlinkedHistoryRows: row.unlinkedHistoryRows,
    discontinuedProducts: row.discontinuedProducts,
    resolvedSparshMappings: row.resolvedSparshMappings,
  };
}

export async function getCurrentCatalogSyncSummary(): Promise<CatalogSyncSummary> {
  return getCurrentCatalogSyncSummaryWith(db);
}

export function summarizeCatalogSyncBundle(bundle: CatalogSyncBundle): CatalogSyncSummary {
  return summarizeData(bundle.data);
}

type PreflightPayload = {
  checksum: string;
  currentChecksum: string;
  email: string;
  expiresAt: number;
};

export function createCatalogSyncPreflightToken(
  bundle: CatalogSyncBundle,
  email: string,
  currentChecksum: string,
): string {
  const encoded = Buffer.from(
    JSON.stringify({
      checksum: bundle.manifest.payloadSha256,
      currentChecksum,
      email: email.toLowerCase(),
      expiresAt: Date.now() + PREFLIGHT_TTL_MS,
    } satisfies PreflightPayload),
  ).toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export function verifyCatalogSyncPreflightToken(
  token: string,
  bundle: CatalogSyncBundle,
  email: string,
): PreflightPayload {
  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra || !safeEqualHex(signature, sign(encoded))) {
    throw new Error("Catalog sync preflight token is invalid.");
  }
  let payload: PreflightPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new Error("Catalog sync preflight token is invalid.");
  }
  if (
    payload.checksum !== bundle.manifest.payloadSha256 ||
    !/^[a-f0-9]{64}$/i.test(payload.currentChecksum) ||
    payload.email !== email.toLowerCase() ||
    payload.expiresAt < Date.now()
  ) {
    throw new Error("Catalog sync preflight has expired or does not match this bundle.");
  }
  return payload;
}

async function insertChunks(tx: any, table: any, rows: Record<string, unknown>[]): Promise<void> {
  for (let index = 0; index < rows.length; index += 250) {
    await tx.insert(table).values(rows.slice(index, index + 250) as any);
  }
}

function reviveDates(data: CatalogSyncData): CatalogSyncData {
  const revive = (row: Record<string, unknown>, fields: string[]) => {
    const copy = { ...row };
    for (const field of fields) {
      if (typeof copy[field] === "string") copy[field] = new Date(copy[field] as string);
    }
    return copy;
  };
  return {
    catalogProducts: data.catalogProducts.map((row) => revive(row, ["createdAt", "updatedAt"])),
    mrpSources: data.mrpSources,
    mrpLoadBatches: data.mrpLoadBatches.map((row) => revive(row, ["loadedAt"])),
    mrpPriceHistory: data.mrpPriceHistory.map((row) => revive(row, ["reviewedAt"])),
    mrpHistoryProvenanceEvents: data.mrpHistoryProvenanceEvents.map((row) =>
      revive(row, ["createdAt"]),
    ),
    codeConflicts: data.codeConflicts,
    competitorPrices: data.competitorPrices.map((row) =>
      revive(row, ["createdAt", "updatedAt"]),
    ),
    competitorCodeAliases: data.competitorCodeAliases.map((row) =>
      revive(row, ["createdAt"]),
    ),
  };
}

export async function applyCatalogSyncBundle(
  bundle: CatalogSyncBundle,
  actorEmail: string,
  expectedCurrentChecksum: string,
): Promise<{
  auditId: number;
  completedAt: string;
  before: CatalogSyncSummary;
  after: CatalogSyncSummary;
}> {
  const [audit] = await db
    .insert(catalogSyncAuditsTable)
    .values({
      bundleSha256: bundle.manifest.payloadSha256,
      bundleCreatedAt: new Date(bundle.manifest.createdAt),
      actorEmail,
      status: "running",
      beforeSummary: "{}",
    })
    .returning({ id: catalogSyncAuditsTable.id });
  if (!audit) throw new Error("Catalog sync audit could not be created.");

  try {
    const data = reviveDates(bundle.data);
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`
        LOCK TABLE
          catalog_products,
          mrp_sources,
          mrp_load_batches,
          mrp_price_history,
          mrp_history_provenance_events,
          code_conflicts,
          competitor_prices,
          competitor_code_aliases
        IN ACCESS EXCLUSIVE MODE
      `);
      const currentData = await readCatalogSyncData(tx);
      const currentChecksum = sha256(JSON.stringify(currentData));
      const before = summarizeData(currentData);
      if (!safeEqualHex(currentChecksum, expectedCurrentChecksum)) {
        throw new Error(
          "Production catalog changed after preview. Preview the bundle again before applying it.",
        );
      }
      await tx
        .update(catalogSyncAuditsTable)
        .set({ beforeSummary: JSON.stringify(before) })
        .where(sql`${catalogSyncAuditsTable.id} = ${audit.id}`);

      await tx.delete(mrpHistoryProvenanceEventsTable);
      await tx.delete(mrpPriceHistoryTable);
      await tx.delete(mrpLoadBatchesTable);
      await tx.delete(mrpSourcesTable);
      await tx.delete(codeConflictsTable);
      await tx.delete(competitorCodeAliasesTable);
      await tx.delete(competitorPricesTable);
      await tx.delete(catalogProductsTable);

      await insertChunks(tx, catalogProductsTable, data.catalogProducts);
      await insertChunks(tx, mrpSourcesTable, data.mrpSources);
      await insertChunks(tx, mrpLoadBatchesTable, data.mrpLoadBatches);
      await insertChunks(tx, mrpPriceHistoryTable, data.mrpPriceHistory);
      await insertChunks(
        tx,
        mrpHistoryProvenanceEventsTable,
        data.mrpHistoryProvenanceEvents,
      );
      await insertChunks(tx, codeConflictsTable, data.codeConflicts);
      await insertChunks(tx, competitorPricesTable, data.competitorPrices);
      await insertChunks(tx, competitorCodeAliasesTable, data.competitorCodeAliases);

      await tx.execute(sql`UPDATE mrp_price_history SET is_current = false`);
      await tx.execute(sql`
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
      await tx.execute(sql`UPDATE competitor_prices SET is_current = false`);
      await tx.execute(sql`
        UPDATE competitor_prices c
        SET is_current = true
        WHERE c.id IN (
          SELECT DISTINCT ON (competitor, matched_prayag_code) id
          FROM competitor_prices
          WHERE matched_prayag_code IS NOT NULL
            AND effective_date <= CURRENT_DATE
          ORDER BY competitor, matched_prayag_code, effective_date DESC NULLS LAST, id DESC
        )
      `);
      await tx.execute(sql`
        UPDATE competitor_prices c
        SET is_current = true
        WHERE matched_prayag_code IS NULL
          AND effective_date <= CURRENT_DATE
          AND effective_date = (
            SELECT MAX(c2.effective_date)
            FROM competitor_prices c2
            WHERE c2.competitor = c.competitor
              AND c2.matched_prayag_code IS NULL
              AND c2.effective_date <= CURRENT_DATE
          )
      `);

      for (const table of [
        "catalog_products",
        "mrp_sources",
        "mrp_load_batches",
        "mrp_price_history",
        "mrp_history_provenance_events",
        "competitor_prices",
        "competitor_code_aliases",
      ]) {
        await tx.execute(
          sql.raw(
            `SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 1), (SELECT COUNT(*) > 0 FROM ${table}))`,
          ),
        );
      }

      const after = await getCurrentCatalogSyncSummaryWith(tx);
      const completedAt = new Date();
      await tx
        .update(catalogSyncAuditsTable)
        .set({
          status: "succeeded",
          afterSummary: JSON.stringify(after),
          completedAt,
        })
        .where(sql`${catalogSyncAuditsTable.id} = ${audit.id}`);
      return { before, after, completedAt };
    });
    return {
      auditId: audit.id,
      completedAt: result.completedAt.toISOString(),
      before: result.before,
      after: result.after,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown catalog sync failure";
    try {
      await db
        .update(catalogSyncAuditsTable)
        .set({
          status: "failed",
          errorMessage: message.slice(0, 2000),
          completedAt: new Date(),
        })
        .where(sql`${catalogSyncAuditsTable.id} = ${audit.id}`);
    } catch (auditError) {
      console.error("Catalog sync failure audit could not be updated", auditError);
    }
    throw error;
  }
}
