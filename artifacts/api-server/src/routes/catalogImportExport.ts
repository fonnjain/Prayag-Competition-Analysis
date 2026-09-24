import { Router, type IRouter } from "express";
import { createHash, randomUUID } from "node:crypto";
import multer from "multer";
import * as XLSX from "xlsx";
import AdmZip from "adm-zip";
import { and, eq, asc, desc, gt, inArray, lte, sql } from "drizzle-orm";
import {
  db,
  catalogProductsTable,
  mrpPriceHistoryTable,
  competitorPricesTable,
  mrpSourcesTable,
  mrpLoadBatchesTable,
  mrpPendingBatchesTable,
  mrpHistoryProvenanceEventsTable,
  importBatchesTable,
  competitorPriceStagingTable,
  competitorMappingDecisionsTable,
  catalogProductClassificationCorrectionsTable,
  apolloReservationsTable,
} from "@workspace/db";
import {
  recomputeCurrentFlags,
  recomputeCurrentFlagsInTransaction,
  recomputeCompetitorCurrentFlagsInTransaction,
  normCode,
  type DatabaseTransaction,
} from "../lib/catalog";
import { requireAdmin } from "../middlewares/authMiddleware";
import { effectivePrice } from "../lib/analysis";
import { deriveConfirmedDiscontinuations } from "../lib/discontinuationPolicy";
import {
  ensureHardwareReplacementSnapshot,
  ensureOfficialMrpSources,
  isIsoDate,
  sha256ForBuffer,
  AUTHORITATIVE_MASTER_SOURCE,
} from "../lib/mrpProvenance";
import {
  isAuthoritativeMasterBuffer,
  loadAuthoritativeMaster,
  parseAuthoritativeMasterBuffer,
  type ParsedAuthoritativeMaster,
} from "../lib/authoritativeMrpMaster";
import { derivePriceHistoryStatuses } from "../lib/priceHistoryStatus";
import {
  isPrinceCompetitorMasterWorkbook,
  normalizePrinceCode,
  parsePrinceCompetitorMaster,
  classifyPrinceDuplicateAnomalies,
  PRINCE_COMPETITOR,
  PRINCE_EFFECTIVE_DATE,
} from "../lib/princeMaster";
import { parseApolloMaster, type ApolloMasterParse } from "../lib/apolloMaster";
import { apolloPipeIdentityV2 } from "../lib/apolloPipeIdentity";

// Price-gap guardrail for auto-matched competitor imports. A correct match
// between equivalent products has a realistic gap; a gap far outside this band
// (e.g. a big assembly matched to a tiny fitting, or per-box vs per-pc) almost
// always means the wrong products were linked, so we send it to manual review
// instead of trusting the match. Gap% = (competitorEffectivePrice - prayagMrp)
// / prayagMrp * 100 (positive = competitor more expensive than Prayag).
const GAP_MIN_PCT = -80;
const GAP_MAX_PCT = 100;

const router: IRouter = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

const PENDING_MRP_BATCH_LIFETIME_MS = 24 * 60 * 60 * 1000;
const NEW_PRODUCTS_SOURCE = {
  division: "New Products Upload",
  sheetId: "__new_products_upload__",
  sheetUrl: "internal://new-products-upload",
  expectedFileName: null,
  notes: "Prayag-only product creation uploads. Existing codes are rejected.",
  sourceKind: "new_products",
} as const;

const P029_CLASSIFICATION_SOURCE = {
  division: "P029 UGD Classification",
  sheetId: "__p029_ugd_classification__",
  sheetUrl: "internal://p029-ugd-classification",
  expectedFileName: "P029 UGD Self Fit classification repair",
  notes: "P029 classification-only sibling copy; never writes price, name, or mappings.",
  sourceKind: "manual_correction",
} as const;
const P029_CLASSIFICATION_FILE_HASH = createHash("sha256")
  .update("P029|UGD Self Fit classification sibling-copy contract|v1")
  .digest("hex");

const P029_PAIRS = [
  ["U-11C", "U-11CS"], ["U-12C", "U-12CS"], ["U-13C", "U-13CS"],
  ["U-14C", "U-14CS"], ["U-15C", "U-15CS"], ["U-16C", "U-16CS"],
  ["U-11B", "U-11BS"], ["U-12B", "U-12BS"], ["U-13B", "U-13BS"],
  ["U-14B", "U-14BS"],
] as const;
const P029_EXPECTED_MRPS: Record<string, number> = {
  "U-11C": 2987, "U-12C": 4582, "U-13C": 6322, "U-14C": 10005, "U-15C": 15805, "U-16C": 25230,
  "U-11B": 2196, "U-12B": 2896, "U-13B": 4790, "U-14B": 7368,
  "U-11CS": 2987, "U-12CS": 4582, "U-13CS": 6322, "U-14CS": 10005, "U-15CS": 15805, "U-16CS": 25230,
  "U-11BS": 2196, "U-12BS": 2896, "U-13BS": 4790, "U-14BS": 7368,
};
const P029_CLASSIFICATION_FIELDS = [
  "division", "category", "seriesRange", "size", "uom", "kgCost",
] as const;
type P029Classification = Pick<typeof catalogProductsTable.$inferSelect, typeof P029_CLASSIFICATION_FIELDS[number]>;

export interface NewProductRow {
  itemCode: string;
  division: string;
  series: string | null;
  seriesRange?: string | null;
  productName: string;
  size: string | null;
  mrp: number;
  effectiveDate: string;
  row: number;
}

function newProductHeaderKey(value: unknown): string {
  return norm(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function previewReason(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function newProductDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return `${String(parsed.y).padStart(4, "0")}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
    }
  }
  const text = norm(value);
  if (!text) return null;
  const iso = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (iso) {
    const candidate = `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
    return isIsoDate(candidate) ? candidate : null;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

export function parseNewProductsWorkbook(buffer: Buffer): {
  rows: NewProductRow[];
  rejectedRows: Array<{ row: number; itemCode: string | null; reason: string }>;
} {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const rows: NewProductRow[] = [];
  const rejectedRows: Array<{ row: number; itemCode: string | null; reason: string }> = [];
  let foundHeaders = false;
  const aliases: Record<string, string[]> = {
    itemCode: ["itemcode", "catno", "catnumber", "productcode"],
    division: ["division"],
    series: ["seriesrange", "series", "range"],
    productName: ["productname", "product"],
    size: ["size"],
    mrp: ["mrp", "mrpw.e.f", "mrpw.eff", "mrpwith effect"],
    effectiveDate: ["priceinforcesince", "effectiveDate", "inforcesince"],
  };
  for (const sheetName of workbook.SheetNames) {
    const grid = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
      header: 1,
      defval: null,
      raw: true,
    });
    if (!grid.some((row) => row.some((cell) => norm(cell))) || foundHeaders) continue;
    let headerRow = -1;
    let columns = new Map<string, number>();
    for (let index = 0; index < Math.min(grid.length, 20); index += 1) {
      const candidate = new Map<string, number>();
      (grid[index] ?? []).forEach((cell, column) => {
        const key = newProductHeaderKey(cell);
        for (const [name, accepted] of Object.entries(aliases)) {
          if (accepted.some((alias) => key === newProductHeaderKey(alias) || key.startsWith(newProductHeaderKey(alias)))) {
            candidate.set(name, column);
          }
        }
      });
      if (
        ["itemCode", "division", "series", "productName", "size", "mrp", "effectiveDate"]
          .every((name) => candidate.has(name))
      ) {
        headerRow = index;
        columns = candidate;
        break;
      }
    }
    if (headerRow < 0) continue;
    foundHeaders = true;
    for (let index = headerRow + 1; index < grid.length; index += 1) {
      const input = grid[index] ?? [];
      if (!input.some((cell) => norm(cell))) continue;
      const itemCode = norm(input[columns.get("itemCode")!]) || null;
      const division = norm(input[columns.get("division")!]);
      const series = norm(input[columns.get("series")!]) || null;
      const productName = norm(input[columns.get("productName")!]);
      const size = norm(input[columns.get("size")!]) || null;
      const rawMrp = input[columns.get("mrp")!];
      const mrp = typeof rawMrp === "number" ? rawMrp : Number(String(rawMrp ?? "").replace(/[,₹Rs\s]/gi, ""));
      const effectiveDate = newProductDate(input[columns.get("effectiveDate")!]);
      const reason =
        !itemCode ? "Missing item code." :
        !division ? "Missing division." :
        !productName ? "Missing product name." :
        !Number.isFinite(mrp) || mrp <= 0 ? "MRP must be a positive number." :
        !effectiveDate ? "Effective date must be a valid date." :
        null;
      if (reason) {
        rejectedRows.push({ row: index + 1, itemCode, reason });
      } else {
        rows.push({ itemCode: itemCode!, division, series, seriesRange: series, productName, size, mrp, effectiveDate: effectiveDate!, row: index + 1 });
      }
    }
  }
  if (!foundHeaders) throw new Error("Workbook must contain all seven columns: item_code, division, series, product_name, size, mrp, and effective_date.");
  return { rows, rejectedRows };
}

function newProductsResponse(batch: typeof mrpPendingBatchesTable.$inferSelect) {
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
    result: batch.result ? JSON.parse(batch.result) : null,
  };
}

const P019_PRINCE_REMAP: Record<string, string> = {
  SIM200965: "U-11CS",
  SIM200960: "U-13CS",
  SIM200961: "U-14CS",
  SIM200962: "U-15CS",
  SIM200963: "U-16CS",
  SIM200955: "U-13BS",
  SIM200956: "U-14BS",
};

export async function applyP019PrinceRematch(
  tx: DatabaseTransaction,
  createdRows: NewProductRow[],
  today: string,
) {
  const createdCodes = new Set(createdRows.map((row) => normCode(row.itemCode)));
  const products = await tx.select({
    itemCode: catalogProductsTable.itemCode,
    isActive: catalogProductsTable.isActive,
    discontinuedFrom: catalogProductsTable.discontinuedFrom,
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
    reviewReason: competitorPriceStagingTable.reviewReason,
  }).from(competitorPriceStagingTable).where(and(
    eq(competitorPriceStagingTable.competitor, "Prince"),
    eq(competitorPriceStagingTable.status, "needs_review"),
    sql`${competitorPriceStagingTable.matchedPrayagCode} IS NULL`,
    eq(competitorPriceStagingTable.reviewReason, "No verified Prayag product match."),
  ));
  const batches = await tx.select({
    id: importBatchesTable.id,
    effectiveDate: importBatchesTable.effectiveDate,
  }).from(importBatchesTable).where(inArray(importBatchesTable.id, [...new Set(candidates.map((row) => row.batchId))]));
  const batchDate = new Map(batches.map((row) => [row.id, row.effectiveDate]));
  const affectedCandidateBatchIds = new Set(candidates.map((row) => row.batchId));
  const moved: Array<{ competitorCode: string; prayagCode: string; batchId: number }> = [];
  const affectedBatchIds = new Set<number>();
  for (const row of candidates) {
    const masterCode = normCode(row.competitorCodeMaster);
    const catalogueCode = normCode(row.competitorCodeCatalogue);
    const rawCompetitorCode = P019_PRINCE_REMAP[masterCode]
      ? masterCode
      : catalogueCode;
    const mappedCode = P019_PRINCE_REMAP[masterCode] ?? P019_PRINCE_REMAP[catalogueCode];
    if (!mappedCode || !createdCodes.has(normCode(mappedCode))) continue;
    const product = canonicalProduct.get(normCode(mappedCode));
    const effectiveDate = batchDate.get(row.batchId) ?? today;
    const activeOnDate = product?.isActive && (!product.discontinuedFrom || product.discontinuedFrom > effectiveDate);
    if (!product || !activeOnDate) continue;
    const targetDate = effectiveDate < today ? effectiveDate : today;
    const history = await tx.select({
      mrp: mrpPriceHistoryTable.mrp,
    }).from(mrpPriceHistoryTable).where(and(
      eq(mrpPriceHistoryTable.itemCode, product.itemCode),
      eq(mrpPriceHistoryTable.variant, "Standard"),
      eq(mrpPriceHistoryTable.reviewStatus, "approved"),
      lte(mrpPriceHistoryTable.effectiveDate, targetDate),
    )).orderBy(desc(mrpPriceHistoryTable.effectiveDate), desc(mrpPriceHistoryTable.id)).limit(1);
    const prayagMrp = history[0]?.mrp ?? null;
    const competitorPrice = row.newMrp ?? row.oldMrp;
    const gapPct = prayagMrp != null && competitorPrice != null && prayagMrp !== 0
      ? ((competitorPrice - prayagMrp) / prayagMrp) * 100
      : null;
    await tx.update(competitorPriceStagingTable).set({
      matchedPrayagCode: product.itemCode,
      status: "ok",
      matchMethod: "trusted_prince_master_p019",
      reviewReason: null,
      prayagMrpCurrent: prayagMrp,
      gapPct,
    }).where(eq(competitorPriceStagingTable.id, row.id));
    moved.push({ competitorCode: rawCompetitorCode, prayagCode: product.itemCode, batchId: row.batchId });
    affectedBatchIds.add(row.batchId);
  }
  if (affectedBatchIds.size) {
    for (const batchId of affectedBatchIds) {
      const counts = await tx.select({
        status: competitorPriceStagingTable.status,
        count: sql<number>`count(*)::int`,
      }).from(competitorPriceStagingTable).where(eq(competitorPriceStagingTable.batchId, batchId)).groupBy(competitorPriceStagingTable.status);
      const [batch] = await tx.select({ rowCounts: importBatchesTable.rowCounts }).from(importBatchesTable).where(eq(importBatchesTable.id, batchId)).limit(1);
      const prior = batch?.rowCounts ? JSON.parse(batch.rowCounts) as Record<string, unknown> : {};
      const next: Record<string, unknown> = { ...prior, ok: 0, needs_review: 0, not_found: 0, new_products: 0 };
      for (const count of counts) {
        if (count.status in next) next[count.status] = count.count;
      }
      await tx.update(importBatchesTable).set({ rowCounts: JSON.stringify(next) }).where(eq(importBatchesTable.id, batchId));
    }
  }
  const remaining = affectedCandidateBatchIds.size === 0 ? [] : await tx.select({
    batchId: competitorPriceStagingTable.batchId,
    competitorCodeMaster: competitorPriceStagingTable.competitorCodeMaster,
    competitorCodeCatalogue: competitorPriceStagingTable.competitorCodeCatalogue,
    matchedPrayagCode: competitorPriceStagingTable.matchedPrayagCode,
    status: competitorPriceStagingTable.status,
  }).from(competitorPriceStagingTable).where(and(
    eq(competitorPriceStagingTable.competitor, "Prince"),
    eq(competitorPriceStagingTable.status, "needs_review"),
    inArray(competitorPriceStagingTable.batchId, [...affectedCandidateBatchIds]),
  ));
  return {
    movedCount: moved.length,
    byCompetitor: { Prince: moved },
    remainingNeedsReview: remaining.map((row) => ({
      batchId: row.batchId,
      competitorCode: normCode(row.competitorCodeMaster ?? row.competitorCodeCatalogue),
      prayagCode: row.matchedPrayagCode,
      status: row.status,
    })),
  };
}

export function pendingAuthoritativePreview(
  parsed: ParsedAuthoritativeMaster,
  products: { itemCode: string; productName: string | null; discontinuedFrom: string | null }[],
  history: { itemCode: string; effectiveDate: string; mrp: number | null; variant: string }[],
) {
  const today = new Date().toISOString().slice(0, 10);
  const productsByCode = new Map(products.map((row) => [normCode(row.itemCode), row]));
  const fileCodes = new Set(parsed.productRows.map((row) => normCode(row.itemCode)));
  const knownPeriods = new Set(history.map((row) => row.effectiveDate));
  const currentByCode = new Map<string, { mrp: number | null; effectiveDate: string }>();
  for (const row of history) {
    if (row.variant !== "Standard" || row.effectiveDate > today) continue;
    const code = normCode(row.itemCode);
    const prior = currentByCode.get(code);
    if (!prior || row.effectiveDate > prior.effectiveDate) {
      currentByCode.set(code, { mrp: row.mrp, effectiveDate: row.effectiveDate });
    }
  }
  const allPastPriceChanges = parsed.productRows
    .filter((row) => productsByCode.has(normCode(row.itemCode)) && row.effectiveDate <= today)
    .flatMap((row) => {
      const old = currentByCode.get(normCode(row.itemCode));
      return old && old.mrp !== row.mrp
        ? [{ itemCode: row.itemCode, productName: productsByCode.get(normCode(row.itemCode))?.productName ?? null, oldMrp: old.mrp, newMrp: row.mrp, effectiveDate: row.effectiveDate, delta: row.mrp - (old.mrp ?? 0) }]
        : [];
    })
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const immediatePriceChanges = allPastPriceChanges.filter(
    (row) =>
      currentByCode.get(normCode(row.itemCode))?.effectiveDate !==
      row.effectiveDate,
  );
  const existingPeriodPriceRevisions = allPastPriceChanges.filter(
    (row) =>
      currentByCode.get(normCode(row.itemCode))?.effectiveDate ===
      row.effectiveDate,
  );
  const periods = Object.entries(parsed.periodCounts)
    .map(([effectiveDate, rowCount]) => ({
      effectiveDate, rowCount, isNew: !knownPeriods.has(effectiveDate),
      movedInCount: parsed.productRows.filter((row) => row.effectiveDate === effectiveDate && currentByCode.get(normCode(row.itemCode))?.effectiveDate !== effectiveDate).length,
    }))
    .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
  const rejectedReasonSummary: Record<string, number> = {};
  return {
    kind: "authoritative-master",
    rowsToWrite: parsed.priceRows.length,
    productRows: parsed.productRows.length,
    priceRows: parsed.priceRows.length,
    periods,
    immediatePriceChanges,
    immediatePriceChangeCount: immediatePriceChanges.length,
    existingPeriodPriceRevisions,
    existingPeriodPriceRevisionCount: existingPeriodPriceRevisions.length,
    newProducts: parsed.productRows.filter((row) => !productsByCode.has(normCode(row.itemCode))).map((row) => ({ itemCode: row.itemCode, productName: row.productName })),
    catalogueProductsAbsentFromFile: products.filter((row) => !fileCodes.has(normCode(row.itemCode))).map((row) => row.itemCode),
    discontinuations: (() => {
      const changed = parsed.discontinuedRows.filter(
        (row) =>
          productsByCode.get(normCode(row.itemCode))?.discontinuedFrom !==
          row.discontinuedFrom,
      );
      return {
        total: changed.length,
        immediate: changed.filter((row) => row.discontinuedFrom <= today).length,
        future: changed.filter((row) => row.discontinuedFrom > today).length,
      };
    })(),
    protectedNameConflicts: parsed.preservedNameDisagreements,
    rejectedRows: [],
    rejectedReasonSummary,
    canApply: parsed.priceRows.length > 0,
    noChangeReason: parsed.priceRows.length ? null : "No valid rows would be written.",
  };
}

const NET_KEYWORDS = ["net", "rate", "dealer", "scheme", "billing", "discount"];
const MRP_KEYWORDS = ["mrp", "list", "retail", "price"];

// Headers that identify packing, quantity, or measurement columns — these must
// never be used as the price column when loading Prayag MRP. A nearby numeric
// weight or pcs/box value is a particularly dangerous fallback because it
// looks like a valid price to the spreadsheet parser.
const PACKING_EXCLUDE_KEYWORDS = [
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
  "volume",
];

// Sheet names that hold packing data — skip entirely when loading Prayag MRP.
const PACKING_SHEET_RE = /\bpacking\b/i;
// Sheet names that hold master pricing data — prefer these over other sheets.
const MASTER_SHEET_RE = /\bmaster\b/i;

function norm(s: unknown): string {
  return String(s ?? "").trim();
}

interface ParsedRow {
  itemCode: string;
  price: number;
  productName: string | null;
  category: string | null;
  /** Required when the source sheet carries a dated price column. */
  effectiveDate?: string;
  /** 'Standard' for the base article; colour name for sanitaryware colour variants. */
  variant?: string;
}

interface SourcePriceObservation {
  itemCode: string;
  isRemoved: boolean;
  effectiveDate?: string;
}

export interface SkippedRow {
  rawCode: string;
  rawPrice: string;
  reason: string;
}

interface ParseResult {
  rows: ParsedRow[];
  sourcePriceObservations: SourcePriceObservation[];
  basis: string;
  codeCol: number;
  priceCol: number;
  nameCol: number;
  categoryCol: number;
  codeColHeader: string;
  priceColHeader: string;
  skippedRows: SkippedRow[];
  hasHeaderPeriods: boolean;
  warnings: string[];
}

interface DiscontinuationCorrectionManifest {
  unmarkedCodes: string[];
  confirmed: { itemCode: string; discontinuedFrom: string }[];
}

/**
 * Recognizes the authoritative correction workbook produced from range/code
 * sources. A code that appears in both sheets stays live: the grouped policy
 * requires every occurrence to be REMOVED before it becomes discontinued.
 */
function parseDiscontinuationCorrectionWorkbook(
  workbook: XLSX.WorkBook,
): DiscontinuationCorrectionManifest | null {
  const unmarkSheet = workbook.Sheets["1_UNMARK_not_discontinued"];
  const confirmedSheet = workbook.Sheets["2_Confirmed_discontinued"];
  if (!unmarkSheet || !confirmedSheet) return null;

  const unmarkedCodes = XLSX.utils
    .sheet_to_json<Record<string, unknown>>(unmarkSheet, { defval: null })
    .map((row) => String(row.item_code ?? "").trim())
    .filter(Boolean);
  const confirmedRows = XLSX.utils
    .sheet_to_json<Record<string, unknown>>(confirmedSheet, { defval: null })
    .map((row) => ({
      itemCode: String(row.item_code ?? "").trim(),
      discontinuedFrom: String(row.discontinued_from ?? "").trim(),
    }))
    .filter(
      (row) =>
        row.itemCode.length > 0 &&
        /^\d{4}-\d{2}-\d{2}$/.test(row.discontinuedFrom),
    );

  if (!unmarkedCodes.length || !confirmedRows.length) {
    throw new Error("The discontinuation correction workbook has no usable rows.");
  }

  const confirmed = deriveConfirmedDiscontinuations([
    ...unmarkedCodes.map((itemCode) => ({
      itemCode,
      markerPeriod: null,
      latestPricedPeriod: null,
      isRemoved: false,
    })),
    ...confirmedRows.map((row) => ({
      itemCode: row.itemCode,
      markerPeriod: row.discontinuedFrom,
      latestPricedPeriod: null,
      isRemoved: true,
    })),
  ]);

  if (confirmed.length !== confirmedRows.length) {
    throw new Error(
      "The correction workbook has overlapping live and removed codes; resolve them by code before importing.",
    );
  }

  return { unmarkedCodes, confirmed };
}

async function applyDiscontinuationCorrection(
  manifest: DiscontinuationCorrectionManifest,
): Promise<void> {
  await db.transaction(async (tx) => {
    // The manifest is complete, so clear prior flags before applying only
    // confirmed, code-grouped withdrawals. This makes re-import idempotent.
    await tx
      .update(catalogProductsTable)
      .set({ discontinuedFrom: null, updatedAt: new Date() });
    for (let index = 0; index < manifest.confirmed.length; index += 500) {
      for (const row of manifest.confirmed.slice(index, index + 500)) {
        await tx
          .update(catalogProductsTable)
          .set({
            discontinuedFrom: row.discontinuedFrom,
            updatedAt: new Date(),
          })
          .where(eq(catalogProductsTable.itemCode, row.itemCode));
      }
    }
  });
  await recomputeCurrentFlags();
}

function parsePeriodHeader(value: unknown): string | null {
  const text = norm(value)
    .replace(/(\d{1,2})(st|nd|rd|th)\b/gi, "$1")
    .replace(/\s+/g, " ");
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const match = text.match(
    /^(\d{1,2})\s*[-,/ ]\s*(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s*,?\s*(\d{4})$/i,
  );
  if (!match) return null;
  const months: Record<string, string> = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  };
  const month = months[match[2].slice(0, 3).toLowerCase()];
  if (!month) return null;
  return `${match[3]}-${month}-${match[1].padStart(2, "0")}`;
}

function hasResolvablePeriodHeader(grid: unknown[][]): boolean {
  return grid.slice(0, 15).some((row) => row.some((cell) => !!parsePeriodHeader(cell)));
}

function parseSheet(
  grid: unknown[][],
  knownCodes: Set<string>,
  requireHeaderPeriod: boolean,
): ParseResult {
  const maxCols = Math.max(0, ...grid.map((r) => r.length));

  // Detect header row: first row with several non-numeric string cells.
  let headerRow = 0;
  for (let r = 0; r < Math.min(grid.length, 15); r++) {
    const strs = (grid[r] ?? []).filter(
      (v) => typeof v === "string" && norm(v).length > 0 && isNaN(Number(v)),
    );
    if (strs.length >= 2) {
      headerRow = r;
      break;
    }
  }
  const rawHeaders = (grid[headerRow] ?? []).map((h) => norm(h));
  const headers = rawHeaders.map((h) => h.toLowerCase());

  // Columns whose headers signal serial numbers — never treat as item codes.
  const SERIAL_HEADER_TOKENS = ["s.no", "sno", "sr.no", "sl.no", "sr.", "sl.", "serial"];
  const isSerialHeader = (c: number) => {
    const h = (headers[c] ?? "").replace(/\s+/g, "").toLowerCase();
    if (h === "no" || h === "no." || h === "#") return true;
    return SERIAL_HEADER_TOKENS.some((t) => h === t || h.startsWith(t));
  };

  // Returns true when most non-empty data values in column c are consecutive
  // small integers — i.e. the column is a serial/row-number column.
  const isSequentialIntColumn = (c: number): boolean => {
    const nums: number[] = [];
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

  // Columns whose headers are measurement/dimension labels — not item codes.
  const DIMENSION_TOKENS = ["size", "length", "width", "height", "dia", "weight", "capacity"];
  const isDimensionHeader = (c: number) => {
    const h = (headers[c] ?? "").toLowerCase();
    return DIMENSION_TOKENS.some((t) => h.includes(t));
  };

  // Code column: prefer keyword-identified column first, then overlap.
  // Priority 1 — explicit code-column header ("code", "item code", "cat no.", etc.)
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
  // Priority 2 — looser keyword fallback ("code" or "item" in header)
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
  // Priority 3 — overlap scan (excluding serial, dimension, and sequential-int columns)
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
      warnings: [],
    };
  }

  // Price column: require an explicit price header. Never fall back to the
  // first mostly-numeric column: in PEA-style sheets that is often weight,
  // pack size, or pcs/box rather than MRP.
  // Columns whose headers indicate packing quantities or measurements are
  // always excluded, even when they also contain a price-like word.
  const isPackingHeader = (h: string) => {
    const normalizedHeader = h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const headerTokens = new Set(normalizedHeader.split(/\s+/).filter(Boolean));
    return PACKING_EXCLUDE_KEYWORDS.some((keyword) =>
      headerTokens.has(keyword),
    );
  };
  const warnings: string[] = [];

  let netCol = -1;
  // Two-pass MRP scan: pass 1 looks for "new mrp" / "new" + mrp keyword (preferred);
  // pass 2 accepts any mrp keyword that doesn't have "old" in it; pass 3 accepts
  // any mrp keyword (including "old mrp") as a last resort.
  let mrpCol = -1;
  let newMrpCol = -1;  // explicit "new mrp" column
  let oldMrpCol = -1;  // "old mrp" fallback

  for (let c = 0; c < maxCols; c++) {
    if (c === codeCol) continue;
    const h = headers[c] ?? "";
    if (isPackingHeader(h)) continue;  // never pick a packing column
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
  // Priority: explicit "new mrp" > generic mrp > "old mrp" > net
  const bestMrpCol = newMrpCol !== -1 ? newMrpCol : mrpCol !== -1 ? mrpCol : oldMrpCol;
  let priceCol = bestMrpCol !== -1 ? bestMrpCol : netCol;
  let basis = bestMrpCol !== -1 ? "MRP" : netCol !== -1 ? "Net" : "Verify";
  // Name column: look for description/product-name keywords.
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
  // Looser fallback: header contains "desc" or "product"
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

  // Category column: look for "category", "type", "group", "series" keywords.
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
  const datedPriceCols = rawHeaders
    .map((header, col) => ({ col, effectiveDate: parsePeriodHeader(header) }))
    .filter(
      (entry): entry is { col: number; effectiveDate: string } =>
        entry.col !== codeCol && entry.effectiveDate !== null,
    );

  if (datedPriceCols.length > 0) {
    const datedRows: ParsedRow[] = [];
    const datedSkipped: SkippedRow[] = [];
    const sourcePriceObservations: SourcePriceObservation[] = [];
    for (let r = 0; r < grid.length; r++) {
      if (r === headerRow) continue;
      const row = grid[r] ?? [];
      const code = normCode(row[codeCol]);
      if (!code) continue;
      const productName = nameCol !== -1 ? (norm(row[nameCol]) || null) : null;
      const category = categoryCol !== -1 ? (norm(row[categoryCol]) || null) : null;
      for (const { col, effectiveDate } of datedPriceCols) {
        const rawPrice = norm(row[col]);
        if (!rawPrice || rawPrice === "-") continue;
        if (/^removed$/i.test(rawPrice)) {
          sourcePriceObservations.push({ itemCode: code, isRemoved: true, effectiveDate });
          datedSkipped.push({ rawCode: code, rawPrice, reason: "Marked REMOVED in source" });
          continue;
        }
        const price = Number(String(row[col]).replace(/,/g, ""));
        if (isNaN(price) || price <= 0) {
          datedSkipped.push({ rawCode: code, rawPrice, reason: "Price is not a positive number" });
          continue;
        }
        sourcePriceObservations.push({ itemCode: code, isRemoved: false, effectiveDate });
        datedRows.push({ itemCode: code, price, productName, category, effectiveDate });
      }
    }
    return {
      rows: datedRows,
      sourcePriceObservations,
      basis: "MRP",
      codeCol,
      priceCol: datedPriceCols[0]?.col ?? -1,
      nameCol,
      categoryCol,
      codeColHeader,
      priceColHeader: datedPriceCols.map(({ col }) => rawHeaders[col]).join(", "),
      skippedRows: datedSkipped,
      hasHeaderPeriods: true,
      warnings,
    };
  }

  // Sanitaryware variant detection: look for colour sub-headers before falling
  // back to the single-price-column path. 'White' maps to 'Standard' (the base
  // article) so the new rows align with existing schema defaults. Requires ≥2
  // matching headers before entering variant mode, to avoid false positives.
  const SANITARYWARE_VARIANTS = new Map([
    ["white", "Standard"],
    ["ivory", "Ivory"],
    ["white with jet", "White with Jet"],
    ["pink / green / blue", "Pink / Green / Blue"],
    ["pink/green/blue", "Pink / Green / Blue"],
  ]);
  const variantCols: { col: number; variant: string }[] = [];
  for (let c = 0; c < maxCols; c++) {
    if (c === codeCol) continue;
    const h = (headers[c] ?? "").toLowerCase().trim();
    const variantName = SANITARYWARE_VARIANTS.get(h);
    if (variantName !== undefined) variantCols.push({ col: c, variant: variantName });
  }

  if (variantCols.length >= 2) {
    // Multi-variant mode: emit one ParsedRow per (item_code, variant) for each
    // non-empty price cell. Empty cells mean the variant is not offered — no row.
    const variantRows: ParsedRow[] = [];
    const variantSkipped: SkippedRow[] = [];
    const sourcePriceObservations: SourcePriceObservation[] = [];
    for (let r = 0; r < grid.length; r++) {
      if (r === headerRow) continue;
      const row = grid[r] ?? [];
      const code = normCode(row[codeCol]);
      if (!code) continue;
      const productName = nameCol !== -1 ? (norm(row[nameCol]) || null) : null;
      const category = categoryCol !== -1 ? (norm(row[categoryCol]) || null) : null;
      for (const { col, variant } of variantCols) {
        const rawPrice = row[col];
        if (rawPrice == null || rawPrice === "") continue; // not offered for this variant
        if (/^removed$/i.test(norm(rawPrice))) {
        sourcePriceObservations.push({ itemCode: code, isRemoved: true });
          variantSkipped.push({
            rawCode: code,
            rawPrice: norm(rawPrice),
            reason: "Marked REMOVED in source",
          });
          continue;
        }
        const price = Number(rawPrice);
        if (isNaN(price) || price <= 0) {
          variantSkipped.push({ rawCode: code, rawPrice: norm(rawPrice), reason: "Price is zero or negative" });
          continue;
        }
        sourcePriceObservations.push({ itemCode: code, isRemoved: false });
        variantRows.push({ itemCode: code, price, productName, category, variant });
      }
    }
    return {
      rows: variantRows,
      sourcePriceObservations,
      basis: "MRP",
      codeCol,
      priceCol: variantCols[0]?.col ?? -1,
      nameCol,
      categoryCol,
      codeColHeader,
      priceColHeader: "Variant MRP",
      skippedRows: variantSkipped,
      hasHeaderPeriods: false,
      warnings,
    };
  }

  if (priceCol === -1) {
    warnings.push(
      "No explicit MRP, price, Net, or rate column was found. Numeric pack, weight, quantity, or dimension columns were not selected as prices; add a clearly labelled price column and re-upload.",
    );
    const skippedRows: SkippedRow[] = [];
    for (let r = 0; r < grid.length; r++) {
      if (r === headerRow) continue;
      const row = grid[r] ?? [];
      const rawCode = norm(row[codeCol]);
      const code = normCode(row[codeCol]);
      if (!code) continue;
      const numericCandidates = row
        .map((value, col) => ({ value, col }))
        .filter(
          ({ value, col }) =>
            col !== codeCol &&
            value != null &&
            norm(value) !== "" &&
            Number.isFinite(Number(value)),
        )
        .map(({ value }) => norm(value));
      skippedRows.push({
        rawCode: rawCode || code,
        rawPrice: numericCandidates.join(", "),
        reason:
          "No accepted price or dated-period header; numeric values were left unpriced for review",
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
      skippedRows,
      hasHeaderPeriods: false,
      warnings,
    };
  }

  const priceColHeader = rawHeaders[priceCol] ?? String(priceCol);

  const rows: ParsedRow[] = [];
  const skippedRows: SkippedRow[] = [];
  const sourcePriceObservations: SourcePriceObservation[] = [];
  for (let r = 0; r < grid.length; r++) {
    if (r === headerRow) continue;
    const row = grid[r] ?? [];
    const rawCodeVal = norm(row[codeCol]);
    const rawPriceVal = norm(row[priceCol]);
    // Skip completely empty rows silently
    if (!rawCodeVal && !rawPriceVal) continue;
    const code = normCode(row[codeCol]);
    if (!code) {
      // Record whenever either column has content — blank-code rows with a
      // valid price are a likely formatting issue the user needs to know about.
      if (rawCodeVal || rawPriceVal) {
        skippedRows.push({
          rawCode: rawCodeVal || "(blank)",
          rawPrice: rawPriceVal,
          reason: rawCodeVal ? "Item code could not be parsed" : "Item code is blank",
        });
      }
      continue;
    }
    if (/^removed$/i.test(rawPriceVal)) {
      sourcePriceObservations.push({ itemCode: code, isRemoved: true });
      skippedRows.push({
        rawCode: rawCodeVal,
        rawPrice: rawPriceVal,
        reason: "Marked REMOVED in source",
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
        reason: "No resolvable dated price column in source sheet",
      });
      continue;
    }
    sourcePriceObservations.push({ itemCode: code, isRemoved: false });
    const productName = nameCol !== -1 ? (norm(row[nameCol]) || null) : null;
    const category = categoryCol !== -1 ? (norm(row[categoryCol]) || null) : null;
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
    warnings,
  };
}

interface LoadSummary {
  file: string;
  effectiveDate: string;
  basis: string;
  codeColHeader: string;
  priceColHeader: string;
  totalRows: number;
  matchedProducts: number;
  newProducts: number;
  newHistoryRows: number;
  skippedDuplicates: number;
  skippedUnparseable: number;
  unmatchedCodes: string[];
  warnings: string[];
  /** Number of rows whose MRP is below ₹50 — near zero is expected for most categories;
   *  a high count almost certainly means a packing-quantity column was imported. */
  lowMrpCount: number;
  flaggedMrpCount: number;
  flaggedRows: MrpReviewFinding[];
  reviewBatchId: string | null;
  provenance?: {
    sourceDivision: string;
    sourceUrl: string;
    downloadedAt: string;
    fileSha256: string;
    loadBatchId: number;
  };
  message?: string;
}

interface MrpReviewFinding {
  itemCode: string;
  oldMrp: number | null;
  newMrp: number;
  reasons: string[];
}

export function anomalyReasons(
  price: number,
  previousMrp: number | null,
  division: string | null,
): string[] {
  const reasons: string[] = [];
  if (price < 1) reasons.push("MRP is below ₹1");
  const guardedDivision = /ptmt|cp fittings|faucet|sanitaryware/i.test(division ?? "");
  if (price < 50 && guardedDivision) {
    reasons.push(`MRP is below ₹50 for ${division ?? "this guarded division"}`);
  }
  if (previousMrp != null && previousMrp > 0) {
    const changePct = ((price - previousMrp) / previousMrp) * 100;
    if (changePct > 60) {
      reasons.push(`MRP increased ${changePct.toFixed(1)}% (limit +60%)`);
    } else if (changePct < -20) {
      reasons.push(`MRP decreased ${Math.abs(changePct).toFixed(1)}% (limit -20%)`);
    }
  }
  return reasons;
}

// ---------------------------------------------------------------------------
// Helper: parse all sheets in a workbook buffer into rows + metadata.
// Mutates knownCodes/canonical in place so successive files in a zip see
// products inserted by earlier files.
// ---------------------------------------------------------------------------
export function parseWorkbookBuffer(
  buffer: Buffer,
  knownCodes: Set<string>,
): {
  rows: ParsedRow[];
  sourcePriceObservations: SourcePriceObservation[];
  basis: string;
  codeColHeader: string;
  priceColHeader: string;
  hasNameCol: boolean;
  hasCategoryCol: boolean;
  skippedUnparseable: number;
  skippedRows: SkippedRow[];
  hasHeaderPeriods: boolean;
  warnings: string[];
} {
  const wb = XLSX.read(buffer, { type: "buffer" });
  let rows: ParsedRow[] = [];
  let basis = "Verify";
  let codeColHeader = "";
  let priceColHeader = "";
  let hasNameCol = false;
  let hasCategoryCol = false;
  let skippedUnparseable = 0;
  const skippedRows: SkippedRow[] = [];
  const warnings = new Set<string>();
  const sourcePriceObservations: SourcePriceObservation[] = [];
  const workbookHasHeaderPeriods = wb.SheetNames
    .filter((name) => !PACKING_SHEET_RE.test(name))
    .some((name) =>
      hasResolvablePeriodHeader(
        XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: null }),
      ),
    );

  // Sheet selection strategy:
  // 1. If any sheet is named "MASTER" (case-insensitive), use it exclusively —
  //    PTMT / Prayag MRP workbooks typically have a MASTER sheet with the real
  //    MRP columns alongside a PACKING sheet whose values are pcs-per-box.
  // 2. Otherwise, skip any sheet whose name contains "packing" and process the rest.
  const masterSheet = wb.SheetNames.find((n) => MASTER_SHEET_RE.test(n));
  const sheetsToProcess = masterSheet && !workbookHasHeaderPeriods
    ? [masterSheet]
    : wb.SheetNames.filter((n) => !PACKING_SHEET_RE.test(n));

  for (const sheetName of sheetsToProcess) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: null,
    });
    const parsed = parseSheet(grid, knownCodes, workbookHasHeaderPeriods);
    skippedUnparseable += parsed.skippedRows.length;
    skippedRows.push(...parsed.skippedRows);
    parsed.warnings.forEach((warning) => warnings.add(warning));
    sourcePriceObservations.push(...parsed.sourcePriceObservations);
    if (parsed.nameCol !== -1) hasNameCol = true;
    if (parsed.categoryCol !== -1) hasCategoryCol = true;
    if (parsed.rows.length > 0) {
      rows = rows.concat(parsed.rows);
      basis = parsed.basis;
      if (!codeColHeader) codeColHeader = parsed.codeColHeader;
      if (!priceColHeader) priceColHeader = parsed.priceColHeader;
    } else {
      if (!codeColHeader && parsed.codeColHeader) codeColHeader = parsed.codeColHeader;
      if (!priceColHeader && parsed.priceColHeader) priceColHeader = parsed.priceColHeader;
      basis = parsed.basis;
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
    warnings: [...warnings],
  };
}

// ---------------------------------------------------------------------------
// Infer a product division from the uploaded filename so that products get
// classified automatically without needing a separate SQL update step.
// ---------------------------------------------------------------------------
const FILENAME_DIVISION_MAP: Array<{ pattern: RegExp; division: string }> = [
  { pattern: /ptmt/i,                          division: "PTMT & Plastic Fittings" },
  { pattern: /pipe|fitting/i,                  division: "Pipes & Fittings" },
  { pattern: /\bcp\b|chrome/i,                 division: "CP Fittings / Faucets" },
  { pattern: /sanitar/i,                       division: "Ceramic Sanitaryware" },
  { pattern: /quaa|fern/i,                     division: "QUAA & FERN" },
];

function divisionFromFilename(filename: string): string | null {
  const base = filename.replace(/\.[^.]+$/, "").toLowerCase();
  for (const { pattern, division } of FILENAME_DIVISION_MAP) {
    if (pattern.test(base)) return division;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helper: persist a set of already-parsed rows to DB inside a transaction and
// return a filled-in LoadSummary.  Mutates knownCodes/canonical in place.
// ---------------------------------------------------------------------------
async function reconcileSourceDiscontinuations(
  tx: any,
  observations: SourcePriceObservation[],
  effectiveDate: string,
  canonical: Map<string, string>,
): Promise<void> {
  if (observations.length === 0) return;

  const normalizedObservations = observations.map((observation) => ({
    ...observation,
    itemCode: canonical.get(normCode(observation.itemCode)) ?? observation.itemCode,
  }));
  const itemCodes = [...new Set(normalizedObservations.map((row) => row.itemCode))];
  const products = await tx
    .select({
      itemCode: catalogProductsTable.itemCode,
      discontinuedFrom: catalogProductsTable.discontinuedFrom,
    })
    .from(catalogProductsTable)
    .where(inArray(catalogProductsTable.itemCode, itemCodes));
  if (products.length === 0) return;

  const history = await tx
    .select({
      itemCode: mrpPriceHistoryTable.itemCode,
      effectiveDate: mrpPriceHistoryTable.effectiveDate,
    })
    .from(mrpPriceHistoryTable)
    .where(
      and(
        inArray(mrpPriceHistoryTable.itemCode, itemCodes),
        eq(mrpPriceHistoryTable.reviewStatus, "approved"),
        eq(mrpPriceHistoryTable.variant, "Standard"),
      ),
    )
    .orderBy(
      asc(mrpPriceHistoryTable.itemCode),
      desc(mrpPriceHistoryTable.effectiveDate),
      desc(mrpPriceHistoryTable.id),
    );
  const latestPriceByCode = new Map<string, string>();
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
      isRemoved: row.isRemoved,
    })),
  );
  const confirmedByCode = new Map(
    confirmed.map((row) => [normCode(row.itemCode), row.discontinuedFrom]),
  );
  const liveInSource = new Set(
    normalizedObservations
      .filter((row) => !row.isRemoved)
      .map((row) => normCode(row.itemCode)),
  );

  for (const product of products) {
    const productKey = normCode(product.itemCode);
    const confirmedFrom = confirmedByCode.get(productKey);
    if (confirmedFrom) {
      if (product.discontinuedFrom !== confirmedFrom) {
        await tx
          .update(catalogProductsTable)
          .set({ discontinuedFrom: confirmedFrom, updatedAt: new Date() })
          .where(eq(catalogProductsTable.itemCode, product.itemCode));
      }
      continue;
    }

    if (!product.discontinuedFrom) continue;
    const latestPrice = latestPriceByCode.get(product.itemCode);
    const hasLaterPrice =
      Boolean(latestPrice) && latestPrice! > product.discontinuedFrom;
    const hasLiveSourceOccurrence =
      liveInSource.has(productKey) && effectiveDate >= product.discontinuedFrom;
    if (hasLaterPrice || hasLiveSourceOccurrence) {
      await tx
        .update(catalogProductsTable)
        .set({ discontinuedFrom: null, updatedAt: new Date() })
        .where(eq(catalogProductsTable.itemCode, product.itemCode));
    }
  }
}

async function persistParsedRows(
  parsedRows: ParsedRow[],
  sourcePriceObservations: SourcePriceObservation[],
  filename: string,
  effectiveDate: string,
  knownCodes: Set<string>,
  canonical: Map<string, string>,
  basis: string,
  codeColHeader: string,
  priceColHeader: string,
  skippedUnparseable: number,
  warnings: string[],
  reviewBatchId: string,
  loadBatchId: number,
  transaction?: DatabaseTransaction,
): Promise<LoadSummary> {
  // De-duplicate by (item code, variant) — keep last occurrence per combo.
  const byCodeVariant = new Map<string, {
    itemCode: string; price: number; productName: string | null;
    category: string | null; variant: string;
  }>();
  for (const r of parsedRows) {
    const variant = r.variant ?? "Standard";
    byCodeVariant.set(`${r.itemCode}__${variant}`, {
      itemCode: r.itemCode, price: r.price,
      productName: r.productName, category: r.category, variant,
    });
  }

  if (byCodeVariant.size === 0) {
    if (sourcePriceObservations.length > 0) {
      const reconcile = async (tx: DatabaseTransaction) => {
        await reconcileSourceDiscontinuations(
          tx,
          sourcePriceObservations,
          effectiveDate,
          canonical,
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
      message:
        "No valid code-and-price rows could be read from the file. Check the sheet has a recognisable item-code column and a price/MRP column.",
    };
  }

  const today = new Date().toISOString().slice(0, 10);
  // Sanity-check: count prices below ₹50.  For PTMT / CP products a count above
  // zero almost certainly means a packing-quantity column was imported by mistake.
  const lowMrpCount = [...byCodeVariant.values()].filter((v) => v.price < 50).length;
  const summary: LoadSummary = {
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
    reviewBatchId: null,
  };

  // Infer division once per file — same for every product in this upload.
  const inferredDivision = divisionFromFilename(filename);

  const write = async (tx: DatabaseTransaction) => {
    const existingPairs = await tx
      .select({
        itemCode: mrpPriceHistoryTable.itemCode,
        variant: mrpPriceHistoryTable.variant,
      })
      .from(mrpPriceHistoryTable)
      .where(eq(mrpPriceHistoryTable.effectiveDate, effectiveDate));
    // Key = "CODE__VARIANT" so a Standard row doesn't block a new Ivory row.
    const dupSet = new Set(existingPairs.map((p) => `${normCode(p.itemCode)}__${p.variant}`));

    // Fetch existing products that are missing name or division so we can backfill.
    const existingRows = await tx
      .select({
        itemCode: catalogProductsTable.itemCode,
        productName: catalogProductsTable.productName,
        division: catalogProductsTable.division,
        category: catalogProductsTable.category,
      })
      .from(catalogProductsTable);
    const existingMap = new Map(existingRows.map((r) => [r.itemCode, r]));
    const previousResult = await tx.execute<{
      item_code: string;
      mrp: number | null;
    }>(sql`
      SELECT DISTINCT ON (item_code) item_code, mrp
      FROM mrp_price_history
      WHERE effective_date < ${effectiveDate}
        AND review_status = 'approved'
        AND mrp IS NOT NULL
        AND variant = 'Standard'
      ORDER BY item_code, effective_date DESC, id DESC
    `);
    const previousMrp = new Map(
      previousResult.rows.map((row) => [normCode(row.item_code), row.mrp]),
    );

    const newProductValues: (typeof catalogProductsTable.$inferInsert)[] = [];
    const historyValues: (typeof mrpPriceHistoryTable.$inferInsert)[] = [];
    // Backfill updates: itemCode -> {productName?, division?, category?}
    const backfillMap = new Map<string, Partial<typeof catalogProductsTable.$inferInsert>>();
    // Track which codes have had their catalog product created/updated this run.
    const processedItemCodes = new Set<string>();

    for (const [, { itemCode: code, price, productName, category, variant }] of byCodeVariant) {
      const isKnown = knownCodes.has(code);
      const storedCode = canonical.get(code) ?? code;
      const existing = existingMap.get(storedCode);
      const division = existing?.division ?? inferredDivision;
      const reasons = anomalyReasons(
        price,
        previousMrp.get(code) ?? null,
        division,
      );

      // catalog_products has one row per item code — only act once per code.
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
            dataFlag: "new_from_load",
          });
          summary.newProducts++;
          summary.unmatchedCodes.push(storedCode);
          knownCodes.add(code);
          canonical.set(code, storedCode);
        } else {
          summary.matchedProducts++;
          // Backfill any null metadata on existing products.
          if (existing) {
            const patch: Partial<typeof catalogProductsTable.$inferInsert> = {};
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
        reviewedAt: reasons.length > 0 ? null : new Date(),
        variant,
      });
      if (reasons.length > 0) {
        summary.flaggedRows.push({
          itemCode: storedCode,
          oldMrp: previousMrp.get(code) ?? null,
          newMrp: price,
          reasons,
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
        const inserted = await tx
          .insert(mrpPriceHistoryTable)
          .values(historyValues.slice(i, i + 500))
          .returning({
            id: mrpPriceHistoryTable.id,
            itemCode: mrpPriceHistoryTable.itemCode,
            effectiveDate: mrpPriceHistoryTable.effectiveDate,
            mrp: mrpPriceHistoryTable.mrp,
            sourceFile: mrpPriceHistoryTable.sourceFile,
            loadBatchId: mrpPriceHistoryTable.loadBatchId,
          });
        await tx.insert(mrpHistoryProvenanceEventsTable).values(
          inserted.map((row) => ({
            historyRowId: row.id,
            itemCode: row.itemCode,
            effectiveDate: row.effectiveDate,
            action: "official_workbook_import",
            sourceFile: row.sourceFile,
            loadBatchId: row.loadBatchId,
            mrp: row.mrp,
          })),
        );
      }
    }

    // Apply backfill patches for existing products with null metadata.
    // Group by patch shape to minimize number of UPDATE statements.
    if (backfillMap.size > 0) {
      // Simple approach: update one at a time in batches of 500 using inArray
      // for the common case where all patches in a batch share the same fields.
      const byPatch = new Map<string, string[]>();
      for (const [code, patch] of backfillMap) {
        const key = JSON.stringify(patch);
        const list = byPatch.get(key) ?? [];
        list.push(code);
        byPatch.set(key, list);
      }
      for (const [patchJson, codes] of byPatch) {
        const patch = JSON.parse(patchJson) as Partial<typeof catalogProductsTable.$inferInsert>;
        for (let i = 0; i < codes.length; i += 500) {
          await tx
            .update(catalogProductsTable)
            .set(patch)
            .where(inArray(catalogProductsTable.itemCode, codes.slice(i, i + 500)));
        }
      }
    }

    await reconcileSourceDiscontinuations(
      tx,
      sourcePriceObservations,
      effectiveDate,
      canonical,
    );
  };
  if (transaction) {
    await write(transaction);
  } else {
    await db.transaction(write);
  }

  if (summary.newHistoryRows === 0 && summary.skippedDuplicates > 0) {
    summary.message = `All ${summary.skippedDuplicates} rows already exist for effective date ${effectiveDate} — nothing added (re-load is safe).`;
  }

  return summary;
}

router.post("/catalog/new-products/preview", requireAdmin, upload.single("file"), async (req, res): Promise<void> => {
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "No workbook uploaded." });
    return;
  }
  if (!/\.(xlsx|xls)$/i.test(file.originalname)) {
    res.status(400).json({ error: "New products upload accepts .xlsx or .xls files only." });
    return;
  }
  if (!previewReason(req.body?.reason)) {
    res.status(400).json({ error: "A reason is required for a new-products upload." });
    return;
  }
  try {
    const parsed = parseNewProductsWorkbook(file.buffer);
    const fileSha256 = sha256ForBuffer(file.buffer);
    await db.insert(mrpSourcesTable).values(NEW_PRODUCTS_SOURCE).onConflictDoNothing({ target: mrpSourcesTable.sheetId });
    const [source] = await db.select().from(mrpSourcesTable).where(eq(mrpSourcesTable.sheetId, NEW_PRODUCTS_SOURCE.sheetId)).limit(1);
    if (!source) throw new Error("New-products provenance source could not be created.");
    const [duplicateLoad] = await db.select({ id: mrpLoadBatchesTable.id }).from(mrpLoadBatchesTable)
      .where(and(eq(mrpLoadBatchesTable.sourceId, source.id), eq(mrpLoadBatchesTable.fileSha256, fileSha256))).limit(1);
    const [duplicatePending] = await db.select({ id: mrpPendingBatchesTable.id }).from(mrpPendingBatchesTable)
      .where(and(eq(mrpPendingBatchesTable.sourceId, source.id), eq(mrpPendingBatchesTable.fileSha256, fileSha256), eq(mrpPendingBatchesTable.status, "pending"), gt(mrpPendingBatchesTable.expiresAt, new Date()))).limit(1);
    if (duplicateLoad || duplicatePending) {
      res.status(409).json({ error: duplicatePending ? "This new-products workbook is already awaiting review." : "This new-products workbook has already been applied.", duplicate: true });
      return;
    }
    const existing = await db.select({ itemCode: catalogProductsTable.itemCode, productName: catalogProductsTable.productName }).from(catalogProductsTable);
    const existingCodes = new Set(existing.map((row) => normCode(row.itemCode)));
    const seen = new Set<string>();
    const rejectedRows = [...parsed.rejectedRows];
    const accepted: NewProductRow[] = [];
    for (const row of parsed.rows) {
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
    const periodCounts = new Map<string, number>();
    history.forEach((row) => periodCounts.set(row.effectiveDate, (periodCounts.get(row.effectiveDate) ?? 0) + 1));
    const today = new Date().toISOString().slice(0, 10);
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
        isImmediate: effectiveDate <= today,
      };
    });
    const preview = {
      kind: "new-products", mode: "new_products",
      reason: req.body.reason.trim(),
      fileName: file.originalname,
      fileSha256,
      willCreate: accepted, rejectedRows, rowsToCreate: accepted.length,
      willCreateCount: accepted.length,
      rejectedCount: rejectedRows.length,
      catalogBeforeCount: existing.length, catalogAfterCount: existing.length + accepted.length,
      catalogBefore: existing.length, catalogAfter: existing.length + accepted.length,
      periods,
      immediateProductCount: accepted.filter((row) => row.effectiveDate <= today).length,
      immediateCount: accepted.filter((row) => row.effectiveDate <= today).length,
      immediateMessage: accepted.some((row) => row.effectiveDate <= today)
        ? `${accepted.filter((row) => row.effectiveDate <= today).length} product(s) will go live immediately because the effective date has passed.`
        : null,
      canApply: accepted.length > 0,
      noChangeReason: accepted.length > 0 ? null : "No valid new products would be created.",
    };
    const [pending] = await db.insert(mrpPendingBatchesTable).values({
      sourceId: source.id, fileName: file.originalname, fileSha256, fileSizeBytes: file.size,
      downloadedAt: today, uploadedBy: req.user?.email ?? req.user?.id ?? null,
      payload: JSON.stringify({ kind: "new_products", reason: preview.reason, rows: accepted }),
      preview: JSON.stringify(preview), expiresAt: new Date(Date.now() + PENDING_MRP_BATCH_LIFETIME_MS),
    }).returning();
    res.json(newProductsResponse(pending!));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Could not read new-products workbook." });
  }
});

router.get("/catalog/new-products/:batchId", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.batchId);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "batchId must be a positive integer." }); return; }
  const [batch] = await db.select().from(mrpPendingBatchesTable).where(eq(mrpPendingBatchesTable.id, id)).limit(1);
  if (!batch) { res.status(404).json({ error: "New-products batch not found." }); return; }
  const [source] = await db.select({ sourceKind: mrpSourcesTable.sourceKind }).from(mrpSourcesTable).where(eq(mrpSourcesTable.id, batch.sourceId)).limit(1);
  if (source?.sourceKind !== "new_products") { res.status(404).json({ error: "New-products batch not found." }); return; }
  res.json(newProductsResponse(batch));
});

router.post("/catalog/new-products/:batchId/discard", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.batchId);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "batchId must be a positive integer." }); return; }
  const [sourceForBatch] = await db.select({ sourceKind: mrpSourcesTable.sourceKind }).from(mrpPendingBatchesTable)
    .innerJoin(mrpSourcesTable, eq(mrpPendingBatchesTable.sourceId, mrpSourcesTable.id))
    .where(eq(mrpPendingBatchesTable.id, id)).limit(1);
  if (sourceForBatch?.sourceKind !== "new_products") { res.status(404).json({ error: "New-products batch not found." }); return; }
  const [batch] = await db.update(mrpPendingBatchesTable).set({
    status: "discarded", discardedAt: new Date(), discardedBy: req.user?.email ?? req.user?.id ?? null,
  }).where(and(eq(mrpPendingBatchesTable.id, id), eq(mrpPendingBatchesTable.status, "pending"))).returning();
  if (!batch) { res.status(409).json({ error: "Only a pending new-products batch can be discarded." }); return; }
  res.json(newProductsResponse(batch));
});

router.post("/catalog/new-products/:batchId/apply", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.batchId);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "batchId must be a positive integer." }); return; }
  const confirmed = Number(req.body?.rowsToCreate);
  try {
    const outcome = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(917_902)`);
      const [batch] = await tx.select().from(mrpPendingBatchesTable).where(eq(mrpPendingBatchesTable.id, id)).limit(1);
      if (!batch) throw new Error("New-products batch not found.");
      const [source] = await tx.select({ sourceKind: mrpSourcesTable.sourceKind }).from(mrpSourcesTable).where(eq(mrpSourcesTable.id, batch.sourceId)).limit(1);
      if (source?.sourceKind !== "new_products") throw new Error("New-products batch not found.");
      if (batch.status !== "pending") throw new Error(`New-products batch is ${batch.status}; only pending batches can be applied.`);
      if (batch.expiresAt <= new Date()) {
        await tx.update(mrpPendingBatchesTable).set({ status: "expired" }).where(eq(mrpPendingBatchesTable.id, id));
        throw new Error("New-products batch has expired and cannot be applied.");
      }
      const preview = JSON.parse(batch.preview) as {
        canApply: boolean;
        rowsToCreate: number;
        willCreate: NewProductRow[];
        noChangeReason: string | null;
        catalogBefore: number;
        catalogAfter: number;
        periods: unknown[];
      };
      if (!preview.canApply) throw new Error(preview.noChangeReason ?? "No valid new products would be created.");
      if (confirmed !== preview.rowsToCreate) throw new Error(`Confirmation must repeat ${preview.rowsToCreate} products to create.`);
      const payload = JSON.parse(batch.payload) as { rows: NewProductRow[]; reason?: string };
      const existing = await tx.select({ itemCode: catalogProductsTable.itemCode }).from(catalogProductsTable);
      const existingCodes = new Set(existing.map((row) => normCode(row.itemCode)));
      if (payload.rows.some((row) => existingCodes.has(normCode(row.itemCode)))) throw new Error("One or more products now exist in the catalogue. Refresh the preview; no rows were written.");
      const [load] = await tx.insert(mrpLoadBatchesTable).values({
        sourceId: batch.sourceId, fileName: batch.fileName, fileSha256: batch.fileSha256, fileSizeBytes: batch.fileSizeBytes,
        downloadedAt: batch.downloadedAt, loadedBy: req.user?.email ?? req.user?.id ?? null, rowCount: payload.rows.length,
        notes: JSON.stringify({ mode: "new_products", reason: payload.reason ?? "" }),
      }).returning({ id: mrpLoadBatchesTable.id });
      if (!load) throw new Error("Could not create load provenance batch.");
      const today = new Date().toISOString().slice(0, 10);
      await tx.insert(catalogProductsTable).values(payload.rows.map((row) => ({
        itemCode: row.itemCode, productName: row.productName, division: row.division, seriesRange: row.series, size: row.size,
        sourceFiles: batch.fileName, dataFlag: "new_products_upload",
      })));
      const insertedHistory = await tx.insert(mrpPriceHistoryTable).values(payload.rows.map((row) => ({
        itemCode: row.itemCode, mrp: row.mrp, priceBasis: "MRP", effectiveDate: row.effectiveDate, loadDate: today,
        sourceFile: batch.fileName, reviewStatus: "approved", reviewedAt: new Date(), loadBatchId: load.id, variant: "Standard",
        notes: "Created by new-products upload",
      }))).returning({ id: mrpPriceHistoryTable.id, itemCode: mrpPriceHistoryTable.itemCode, effectiveDate: mrpPriceHistoryTable.effectiveDate, mrp: mrpPriceHistoryTable.mrp });
      await tx.insert(mrpHistoryProvenanceEventsTable).values(insertedHistory.map((row) => ({
        historyRowId: row.id, itemCode: row.itemCode, effectiveDate: row.effectiveDate, action: "new_product_upload",
        sourceFile: batch.fileName, loadBatchId: load.id, mrp: row.mrp,
      })));
      await recomputeCurrentFlagsInTransaction(tx);
      const competitorEffect = await applyP019PrinceRematch(tx, payload.rows, today);
      const result = {
        kind: "new_products", mode: "new_products", loadBatchId: load.id, createdProducts: payload.rows.length,
        createdCount: payload.rows.length,
        catalogBefore: preview.catalogBefore,
        catalogAfter: preview.catalogAfter,
        periods: preview.periods,
        competitorEffect,
      };
      await tx.update(mrpPendingBatchesTable).set({
        status: "applied", appliedAt: new Date(), appliedBy: req.user?.email ?? req.user?.id ?? null, loadBatchId: load.id, result: JSON.stringify(result),
      }).where(eq(mrpPendingBatchesTable.id, id));
      return { batchId: id, status: "applied", preview, result };
    });
    res.json(outcome);
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : "Could not apply new-products batch." });
  }
});

router.get("/catalog/mrp-loads/:batchId", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.batchId);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "batchId must be a positive integer." });
    return;
  }
  const [batch] = await db.select().from(mrpPendingBatchesTable)
    .where(eq(mrpPendingBatchesTable.id, id)).limit(1);
  if (!batch) {
    res.status(404).json({ error: "Pending MRP batch not found." });
    return;
  }
  res.json({
    ...batch,
    payload: undefined,
    preview: JSON.parse(batch.preview),
    result: batch.result ? JSON.parse(batch.result) : null,
  });
});

router.post("/catalog/mrp-loads/:batchId/discard", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.batchId);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "batchId must be a positive integer." });
    return;
  }
  const [batch] = await db.update(mrpPendingBatchesTable).set({
    status: "discarded",
    discardedAt: new Date(),
    discardedBy: req.user?.email ?? req.user?.id ?? null,
  }).where(and(eq(mrpPendingBatchesTable.id, id), eq(mrpPendingBatchesTable.status, "pending")))
    .returning();
  if (!batch) {
    res.status(409).json({ error: "Only a pending MRP batch can be discarded." });
    return;
  }
  res.json({
    ...batch,
    payload: undefined,
    preview: JSON.parse(batch.preview),
    result: batch.result ? JSON.parse(batch.result) : null,
  });
});

router.post("/catalog/mrp-loads/:batchId/apply", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.batchId);
  const confirmedRows = Number(req.body?.rowsToWrite);
  const confirmedImmediate = Number(req.body?.immediatePriceChanges);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "batchId must be a positive integer." });
    return;
  }
  try {
    await db
      .update(mrpPendingBatchesTable)
      .set({ status: "expired" })
      .where(
        and(
          eq(mrpPendingBatchesTable.id, id),
          eq(mrpPendingBatchesTable.status, "pending"),
          lte(mrpPendingBatchesTable.expiresAt, new Date()),
        ),
      );
    const outcome = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${917_902 + id})`);
      const [batch] = await tx.select().from(mrpPendingBatchesTable)
        .where(eq(mrpPendingBatchesTable.id, id)).limit(1);
      if (!batch) throw new Error("Pending MRP batch not found.");
      if (batch.status !== "pending") throw new Error(`MRP batch is ${batch.status}; only pending batches can be applied.`);
      const preview = JSON.parse(batch.preview) as { rowsToWrite: number; immediatePriceChangeCount: number; canApply: boolean; noChangeReason: string | null };
      if (!preview.canApply) throw new Error(preview.noChangeReason ?? "This preview has no changes to apply.");
      if (confirmedRows !== preview.rowsToWrite || confirmedImmediate !== preview.immediatePriceChangeCount) {
        throw new Error(`Confirmation must repeat ${preview.rowsToWrite} rows to write and ${preview.immediatePriceChangeCount} immediate price changes.`);
      }
      const payload = JSON.parse(batch.payload) as
        | ParsedAuthoritativeMaster
        | { kind: "ordinary"; reviewBatchId: string; entries: Array<{ fileName: string; effectiveDate: string; rows: ParsedRow[]; sourcePriceObservations: SourcePriceObservation[]; basis: string; codeColHeader: string; priceColHeader: string; skippedUnparseable: number; warnings: string[] }> };
      let result: unknown;
      let appliedLoadBatchId: number;
      if ("kind" in payload && payload.kind === "ordinary") {
        const [load] = await tx.insert(mrpLoadBatchesTable).values({
          sourceId: batch.sourceId, fileName: batch.fileName, fileSha256: batch.fileSha256,
          fileSizeBytes: batch.fileSizeBytes, downloadedAt: batch.downloadedAt,
          loadedBy: req.user?.email ?? req.user?.id ?? null, rowCount: 0,
        }).returning({ id: mrpLoadBatchesTable.id });
        appliedLoadBatchId = load!.id;
        const products = await tx.select({ itemCode: catalogProductsTable.itemCode }).from(catalogProductsTable);
        const knownCodes = new Set(products.map((row) => normCode(row.itemCode)));
        const canonical = new Map(products.map((row) => [normCode(row.itemCode), row.itemCode] as const));
        const summaries: LoadSummary[] = [];
        for (const entry of payload.entries) {
          summaries.push(await persistParsedRows(entry.rows, entry.sourcePriceObservations, entry.fileName,
            entry.effectiveDate, knownCodes, canonical, entry.basis, entry.codeColHeader,
            entry.priceColHeader, entry.skippedUnparseable, entry.warnings,
            payload.reviewBatchId,
            appliedLoadBatchId, tx));
        }
        const rowsWritten = summaries.reduce((count, summary) => count + summary.newHistoryRows, 0);
        await tx.update(mrpLoadBatchesTable).set({ rowCount: rowsWritten })
          .where(eq(mrpLoadBatchesTable.id, appliedLoadBatchId));
        await recomputeCurrentFlagsInTransaction(tx);
        result = { kind: "ordinary", loadBatchId: appliedLoadBatchId, summaries, rowsWritten };
      } else {
        const authoritative = await loadAuthoritativeMaster({
          parsed: payload as ParsedAuthoritativeMaster,
          fileSizeBytes: batch.fileSizeBytes,
          downloadedAt: batch.downloadedAt,
          loadedBy: req.user?.email ?? req.user?.id ?? null,
          transaction: tx,
        });
        if (authoritative.duplicate) throw new Error("This source snapshot was already applied.");
        appliedLoadBatchId = authoritative.loadBatchId;
        result = authoritative;
      }
      await tx.update(mrpPendingBatchesTable).set({
        status: "applied",
        appliedAt: new Date(),
        appliedBy: req.user?.email ?? req.user?.id ?? null,
        loadBatchId: appliedLoadBatchId,
        result: JSON.stringify(result),
      }).where(eq(mrpPendingBatchesTable.id, id));
      return { result, preview };
    });
    let hardwareSourceReplacement: unknown = null;
    let hardwareSourceWarning: string | null = null;
    if (!(outcome.result as { kind?: string }).kind) {
      try {
        hardwareSourceReplacement = await ensureHardwareReplacementSnapshot(
          req.user?.email ?? req.user?.id ?? null,
        );
      } catch (error) {
        hardwareSourceWarning =
          error instanceof Error
            ? error.message
            : "Hardware source reconciliation could not be confirmed.";
        req.log.error(
          { err: error, pendingBatchId: id },
          "MRP batch applied but Hardware source reconciliation failed",
        );
      }
    }
    res.json({
      batchId: id,
      status: "applied",
      preview: outcome.preview,
      result: outcome.result,
      hardwareSourceReplacement,
      hardwareSourceWarning,
    });
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : "Could not apply MRP batch." });
  }
});

router.post("/catalog/load-mrp", requireAdmin, upload.single("file"), async (req, res) => {
  const file = req.file!;
  if (!file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  const effectiveDate =
    typeof req.body.effectiveDate === "string" && req.body.effectiveDate.trim()
      ? req.body.effectiveDate.trim()
      : null;

  if (effectiveDate && !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
    res.status(400).json({ error: "effectiveDate must be YYYY-MM-DD" });
    return;
  }

  const name = file.originalname;
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (!["xlsx", "xls", "csv", "zip"].includes(ext)) {
    res.status(400).json({ error: "Upload an .xlsx, .xls, .csv, or .zip file" });
    return;
  }

  try {
    const reviewBatchId = randomUUID();
    let authoritativeWorkbook = false;
    if (ext === "xlsx" || ext === "xls") {
      const workbook = XLSX.read(file.buffer, { type: "buffer" });
      const correction = parseDiscontinuationCorrectionWorkbook(workbook);
      if (correction) {
        res.status(400).json({
          error:
            "This is a discontinuation correction workbook. It is not accepted by the MRP loader because uploads are preview-only; use the dedicated discontinuation correction tool.",
        });
        return;
      }
      const authoritativeSheets = [
        "products",
        "discontinued",
        "excluded_do_not_load",
        "notes",
      ];
      const looksAuthoritative = authoritativeSheets.every((sheet) =>
        workbook.SheetNames.includes(sheet),
      );
      if (looksAuthoritative && !isAuthoritativeMasterBuffer(file.buffer)) {
        res.status(400).json({
          error:
            "Authoritative master checksum mismatch. The file was not loaded.",
        });
        return;
      }
      authoritativeWorkbook = looksAuthoritative;
    }
    if (authoritativeWorkbook) {
      const downloadedAt = req.body.downloadedAt;
      if (!isIsoDate(downloadedAt)) {
        res.status(400).json({
          error: "Enter the date this file was downloaded (YYYY-MM-DD).",
        });
        return;
      }
      const parsed = parseAuthoritativeMasterBuffer(file.buffer);
      await db
        .insert(mrpSourcesTable)
        .values(AUTHORITATIVE_MASTER_SOURCE)
        .onConflictDoNothing({ target: mrpSourcesTable.sheetId });
      const [source] = await db
        .select({ id: mrpSourcesTable.id })
        .from(mrpSourcesTable)
        .where(eq(mrpSourcesTable.sheetId, AUTHORITATIVE_MASTER_SOURCE.sheetId))
        .limit(1);
      if (!source) throw new Error("Authoritative MRP provenance source could not be created.");
      // This precheck intentionally happens before the pending record exists.
      const existingBatches = await db
        .select({
          id: mrpLoadBatchesTable.id,
          loadedAt: mrpLoadBatchesTable.loadedAt,
          downloadedAt: mrpLoadBatchesTable.downloadedAt,
        })
        .from(mrpLoadBatchesTable)
        .where(and(eq(mrpLoadBatchesTable.sourceId, source.id), eq(mrpLoadBatchesTable.fileSha256, parsed.fileSha256)));
      const pendingMatch = await db
        .select({ id: mrpPendingBatchesTable.id })
        .from(mrpPendingBatchesTable)
        .where(and(
          eq(mrpPendingBatchesTable.sourceId, source.id),
          eq(mrpPendingBatchesTable.fileSha256, parsed.fileSha256),
          eq(mrpPendingBatchesTable.status, "pending"),
          gt(mrpPendingBatchesTable.expiresAt, new Date()),
        ))
        .limit(1);
      if (existingBatches.length || pendingMatch.length) {
        res.status(409).json({
          error: pendingMatch.length
            ? "This authoritative master is already awaiting review."
            : "This authoritative master has already been loaded.",
          duplicate: {
            sourceDivision: "Authoritative multi-division master",
            fileSha256: parsed.fileSha256,
            matches: existingBatches.map((batch) => ({
              loadBatchId: batch.id,
              loadedAt: batch.loadedAt,
              downloadedAt: batch.downloadedAt,
            })),
          },
        });
        return;
      }
      const products = await db.select({
        itemCode: catalogProductsTable.itemCode,
        productName: catalogProductsTable.productName,
        discontinuedFrom: catalogProductsTable.discontinuedFrom,
      }).from(catalogProductsTable);
      const history = await db.select({
        itemCode: mrpPriceHistoryTable.itemCode,
        effectiveDate: mrpPriceHistoryTable.effectiveDate,
        mrp: mrpPriceHistoryTable.mrp,
        variant: mrpPriceHistoryTable.variant,
      }).from(mrpPriceHistoryTable);
      const preview = pendingAuthoritativePreview(parsed, products, history);
      const [pending] = await db.insert(mrpPendingBatchesTable).values({
        sourceId: source.id,
        fileName: file.originalname,
        fileSha256: parsed.fileSha256,
        fileSizeBytes: file.size,
        downloadedAt,
        uploadedBy: req.user?.email ?? req.user?.id ?? null,
        payload: JSON.stringify(parsed),
        preview: JSON.stringify(preview),
        expiresAt: new Date(Date.now() + PENDING_MRP_BATCH_LIFETIME_MS),
      }).returning({ id: mrpPendingBatchesTable.id, expiresAt: mrpPendingBatchesTable.expiresAt });
      res.json({
        batchId: pending!.id,
        status: "pending",
        expiresAt: pending!.expiresAt,
        preview,
      });
      return;
    }
    const sourceId = Number(req.body.sourceId);
    const downloadedAt = req.body.downloadedAt;
    if (!Number.isInteger(sourceId) || sourceId <= 0) {
      res.status(400).json({
        error: "Choose the official MRP source before loading a price sheet.",
      });
      return;
    }
    if (!isIsoDate(downloadedAt)) {
      res.status(400).json({
        error: "Enter the date this file was downloaded (YYYY-MM-DD).",
      });
      return;
    }

    await ensureOfficialMrpSources();
    const sourceRows = await db
      .select()
      .from(mrpSourcesTable)
      .where(eq(mrpSourcesTable.id, sourceId))
      .limit(1);
    const source = sourceRows[0];
    if (!source) {
      res.status(400).json({
        error: "The selected MRP source no longer exists. Refresh and choose a source again.",
      });
      return;
    }

    const fileSha256 = sha256ForBuffer(file.buffer);
    const duplicateBatches = await db
      .select()
      .from(mrpLoadBatchesTable)
      .where(
        and(
          eq(mrpLoadBatchesTable.sourceId, source.id),
          eq(mrpLoadBatchesTable.fileSha256, fileSha256),
        ),
      )
      .orderBy(desc(mrpLoadBatchesTable.loadedAt))
    const pendingDuplicate = await db.select({ id: mrpPendingBatchesTable.id })
      .from(mrpPendingBatchesTable)
      .where(and(
        eq(mrpPendingBatchesTable.sourceId, source.id),
        eq(mrpPendingBatchesTable.fileSha256, fileSha256),
        eq(mrpPendingBatchesTable.status, "pending"),
        gt(mrpPendingBatchesTable.expiresAt, new Date()),
      ))
      .limit(1);
    const confirmDuplicate = req.body.confirmDuplicate === "true";
    if (duplicateBatches.length > 0 || pendingDuplicate.length > 0) {
      res.status(409).json({
        error: pendingDuplicate.length
          ? "This identical file is already awaiting review; no second pending batch was created."
          : `This file matches ${duplicateBatches.length} prior load${duplicateBatches.length === 1 ? "" : "s"} for this source.`,
        duplicate: {
          sourceDivision: source.division,
          fileSha256,
          matches: duplicateBatches.map((batch) => ({
            loadBatchId: batch.id,
            fileName: batch.fileName,
            loadedAt: batch.loadedAt,
            downloadedAt: batch.downloadedAt,
          })),
        },
      });
      return;
    }

    // Parse once and stage the exact parser output.  In particular, do not
    // create an mrp_load_batches record here: source uploads are previews.
    const existingProductsForPreview = await db.select({
      itemCode: catalogProductsTable.itemCode,
      productName: catalogProductsTable.productName,
    }).from(catalogProductsTable);
    const previewKnownCodes = new Set(existingProductsForPreview.map((p) => normCode(p.itemCode)));
    const entries: Array<{
      fileName: string; effectiveDate: string; rows: ParsedRow[];
      sourcePriceObservations: SourcePriceObservation[]; basis: string;
      codeColHeader: string; priceColHeader: string; skippedUnparseable: number;
      skippedRows: SkippedRow[]; warnings: string[];
    }> = [];
    if (ext === "zip") {
      if (!effectiveDate) {
        res.status(400).json({ error: "effectiveDate is required for ZIP imports until each entry carries a resolvable dated price column." });
        return;
      }
      const zipEntries = new AdmZip(file.buffer).getEntries()
        .filter((entry) => !entry.isDirectory && ["xlsx", "xls", "csv"].includes(entry.name.toLowerCase().split(".").pop() ?? ""))
        .filter((entry) => !entry.entryName.startsWith("__MACOSX") && !entry.name.startsWith("._"))
        .sort((a, b) => a.name.localeCompare(b.name));
      if (!zipEntries.length) {
        res.status(400).json({ error: "The ZIP file contains no .xlsx / .xls / .csv files." });
        return;
      }
      for (const entry of zipEntries) {
        const parsed = parseWorkbookBuffer(entry.getData(), previewKnownCodes);
        entries.push({
          fileName: entry.name,
          effectiveDate,
          rows: parsed.rows.map((row) => ({ ...row, effectiveDate })),
          sourcePriceObservations: parsed.sourcePriceObservations.map((row) => ({
            ...row,
            effectiveDate,
          })),
          basis: parsed.basis,
          codeColHeader: parsed.codeColHeader,
          priceColHeader: parsed.priceColHeader,
          skippedUnparseable: parsed.skippedUnparseable,
          skippedRows: parsed.skippedRows,
          warnings: parsed.warnings,
        });
      }
    } else {
      const parsed = parseWorkbookBuffer(file.buffer, previewKnownCodes);
      if (!parsed.hasHeaderPeriods && !effectiveDate) {
        res.status(400).json({ error: "No dated price column was found. Supply an explicit effectiveDate; the loader will never default it to the load date." });
        return;
      }
      const periods = parsed.hasHeaderPeriods
        ? [...new Set(parsed.rows.map((row) => row.effectiveDate).filter((date): date is string => !!date))]
        : [effectiveDate!];
      if (!periods.length) {
        res.status(400).json({ error: "No price rows with a resolvable source period were found." });
        return;
      }
      for (const period of periods) {
        entries.push({
          fileName: name,
          effectiveDate: period,
          rows: parsed.rows
            .filter((row) => !parsed.hasHeaderPeriods || row.effectiveDate === period)
            .map((row) => ({ ...row, effectiveDate: period })),
          sourcePriceObservations: parsed.sourcePriceObservations
            .filter((row) => !parsed.hasHeaderPeriods || row.effectiveDate === period)
            .map((row) => ({ ...row, effectiveDate: period })),
          basis: parsed.basis,
          codeColHeader: parsed.codeColHeader,
          priceColHeader: parsed.priceColHeader,
          skippedUnparseable: parsed.skippedUnparseable,
          skippedRows: parsed.skippedRows,
          warnings: parsed.warnings,
        });
      }
    }
    const historyForPreview = await db.select({
      itemCode: mrpPriceHistoryTable.itemCode, effectiveDate: mrpPriceHistoryTable.effectiveDate,
      mrp: mrpPriceHistoryTable.mrp, variant: mrpPriceHistoryTable.variant,
    }).from(mrpPriceHistoryTable);
    const today = new Date().toISOString().slice(0, 10);
    const knownPeriods = new Set(historyForPreview.map((row) => row.effectiveDate));
    const latest = new Map<string, { mrp: number | null; effectiveDate: string }>();
    for (const row of historyForPreview) if (row.variant === "Standard" && row.effectiveDate <= today && (!latest.get(normCode(row.itemCode)) || latest.get(normCode(row.itemCode))!.effectiveDate < row.effectiveDate)) latest.set(normCode(row.itemCode), { mrp: row.mrp, effectiveDate: row.effectiveDate });
    const allRows = entries.flatMap((entry) => entry.rows);
    const historyByKey = new Map(
      historyForPreview.map((row) => [
        `${normCode(row.itemCode)}\u001f${row.effectiveDate}\u001f${row.variant}`,
        row.mrp,
      ]),
    );
    const rowsThatWrite = allRows.filter(
      (row) =>
        historyByKey.get(
          `${normCode(row.itemCode)}\u001f${row.effectiveDate}\u001f${row.variant ?? "Standard"}`,
        ) !== row.price,
    );
    const immediatePriceChanges = allRows.filter((row) => (row.variant ?? "Standard") === "Standard" && row.effectiveDate! <= today && previewKnownCodes.has(normCode(row.itemCode)) && latest.get(normCode(row.itemCode))?.mrp !== row.price).map((row) => ({ itemCode: row.itemCode, oldMrp: latest.get(normCode(row.itemCode))?.mrp ?? null, newMrp: row.price, effectiveDate: row.effectiveDate, delta: row.price - (latest.get(normCode(row.itemCode))?.mrp ?? 0) })).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    const rejectedRows = entries.flatMap((entry) => entry.skippedRows);
    const rejectedReasonSummary = rejectedRows.reduce<Record<string, number>>((out, row) => { out[row.reason] = (out[row.reason] ?? 0) + 1; return out; }, {});
    const discontinuationDates = entries.flatMap((entry) => entry.sourcePriceObservations
      .filter((row) => row.isRemoved)
      .map((row) => row.effectiveDate ?? entry.effectiveDate));
    const preview = {
      kind: "ordinary", rowsToWrite: rowsThatWrite.length, productRows: allRows.length, priceRows: allRows.length,
      periods: entries.map((entry) => ({ effectiveDate: entry.effectiveDate, rowCount: entry.rows.length, isNew: !knownPeriods.has(entry.effectiveDate), movedInCount: entry.rows.filter((row) => latest.get(normCode(row.itemCode))?.effectiveDate !== entry.effectiveDate).length })),
      immediatePriceChanges, immediatePriceChangeCount: immediatePriceChanges.length,
      newProducts: [...new Set(allRows.filter((row) => !previewKnownCodes.has(normCode(row.itemCode))).map((row) => row.itemCode))],
      catalogueProductsAbsentFromFile: existingProductsForPreview.filter((row) => !allRows.some((input) => normCode(input.itemCode) === normCode(row.itemCode))).map((row) => row.itemCode),
      discontinuations: {
        total: discontinuationDates.length,
        immediate: discontinuationDates.filter((date) => date <= today).length,
        future: discontinuationDates.filter((date) => date > today).length,
      }, protectedNameConflicts: [],
      rejectedRows, rejectedReasonSummary,
      canApply: rowsThatWrite.length > 0 || discontinuationDates.length > 0,
      noChangeReason:
        rowsThatWrite.length > 0 || discontinuationDates.length > 0
          ? null
          : allRows.length
            ? "Every parsed price already exists with the same value, and no discontinuation would change."
            : "No valid rows would be written.",
    };
    const [pending] = await db.insert(mrpPendingBatchesTable).values({
      sourceId: source.id, fileName: name, fileSha256, fileSizeBytes: file.size, downloadedAt,
      uploadedBy: req.user?.email ?? req.user?.id ?? null,
      payload: JSON.stringify({ kind: "ordinary", reviewBatchId, entries }),
      preview: JSON.stringify(preview), expiresAt: new Date(Date.now() + PENDING_MRP_BATCH_LIFETIME_MS),
    }).returning({ id: mrpPendingBatchesTable.id, expiresAt: mrpPendingBatchesTable.expiresAt });
    res.json({ batchId: pending!.id, status: "pending", expiresAt: pending!.expiresAt, preview });
    return;
  } catch (err) {
    req.log.error({ err, file: name }, "load-mrp preview failed");
    res.status(500).json({ error: "Failed to parse and preview file" });
  }
});

router.post("/catalog/mrp-review-batches/:batchId/approve", requireAdmin, async (req, res) => {
  const batchId = req.params.batchId;
  const approved = await db.transaction(async (tx) => {
    const pending = await tx
      .select({
        id: mrpPriceHistoryTable.id,
        itemCode: mrpPriceHistoryTable.itemCode,
        effectiveDate: mrpPriceHistoryTable.effectiveDate,
        mrp: mrpPriceHistoryTable.mrp,
        sourceFile: mrpPriceHistoryTable.sourceFile,
        loadBatchId: mrpPriceHistoryTable.loadBatchId,
      })
      .from(mrpPriceHistoryTable)
      .where(
        sql`${mrpPriceHistoryTable.importBatchId} = ${batchId}
          AND ${mrpPriceHistoryTable.reviewStatus} = 'pending'`,
      );
    if (pending.length === 0) return [];
    await tx
      .update(mrpPriceHistoryTable)
      .set({ reviewStatus: "approved", reviewedAt: new Date() })
      .where(inArray(mrpPriceHistoryTable.id, pending.map((row) => row.id)));
    await tx.insert(mrpHistoryProvenanceEventsTable).values(
      pending.map((row) => ({
        historyRowId: row.id,
        itemCode: row.itemCode,
        effectiveDate: row.effectiveDate,
        action: "review_approved",
        sourceFile: row.sourceFile,
        loadBatchId: row.loadBatchId,
        mrp: row.mrp,
      })),
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
    const pending = await tx
      .select({
        id: mrpPriceHistoryTable.id,
        itemCode: mrpPriceHistoryTable.itemCode,
        effectiveDate: mrpPriceHistoryTable.effectiveDate,
        mrp: mrpPriceHistoryTable.mrp,
        sourceFile: mrpPriceHistoryTable.sourceFile,
        loadBatchId: mrpPriceHistoryTable.loadBatchId,
      })
      .from(mrpPriceHistoryTable)
      .where(
        sql`${mrpPriceHistoryTable.importBatchId} = ${batchId}
          AND ${mrpPriceHistoryTable.reviewStatus} = 'pending'`,
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
        mrp: row.mrp,
      })),
    );
    await tx
      .delete(mrpPriceHistoryTable)
      .where(inArray(mrpPriceHistoryTable.id, pending.map((row) => row.id)));
    return pending;
  });
  if (removed.length === 0) {
    res.status(404).json({ error: "No pending MRP rows found for this review batch" });
    return;
  }
  await recomputeCurrentFlags();
  res.json({ ok: true, cancelled: removed.length });
});

// GET /catalog/export — dated MRP list/revisions, or full history.
router.get("/catalog/export", async (req, res) => {
  const type = String(req.query.type ?? "catalog");
  const format = String(req.query.format ?? "xlsx");
  const scope = req.query.scope === "revisions" ? "revisions" : "in-force";
  const asOf =
    typeof req.query.asOf === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(req.query.asOf)
      ? req.query.asOf
      : new Date().toISOString().slice(0, 10);

  let aoa: (string | number | null)[][];
  let sheetName: string;
  let fileBase: string;
  let summaryAoa: (string | number | null)[][] | null = null;

  if (type === "history") {
    sheetName = "MRP History";
    fileBase = "prayag-mrp-history";
    const rows = await db
      .select()
      .from(mrpPriceHistoryTable)
      .where(eq(mrpPriceHistoryTable.reviewStatus, "approved"))
      .orderBy(
        asc(mrpPriceHistoryTable.itemCode),
        desc(mrpPriceHistoryTable.effectiveDate),
        desc(mrpPriceHistoryTable.id),
      );
    const statuses = derivePriceHistoryStatuses(
      rows.map((row) => ({
        ...row,
        effectiveDate: String(row.effectiveDate),
      })),
      asOf,
      (row) => `${row.itemCode}\u0000${row.variant}`,
      (row) => row.mrp != null,
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
      "Notes",
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
      r.notes,
    ]);
    aoa = [header, ...body];
  } else {
    sheetName = scope === "revisions" ? "MRP Revisions" : "MRP In Force";
    fileBase =
      scope === "revisions"
        ? `prayag-mrp-revisions-effective-${asOf}`
        : `prayag-mrp-list-in-force-${asOf}`;
    type CatalogExportRow = {
      item_code: string;
      product_name: string | null;
      division: string | null;
      category: string | null;
      series_range: string | null;
      size: string | null;
      uom: string | null;
      mrp: number | null;
      price_basis: string | null;
      effective_date: string;
      load_date: string | null;
      source_file: string | null;
      data_flag: string | null;
      discontinued_from: string | null;
    };
    const result =
      scope === "revisions"
        ? await db.execute<CatalogExportRow>(sql`
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
          `)
        : await db.execute<CatalogExportRow>(sql`
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
      "Series/Range",
      "Size",
      "UOM",
      scope === "revisions" ? "Revised MRP" : "MRP In Force",
      "Basis",
      "Effective Date",
      "Load Date",
      "Source File",
      "Data Flag",
      "Discontinued From",
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
      row.discontinued_from,
    ]);
    aoa = [header, ...body];
    summaryAoa = [
      [
        "Scope",
        scope === "revisions"
          ? `Prayag MRP revisions effective exactly ${asOf}`
          : `Prayag MRP list in force on ${asOf}`,
      ],
      ["Product count", body.length],
      ["Requested date", asOf],
      [
        "Resolution rule",
        scope === "revisions"
          ? "Approved Standard MRP rows whose effective date equals the requested date."
          : "Latest approved Standard MRP on or before the requested date for each live product.",
      ],
      [
        "Availability rule",
        "Active catalogue products excluding products discontinued on or before the requested date.",
      ],
    ];
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  if (format === "csv") {
    const csv = XLSX.utils.sheet_to_csv(ws);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fileBase}.csv"`,
    );
    res.send(csv);
    return;
  }

  const wb = XLSX.utils.book_new();
  if (summaryAoa) {
    const summaryWs = XLSX.utils.aoa_to_sheet(summaryAoa);
    XLSX.utils.book_append_sheet(wb, summaryWs, "Summary");
  }
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${fileBase}.xlsx"`,
  );
  res.send(buf);
});

interface ParsedCompetitorRow {
  category: string | null;
  description: string | null;
  size: string | null;
  price: number;
  unit: string | null;
  effectiveDate: string | null;
  matchedPrayagCode: string | null;
  competitorCode?: string | null;
  codeSource?: "supplier" | "locally_assigned";
}

const SPARSH_MASTER_SHEET = "competitor_mapping";
const SPARSH_MASTER_COMPETITOR = "Sparsh Pearl";
const SPARSH_MASTER_ROW_COUNT = 150;
const ASHIRVAD_MASTER_COMPETITOR = "Ashirvad";
const ASHIRVAD_MASTER_ROW_COUNT = 669;
const ASHIRVAD_MASTER_EFFECTIVE_DATE = "2025-03-01";
const APOLLO_PIPE_SHEETS = new Set([
  "agri pipe", "casing pipe", "cpvc pipe", "ppr pipe",
  "swr pipe", "ugd pipe", "upvc pipe",
]);
const APOLLO_COMPETITOR = "Apollo";

function normalizedSheetName(value: string): string {
  return value.replace(/\s+/gu, " ").trim().toLowerCase();
}

/** P045 raw-master detection is deliberately strict: ordinary workbooks are
 * left on the legacy parser, while a master is never silently misinterpreted. */
export function isApolloRawMaster(workbook: XLSX.WorkBook): boolean {
  const pipeSheets = workbook.SheetNames.filter((name) =>
    APOLLO_PIPE_SHEETS.has(normalizedSheetName(name)),
  );
  return pipeSheets.length === APOLLO_PIPE_SHEETS.size;
}

const ASHIRVAD_MASTER_SHA256 =
  "5dfa4fdcc76595e4e3c090734808a506d85eb3902137428263274272e2b0e499";
const SPARSH_MASTER_PERIOD_FIELDS = [
  { key: "vol_4_8", label: "Vol 4.8", priceKey: "vol_4_8_mrp", dateKey: "vol_4_8_effective_from" },
  { key: "vol_6_2", label: "Vol 6.2", priceKey: "vol_6_2_mrp", dateKey: "vol_6_2_effective_from" },
] as const;

interface SparshMasterPeriod {
  key: (typeof SPARSH_MASTER_PERIOD_FIELDS)[number]["key"];
  label: (typeof SPARSH_MASTER_PERIOD_FIELDS)[number]["label"];
  priceKey: (typeof SPARSH_MASTER_PERIOD_FIELDS)[number]["priceKey"];
  dateKey: (typeof SPARSH_MASTER_PERIOD_FIELDS)[number]["dateKey"];
  sourceEffectiveDate: string;
}

interface SparshMasterRow {
  prayagCode: string;
  description: string | null;
  series: string | null;
  competitorCode: string;
  prices: Record<string, number>;
}

interface SparshMasterParseResult {
  rows: SparshMasterRow[];
  periods: SparshMasterPeriod[];
}

interface AshirvadMasterRow {
  prayagCode: string;
  competitorCode: string;
  price: number;
  description: string | null;
  category: string | null;
}

/**
 * Parse the one approved Ashirvad mapping snapshot. Its digest is deliberately
 * part of the format contract: review-only Prayag values in this workbook must
 * never be treated as a Prayag price source or as a gap calculation input.
 */
export function parseAshirvadCompetitorMaster(
  buffer: Buffer,
  workbook: XLSX.WorkBook,
  canonicalCodes: Map<string, string>,
): AshirvadMasterRow[] | null {
  const sheet = workbook.Sheets[SPARSH_MASTER_SHEET];
  if (!sheet) return null;
  const headerRow =
    XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null })[0] ?? [];
  const headers = new Set(headerRow.map((value) => String(value ?? "").trim()));
  const requiredColumns = [
    "prayag_code",
    "competitor",
    "competitor_code",
    "competitor_mrp",
    "effective_from",
  ];
  // A normal generic workbook sharing this sheet name is not this special
  // master. Once it presents this signature, however, reject a changed copy.
  if (!requiredColumns.every((column) => headers.has(column))) return null;
  if (sha256ForBuffer(buffer) !== ASHIRVAD_MASTER_SHA256) {
    throw new Error("Ashirvad master checksum does not match the approved trusted snapshot.");
  }

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
  });
  if (rows.length !== ASHIRVAD_MASTER_ROW_COUNT) {
    throw new Error(
      `Ashirvad master must contain exactly ${ASHIRVAD_MASTER_ROW_COUNT} mapping rows; found ${rows.length}.`,
    );
  }

  const prayagCodes = new Set<string>();
  const competitorCodes = new Set<string>();
  const parsed: AshirvadMasterRow[] = [];
  for (const [index, row] of rows.entries()) {
    const rowNumber = index + 2;
    const rawPrayagCode = norm(row.prayag_code);
    const competitorCode = norm(row.competitor_code);
    const canonicalPrayagCode = canonicalCodes.get(normCode(rawPrayagCode));
    if (norm(row.competitor) !== ASHIRVAD_MASTER_COMPETITOR) {
      throw new Error(`Ashirvad master row ${rowNumber} has an unexpected competitor.`);
    }
    if (!rawPrayagCode || !competitorCode || !canonicalPrayagCode) {
      throw new Error(
        `Ashirvad master row ${rowNumber} has a missing or unknown Prayag code, or missing competitor code.`,
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
        `Ashirvad master row ${rowNumber} must have effective_from ${ASHIRVAD_MASTER_EFFECTIVE_DATE}.`,
      );
    }
    prayagCodes.add(prayagKey);
    competitorCodes.add(competitorKey);
    // Do not read prayag_mrp_reference or gap_pct. They are explicitly
    // review-only and live Prayag MRP/gaps are resolved at query time.
    parsed.push({
      prayagCode: canonicalPrayagCode,
      competitorCode,
      price,
      description: norm(row.prayag_name) || null,
      category: norm(row.category) || null,
    });
  }
  return parsed;
}

/**
 * Parses the dedicated Sparsh master format. This is deliberately separate
 * from the loose, generic competitor-sheet parser: the master carries two
 * periods and an explicit Prayag-to-competitor mapping, and must never be
 * mistaken for a Prayag price source.
 */
export function parseSparshCompetitorMaster(
  workbook: XLSX.WorkBook,
  canonicalCodes: Map<string, string>,
): SparshMasterParseResult | null {
  const sheet = workbook.Sheets[SPARSH_MASTER_SHEET];
  if (!sheet) return null;

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
  const requiredColumns = [
    "prayag_code",
    "prayag_name",
    "prayag_series",
    "competitor",
    "competitor_code",
    ...SPARSH_MASTER_PERIOD_FIELDS.flatMap((period) => [period.priceKey, period.dateKey]),
  ];
  const headers = new Set(
    XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null })[0]
      ?.map((value) => String(value ?? "").trim()) ?? [],
  );
  const missingColumns = requiredColumns.filter((column) => !headers.has(column));
  if (missingColumns.length > 0) {
    // competitor_mapping is also used by other dedicated masters. Only claim
    // this workbook when it has the Sparsh period signature.
    return null;
  }
  if (rows.length !== SPARSH_MASTER_ROW_COUNT) {
    throw new Error(
      `Sparsh master must contain exactly ${SPARSH_MASTER_ROW_COUNT} mapping rows; found ${rows.length}.`,
    );
  }

  const periods = SPARSH_MASTER_PERIOD_FIELDS.map((period) => {
    const dates = new Set(
      rows
        .map((row) => toDateStr(row[period.dateKey]))
        .filter((date): date is string => Boolean(date)),
    );
    if (dates.size !== 1) {
      throw new Error(
        `Sparsh master must contain one consistent ${period.dateKey} value across all rows.`,
      );
    }
    const sourceEffectiveDate = [...dates][0]!;
    if (!isIsoDate(sourceEffectiveDate)) {
      throw new Error(`Sparsh master has an invalid ${period.dateKey} value.`);
    }
    return { ...period, sourceEffectiveDate };
  });
  if (new Set(periods.map((period) => period.sourceEffectiveDate)).size !== periods.length) {
    throw new Error("Sparsh master period dates must be distinct.");
  }

  const competitorCodes = new Set<string>();
  const prayagCodes = new Set<string>();
  const parsed: SparshMasterRow[] = [];
  const missingPrayagCodes: string[] = [];

  for (const [index, row] of rows.entries()) {
    const rowNumber = index + 2;
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

    const prices: SparshMasterRow["prices"] = {};
    for (const period of periods) {
      const effectiveDate = toDateStr(row[period.dateKey]);
      const price = Number(row[period.priceKey]);
      if (effectiveDate !== period.sourceEffectiveDate) {
        throw new Error(
          `Sparsh master row ${rowNumber} has an unexpected ${period.dateKey} value.`,
        );
      }
      if (!Number.isFinite(price) || price <= 0) {
        throw new Error(`Sparsh master row ${rowNumber} has an invalid ${period.priceKey} value.`);
      }
      prices[period.sourceEffectiveDate] = price;
    }

    competitorCodes.add(competitorCodeKey);
    prayagCodes.add(prayagCodeKey);
    parsed.push({
      prayagCode,
      description: norm(row.prayag_name) || null,
      series: norm(row.prayag_series) || null,
      competitorCode: rawCompetitorCode,
      prices,
    });
  }

  if (missingPrayagCodes.length > 0) {
    throw new Error(
      `Sparsh master refers to Prayag code(s) that are not in the official catalog: ${missingPrayagCodes.join(", ")}.`,
    );
  }
  return { rows: parsed, periods };
}

export function resolveSparshEffectiveDates(
  periods: SparshMasterPeriod[],
  rawOverrides: unknown,
): string[] {
  if (rawOverrides == null || rawOverrides === "") {
    return periods.map((period) => period.sourceEffectiveDate);
  }

  let overrides: unknown = rawOverrides;
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

  const effectiveDates = overrides.map((value, index) => {
    if (typeof value !== "string" || !isIsoDate(value)) {
      throw new Error(`periodDates[${index}] must be a valid calendar date (YYYY-MM-DD).`);
    }
    return value;
  });
  if (new Set(effectiveDates).size !== effectiveDates.length) {
    throw new Error("Each Sparsh source period must have a distinct effective date.");
  }
  return effectiveDates;
}

// Locate a column whose header contains any of the keywords (excluding some).
function findCol(
  headers: string[],
  include: string[],
  exclude: string[] = [],
): number {
  for (let c = 0; c < headers.length; c++) {
    const h = headers[c] ?? "";
    if (!h) continue;
    if (exclude.some((k) => h.includes(k))) continue;
    if (include.some((k) => h.includes(k))) return c;
  }
  return -1;
}

function toDateStr(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return null;
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.y}-${p(d.m)}-${p(d.d)}`;
  }
  const s = String(v).trim();
  const m = s.match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : s.slice(0, 10) || null;
}

function parseCompetitorSheet(
  grid: unknown[][],
  knownCodes: Set<string>,
): ParsedCompetitorRow[] {
  const maxCols = Math.max(0, ...grid.map((r) => r.length));
  let headerRow = 0;
  for (let r = 0; r < Math.min(grid.length, 15); r++) {
    const strs = (grid[r] ?? []).filter(
      (v) => typeof v === "string" && norm(v).length > 0 && isNaN(Number(v)),
    );
    if (strs.length >= 2) {
      headerRow = r;
      break;
    }
  }
  const headers = (grid[headerRow] ?? []).map((h) => norm(h).toLowerCase());

  // Matched Prayag code column: prefer an explicit "matched"/"prayag code"
  // header, else the column with the most overlap against known codes.
  let codeCol = findCol(headers, ["matched", "prayag_code", "prayag code"]);
  if (codeCol === -1) {
    // Fallback: pick the column with the most overlap against known Prayag
    // codes, but only if the overlap is strong enough. This guards against
    // numeric columns (size/diameter) coincidentally matching numeric codes.
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

  // Price column: a "price"/"rate"/"cost" header that is not the Prayag MRP
  // snapshot or a diff column; else the first mostly-numeric column.
  let priceCol = findCol(
    headers,
    ["price", "rate", "cost", "mrp"],
    ["prayag", "diff"],
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

  const rows: ParsedCompetitorRow[] = [];
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
      matchedPrayagCode: rawCode || null,
    });
  }
  return rows;
}

// GET /catalog/competitor-brands — distinct brand names + their price periods.
router.get("/catalog/competitor-brands", async (_req, res) => {
  const rows = await db
    .selectDistinct({
      competitor: competitorPricesTable.competitor,
      effectiveDate: competitorPricesTable.effectiveDate,
    })
    .from(competitorPricesTable)
    .orderBy(
      asc(competitorPricesTable.competitor),
      asc(competitorPricesTable.effectiveDate),
    );

  // Group into brand → sorted effectiveDates
  const periodMap = new Map<string, string[]>();
  for (const row of rows) {
    if (!periodMap.has(row.competitor)) periodMap.set(row.competitor, []);
    if (row.effectiveDate) periodMap.get(row.competitor)!.push(row.effectiveDate);
  }

  const brands = [...periodMap.keys()].sort();
  const brandPeriods = brands.map((brand) => ({
    brand,
    effectiveDates: periodMap.get(brand) ?? [],
  }));

  res.json({ brands, brandPeriods });
});

// POST /catalog/preview-competitor — validate a workbook before the upload form
// asks the administrator to confirm any source-period date overrides.
router.post(
  "/catalog/preview-competitor",
  requireAdmin,
  upload.single("file"),
  async (req, res) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }
    const ext = file.originalname.toLowerCase().split(".").pop() ?? "";
    if (!["xlsx", "xls", "csv"].includes(ext)) {
      res.json({ isSparshMaster: false, isAshirvadMaster: false, isPrinceMaster: false });
      return;
    }

    try {
      const existingProducts = await db
        .select({ itemCode: catalogProductsTable.itemCode })
        .from(catalogProductsTable);
      const canonical = new Map<string, string>(
        existingProducts.map((product) => [normCode(product.itemCode), product.itemCode]),
      );
      const princeCanonical = new Map<string, string>(
        existingProducts.map((product) => [normalizePrinceCode(product.itemCode), product.itemCode]),
      );
      const workbook = XLSX.read(file.buffer, { type: "buffer" });
       const ashirvadMaster = parseAshirvadCompetitorMaster(
         file.buffer,
         workbook,
         canonical,
       );
      const sparshMaster = parseSparshCompetitorMaster(workbook, canonical);
      const princeMaster = (() => {
         if (!isPrinceCompetitorMasterWorkbook(workbook)) return null;
         try {
            return parsePrinceCompetitorMaster(file.buffer, workbook, princeCanonical);
         } catch (error) {
           // A workbook that is not the locked Prince snapshot is an ordinary
           // workbook; preserve the generic preview behaviour.
           if (error instanceof Error && /checksum/i.test(error.message)) return null;
           throw error;
         }
       })();

      const liveCheckCodes = ["C133", "PMR-8", "PMR-9"];
      const liveProducts = existingProducts.filter((row) => liveCheckCodes.includes(row.itemCode));
      const liveMrps = await db.execute<{ item_code: string; mrp: number | null }>(sql`
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
        currentMrp: liveMrpByCode.get(itemCode) ?? null,
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
           liveCatalogueChecks,
         } : null,
        periods: sparshMaster?.periods.map((period) => ({
          key: period.key,
          label: period.label,
          sourceEffectiveDate: period.sourceEffectiveDate,
        })) ?? [],
      });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Could not read competitor workbook.",
      });
    }
  },
);

// POST /catalog/stage-competitor-workbook — parse an Excel/CSV workbook into a
// persistent review batch.  Unlike the legacy load endpoint below, this route
// never writes competitor_prices.
router.post(
  "/catalog/stage-competitor-workbook",
  requireAdmin,
  upload.single("file"),
  async (req, res) => {
    const file = req.file;
    if (!file) { res.status(400).json({ error: "No file uploaded" }); return; }
    const competitor = typeof req.body.competitor === "string" ? req.body.competitor.trim() : "";
    if (!competitor) { res.status(400).json({ error: "competitor name is required" }); return; }
    const ext = file.originalname.toLowerCase().split(".").pop() ?? "";
    if (!["xlsx", "xls", "csv"].includes(ext)) {
      res.status(400).json({ error: "Upload an .xlsx, .xls, or .csv file" }); return;
    }

    try {
      const products = await db.select({ itemCode: catalogProductsTable.itemCode }).from(catalogProductsTable);
      const knownCodes = new Set(products.map((p) => normCode(p.itemCode)));
      const canonical = new Map(products.map((p) => [normCode(p.itemCode), p.itemCode]));
      const princeCanonical = new Map(products.map((p) => [normalizePrinceCode(p.itemCode), p.itemCode]));
      const workbook = XLSX.read(file.buffer, { type: "buffer" });
      const ashirvadMaster = parseAshirvadCompetitorMaster(file.buffer, workbook, canonical);
      const sparshMaster = parseSparshCompetitorMaster(workbook, canonical);
      const princeMaster = (() => {
        if (!isPrinceCompetitorMasterWorkbook(workbook)) return null;
        try {
          return parsePrinceCompetitorMaster(file.buffer, workbook, princeCanonical);
        } catch (error) {
          if (error instanceof Error && /checksum/i.test(error.message)) return null;
          throw error;
        }
      })();
      if (competitor === PRINCE_COMPETITOR && !princeMaster) {
        res.status(409).json({
          error: "Prince imports must use the trusted 13-sheet Competitor Master and pass its content and date gates.",
          code: "TRUSTED_PRINCE_MASTER_REQUIRED",
        });
        return;
      }
      const sourceHash = sha256ForBuffer(file.buffer);
      const priceBasis = req.body.priceBasis === "Ex-GST" ? "Ex-GST" : "MRP";
      const gstPct = priceBasis === "Ex-GST" && !isNaN(Number(req.body.gstPct))
        ? Number(req.body.gstPct) : priceBasis === "Ex-GST" ? 18 : null;

      const createBatch = async (
        batchCompetitor: string,
        effectiveDate: string,
        rows: Array<{
          prayagCode: string | null; description: string | null; variant: string | null;
          price: number | null; competitorCode: string | null; status: "ok" | "needs_review";
          prayagMrp?: number | null;
          reviewReason?: string | null;
          effectiveDate?: string;
        }>,
        counts: Record<string, unknown>,
        loadBatchId?: number | null,
      ) => {
        const [batch] = await db.insert(importBatchesTable).values({
          competitor: batchCompetitor, effectiveDate, sourceFileName: file.originalname,
          priceBasis, gstPct, status: "pending", fileSha256: sourceHash,
          fileSizeBytes: file.size, rowCounts: JSON.stringify(counts),
          loadBatchId: loadBatchId ?? null,
        }).returning();
        if (!batch) throw new Error("Could not create import batch.");
        if (rows.length) {
          await db.insert(competitorPriceStagingTable).values(rows.map((row) => ({
            batchId: batch.id, competitor: batchCompetitor,
            effectiveDate: row.effectiveDate ?? effectiveDate,
            competitorCodeMaster: row.competitorCode, competitorCodeCatalogue: row.competitorCode,
            matchedPrayagCode: row.prayagCode, description: row.description,
            catalogueDescription: row.description, variant: row.variant, oldMrp: null,
            newMrp: row.price, increasePct: null, prayagMrpCurrent: row.prayagMrp ?? null,
            gapPct: null, page: null, discoveryEvidence: null, adjudicated: false,
            matchMethod: row.prayagCode ? "code+desc" : null, status: row.status,
            reviewReason: row.reviewReason ?? (row.prayagCode ? null : "No verified Prayag product match."),
          })));
        }
        return batch.id;
      };

      if (princeMaster) {
        if (competitor !== PRINCE_COMPETITOR) {
          res.status(400).json({ error: `The trusted Prince master must be imported as ${PRINCE_COMPETITOR}.` });
          return;
        }
        const existingPrinceBatch = await db.select().from(importBatchesTable)
          .where(and(eq(importBatchesTable.competitor, PRINCE_COMPETITOR), eq(importBatchesTable.effectiveDate, PRINCE_EFFECTIVE_DATE)))
          .orderBy(desc(importBatchesTable.id));
        const existingContent = existingPrinceBatch.find((batch) => batch.status === "approved" && (() => {
          try { return JSON.parse(batch.rowCounts ?? "{}").content_fingerprint === princeMaster.contentFingerprint; } catch { return false; }
        })());
        if (existingContent) {
          const activeDecisions = await db.select({
            competitorCode: competitorMappingDecisionsTable.competitorCode,
            prayagCode: competitorMappingDecisionsTable.prayagCode,
            decision: competitorMappingDecisionsTable.decision,
            reason: competitorMappingDecisionsTable.reason,
          }).from(competitorMappingDecisionsTable).where(and(
            eq(competitorMappingDecisionsTable.competitor, PRINCE_COMPETITOR),
            sql`${competitorMappingDecisionsTable.undoneAt} IS NULL`,
          ));
          const excluded = activeDecisions.filter((decision) => decision.decision === "exclusion");
          const confirmed = activeDecisions.filter((decision) => decision.decision === "confirmation");
          const currentPrinceRows = await db.select().from(competitorPricesTable)
            .where(eq(competitorPricesTable.competitor, PRINCE_COMPETITOR));
          const sourceMappings = (() => {
            try {
              return (JSON.parse(existingContent.rowCounts ?? "{}").source_mappings ?? []) as Array<{ competitorCode?: string; princeCode?: string; prayagCode?: string; catalogMatched?: boolean }>;
            } catch { return []; }
          })();
          const observedMappings = [
            ...sourceMappings,
            ...princeMaster.rows.map((row) => ({ princeCode: row.princeCode, prayagCode: row.canonicalPrayagCode ?? row.prayagCode })),
            ...princeMaster.rejectedRows.map((row) => ({ princeCode: row.princeCode, prayagCode: row.prayagCode })),
          ];
          const excludedRows = observedMappings.filter((mapping) => excluded.some((decision) =>
            normalizePrinceCode(decision.competitorCode) === normalizePrinceCode(mapping.princeCode ?? ("competitorCode" in mapping ? mapping.competitorCode : undefined)) &&
            normCode(decision.prayagCode) === normCode(mapping.prayagCode ?? ""),
          ));
          const confirmedRows = currentPrinceRows.filter((mapping) => confirmed.some((decision) =>
            normalizePrinceCode(decision.competitorCode) === normalizePrinceCode(mapping.competitorCode),
          )).map((mapping) => ({
            competitorCode: mapping.competitorCode,
            prayagCode: mapping.matchedPrayagCode,
            decision: "confirmation",
          }));
          res.status(200).json({
            batchId: existingContent.id, batchIds: [existingContent.id], status: existingContent.status, idempotent: true,
            excluded_by_decision: excludedRows,
            excluded_by_decision_count: excludedRows.length,
            active_excluded_decisions: excludedRows.length ? [] : excluded,
            active_excluded_decision_count: excludedRows.length ? 0 : excluded.length,
            confirmed_by_decision: confirmedRows.length ? confirmedRows : confirmed,
            confirmed_by_decision_count: confirmedRows.length || confirmed.length,
            decisions: activeDecisions,
          });
          return;
        }
        const decisions = await db.select().from(competitorMappingDecisionsTable).where(and(
          eq(competitorMappingDecisionsTable.competitor, PRINCE_COMPETITOR),
          sql`${competitorMappingDecisionsTable.undoneAt} IS NULL`,
        ));
        const excludedPairs = new Set(
          decisions.filter((d) => d.decision === "exclusion")
            .map((d) => `${normalizePrinceCode(d.competitorCode)}|${normCode(d.prayagCode)}`),
        );
        const confirmedCodes = new Set(
          decisions.filter((d) => d.decision === "confirmation")
            .map((d) => normalizePrinceCode(d.competitorCode)),
        );
        const excludedByDecision: Array<{ competitorCode: string; prayagCode: string | null; reason: string }> = [];
        const shouldExclude = (competitorCode: string | null, prayagCode: string | null) => {
          const key = `${normalizePrinceCode(competitorCode)}|${normCode(prayagCode ?? "")}`;
          const excluded = excludedPairs.has(key);
          if (excluded) {
            const decision = decisions.find((d) =>
              d.decision === "exclusion" &&
              normalizePrinceCode(d.competitorCode) === normalizePrinceCode(competitorCode) &&
              normCode(d.prayagCode) === normCode(prayagCode ?? ""),
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
            status: row.catalogMatched ? "ok" as const : "needs_review" as const,
            reviewReason: row.catalogMatched ? null : "No verified Prayag product match.",
            effectiveDate: row.effectiveDate,
          })),
          ...princeMaster.rejectedRows.map((row) => ({
            prayagCode: row.prayagCode,
            description: null,
            variant: null,
            price: row.price,
            competitorCode: row.princeCode || null,
            status: "needs_review" as const,
            reviewReason: row.reason,
            effectiveDate: PRINCE_EFFECTIVE_DATE,
          })),
        ].filter((row) => !shouldExclude(row.competitorCode, row.prayagCode));
        const retainedPrinceRows = princeMaster.rows.filter((row) => !excludedPairs.has(
          `${normalizePrinceCode(row.princeCode)}|${normCode(row.canonicalPrayagCode ?? row.prayagCode)}`,
        ));
        const duplicateAnomalies = classifyPrinceDuplicateAnomalies(retainedPrinceRows, confirmedCodes);
        const stagedRows = stagedRowsBeforeAnomalyClassification.map((staged) => {
          const anomaly = duplicateAnomalies.get(
            `${normalizePrinceCode(staged.competitorCode)}|${normCode(staged.prayagCode ?? "")}`,
          );
          return anomaly ? { ...staged, status: anomaly.status, reviewReason: anomaly.reason } : staged;
        });
        const confirmedByDecision = princeMaster.rows
          .filter((row) => confirmedCodes.has(normalizePrinceCode(row.princeCode)))
          .map((row) => ({
            competitorCode: row.princeCode,
            prayagCode: row.canonicalPrayagCode ?? row.prayagCode,
            decision: "confirmation",
            reason: decisions.find((d) => d.decision === "confirmation" && normalizePrinceCode(d.competitorCode) === normalizePrinceCode(row.princeCode))?.reason ?? "Confirmed by decision.",
          }));
        const excludedRejectedRows = new Set(excludedByDecision.map((row) =>
          `${normalizePrinceCode(row.competitorCode)}|${normCode(row.prayagCode ?? "")}`,
        ));
        const rejectedRowsForReport = princeMaster.rejectedRows.filter((row) =>
          !excludedRejectedRows.has(`${normalizePrinceCode(row.princeCode)}|${normCode(row.prayagCode)}`),
        );
        const stagedOkCount = stagedRows.filter((row) => row.status === "ok").length;
        const stagedReviewCount = stagedRows.filter((row) => row.status === "needs_review").length;
        const actor = req.user?.email ?? req.user?.id ?? null;
        let provenanceLoadBatchId: number | null = null;
        const [source] = await db.insert(mrpSourcesTable).values({
          division: "Prince competitor",
          sheetId: "prince-competitor-master",
          sheetUrl: "internal://prince-competitor-master",
          expectedFileName: null,
          notes: "Trusted P027r2 Prince competitor source",
          sourceKind: "competitor",
        }).onConflictDoNothing().returning();
        const sourceRow = source ?? (await db.select({ id: mrpSourcesTable.id }).from(mrpSourcesTable)
          .where(eq(mrpSourcesTable.sheetId, "prince-competitor-master")).limit(1))[0];
        if (sourceRow) {
          const [load] = await db.insert(mrpLoadBatchesTable).values({
            sourceId: sourceRow.id,
            fileName: file.originalname,
            fileSha256: princeMaster.sourceSha256,
            fileSizeBytes: file.size,
            downloadedAt: new Date().toISOString().slice(0, 10),
            loadedBy: actor,
            rowCount: princeMaster.contentFingerprint ? 950 : princeMaster.rows.length,
            notes: JSON.stringify({ contentFingerprint: princeMaster.contentFingerprint }),
          }).returning();
          provenanceLoadBatchId = load?.id ?? null;
        }
        const batchId = await createBatch(
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
            source_effective_date: "per-worksheet",
          },
          provenanceLoadBatchId,
        );
        // Re-check under the same advisory lock used by P034r2 apply and by
        // approval. A decision committed while parsing cannot leave an
        // excluded pair in a newly-created staging batch.
        await db.transaction(async (tx) => {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(340342)`);
          const activeExclusions = await tx.select().from(competitorMappingDecisionsTable).where(and(
            eq(competitorMappingDecisionsTable.competitor, PRINCE_COMPETITOR),
            eq(competitorMappingDecisionsTable.decision, "exclusion"),
            sql`${competitorMappingDecisionsTable.undoneAt} IS NULL`,
          ));
          for (const decision of activeExclusions) {
            await tx.execute(sql`
              DELETE FROM competitor_price_staging
              WHERE batch_id = ${batchId}
                AND competitor_code_master = ${decision.competitorCode}
                AND matched_prayag_code = ${decision.prayagCode}
            `);
          }
        });
        res.status(201).json({
          batchId, batchIds: [batchId], status: "pending",
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
            duplicateAnomaliesClearedByDecision: [...duplicateAnomalies.values()].filter((value) => value.confirmedByDecision).length,
          },
        });
        return;
      }

      if (ashirvadMaster) {
        if (competitor !== ASHIRVAD_MASTER_COMPETITOR) {
          res.status(400).json({ error: `The trusted Ashirvad master must be imported as ${ASHIRVAD_MASTER_COMPETITOR}.` }); return;
        }
        const batchId = await createBatch(
          ASHIRVAD_MASTER_COMPETITOR, ASHIRVAD_MASTER_EFFECTIVE_DATE,
          ashirvadMaster.map((row) => ({ prayagCode: row.prayagCode, description: row.description,
            variant: null, price: row.price, competitorCode: row.competitorCode, status: "ok" as const })),
          { ok: ashirvadMaster.length, needs_review: 0, not_found: 0, new_products: 0,
            source: "trusted_ashirvad_competitor_master", source_sha256: ASHIRVAD_MASTER_SHA256,
            source_effective_date: ASHIRVAD_MASTER_EFFECTIVE_DATE,
            reason: "Trusted one-to-one Ashirvad competitor mapping; review-only Prayag fields ignored." },
        );
        res.status(201).json({ batchId, batchIds: [batchId], status: "pending" }); return;
      }

      if (sparshMaster) {
        if (competitor !== SPARSH_MASTER_COMPETITOR) {
          res.status(400).json({ error: `The ${SPARSH_MASTER_SHEET} workbook must be imported as ${SPARSH_MASTER_COMPETITOR}.` }); return;
        }
        let dates: string[];
        try { dates = resolveSparshEffectiveDates(sparshMaster.periods, req.body.periodDates); }
        catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Invalid Sparsh effective dates." }); return; }
        const batchIds = await Promise.all(sparshMaster.periods.map((period, index) => createBatch(
          SPARSH_MASTER_COMPETITOR, dates[index]!,
          sparshMaster.rows.map((row) => ({ prayagCode: row.prayagCode, description: row.description,
            variant: null, price: row.prices[period.sourceEffectiveDate], competitorCode: row.competitorCode, status: "ok" as const })),
          { ok: sparshMaster.rows.length, needs_review: 0, not_found: 0, new_products: 0,
            source: "authoritative_sparsh_competitor_master", source_effective_date: period.sourceEffectiveDate,
            effective_date_overridden: dates[index] !== period.sourceEffectiveDate },
        )));
        res.status(201).json({ batchId: batchIds[0], batchIds, status: "pending" }); return;
      }

      const effectiveDate = typeof req.body.effectiveDate === "string" ? req.body.effectiveDate.trim() : "";
      if (!isIsoDate(effectiveDate)) {
        res.status(400).json({ error: "effectiveDate is required and must be a valid YYYY-MM-DD calendar date." }); return;
      }
      const currentMrpResult = await db.execute<{ item_code: string; mrp: number | null }>(sql`
        SELECT DISTINCT ON (h.item_code) h.item_code, h.mrp FROM mrp_price_history h
        JOIN catalog_products p ON p.item_code = h.item_code
        WHERE h.effective_date <= CURRENT_DATE AND h.review_status = 'approved'
          AND h.variant = 'Standard' AND p.is_active IS TRUE
          AND (p.discontinued_from IS NULL OR p.discontinued_from > CURRENT_DATE)
        ORDER BY h.item_code, h.effective_date DESC, h.id DESC`);
      const currentMrp = new Map(currentMrpResult.rows.filter((r) => r.mrp != null).map((r) => [normCode(r.item_code), r.mrp!]));
      let parsed: ParsedCompetitorRow[] = [];
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) continue;
        const candidate = parseCompetitorSheet(XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null }), knownCodes);
        if (candidate.length > parsed.length) parsed = candidate;
      }
      let matched = 0; let needsReview = 0;
      const rows = parsed.map((row) => {
        const norm = row.matchedPrayagCode;
        let matchedCode = !!norm && knownCodes.has(norm);
        const prayagMrp = matchedCode ? currentMrp.get(norm!) ?? null : null;
        if (matchedCode && prayagMrp && prayagMrp > 0) {
          const gap = ((effectivePrice(row.unit, row.price) - prayagMrp) / prayagMrp) * 100;
          if (gap < GAP_MIN_PCT || gap > GAP_MAX_PCT) matchedCode = false;
        }
        if (matchedCode) matched++; else needsReview++;
        return { prayagCode: matchedCode ? (canonical.get(norm!) ?? norm!) : null, description: row.description,
          variant: row.size, price: row.price, competitorCode: null, status: matchedCode ? "ok" as const : "needs_review" as const,
          prayagMrp: matchedCode ? prayagMrp : null };
      });
      const batchId = await createBatch(competitor, effectiveDate, rows, {
        ok: matched, needs_review: needsReview, not_found: 0, new_products: 0, total: rows.length,
      });
      res.status(201).json({ batchId, batchIds: [batchId], status: "pending" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not stage competitor workbook.";
      res.status(400).json({ error: message });
    }
  },
);

// POST /catalog/load-competitor — upload a competitor workbook (any brand).
router.post(
  "/catalog/load-competitor",
  requireAdmin,
  upload.single("file"),
  async (req, res) => {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }
    const competitor =
      typeof req.body.competitor === "string" && req.body.competitor.trim()
        ? req.body.competitor.trim()
        : null;
    if (!competitor) {
      res.status(400).json({ error: "competitor name is required" });
      return;
    }
    if (competitor === PRINCE_COMPETITOR) {
      res.status(409).json({
        error: "Prince trusted workbooks must use preview → stage → approve; the legacy direct-load route is disabled.",
        code: "TRUSTED_STAGE_REQUIRED",
      });
      return;
    }

    const name = file.originalname;
    const ext = name.toLowerCase().split(".").pop() ?? "";
    if (!["xlsx", "xls", "csv"].includes(ext)) {
      res.status(400).json({ error: "Upload an .xlsx, .xls, or .csv file" });
      return;
    }

    try {
      const existingProducts = await db
        .select({ itemCode: catalogProductsTable.itemCode })
        .from(catalogProductsTable);
      const knownCodes = new Set(
        existingProducts.map((p) => normCode(p.itemCode)),
      );
      const canonical = new Map<string, string>(
        existingProducts.map((p) => [normCode(p.itemCode), p.itemCode]),
      );
      const wb = XLSX.read(file.buffer, { type: "buffer" });
       const ashirvadMaster = parseAshirvadCompetitorMaster(
         file.buffer,
         wb,
         canonical,
       );
      const sparshMaster = parseSparshCompetitorMaster(wb, canonical);
       // Apollo pipe sheets share names with Prince's trusted workbook. Never
       // run the Prince date/position parser on an Apollo upload.
       const princeMaster = competitor.trim().toLowerCase() === "apollo" ? null : (() => {
         try {
           return parsePrinceCompetitorMaster(file.buffer, wb, canonical);
         } catch (error) {
           if (error instanceof Error && /checksum/i.test(error.message)) return null;
           throw error;
         }
       })();

        if (princeMaster) {
          if (competitor !== PRINCE_COMPETITOR) {
            res.status(400).json({
              error: `The trusted Prince master must be imported as ${PRINCE_COMPETITOR}.`,
            });
            return;
          }
          const sourceHash = princeMaster.sourceSha256;
          const existingBatch = await db
            .select({ id: importBatchesTable.id, rowCounts: importBatchesTable.rowCounts })
            .from(importBatchesTable)
            .where(and(
              eq(importBatchesTable.competitor, PRINCE_COMPETITOR),
              eq(importBatchesTable.effectiveDate, PRINCE_EFFECTIVE_DATE),
              eq(importBatchesTable.fileSha256, sourceHash),
              eq(importBatchesTable.status, "approved"),
            ))
            .limit(1);
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
                batchId: existingBatch[0]!.id,
                sourceMappings: existingBatch[0]!.rowCounts
                  ? (JSON.parse(existingBatch[0]!.rowCounts) as { source_mappings?: unknown[] }).source_mappings ?? []
                  : [],
              },
            });
            return;
          }
          const values = princeMaster.catalogMatchedRows.map((row) => ({
            competitor: PRINCE_COMPETITOR,
            category: row.category,
            description: null,
            size: row.lengthMeters ? `${row.lengthMeters} m` : null,
            price: row.price,
            unit: "MRP",
            competitorCode: row.princeCode,
            effectiveDate: PRINCE_EFFECTIVE_DATE,
            matchedPrayagCode: row.canonicalPrayagCode!,
            matchStatus: "matched",
            matchConfidence: "High",
            prayagMrpAtCompare: null,
            isCurrent: false,
            priceBasis: "MRP",
            gstPct: null,
          }));
          let insertedBatchId: number | null = null;
          await db.transaction(async (tx) => {
            await tx.delete(competitorPricesTable).where(and(
              eq(competitorPricesTable.competitor, PRINCE_COMPETITOR),
              eq(competitorPricesTable.effectiveDate, PRINCE_EFFECTIVE_DATE),
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
                matched: values.length,
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
                  catalogMatched: row.catalogMatched,
                })),
                source: "trusted_prince_competitor_master",
                source_sha256: sourceHash,
                source_effective_date: PRINCE_EFFECTIVE_DATE,
              }),
              extractionModel: null,
              fileSha256: sourceHash,
              fileSizeBytes: file.size,
              extractorVersion: null,
              catalogueProfileRevision: null,
              promptRevision: null,
              model: null,
              pagesRequested: null,
              passesRun: null,
              itemsAdjudicated: null,
            }).returning({ id: importBatchesTable.id });
            insertedBatchId = batch?.id ?? null;
            for (let index = 0; index < values.length; index += 200) {
              await tx.insert(competitorPricesTable).values(values.slice(index, index + 200));
            }
            await recomputeCompetitorCurrentFlagsInTransaction(PRINCE_COMPETITOR, tx);
          });
          res.json({
            results: {
              competitor: PRINCE_COMPETITOR,
              file: name,
              totalRows: princeMaster.rows.length,
              inserted: values.length,
              matched: values.length,
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
                 catalogMatched: row.catalogMatched,
               })),
            },
          });
          return;
        }

        if (ashirvadMaster) {
         if (competitor !== ASHIRVAD_MASTER_COMPETITOR) {
           res.status(400).json({
             error: `The trusted Ashirvad master must be imported as ${ASHIRVAD_MASTER_COMPETITOR}.`,
           });
           return;
         }
         const sourceHash = sha256ForBuffer(file.buffer);
         const values = ashirvadMaster.map((row) => ({
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
           gstPct: null,
         }));

         await db.transaction(async (tx) => {
           // Replacement scope is only this brand and this trusted period.
           // No catalogue or Prayag MRP writer is called in this path.
           await tx
             .delete(competitorPricesTable)
             .where(
               and(
                 eq(competitorPricesTable.competitor, ASHIRVAD_MASTER_COMPETITOR),
                 eq(competitorPricesTable.effectiveDate, ASHIRVAD_MASTER_EFFECTIVE_DATE),
               ),
             );
           await tx.insert(importBatchesTable).values({
             competitor: ASHIRVAD_MASTER_COMPETITOR,
             effectiveDate: ASHIRVAD_MASTER_EFFECTIVE_DATE,
             sourceFileName: name,
             priceBasis: "MRP",
             gstPct: null,
             status: "approved",
             rowCounts: JSON.stringify({
               total: values.length,
               matched: values.length,
               direct_code: values.length,
               source: "trusted_ashirvad_competitor_master",
               source_sha256: ASHIRVAD_MASTER_SHA256,
               source_effective_date: ASHIRVAD_MASTER_EFFECTIVE_DATE,
               reason: "Trusted one-to-one Ashirvad competitor mapping; review-only Prayag fields ignored.",
             }),
             extractionModel: null,
             fileSha256: sourceHash,
             fileSizeBytes: file.size,
             extractorVersion: null,
             catalogueProfileRevision: null,
             promptRevision: null,
             model: null,
             pagesRequested: null,
             passesRun: null,
             itemsAdjudicated: null,
           });
           await tx.insert(competitorPricesTable).values(values);
           await recomputeCompetitorCurrentFlagsInTransaction(
             ASHIRVAD_MASTER_COMPETITOR,
             tx,
           );
         });

         req.log?.info(
           { rows: values.length, effectiveDate: ASHIRVAD_MASTER_EFFECTIVE_DATE },
           "Adopted trusted Ashirvad competitor master",
         );
         res.json({
           results: {
             competitor: ASHIRVAD_MASTER_COMPETITOR,
             file: name,
             totalRows: values.length,
             inserted: values.length,
             matched: values.length,
             unmatched: 0,
             rejectedByGap: 0,
             effectiveDate: ASHIRVAD_MASTER_EFFECTIVE_DATE,
             fileSha256: sourceHash,
           },
         });
         return;
       }

      if (sparshMaster) {
        if (competitor !== SPARSH_MASTER_COMPETITOR) {
          res.status(400).json({
            error: `The ${SPARSH_MASTER_SHEET} workbook must be imported as ${SPARSH_MASTER_COMPETITOR}.`,
          });
          return;
        }

        let effectiveDates: string[];
        try {
          effectiveDates = resolveSparshEffectiveDates(
            sparshMaster.periods,
            req.body.periodDates,
          );
        } catch (error) {
          res.status(400).json({
            error: error instanceof Error ? error.message : "Invalid Sparsh effective dates.",
          });
          return;
        }

        const sourceHash = sha256ForBuffer(file.buffer);
        const directMatchCount = sparshMaster.rows.length;
        const values = sparshMaster.periods.flatMap((period, periodIndex) =>
          sparshMaster.rows.map((row) => ({
            competitor: SPARSH_MASTER_COMPETITOR,
            category: row.series,
            description: row.description,
            size: null,
            price: row.prices[period.sourceEffectiveDate],
            unit: "MRP",
            competitorCode: row.competitorCode,
            effectiveDate: effectiveDates[periodIndex]!,
            matchedPrayagCode: row.prayagCode,
            matchStatus: "matched",
            // The workbook carries a verified direct mapping, rather than a
            // guessed description/size result, so the generic gap guardrail
            // intentionally does not demote these audited rows.
            matchConfidence: "High",
            prayagMrpAtCompare: null,
            isCurrent: false,
            priceBasis: "MRP",
            gstPct: null,
          })),
        );

        await db.transaction(async (tx) => {
          // The master is the authoritative full Sparsh mapping. Remove only
          // this competitor's superseded rows; all Prayag tables, other brands,
          // and the retained historical alias register remain untouched.
          await tx
            .delete(competitorPricesTable)
            .where(eq(competitorPricesTable.competitor, SPARSH_MASTER_COMPETITOR));

          for (const [periodIndex, period] of sparshMaster.periods.entries()) {
            const effectiveDate = effectiveDates[periodIndex]!;
            const periodValues = values.filter(
              (value) => value.effectiveDate === effectiveDate,
            );
            await tx.insert(importBatchesTable).values({
              competitor: SPARSH_MASTER_COMPETITOR,
              effectiveDate,
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
                effective_date_overridden: effectiveDate !== period.sourceEffectiveDate,
              }),
              extractionModel: null,
              fileSha256: sourceHash,
              fileSizeBytes: file.size,
              extractorVersion: null,
              catalogueProfileRevision: null,
              promptRevision: null,
              model: null,
              pagesRequested: null,
              passesRun: null,
              itemsAdjudicated: null,
            });
            await tx.insert(competitorPricesTable).values(periodValues);
          }
          await recomputeCompetitorCurrentFlagsInTransaction(
            SPARSH_MASTER_COMPETITOR,
            tx,
          );
        });

        req.log?.info(
          {
            rows: values.length,
            periods: sparshMaster.periods.map((period, index) => ({
              sourceEffectiveDate: period.sourceEffectiveDate,
              effectiveDate: effectiveDates[index],
            })),
          },
          "Adopted authoritative Sparsh competitor master",
        );
        res.json({
          results: {
            competitor: SPARSH_MASTER_COMPETITOR,
            file: name,
            totalRows: values.length,
            inserted: values.length,
            matched: values.length,
            unmatched: 0,
            rejectedByGap: 0,
            periods: sparshMaster.periods.map((period, index) => ({
              label: period.label,
              sourceEffectiveDate: period.sourceEffectiveDate,
              effectiveDate: effectiveDates[index],
              overridden: effectiveDates[index] !== period.sourceEffectiveDate,
              inserted: directMatchCount,
              directMatches: directMatchCount,
              descSizeMatches: 0,
            })),
          },
        });
        return;
      }

       // P045 Apollo's raw master does contain Prayag mappings, but must not
       // pass through the generic loader. The workbook uses grouped two-row
       // headers (including
       // duplicate ITEM CODE/MRP columns), and cannot safely be parsed by the
       // generic loader.  Reject before any write rather than risk importing
       // a Prayag reference as an Apollo SKU or silently dropping a sheet.
       if (isApolloRawMaster(wb)) {
          if (competitor.trim().toLowerCase() === APOLLO_COMPETITOR.toLowerCase()) {
            const effectiveDateBody =
              typeof req.body.effectiveDate === "string" && req.body.effectiveDate.trim()
                ? req.body.effectiveDate.trim()
                : null;
            if (!effectiveDateBody) {
              res.status(400).json({ error: "effectiveDate (YYYY-MM-DD) is required" });
              return;
            }
            if (!isIsoDate(effectiveDateBody)) {
              res.status(400).json({ error: "effectiveDate must be a valid calendar date (YYYY-MM-DD)" });
              return;
            }
            const effectiveDate = effectiveDateBody;
            const sourceHash = sha256ForBuffer(file.buffer);
            let parsedApollo: ApolloMasterParse;
            try {
              parsedApollo = parseApolloMaster(file.buffer);
            } catch (error) {
              res.status(422).json({
                error: error instanceof Error ? error.message : "Apollo master could not be safely parsed.",
                code: "APOLLO_RAW_MASTER_MAPPING_REQUIRED",
                noWrites: true,
              });
              return;
            }
            // Reservations are product identities, not merely historical
            // codes. Validate them before reading/writing any import state so
            // a mistaken re-use cannot create a batch or price rows.
            const storedReservations = await db.select({
              competitorCode: apolloReservationsTable.competitorCode,
              ownerIdentity: apolloReservationsTable.ownerIdentity,
            }).from(apolloReservationsTable).where(
              eq(apolloReservationsTable.competitor, APOLLO_COMPETITOR),
            );
            const incomingReservations = new Map(
              parsedApollo.reservations.map((reservation) => [
                reservation.code.toUpperCase(),
                reservation.owner,
              ]),
            );
            for (const row of parsedApollo.rows) {
              if (row.codeSource === "locally_assigned") {
                const owner = apolloPipeIdentityV2(row.category, row.prayagCode, row.size);
                if (owner) incomingReservations.set(row.competitorCode.toUpperCase(), owner);
              }
            }
            for (const stored of storedReservations) {
              const incomingOwner = incomingReservations.get(stored.competitorCode.toUpperCase());
              if (incomingOwner && incomingOwner !== stored.ownerIdentity) {
                res.status(409).json({
                  error: `Apollo reserved code ${stored.competitorCode} belongs to ${stored.ownerIdentity}, not ${incomingOwner}`,
                  code: "APOLLO_RESERVATION_OWNER_MISMATCH",
                  competitorCode: stored.competitorCode,
                  noWrites: true,
                });
                return;
              }
            }
            const existingApollo = await db.execute<{
              id: number; competitor_code: string | null; code_source: string | null;
              description: string | null; size: string | null; matched_prayag_code: string | null; category: string | null;
            }>(sql`SELECT id, competitor_code, code_source, description, size, matched_prayag_code, category
                   FROM competitor_prices WHERE competitor = ${APOLLO_COMPETITOR}`);
            const allCompetitorCodes = await db.execute<{
              competitor: string; competitor_code: string | null; code_source: string | null;
              matched_prayag_code: string | null;
            }>(
              sql`SELECT competitor, competitor_code, code_source, matched_prayag_code
                  FROM competitor_prices WHERE competitor_code IS NOT NULL`,
            );
            const existingByIdentity = existingApollo.rows.map((row) => ({
              id: row.id,
              competitorCode: row.competitor_code,
              codeSource: row.code_source as "supplier" | "locally_assigned" | null,
              description: row.description,
              size: row.size,
              matchedPrayagCode: row.matched_prayag_code,
              category: row.category,
            }));
            const conflictCodes = new Set(parsedApollo.conflicts.map((conflict) => normCode(conflict.competitorCode)));
            const accepted: typeof parsedApollo.rows = [];
            const acceptedPrayagCodes = new Set<string>();
            const skipped: Array<{ sheet: string; sourceRow: number; reason: string; prayagCode: string | null }> = [];
            for (const row of parsedApollo.rows) {
              const codeKey = normCode(row.competitorCode);
              if (conflictCodes.has(codeKey)) {
                skipped.push({ sheet: row.sheet, sourceRow: row.sourceRow, prayagCode: row.prayagCode, reason: "supplier price conflict requires review" });
                continue;
              }
              let prayagCode = row.prayagCode ? canonical.get(normCode(row.prayagCode)) ?? null : null;
              const identity = row.codeSource === "locally_assigned"
                ? apolloPipeIdentityV2(row.category, row.prayagCode, row.size)
                : null;
              const matches = identity
                ? existingByIdentity.filter((candidate) =>
                    candidate.codeSource === "locally_assigned" &&
                    apolloPipeIdentityV2(candidate.category, candidate.matchedPrayagCode, candidate.size) === identity)
                : existingByIdentity.filter((candidate) =>
                    candidate.codeSource === "supplier" &&
                    normCode(candidate.competitorCode) === codeKey);
              // The same verified mapping can legitimately occur in several
              // historical periods; ambiguity means distinct Prayag mappings,
              // not repeated rows for one mapping.
              const distinctMappingKeys = new Set(matches.map((match) => normCode(match.matchedPrayagCode)));
              if (matches.length > 1 && distinctMappingKeys.size === 1) {
                matches.splice(1);
              }
              if (!prayagCode && matches.length === 1) prayagCode = matches[0]!.matchedPrayagCode
                ? canonical.get(normCode(matches[0]!.matchedPrayagCode)) ?? null : null;
              if (matches.length > 1) {
                skipped.push({ sheet: row.sheet, sourceRow: row.sourceRow, prayagCode: row.prayagCode, reason: "ambiguous existing Apollo mapping" });
                continue;
              }
              if (!prayagCode) {
                skipped.push({ sheet: row.sheet, sourceRow: row.sourceRow, prayagCode: row.prayagCode, reason: "unmapped Prayag code" });
                continue;
              }
              const prayagKey = normCode(prayagCode);
              if (acceptedPrayagCodes.has(prayagKey)) {
                skipped.push({ sheet: row.sheet, sourceRow: row.sourceRow, prayagCode, reason: "duplicate Prayag mapping for effective date" });
                continue;
              }
              // A locally assigned code may only collide with its own verified mapping.
              const collides = allCompetitorCodes.rows.some((candidate) =>
                normCode(candidate.competitor_code) === codeKey &&
                !(
                  candidate.competitor === APOLLO_COMPETITOR &&
                  candidate.code_source === row.codeSource &&
                  normCode(candidate.matched_prayag_code) === prayagKey
                ));
              if (collides) {
                res.status(409).json({
                  error: `Apollo competitor code collision: ${row.competitorCode}`,
                  code: "APOLLO_COMPETITOR_CODE_COLLISION",
                  competitorCode: row.competitorCode,
                  noWrites: true,
                });
                return;
              }
              accepted.push({ ...row, prayagCode });
              acceptedPrayagCodes.add(prayagKey);
            }
            const values = accepted.map((row) => ({
              competitor: APOLLO_COMPETITOR,
              category: row.category,
              description: row.description,
              size: row.size,
              price: row.price,
              unit: "MRP",
              competitorCode: row.competitorCode,
              codeSource: row.codeSource,
              effectiveDate,
              matchedPrayagCode: canonical.get(normCode(row.prayagCode!))!,
              matchStatus: "matched",
              matchConfidence: "High",
              prayagMrpAtCompare: null,
              isCurrent: false,
              priceBasis: "MRP",
              gstPct: null,
            }));
            let batchId: number | null = null;
            let idempotent = false;
            let insertedCount = 0;
            let updatedCount = 0;
            let unchangedCount = 0;
             const idempotentInfo: { counts: {
               matched?: number;
               skipped?: typeof skipped;
               coverage_gaps?: typeof parsedApollo.coverageGaps;
               conflicts?: typeof parsedApollo.conflicts;
             } | null } = { counts: null };
            await db.transaction(async (tx) => {
              await tx.execute(sql`SELECT pg_advisory_xact_lock(917045)`);
              const prior = await tx.select({ id: importBatchesTable.id, rowCounts: importBatchesTable.rowCounts })
                .from(importBatchesTable).where(and(
                  eq(importBatchesTable.competitor, APOLLO_COMPETITOR),
                  eq(importBatchesTable.effectiveDate, effectiveDate),
                  eq(importBatchesTable.fileSha256, sourceHash),
                  eq(importBatchesTable.status, "approved"),
                )).limit(1);
              if (prior.length) {
                batchId = prior[0]!.id;
                idempotent = true;
                 idempotentInfo.counts = prior[0]!.rowCounts
                   ? JSON.parse(prior[0]!.rowCounts) as typeof idempotentInfo.counts
                   : null;
                return;
              }
              const lockedReservations = await tx.select({
                competitorCode: apolloReservationsTable.competitorCode,
                ownerIdentity: apolloReservationsTable.ownerIdentity,
              }).from(apolloReservationsTable).where(
                eq(apolloReservationsTable.competitor, APOLLO_COMPETITOR),
              );
              for (const existing of lockedReservations) {
                const incomingOwner = incomingReservations.get(existing.competitorCode.toUpperCase());
                if (incomingOwner && incomingOwner !== existing.ownerIdentity) {
                  throw Object.assign(
                    new Error(`Apollo reserved code ${existing.competitorCode} belongs to ${existing.ownerIdentity}, not ${incomingOwner}`),
                    { httpStatus: 409 },
                  );
                }
              }
              for (const reservation of parsedApollo.reservations) {
                const existing = lockedReservations.find((row) =>
                  row.competitorCode.toUpperCase() === reservation.code.toUpperCase());
                if (existing && existing.ownerIdentity !== reservation.owner) {
                  throw Object.assign(
                    new Error(`Apollo reserved code ${reservation.code} belongs to ${existing.ownerIdentity}, not ${reservation.owner}`),
                    { httpStatus: 409 },
                  );
                }
                await tx.insert(apolloReservationsTable).values({
                  competitor: APOLLO_COMPETITOR,
                  competitorCode: reservation.code,
                  ownerIdentity: reservation.owner,
                  prayagCode: reservation.prayagCode,
                  sourceSheet: reservation.sourceSheet ?? "UGD PIPE",
                  sourceRow: reservation.sourceRow ?? 0,
                  sourceFileName: name,
                }).onConflictDoNothing({
                  target: [apolloReservationsTable.competitor, apolloReservationsTable.competitorCode],
                });
              }
              // Recheck against the locked, current competitor set.  The
              // preflight snapshot above is only for user feedback; this is
              // the write-safety check that prevents a local code shadowing a
              // supplier code inserted concurrently.
              const lockedCodes = await tx.execute<{
                competitor: string; competitor_code: string | null;
                code_source: string | null; matched_prayag_code: string | null;
              }>(sql`SELECT competitor, competitor_code, code_source, matched_prayag_code
                     FROM competitor_prices WHERE competitor_code IS NOT NULL`);
              for (const value of values) {
                const collision = lockedCodes.rows.some((candidate) =>
                  normCode(candidate.competitor_code) === normCode(value.competitorCode) &&
                  !(
                    candidate.competitor === APOLLO_COMPETITOR &&
                    candidate.code_source === value.codeSource &&
                    normCode(candidate.matched_prayag_code) === normCode(value.matchedPrayagCode)
                  ));
                if (collision) {
                  throw Object.assign(
                    new Error(`Apollo competitor code collision: ${value.competitorCode}`),
                    { httpStatus: 409 },
                  );
                }
              }
              const periodRows = await tx.select({
                id: competitorPricesTable.id,
                competitorCode: competitorPricesTable.competitorCode,
                codeSource: competitorPricesTable.codeSource,
                description: competitorPricesTable.description,
                size: competitorPricesTable.size,
                matchedPrayagCode: competitorPricesTable.matchedPrayagCode,
                category: competitorPricesTable.category,
                price: competitorPricesTable.price,
                unit: competitorPricesTable.unit,
                matchStatus: competitorPricesTable.matchStatus,
                matchConfidence: competitorPricesTable.matchConfidence,
                prayagMrpAtCompare: competitorPricesTable.prayagMrpAtCompare,
                priceBasis: competitorPricesTable.priceBasis,
                gstPct: competitorPricesTable.gstPct,
              }).from(competitorPricesTable).where(and(
                eq(competitorPricesTable.competitor, APOLLO_COMPETITOR),
                eq(competitorPricesTable.effectiveDate, effectiveDate),
              ));
              const [batch] = await tx.insert(importBatchesTable).values({
                competitor: APOLLO_COMPETITOR, effectiveDate, sourceFileName: name,
                priceBasis: "MRP", gstPct: null, status: "approved",
                rowCounts: JSON.stringify({
                  total: parsedApollo.rows.length, inserted: values.length, matched: values.length,
                  coverage_gaps: parsedApollo.coverageGaps, unpriced: parsedApollo.unpriced,
                  conflicts: parsedApollo.conflicts, skipped, renames: parsedApollo.renames,
                  pipe_count: parsedApollo.pipeCount, fitting_count: parsedApollo.fittingCount,
                  source: "apollo_grouped_master_reviewed_mapping", source_sha256: sourceHash,
                }),
                extractionModel: null, fileSha256: sourceHash, fileSizeBytes: file.size,
                extractorVersion: null, catalogueProfileRevision: null, promptRevision: null,
                model: null, pagesRequested: null, passesRun: null, itemsAdjudicated: null,
              }).returning({ id: importBatchesTable.id });
              batchId = batch?.id ?? null;
              for (const value of values) {
                const current = periodRows.find((candidate) =>
                  normCode(candidate.matchedPrayagCode) === normCode(value.matchedPrayagCode));
                if (current) {
                  const localIdentityMatches = value.codeSource === "locally_assigned" &&
                    current.codeSource === "locally_assigned" &&
                    apolloPipeIdentityV2(current.category, current.matchedPrayagCode, current.size) === apolloPipeIdentityV2(value.category, value.matchedPrayagCode, value.size);
                  const supplierCodeMatches = value.codeSource === "supplier" &&
                    current.codeSource === "supplier" &&
                    normCode(current.competitorCode) === normCode(value.competitorCode);
                  if (!localIdentityMatches && !supplierCodeMatches) {
                    throw Object.assign(new Error(`Apollo mapping provenance changed for Prayag code ${value.matchedPrayagCode}`), {
                      httpStatus: 409,
                    });
                  }
                  const changed = [
                    ["category", current.category, value.category],
                    ["description", current.description, value.description],
                    ["size", current.size, value.size],
                    ["price", current.price, value.price],
                    ["unit", current.unit, value.unit],
                    ["competitorCode", current.competitorCode, value.codeSource === "locally_assigned" ? current.competitorCode : value.competitorCode],
                    ["codeSource", current.codeSource, value.codeSource],
                    ["matchStatus", current.matchStatus, value.matchStatus],
                    ["matchConfidence", current.matchConfidence, value.matchConfidence],
                    ["priceBasis", current.priceBasis, value.priceBasis],
                    ["gstPct", current.gstPct, value.gstPct],
                  ].some(([, before, after]) => before !== after);
                  if (!changed) {
                    unchangedCount++;
                    continue;
                  }
                  await tx.update(competitorPricesTable).set({
                    category: value.category,
                    description: value.description,
                    size: value.size,
                    price: value.price,
                    unit: value.unit,
                    // A revised file must not replace an established local code.
                    competitorCode: value.codeSource === "locally_assigned" ? current.competitorCode : value.competitorCode,
                    codeSource: value.codeSource,
                    matchStatus: value.matchStatus,
                    matchConfidence: value.matchConfidence,
                    priceBasis: value.priceBasis,
                    gstPct: value.gstPct,
                  }).where(eq(competitorPricesTable.id, current.id));
                  updatedCount++;
                } else {
                   // This FK belongs to MRP load batches, not competitor import
                   // batches. The Apollo import is recorded in import_batches.
                   await tx.insert(competitorPricesTable).values(value);
                  insertedCount++;
                }
              }
              if (insertedCount || updatedCount) {
                await recomputeCompetitorCurrentFlagsInTransaction(APOLLO_COMPETITOR, tx);
              }
              await tx.update(importBatchesTable).set({
                rowCounts: JSON.stringify({
                  total: parsedApollo.rows.length, inserted: insertedCount, updated: updatedCount,
                  unchanged: unchangedCount, matched: insertedCount + updatedCount + unchangedCount,
                  coverage_gaps: parsedApollo.coverageGaps, unpriced: parsedApollo.unpriced,
                  conflicts: parsedApollo.conflicts, skipped, renames: parsedApollo.renames,
                  pipe_count: parsedApollo.pipeCount, fitting_count: parsedApollo.fittingCount,
                  source: "apollo_grouped_master_reviewed_mapping", source_sha256: sourceHash,
                }),
              }).where(eq(importBatchesTable.id, batchId!));
            });
            res.json({ results: {
              competitor: APOLLO_COMPETITOR, file: name, effectiveDate, fileSha256: sourceHash,
              batchId, totalRows: parsedApollo.rows.length, inserted: idempotent ? 0 : insertedCount,
               updated: idempotent ? 0 : updatedCount,
               unchanged: idempotent ? (idempotentInfo.counts?.matched ?? values.length) : unchangedCount,
              matched: idempotent ? 0 : insertedCount + updatedCount + unchangedCount,
               // The stored skipped list describes the original source load.
               // A repeat processes no rows, so it skips none.
               skipped: idempotent ? [] : skipped,
               coverageGaps: idempotent ? (idempotentInfo.counts?.coverage_gaps ?? parsedApollo.coverageGaps) : parsedApollo.coverageGaps,
               conflicts: idempotent ? (idempotentInfo.counts?.conflicts ?? parsedApollo.conflicts) : parsedApollo.conflicts,
              idempotent, noPrayagWrites: true,
            } });
            return;
          }
         res.status(422).json({
           error: "P045 Apollo raw master rejected: grouped two-row headers require explicit column mapping review; no rows were written.",
           code: "APOLLO_RAW_MASTER_MAPPING_REQUIRED",
           limitation: "The importer does not safely distinguish Apollo price columns from Prayag reference columns in this workbook format.",
           noWrites: true,
         });
         return;
       }
       if (competitor.trim().toLowerCase() === APOLLO_COMPETITOR.toLowerCase()) {
         res.status(422).json({
           error: "P045 Apollo upload rejected: competitor code provenance was not explicitly parsed; no rows were written.",
           code: "APOLLO_PROVENANCE_REQUIRED",
           noWrites: true,
         });
         return;
       }

      const effectiveDateBody =
        typeof req.body.effectiveDate === "string" && req.body.effectiveDate.trim()
          ? req.body.effectiveDate.trim()
          : null;
      if (!effectiveDateBody) {
        res.status(400).json({ error: "effectiveDate (YYYY-MM-DD) is required" });
        return;
      }
      if (!isIsoDate(effectiveDateBody)) {
        res.status(400).json({ error: "effectiveDate must be a valid calendar date (YYYY-MM-DD)" });
        return;
      }
      const effectiveDate = effectiveDateBody;

      // Current MRP per normalized code, used by the price-gap guardrail.
      const currentMrpResult = await db.execute<{
        item_code: string;
        mrp: number | null;
      }>(sql`
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
      const currentMrp = new Map<string, number>();
      for (const r of currentMrpResult.rows) {
        if (r.mrp != null) currentMrp.set(normCode(r.item_code), r.mrp);
      }

      let parsed: ParsedCompetitorRow[] = [];
      for (const sheetName of wb.SheetNames) {
        const sheet = wb.Sheets[sheetName];
        if (!sheet) continue;
        const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
          header: 1,
          defval: null,
        });
        const sheetRows = parseCompetitorSheet(grid, knownCodes);
        if (sheetRows.length > parsed.length) parsed = sheetRows;
      }

      if (parsed.length === 0) {
        res.json({
          results: {
            competitor,
            file: name,
            totalRows: 0,
            inserted: 0,
            matched: 0,
            unmatched: 0,
            message:
              "No price rows detected. Check the sheet has a price column.",
          },
        });
        return;
      }

      let matched = 0;
      let rejectedByGap = 0;
      const values = parsed.map((r) => {
        const norm = r.matchedPrayagCode;
        let isMatched = !!norm && knownCodes.has(norm);
        // Snapshot of the catalog's current MRP at import time. Raw competitor
        // sheets carry no Prayag MRP, so we persist this onto the row so the
        // analysis gap can use it directly (never a later catalog lookup).
        let prayagMrpSnapshot: number | null = null;
        // Price-gap guardrail: even a code that exists is sent to review when
        // the gap vs Prayag's current MRP is unrealistically large — that
        // almost always means the wrong products were linked.
        if (isMatched) {
          const prayagMrp = currentMrp.get(norm!);
          if (prayagMrp != null && prayagMrp > 0) {
            prayagMrpSnapshot = prayagMrp;
            const eff = effectivePrice(r.unit, r.price);
            const gapPct = ((eff - prayagMrp) / prayagMrp) * 100;
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
          matchedPrayagCode: isMatched ? (canonical.get(norm!) ?? norm) : null,
          codeSource: "supplier" as const,
          matchStatus: isMatched ? "matched" : "no match (review)",
          matchConfidence: isMatched ? "High" : null,
          prayagMrpAtCompare: prayagMrpSnapshot,
          // All new rows start as not current; recompute below sets the flag.
          isCurrent: false,
        };
      });

      // Period-aware: delete only the rows for this (competitor, effectiveDate)
      // so older periods are preserved. A different effectiveDate adds a new period.
      await db.transaction(async (tx) => {
        await tx
          .delete(competitorPricesTable)
          .where(
            sql`competitor = ${competitor} AND effective_date = ${effectiveDate}`,
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
          totalRows: parsed.length,
          inserted: values.length,
          matched,
          unmatched: values.length - matched,
          rejectedByGap,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to parse and load file";
      const httpStatus = typeof err === "object" && err !== null && "httpStatus" in err
        ? Number((err as { httpStatus?: number }).httpStatus)
        : 0;
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
  },
);

// GET /catalog/mrp-periods — list all MRP effective dates with row counts.
router.get("/catalog/mrp-periods", async (_req, res) => {
  const rows = await db
    .select({
      effectiveDate: mrpPriceHistoryTable.effectiveDate,
      count: sql<number>`cast(count(*) as integer)`,
    })
    .from(mrpPriceHistoryTable)
    .groupBy(mrpPriceHistoryTable.effectiveDate)
    .orderBy(desc(mrpPriceHistoryTable.effectiveDate));

  res.json({ periods: rows.map((r) => ({ effectiveDate: r.effectiveDate, count: r.count })) });
});

// DELETE /catalog/mrp-period/:date — remove all mrp_price_history rows for a
// specific effective date and re-run the current-flag computation atomically.
// Rejects if this is the only remaining period (catalog must always have at
// least one price period so products have a current MRP).
//
// All reads, the guard check, the delete, and the flag recomputation run
// inside a single serializable transaction with an exclusive table lock so
// that concurrent deletions or uploads cannot race past the single-period
// guard and leave zero periods behind.
router.delete("/catalog/mrp-period/:date", requireAdmin, async (req, res) => {
  const date = String(req.params.date ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: "date param must be YYYY-MM-DD" });
    return;
  }

  try {
    await db.transaction(async (tx) => {
      // Lock the table exclusively for the duration of this transaction so
      // concurrent deletes or inserts cannot race past the period-count guard.
      await tx.execute(
        sql`LOCK TABLE mrp_price_history IN SHARE ROW EXCLUSIVE MODE`,
      );

      // Re-read the period list inside the lock.
      const allPeriods = await tx
        .selectDistinct({ effectiveDate: mrpPriceHistoryTable.effectiveDate })
        .from(mrpPriceHistoryTable);

      // Check target existence first so we always return 404 for an absent
      // date, regardless of how many periods remain.
      const target = allPeriods.find((p) => p.effectiveDate === date);
      if (!target) {
        throw Object.assign(
          new Error(`No MRP period found for date ${date}`),
          { httpStatus: 404 },
        );
      }

      if (allPeriods.length <= 1) {
        throw Object.assign(
          new Error("Cannot delete the only remaining MRP period. At least one price period must exist."),
          { httpStatus: 409 },
        );
      }

      const rowsToDelete = await tx
        .select({
          id: mrpPriceHistoryTable.id,
          itemCode: mrpPriceHistoryTable.itemCode,
          effectiveDate: mrpPriceHistoryTable.effectiveDate,
          mrp: mrpPriceHistoryTable.mrp,
          sourceFile: mrpPriceHistoryTable.sourceFile,
          loadBatchId: mrpPriceHistoryTable.loadBatchId,
        })
        .from(mrpPriceHistoryTable)
        .where(eq(mrpPriceHistoryTable.effectiveDate, date));

      await tx.insert(mrpHistoryProvenanceEventsTable).values(
        rowsToDelete.map((row) => ({
          historyRowId: row.id,
          itemCode: row.itemCode,
          effectiveDate: row.effectiveDate,
          action: "period_deleted",
          sourceFile: row.sourceFile,
          loadBatchId: row.loadBatchId,
          mrp: row.mrp,
        })),
      );
      await tx
        .delete(mrpPriceHistoryTable)
        .where(eq(mrpPriceHistoryTable.effectiveDate, date));

      // Inline recomputeCurrentFlags so it runs inside the same transaction.
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
    });
  } catch (err: any) {
    const status: number = err.httpStatus ?? 500;
    if (status < 500) {
      res.status(status).json({ error: err.message });
    } else {
      req.log.error({ err, date }, "mrp-period delete failed");
      res.status(500).json({ error: "Failed to delete MRP period" });
    }
    return;
  }

  res.json({ deleted: date });
});

// Move an existing MRP period without changing any prices. A target date must
// be unused so the append-only (code, date, variant) history remains intact.
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
      await tx.execute(sql`LOCK TABLE mrp_price_history IN SHARE ROW EXCLUSIVE MODE`);
      const [source, destination] = await Promise.all([
        tx.select({ id: mrpPriceHistoryTable.id }).from(mrpPriceHistoryTable)
          .where(eq(mrpPriceHistoryTable.effectiveDate, currentEffectiveDate)).limit(1),
        tx.select({ id: mrpPriceHistoryTable.id }).from(mrpPriceHistoryTable)
          .where(eq(mrpPriceHistoryTable.effectiveDate, newEffectiveDate)).limit(1),
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
        mrp: mrpPriceHistoryTable.mrp,
      }).from(mrpPriceHistoryTable)
        .where(eq(mrpPriceHistoryTable.effectiveDate, currentEffectiveDate));
      await tx.insert(mrpHistoryProvenanceEventsTable).values(rows.map((row) => ({
        historyRowId: row.id,
        itemCode: row.itemCode,
        effectiveDate: newEffectiveDate,
        action: "period_effective_date_changed",
        reason: `Effective date corrected from ${currentEffectiveDate} to ${newEffectiveDate}`,
        sourceFile: row.sourceFile,
        loadBatchId: row.loadBatchId,
        mrp: row.mrp,
      })));
      await tx.update(mrpPriceHistoryTable)
        .set({ effectiveDate: newEffectiveDate, isCurrent: false })
        .where(eq(mrpPriceHistoryTable.effectiveDate, currentEffectiveDate));
      await tx.execute(sql`
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
  } catch (err: any) {
    const status = err.httpStatus ?? 500;
    if (status < 500) res.status(status).json({ error: err.message });
    else {
      req.log.error({ err, currentEffectiveDate, newEffectiveDate }, "mrp period date update failed");
      res.status(500).json({ error: "Failed to change MRP period date" });
    }
  }
});

// Move every price row for a competitor period. Keep periods separate rather
// than silently merging them, and refresh the brand's active-price flags.
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
      await tx.execute(sql`LOCK TABLE competitor_prices IN SHARE ROW EXCLUSIVE MODE`);
      const [source, destination] = await Promise.all([
        tx.select({ id: competitorPricesTable.id }).from(competitorPricesTable)
          .where(and(eq(competitorPricesTable.competitor, competitor), eq(competitorPricesTable.effectiveDate, currentEffectiveDate))).limit(1),
        tx.select({ id: competitorPricesTable.id }).from(competitorPricesTable)
          .where(and(eq(competitorPricesTable.competitor, competitor), eq(competitorPricesTable.effectiveDate, newEffectiveDate))).limit(1),
      ]);
      if (source.length === 0) {
        throw Object.assign(new Error(`No ${competitor} period found for ${currentEffectiveDate}`), { httpStatus: 404 });
      }
      if (destination.length > 0) {
        throw Object.assign(new Error(`${competitor} already has a period for ${newEffectiveDate}. Choose an unused date.`), { httpStatus: 409 });
      }
      const result = await tx.update(competitorPricesTable)
        .set({ effectiveDate: newEffectiveDate, isCurrent: false, updatedAt: new Date() })
        .where(and(eq(competitorPricesTable.competitor, competitor), eq(competitorPricesTable.effectiveDate, currentEffectiveDate)))
        .returning({ id: competitorPricesTable.id });
      await recomputeCompetitorCurrentFlagsInTransaction(competitor, tx);
      return result.length;
    });
    res.json({ moved, competitor, previousEffectiveDate: currentEffectiveDate, effectiveDate: newEffectiveDate });
  } catch (err: any) {
    const status = err.httpStatus ?? 500;
    if (status < 500) res.status(status).json({ error: err.message });
    else {
      req.log.error({ err, competitor, currentEffectiveDate, newEffectiveDate }, "competitor period date update failed");
      res.status(500).json({ error: "Failed to change competitor period date" });
    }
  }
});

// P029: the fixed, sibling-driven UGD classification repair. This deliberately
// does not accept arbitrary codes or values: the preview is the only source of
// truth used by apply, and both operations are administrator-only.
router.post("/catalog/ugd-classification/preview", requireAdmin, async (req, res) => {
  try {
    const products = await db.select().from(catalogProductsTable)
      .where(inArray(catalogProductsTable.itemCode, P029_PAIRS.flat()));
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
        siblingCode, itemCode, previousValues, correctedValues,
        name: target.productName,
        siblingName: sibling.productName,
      };
    });
    const prices = await db.select({
      itemCode: mrpPriceHistoryTable.itemCode,
      mrp: mrpPriceHistoryTable.mrp,
    }).from(mrpPriceHistoryTable).where(and(
      inArray(mrpPriceHistoryTable.itemCode, P029_PAIRS.flat()),
      eq(mrpPriceHistoryTable.variant, "Standard"),
      eq(mrpPriceHistoryTable.reviewStatus, "approved"),
    )).orderBy(desc(mrpPriceHistoryTable.effectiveDate), desc(mrpPriceHistoryTable.id));
    const latest = new Map<string, number | null>();
    for (const row of prices) if (!latest.has(row.itemCode)) latest.set(row.itemCode, row.mrp);
    const priceChecks = P029_PAIRS.map(([siblingCode, itemCode]) => ({
      siblingCode, itemCode, siblingMrp: latest.get(siblingCode) ?? null, targetMrp: latest.get(itemCode) ?? null,
      expectedMrp: P029_EXPECTED_MRPS[siblingCode],
      matches: latest.get(siblingCode) === latest.get(itemCode) &&
        latest.get(siblingCode) === P029_EXPECTED_MRPS[siblingCode],
    }));
    if (priceChecks.some((row) => !row.matches)) {
      throw new Error("P029 preview stopped: every sibling and Self Fit MRP must match the exact P029 expected MRP.");
    }
    const correctionKey = randomUUID();
    const actor = req.user?.email ?? req.user?.id ?? null;
    await db.insert(catalogProductClassificationCorrectionsTable).values(rows.map((row) => ({
      correctionKey, itemCode: row.itemCode, siblingCode: row.siblingCode,
      previousValues: JSON.stringify(row.previousValues), correctedValues: JSON.stringify(row.correctedValues), actor,
    })));
    res.json({
      correctionKey, status: "preview", rows, priceChecks,
      copiedFields: P029_CLASSIFICATION_FIELDS,
      sizeAction: "unchanged: all siblings and targets verified null",
      canApply: true,
    });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Could not create P029 preview." });
  }
});

router.post("/catalog/ugd-classification/:correctionKey/apply", requireAdmin, async (req, res) => {
  const correctionKey = String(req.params.correctionKey ?? "").trim();
  if (!correctionKey) { res.status(400).json({ error: "correctionKey is required." }); return; }
  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(929007)`);
      const rows = await tx.select().from(catalogProductClassificationCorrectionsTable)
        .where(and(eq(catalogProductClassificationCorrectionsTable.correctionKey, correctionKey), sql`${catalogProductClassificationCorrectionsTable.appliedAt} IS NULL`));
      if (rows.length !== P029_PAIRS.length) throw new Error("P029 preview not found, already applied, or incomplete.");
      const products = await tx.select().from(catalogProductsTable)
        .where(inArray(catalogProductsTable.itemCode, P029_PAIRS.flat())).for("update");
      if (products.length !== P029_PAIRS.length * 2) throw new Error("P029 apply stopped: one or more locked products is missing.");
      const byCode = new Map(products.map((row) => [row.itemCode, row]));
      for (const row of rows) {
        const current = byCode.get(row.itemCode);
        if (!current || JSON.stringify(Object.fromEntries(P029_CLASSIFICATION_FIELDS.map((field) => [field, current[field]]))) !== row.previousValues) {
          throw new Error(`P029 preview is stale for ${row.itemCode}; create a new preview.`);
        }
      }
      // Re-read every sibling and target MRP while holding the transaction
      // lock. A price may have changed after Preview; never classify against a
      // stale price verification.
      const mrpRows = await tx.select({
        itemCode: mrpPriceHistoryTable.itemCode,
        mrp: mrpPriceHistoryTable.mrp,
      }).from(mrpPriceHistoryTable).where(and(
        inArray(mrpPriceHistoryTable.itemCode, P029_PAIRS.flat()),
        eq(mrpPriceHistoryTable.variant, "Standard"),
        eq(mrpPriceHistoryTable.reviewStatus, "approved"),
      )).orderBy(desc(mrpPriceHistoryTable.effectiveDate), desc(mrpPriceHistoryTable.id));
      const latestMrp = new Map<string, number | null>();
      for (const row of mrpRows) if (!latestMrp.has(row.itemCode)) latestMrp.set(row.itemCode, row.mrp);
      for (const [siblingCode, itemCode] of P029_PAIRS) {
        if (!latestMrp.has(siblingCode) || !latestMrp.has(itemCode) ||
            latestMrp.get(siblingCode) !== latestMrp.get(itemCode) ||
            latestMrp.get(siblingCode) !== P029_EXPECTED_MRPS[siblingCode]) {
          throw new Error(`P029 apply stopped: MRP mismatch for ${siblingCode} -> ${itemCode}; create a new preview.`);
        }
      }
      await tx.insert(mrpSourcesTable).values(P029_CLASSIFICATION_SOURCE).onConflictDoNothing();
      const [source] = await tx.select({ id: mrpSourcesTable.id }).from(mrpSourcesTable).where(eq(mrpSourcesTable.sheetId, P029_CLASSIFICATION_SOURCE.sheetId)).limit(1);
      if (!source) throw new Error("P029 provenance source could not be created.");
      const actor = req.user?.email ?? req.user?.id ?? null;
      const [load] = await tx.insert(mrpLoadBatchesTable).values({
        sourceId: source.id, fileName: P029_CLASSIFICATION_SOURCE.expectedFileName!,
        fileSha256: P029_CLASSIFICATION_FILE_HASH, fileSizeBytes: Buffer.byteLength("P029|UGD Self Fit classification sibling-copy contract|v1"),
        downloadedAt: new Date().toISOString().slice(0, 10), loadedBy: actor, rowCount: rows.length,
        notes: "P029 classification-only correction; no price rows written.",
      }).returning({ id: mrpLoadBatchesTable.id });
      if (!load) throw new Error("P029 provenance batch could not be created.");
      for (const row of rows) {
        const updated = await tx.update(catalogProductsTable).set({
          ...JSON.parse(row.correctedValues),
          updatedAt: new Date(),
        }).where(eq(catalogProductsTable.itemCode, row.itemCode)).returning({ id: catalogProductsTable.id });
        if (updated.length !== 1) throw new Error(`P029 apply stopped: compare-and-swap failed for ${row.itemCode}.`);
      }
      const audited = await tx.update(catalogProductClassificationCorrectionsTable).set({ loadBatchId: load.id, actor, appliedAt: new Date() })
        .where(and(eq(catalogProductClassificationCorrectionsTable.correctionKey, correctionKey), sql`${catalogProductClassificationCorrectionsTable.appliedAt} IS NULL`));
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
      await tx.execute(sql`SELECT pg_advisory_xact_lock(929007)`);
      const rows = await tx.select().from(catalogProductClassificationCorrectionsTable)
        .where(and(eq(catalogProductClassificationCorrectionsTable.correctionKey, correctionKey), sql`${catalogProductClassificationCorrectionsTable.appliedAt} IS NOT NULL AND ${catalogProductClassificationCorrectionsTable.undoneAt} IS NULL`));
      if (rows.length !== P029_PAIRS.length) throw new Error("P029 correction is not applied, already undone, or incomplete.");
      const products = await tx.select().from(catalogProductsTable)
        .where(inArray(catalogProductsTable.itemCode, rows.map((row) => row.itemCode))).for("update");
      if (products.length !== P029_PAIRS.length) {
        throw new Error("P029 undo stopped: one or more locked products is missing.");
      }
      const byCode = new Map(products.map((row) => [row.itemCode, row]));
      const currentValues = (row: typeof rows[number]) => {
        const current = byCode.get(row.itemCode);
        return current
          ? JSON.stringify(Object.fromEntries(P029_CLASSIFICATION_FIELDS.map((field) => [field, current[field]])))
          : null;
      };
      const alreadyRestored = rows.every((row) => currentValues(row) === row.previousValues);
      const stillApplied = rows.every((row) => currentValues(row) === row.correctedValues);
      if (!alreadyRestored && !stillApplied) {
        throw new Error("P029 undo stopped: one or more products changed after apply.");
      }
      if (!alreadyRestored) {
        for (const row of rows) {
          const restored = await tx.update(catalogProductsTable)
            .set({ ...JSON.parse(row.previousValues), updatedAt: new Date() })
            .where(eq(catalogProductsTable.itemCode, row.itemCode))
            .returning({ id: catalogProductsTable.id });
          if (restored.length !== 1) {
            throw new Error(`P029 undo stopped: compare-and-swap failed for ${row.itemCode}.`);
          }
        }
      }
      const audited = await tx.update(catalogProductClassificationCorrectionsTable).set({ undoneAt: new Date(), undoneBy: req.user?.email ?? req.user?.id ?? null })
        .where(and(eq(catalogProductClassificationCorrectionsTable.correctionKey, correctionKey), sql`${catalogProductClassificationCorrectionsTable.undoneAt} IS NULL`));
      if (audited.rowCount !== P029_PAIRS.length) {
        throw new Error("P029 undo stopped: audit rows changed concurrently.");
      }
      return {
        correctionKey,
        restored: alreadyRestored ? 0 : rows.length,
        alreadyRestored,
        status: "undone",
      };
    }, { isolationLevel: "serializable" });
    res.json(result);
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : "Could not undo P029 correction." });
  }
});

export default router;
