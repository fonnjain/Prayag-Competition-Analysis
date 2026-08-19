import { Router, type IRouter, type Request, type Response } from "express";
import { sql, eq, ne, asc, desc, and } from "drizzle-orm";
import * as XLSX from "xlsx";
import {
  db,
  competitorPricesTable,
  catalogProductsTable,
  mrpPriceHistoryTable,
  acceptBatchesTable,
} from "@workspace/db";
import { normCode, recomputeCompetitorCurrentFlags } from "../lib/catalog";
import { buildCandidate, suggestMatches, type CatalogCandidate } from "../lib/suggest";
import { catalogVersion, topSuggestionTier } from "../lib/suggestCache";
import {
  computeCompareNorm,
  NO_NORM,
  normalizePerMetre,
  type NormResult,
} from "../lib/priceNormalize";
import { priceChangePct, validToFromNextDateOrDiscontinuation, validToFromNextDate } from "../lib/priceWindow";
import {
  effectivePrice,
  marketGapPct,
  prayagCheaperForGap,
} from "../lib/analysis.js";

const router: IRouter = Router();

// Stream an array-of-arrays as a CSV or XLSX download.
function sendSheet(
  res: Response,
  aoa: (string | number | null)[][],
  sheetName: string,
  fileBase: string,
  format: string,
): void {
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
}

interface PrayagInfo {
  mrp: number | null;
  effectiveDate: string | null;
  validTo: string | null;
  upcomingMrp: number | null;
  upcomingEffectiveDate: string | null;
  upcomingChangePct: number | null;
  productName: string | null;
  discontinuedFrom: string | null;
}

// Current MRP + product name, keyed by normalized item code, for live joins.
// Date-driven: DISTINCT ON (item_code) WHERE effective_date <= today, never
// relies on the is_current flag which can go stale between recompute runs.
async function getPrayagMaps(): Promise<Map<string, PrayagInfo>> {
  const d = new Date();
  const todayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  type PriceRow = { item_code: string; mrp: number | null; effective_date: string | null };

  const [currentResult, upcomingResult, products] = await Promise.all([
    db.execute<PriceRow>(sql`
      SELECT DISTINCT ON (item_code) item_code, mrp, effective_date
      FROM mrp_price_history
      WHERE effective_date <= ${todayStr}
        AND mrp IS NOT NULL
        AND review_status = 'approved'
      ORDER BY item_code, effective_date DESC, id DESC
    `),
    db.execute<PriceRow>(sql`
      SELECT DISTINCT ON (item_code) item_code, mrp, effective_date
      FROM mrp_price_history
      WHERE effective_date > ${todayStr}
        AND mrp IS NOT NULL
        AND review_status = 'approved'
      ORDER BY item_code, effective_date ASC, id DESC
    `),
    db.select({
      itemCode: catalogProductsTable.itemCode,
      productName: catalogProductsTable.productName,
      discontinuedFrom: catalogProductsTable.discontinuedFrom,
    })
      .from(catalogProductsTable)
      .where(and(
        eq(catalogProductsTable.isActive, true),
        sql`(${catalogProductsTable.discontinuedFrom} is null or ${catalogProductsTable.discontinuedFrom} > ${todayStr})`,
      )),
  ]);

  const nameMap = new Map<string, string | null>();
  for (const p of products) nameMap.set(normCode(p.itemCode), p.productName);

  const upcomingMap = new Map<string, PriceRow>();
  for (const row of upcomingResult.rows) {
    upcomingMap.set(normCode(row.item_code), row);
  }

  const map = new Map<string, PrayagInfo>();
  for (const c of currentResult.rows) {
    const key = normCode(c.item_code);
    if (!nameMap.has(key)) continue;
    const scheduled = upcomingMap.get(key);
    const discontinuedFrom = products.find((p) => normCode(p.itemCode) === key)?.discontinuedFrom ?? null;
    const upcoming =
      scheduled && (!discontinuedFrom || scheduled.effective_date! < discontinuedFrom)
        ? scheduled
        : undefined;
    map.set(key, {
      mrp: c.mrp,
      effectiveDate: c.effective_date,
      validTo: validToFromNextDateOrDiscontinuation(
        upcoming?.effective_date ?? null,
        discontinuedFrom,
      ),
      upcomingMrp: upcoming?.mrp ?? null,
      upcomingEffectiveDate: upcoming?.effective_date ?? null,
      upcomingChangePct: priceChangePct(c.mrp, upcoming?.mrp ?? null),
      productName: nameMap.get(key) ?? null,
      discontinuedFrom,
    });
  }
  // Include catalog products that have a name but no in-force price.
  for (const p of products) {
    const key = normCode(p.itemCode);
    if (!map.has(key)) {
      map.set(key, {
        mrp: null,
        effectiveDate: null,
        validTo: null,
        upcomingMrp: null,
        upcomingEffectiveDate: null,
        upcomingChangePct: null,
        productName: p.productName,
        discontinuedFrom: p.discontinuedFrom,
      });
    }
  }
  return map;
}

// Catalog products with their current MRP, prepared for fuzzy matching. Built
// once per request so per-row scoring is cheap.
async function getCatalogCandidates(): Promise<CatalogCandidate[]> {
  const _cd = new Date();
  const todayForCandidates = `${_cd.getFullYear()}-${String(_cd.getMonth() + 1).padStart(2, "0")}-${String(_cd.getDate()).padStart(2, "0")}`;
  const products = await db
    .select({
      itemCode: catalogProductsTable.itemCode,
      productName: catalogProductsTable.productName,
      division: catalogProductsTable.division,
      category: catalogProductsTable.category,
      size: catalogProductsTable.size,
      isActive: catalogProductsTable.isActive,
      discontinuedFrom: catalogProductsTable.discontinuedFrom,
    })
    .from(catalogProductsTable)
    .where(and(
      eq(catalogProductsTable.isActive, true),
      sql`(${catalogProductsTable.discontinuedFrom} is null or ${catalogProductsTable.discontinuedFrom} > ${todayForCandidates})`,
    ));
  type MrpPriceRow = { item_code: string; mrp: number | null };
  const currentMrps = await db.execute<MrpPriceRow>(sql`
    SELECT DISTINCT ON (item_code) item_code, mrp
    FROM mrp_price_history
    WHERE effective_date <= ${todayForCandidates}
      AND review_status = 'approved'
    ORDER BY item_code, effective_date DESC, id DESC
  `);

  const mrpByCode = new Map<string, number | null>();
  for (const c of currentMrps.rows) mrpByCode.set(normCode(c.item_code), c.mrp);

  return products.map((p) =>
    buildCandidate({
      itemCode: p.itemCode,
      productName: p.productName,
      category: p.category,
      division: p.division,
      size: p.size,
      currentMrp: mrpByCode.get(normCode(p.itemCode)) ?? null,
    }),
  );
}

type CompRow = typeof competitorPricesTable.$inferSelect;

interface CompetitorWindow {
  isCurrent: boolean;
  validTo: string | null;
  upcomingPrice: number | null;
  upcomingEffectiveDate: string | null;
  upcomingChangePct: number | null;
}

interface PendingRevision {
  effectiveDate: string;
  reviewStatus: string;
}

function competitorWindowKey(row: CompRow): string {
  const mapping = row.matchedPrayagCode
    ? `matched:${normCode(row.matchedPrayagCode)}`
    : `unmatched:${row.competitorCode ?? ""}:${row.description ?? ""}:${row.size ?? ""}`;
  return `${row.competitor}\u0000${mapping}`;
}

function getCompetitorWindows(rows: CompRow[]): Map<number, CompetitorWindow> {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const groups = new Map<string, CompRow[]>();
  for (const row of rows) {
    const key = competitorWindowKey(row);
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const result = new Map<number, CompetitorWindow>();
  for (const list of groups.values()) {
    const revisionsByDate = new Map<string, CompRow>();
    for (const row of list) {
      if (row.effectiveDate == null || row.price == null) continue;
      const existing = revisionsByDate.get(row.effectiveDate);
      if (!existing || row.id > existing.id) {
        revisionsByDate.set(row.effectiveDate, row);
      }
    }
    const revisions = [...revisionsByDate.values()].sort((a, b) =>
      a.effectiveDate!.localeCompare(b.effectiveDate!),
    );
    const current =
      revisions.filter((row) => row.effectiveDate! <= todayStr).at(-1);

    for (const row of list) {
      const isWinningRevision =
        row.effectiveDate != null &&
        row.price != null &&
        revisionsByDate.get(row.effectiveDate)?.id === row.id;
      const next =
        !isWinningRevision
          ? undefined
          : revisions.find(
              (candidate) => candidate.effectiveDate! > row.effectiveDate!,
            );
      result.set(row.id, {
        isCurrent: isWinningRevision && row.id === current?.id,
        validTo:
          !isWinningRevision
            ? null
            : validToFromNextDate(next?.effectiveDate ?? null),
        upcomingPrice: !isWinningRevision ? null : (next?.price ?? null),
        upcomingEffectiveDate:
          !isWinningRevision ? null : (next?.effectiveDate ?? null),
        upcomingChangePct:
          !isWinningRevision
            ? null
            : priceChangePct(row.price, next?.price ?? null),
      });
    }
  }
  return result;
}

// The official gap uses the latest confirmed ("matched") revision. A newer
// unconfirmed mapping must never displace that price, but reviewers still need
// to know why the displayed market price is older than the latest upload.
function getPendingRevisions(rows: CompRow[]): Map<number, PendingRevision> {
  const result = new Map<number, PendingRevision>();
  const byKey = new Map<string, CompRow[]>();
  for (const row of rows) {
    if (!row.matchedPrayagCode) continue;
    const key = `${row.competitor}\u0000${normCode(row.matchedPrayagCode)}`;
    const list = byKey.get(key) ?? [];
    list.push(row);
    byKey.set(key, list);
  }

  for (const list of byKey.values()) {
    for (const confirmed of list) {
      if (
        confirmed.matchStatus !== "matched" ||
        confirmed.effectiveDate == null ||
        confirmed.price == null
      ) {
        continue;
      }
      const pending = list
        .filter(
          (candidate) =>
            candidate.matchStatus !== "matched" &&
            candidate.price != null &&
            candidate.effectiveDate != null &&
            candidate.effectiveDate > confirmed.effectiveDate!,
        )
        .sort(
          (a, b) =>
            b.effectiveDate!.localeCompare(a.effectiveDate!) || b.id - a.id,
        )[0];
      if (pending?.effectiveDate) {
        result.set(confirmed.id, {
          effectiveDate: pending.effectiveDate,
          reviewStatus: pending.matchStatus,
        });
      }
    }
  }
  return result;
}

async function getAllCompetitorWindows(): Promise<Map<number, CompetitorWindow>> {
  const rows = await db.select().from(competitorPricesTable);
  return getCompetitorWindows(rows);
}

// The official market-gap population uses the newest confirmed mapping, not a
// stale matched revision superseded by an unreviewed/rejected revision. Keeping
// this window separate lets the row-list still display history for review while
// every comparable KPI shares the dashboard/report definition.
async function getAllMatchedCompetitorWindows(): Promise<Map<number, CompetitorWindow>> {
  const rows = await db
    .select()
    .from(competitorPricesTable)
    .where(eq(competitorPricesTable.matchStatus, "matched"));
  return getCompetitorWindows(rows);
}

function buildComparisonRow(
  c: CompRow,
  maps: Map<string, PrayagInfo>,
  window?: CompetitorWindow,
  matchedWindow?: CompetitorWindow,
  pendingRevision?: PendingRevision,
) {
  const key = c.matchedPrayagCode ? normCode(c.matchedPrayagCode) : null;
  const prayag = key ? maps.get(key) : undefined;
  const prayagMrp = prayag?.mrp ?? null;
  const competitorEffectivePrice =
    c.price == null
      ? null
      : effectivePrice(c.unit, c.price, c.priceBasis, c.gstPct);
  const rawGapPct =
    c.matchStatus === "matched" && (matchedWindow?.isCurrent ?? window?.isCurrent ?? true)
      ? marketGapPct(prayagMrp, competitorEffectivePrice)
      : null;
  const diffPct = rawGapPct == null ? null : Math.round(rawGapPct * 10) / 10;
  const prayagCheaper = prayagCheaperForGap(rawGapPct);

  // Reduce length-based prices (pipes/coils) to a per-metre basis so the diff
  // is like-for-like; flag rows whose unit basis is ambiguous for review.
  // Rows without a competitor price (verified mapping, MRP pending) skip
  // normalization entirely — there is nothing to compare yet.
  const norm =
    competitorEffectivePrice == null
      ? NO_NORM
      : computeCompareNorm({
          prayagName: prayag?.productName ?? null,
          prayagMrp,
          description: c.description,
          size: c.size,
          unit: c.unit,
          price: competitorEffectivePrice,
        });
  const effectiveDiffPct = rawGapPct == null
    ? null
    : norm.unitAmbiguous
    ? null
    : norm.lengthNormalized
      ? norm.perMetreDiffPct
      : diffPct;
  const effectivePrayagCheaper = prayagCheaperForGap(effectiveDiffPct);

  return {
    id: c.id,
    competitor: c.competitor,
    category: c.category,
    description: c.description,
    size: c.size,
    competitorPrice: c.price,
    unit: c.unit,
    effectiveDate: c.effectiveDate,
    competitorValidTo: window?.validTo ?? null,
    upcomingCompetitorPrice: window?.upcomingPrice ?? null,
    upcomingCompetitorEffectiveDate: window?.upcomingEffectiveDate ?? null,
    upcomingCompetitorChangePct: window?.upcomingChangePct ?? null,
    competitorPriceIsCurrent: window?.isCurrent ?? true,
    newerRevisionAwaitingReview: pendingRevision != null,
    newerRevisionEffectiveDate: pendingRevision?.effectiveDate ?? null,
    newerRevisionReviewStatus: pendingRevision?.reviewStatus ?? null,
    matchedPrayagCode: c.matchedPrayagCode,
    matchStatus: c.matchStatus,
    matchConfidence: c.matchConfidence,
    prayagProductName: prayag?.productName ?? null,
    prayagMrp,
    prayagEffectiveDate: prayag?.effectiveDate ?? null,
    prayagValidTo: prayag?.validTo ?? null,
    upcomingPrayagMrp: prayag?.upcomingMrp ?? null,
    upcomingPrayagEffectiveDate: prayag?.upcomingEffectiveDate ?? null,
    upcomingPrayagChangePct: prayag?.upcomingChangePct ?? null,
    diffPct,
    prayagCheaper,
    compPerMetre: norm.compPerMetre,
    prayagPerMetre: norm.prayagPerMetre,
    perMetreDiffPct: norm.perMetreDiffPct,
    lengthNormalized: norm.lengthNormalized,
    unitAmbiguous: norm.unitAmbiguous,
    normalizationNote: norm.normalizationNote,
    effectiveDiffPct,
    effectivePrayagCheaper,
  };
}

function isAvailableComparisonRow(
  row: CompRow,
  maps: Map<string, PrayagInfo>,
): boolean {
  return (
    row.matchedPrayagCode == null ||
    maps.has(normCode(row.matchedPrayagCode))
  );
}

function strParam(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

// GET /catalog/comparison — competitor rows joined to Prayag current MRP.
router.get("/catalog/comparison", async (req, res) => {
  const competitor = strParam(req.query.competitor);
  const category = strParam(req.query.category);
  const matchStatus = strParam(req.query.matchStatus);
  const confidence = strParam(req.query.confidence);
  const search = strParam(req.query.search);
  const expensiveOnly = req.query.expensiveOnly === "true";
  const ambiguousOnly = req.query.ambiguousOnly === "true";
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));

  const conditions = [];
  if (competitor) conditions.push(eq(competitorPricesTable.competitor, competitor));
  if (category) conditions.push(eq(competitorPricesTable.category, category));
  if (matchStatus) conditions.push(eq(competitorPricesTable.matchStatus, matchStatus));
  if (confidence)
    conditions.push(eq(competitorPricesTable.matchConfidence, confidence));
  if (search) {
    const like = `%${search.toLowerCase()}%`;
    conditions.push(
      sql`(lower(coalesce(${competitorPricesTable.description}, '')) like ${like} or lower(coalesce(${competitorPricesTable.matchedPrayagCode}, '')) like ${like} or lower(coalesce(${competitorPricesTable.size}, '')) like ${like})`,
    );
  }

  let q = db.select().from(competitorPricesTable).$dynamic();
  if (conditions.length > 0) q = q.where(and(...conditions));
  const [maps, all, revisionRows] = await Promise.all([
    getPrayagMaps(),
    q.orderBy(
      asc(competitorPricesTable.category),
      asc(competitorPricesTable.description),
      asc(competitorPricesTable.id),
    ),
    db.select().from(competitorPricesTable),
  ]);
  const windows = getCompetitorWindows(revisionRows);
  const matchedWindows = getCompetitorWindows(
    revisionRows.filter((row) => row.matchStatus === "matched"),
  );
  const pendingRevisions = getPendingRevisions(revisionRows);
  let rows = all
    .filter((row) => isAvailableComparisonRow(row, maps))
    .map((c) =>
      buildComparisonRow(
        c,
        maps,
        windows.get(c.id),
        matchedWindows.get(c.id),
        pendingRevisions.get(c.id),
      ),
    );
  if (expensiveOnly) rows = rows.filter((r) => r.effectivePrayagCheaper === false);
  if (ambiguousOnly) rows = rows.filter((r) => r.unitAmbiguous);

  const total = rows.length;
  const start = (page - 1) * pageSize;
  res.json({ rows: rows.slice(start, start + pageSize), total, page, pageSize });
});

// GET /catalog/comparison/export — full filtered comparison as CSV/XLSX.
router.get("/catalog/comparison/export", async (req, res) => {
  const competitor = strParam(req.query.competitor);
  const category = strParam(req.query.category);
  const matchStatus = strParam(req.query.matchStatus);
  const search = strParam(req.query.search);
  const expensiveOnly = req.query.expensiveOnly === "true";
  const format = String(req.query.format ?? "xlsx");

  const conditions = [];
  if (competitor) conditions.push(eq(competitorPricesTable.competitor, competitor));
  if (category) conditions.push(eq(competitorPricesTable.category, category));
  if (matchStatus) conditions.push(eq(competitorPricesTable.matchStatus, matchStatus));
  if (search) {
    const like = `%${search.toLowerCase()}%`;
    conditions.push(
      sql`(lower(coalesce(${competitorPricesTable.description}, '')) like ${like} or lower(coalesce(${competitorPricesTable.matchedPrayagCode}, '')) like ${like} or lower(coalesce(${competitorPricesTable.size}, '')) like ${like})`,
    );
  }

  let q = db.select().from(competitorPricesTable).$dynamic();
  if (conditions.length > 0) q = q.where(and(...conditions));
  const [maps, all, revisionRows] = await Promise.all([
    getPrayagMaps(),
    q.orderBy(
      asc(competitorPricesTable.category),
      asc(competitorPricesTable.description),
      asc(competitorPricesTable.id),
    ),
    db.select().from(competitorPricesTable),
  ]);
  const windows = getCompetitorWindows(revisionRows);
  const matchedWindows = getCompetitorWindows(
    revisionRows.filter((row) => row.matchStatus === "matched"),
  );
  const pendingRevisions = getPendingRevisions(revisionRows);
  let rows = all
    .filter((row) => isAvailableComparisonRow(row, maps))
    .map((c) =>
      buildComparisonRow(
        c,
        maps,
        windows.get(c.id),
        matchedWindows.get(c.id),
        pendingRevisions.get(c.id),
      ),
    );
  if (expensiveOnly) rows = rows.filter((r) => r.effectivePrayagCheaper === false);

  const header = [
    "Competitor",
    "Category",
    "Description",
    "Size",
    "Competitor Price (Row Period)",
    "Unit",
    "Competitor Valid From",
    "Competitor Valid To",
    "Competitor Next Price",
    "Competitor Next Effective Date",
    "Competitor Next Change %",
    "Competitor Price Is Current",
    "Official Gap Note",
    "Newer Revision Awaiting Review",
    "Newer Revision Effective Date",
    "Newer Revision Review Status",
    "Prayag Code",
    "Prayag Product Name",
    "Prayag Current MRP",
    "Prayag Current Valid From",
    "Prayag Current Valid To",
    "Prayag Next MRP",
    "Prayag Next Effective Date",
    "Prayag Next Change %",
    "Current-vs-Current Diff %",
    "Competitor ₹/m",
    "Prayag ₹/m",
    "Per-metre Diff %",
    "Effective Diff %",
    "Unit Ambiguous",
    "Normalization Note",
    "Status",
  ];
  const body = rows.map((r) => [
    r.competitor,
    r.category,
    r.description,
    r.size,
    r.competitorPrice,
    r.unit,
    r.effectiveDate,
    r.competitorValidTo,
    r.upcomingCompetitorPrice,
    r.upcomingCompetitorEffectiveDate,
    r.upcomingCompetitorChangePct,
    r.competitorPriceIsCurrent ? "yes" : "no",
    r.newerRevisionAwaitingReview
      ? "Using confirmed price; newer revision awaits review"
      : "",
    r.newerRevisionAwaitingReview ? "yes" : "no",
    r.newerRevisionEffectiveDate,
    r.newerRevisionReviewStatus,
    r.matchedPrayagCode,
    r.prayagProductName,
    r.prayagMrp,
    r.prayagEffectiveDate,
    r.prayagValidTo,
    r.upcomingPrayagMrp,
    r.upcomingPrayagEffectiveDate,
    r.upcomingPrayagChangePct,
    r.diffPct,
    r.compPerMetre,
    r.prayagPerMetre,
    r.perMetreDiffPct,
    r.effectiveDiffPct,
    r.unitAmbiguous ? "yes" : "",
    r.normalizationNote,
    r.matchStatus,
  ]);
  sendSheet(res, [header, ...body], "Comparison", "prayag-comparison", format);
});

// GET /catalog/comparison/summary — competitive share KPI + category win-rate.
router.get("/catalog/comparison/summary", async (req, res) => {
  const competitor = strParam(req.query.competitor);
  let q = db.select().from(competitorPricesTable).$dynamic();
  if (competitor) q = q.where(eq(competitorPricesTable.competitor, competitor));
  const [maps, all] = await Promise.all([getPrayagMaps(), q]);
  const windows = getCompetitorWindows(all);
  const matchedWindows = getCompetitorWindows(
    all.filter((row) => row.matchStatus === "matched"),
  );
  const pendingRevisions = getPendingRevisions(all);
  // Keep full precision for the official aggregate. `diffPct` on the response
  // is intentionally rounded for display, so it must not be summed here.
  const canonicalGaps = new Map<number, number | null>();
  for (const c of all) {
    const prayag = c.matchedPrayagCode
      ? maps.get(normCode(c.matchedPrayagCode))
      : undefined;
    canonicalGaps.set(
      c.id,
      c.matchStatus === "matched" &&
        matchedWindows.get(c.id)?.isCurrent === true &&
        c.price != null
        ? marketGapPct(
            prayag?.mrp ?? null,
            effectivePrice(c.unit, c.price, c.priceBasis, c.gstPct),
          )
        : null,
    );
  }
  const rows = all
    .filter((row) => isAvailableComparisonRow(row, maps))
    .map((c) =>
      buildComparisonRow(
        c,
        maps,
        windows.get(c.id),
        matchedWindows.get(c.id),
        pendingRevisions.get(c.id),
      ),
    )
    // Preserve the ordinary current row for mapping-review counts, while also
    // retaining the current *confirmed match* when a newer revision is pending
    // review. Comparable KPIs below then use the same population as analysis.
    .filter(
      (row) =>
        row.competitorPriceIsCurrent ||
        matchedWindows.get(row.id)?.isCurrent === true,
    );

  const matched = rows.filter((r) => !!r.matchedPrayagCode);
  // The summary is the official market-gap KPI, so it deliberately uses the
  // raw MRP-basis canonical gap. Per-metre fields remain a like-for-like row
  // display aid only; allowing them into this aggregate would diverge from the
  // Analysis dashboard and the reproducible rebuild report.
  const comparable = rows.filter((r) => canonicalGaps.get(r.id) != null);
  const cheaper = comparable.filter((r) => (canonicalGaps.get(r.id) ?? 0) > 0);
  const reviewRows = rows.filter((r) => r.matchStatus !== "matched");
  const ambiguousRows = rows.filter((r) => r.unitAmbiguous);

  const confidenceCounts = {
    high: rows.filter((r) => r.matchConfidence === "High").length,
    medium: rows.filter((r) => r.matchConfidence === "Medium").length,
    low: rows.filter((r) => r.matchConfidence === "Low").length,
    none: rows.filter((r) => !r.matchConfidence).length,
  };

  const avgDiffPct =
    comparable.length > 0
      ? Math.round(
          (comparable.reduce((s, r) => s + (canonicalGaps.get(r.id) ?? 0), 0) /
            comparable.length) *
            10,
        ) / 10
      : null;

  const byCat = new Map<
    string,
    { comparable: number; cheaper: number; diffSum: number }
  >();
  for (const r of comparable) {
    const cat = r.category ?? "Uncategorized";
    const e = byCat.get(cat) ?? { comparable: 0, cheaper: 0, diffSum: 0 };
    e.comparable++;
    if ((canonicalGaps.get(r.id) ?? 0) > 0) e.cheaper++;
    e.diffSum += canonicalGaps.get(r.id) ?? 0;
    byCat.set(cat, e);
  }
  const categoryWinRates = [...byCat.entries()]
    .map(([category, e]) => ({
      category,
      comparable: e.comparable,
      prayagCheaper: e.cheaper,
      prayagCheaperPct:
        e.comparable > 0
          ? Math.round((e.cheaper / e.comparable) * 1000) / 10
          : null,
      avgDiffPct:
        e.comparable > 0 ? Math.round((e.diffSum / e.comparable) * 10) / 10 : null,
    }))
    .sort((a, b) => b.comparable - a.comparable);

  res.json({
    competitor: competitor ?? null,
    totalRows: rows.length,
    matchedRows: matched.length,
    comparableRows: comparable.length,
    prayagCheaperCount: cheaper.length,
    prayagCheaperPct:
      comparable.length > 0
        ? Math.round((cheaper.length / comparable.length) * 1000) / 10
        : null,
    avgDiffPct,
    reviewCount: reviewRows.length,
    ambiguousCount: ambiguousRows.length,
    pendingRevisionCount: rows.filter((r) => r.newerRevisionAwaitingReview).length,
    confidenceCounts,
    categoryWinRates,
  });
});

// Normalize an incoming mapping update into canonical fields. Mirrors the
// single-row PATCH invariants so bulk and single accepts behave identically.
function normalizeMapping(body: {
  matchedPrayagCode?: string | null;
  matchStatus?: string;
  matchConfidence?: string | null;
}): { matchedPrayagCode: string | null; matchStatus: string; matchConfidence: string | null } {
  const matchedPrayagCode =
    typeof body.matchedPrayagCode === "string" && body.matchedPrayagCode.trim()
      ? body.matchedPrayagCode.trim()
      : null;
  const ALLOWED_STATUSES = new Set(["matched", "no match (review)"]);
  const requested =
    typeof body.matchStatus === "string" ? body.matchStatus.trim() : "";
  const matchStatus = !matchedPrayagCode
    ? "no match (review)"
    : ALLOWED_STATUSES.has(requested)
      ? requested
      : "matched";
  const matchConfidence =
    matchStatus !== "matched"
      ? null
      : typeof body.matchConfidence === "string" && body.matchConfidence.trim()
        ? body.matchConfidence.trim()
        : "High";
  return { matchedPrayagCode, matchStatus, matchConfidence };
}

// Keep the persisted prayag_mrp_at_compare audit snapshot aligned whenever a
// mapping changes. Live analysis resolves its comparison MRP by effective date.
function snapshotPrayagMrp(
  maps: Map<string, PrayagInfo>,
  matchedPrayagCode: string | null,
  matchStatus: string,
): number | null {
  if (matchStatus !== "matched" || !matchedPrayagCode) return null;
  return maps.get(normCode(matchedPrayagCode))?.mrp ?? null;
}

// PATCH /catalog/competitor-prices/bulk — apply mapping updates to many rows at
// once (per-row "Accept selected"). Registered before the :id route so "bulk"
// is never parsed as an id.
router.patch("/catalog/competitor-prices/bulk", async (req, res) => {
  const body = req.body as {
    updates?: Array<{
      id?: number;
      matchedPrayagCode?: string | null;
      matchStatus?: string;
      matchConfidence?: string | null;
    }>;
  };
  const updates = Array.isArray(body.updates) ? body.updates : [];
  const valid = updates.filter((u) => Number.isInteger(u.id));
  if (valid.length === 0) {
    res.json({ updated: 0, rows: [] });
    return;
  }

  const maps = await getPrayagMaps();
  const updatedRows: CompRow[] = [];
  for (const u of valid) {
    const { matchedPrayagCode, matchStatus, matchConfidence } =
      normalizeMapping(u);
    const prayagMrpAtCompare = snapshotPrayagMrp(maps, matchedPrayagCode, matchStatus);
    const result = await db
      .update(competitorPricesTable)
      .set({
        matchedPrayagCode,
        matchStatus,
        matchConfidence,
        prayagMrpAtCompare,
        updatedAt: new Date(),
      })
      .where(eq(competitorPricesTable.id, u.id!))
      .returning();
    if (result[0]) updatedRows.push(result[0]);
  }

  const windows = await getAllCompetitorWindows();
  res.json({
    updated: updatedRows.length,
    rows: updatedRows.map((r) =>
      buildComparisonRow(r, maps, windows.get(r.id)),
    ),
  });
});

// POST /catalog/mapping-review/auto-accept — for every unmatched row in the
// current filter, accept its top fuzzy suggestion when that suggestion's tier
// meets the requested minimum. Computes suggestions server-side so it can clear
// the whole backlog (all pages), not just what's on screen.
router.post("/catalog/mapping-review/auto-accept", async (req, res) => {
  const body = req.body as {
    competitor?: string | null;
    confidence?: string | null;
    period?: string | null;
    search?: string | null;
    minConfidence?: string;
  };
  const competitor = strParam(body.competitor);
  const confidence = strParam(body.confidence);
  const period = strParam(body.period);
  const search = strParam(body.search);
  const TIERS = ["low", "medium", "high"] as const;
  const minTierRaw =
    typeof body.minConfidence === "string"
      ? body.minConfidence.trim().toLowerCase()
      : "high";
  const minTier = (TIERS as readonly string[]).includes(minTierRaw)
    ? (minTierRaw as (typeof TIERS)[number])
    : "high";
  const minRank = TIERS.indexOf(minTier);

  const conditions = [ne(competitorPricesTable.matchStatus, "matched")];
  if (competitor) conditions.push(eq(competitorPricesTable.competitor, competitor));
  if (confidence)
    conditions.push(eq(competitorPricesTable.matchConfidence, confidence));
  if (period) conditions.push(eq(competitorPricesTable.effectiveDate, period));
  if (search) {
    const like = `%${search.toLowerCase()}%`;
    conditions.push(
      sql`(lower(coalesce(${competitorPricesTable.description}, '')) like ${like} or lower(coalesce(${competitorPricesTable.category}, '')) like ${like} or lower(coalesce(${competitorPricesTable.size}, '')) like ${like})`,
    );
  }

  const rows = await db
    .select({
      id: competitorPricesTable.id,
      category: competitorPricesTable.category,
      description: competitorPricesTable.description,
      size: competitorPricesTable.size,
    })
    .from(competitorPricesTable)
    .where(and(...conditions));

  if (rows.length === 0) {
    res.json({ matched: 0 });
    return;
  }

  const candidates = await getCatalogCandidates();
  const maps = await getPrayagMaps();
  const matchedIds: number[] = [];
  for (const r of rows) {
    const top = suggestMatches(
      { category: r.category, description: r.description, size: r.size },
      candidates,
    )[0];
    if (!top) continue;
    if (TIERS.indexOf(top.confidenceLabel) < minRank) continue;
    await db
      .update(competitorPricesTable)
      .set({
        matchedPrayagCode: top.itemCode,
        matchStatus: "matched",
        matchConfidence: "High",
        prayagMrpAtCompare: snapshotPrayagMrp(maps, top.itemCode, "matched"),
        updatedAt: new Date(),
      })
      .where(eq(competitorPricesTable.id, r.id));
    matchedIds.push(r.id);
  }

  res.json({ matched: matchedIds.length, matchedIds });
});

// GET /catalog/mapping-review/auto-accept-preview — dry run of the auto-accept
// above. For the current filter, compute each pending row's top suggestion and
// count how many rows each confidence threshold would accept, so reviewers can
// pick a safe tier before committing.
router.get("/catalog/mapping-review/auto-accept-preview", async (req, res) => {
  const competitor = strParam(req.query.competitor);
  const confidence = strParam(req.query.confidence);
  const period = strParam(req.query.period);
  const search = strParam(req.query.search);
  const TIERS = ["low", "medium", "high"] as const;

  const conditions = [ne(competitorPricesTable.matchStatus, "matched")];
  if (competitor) conditions.push(eq(competitorPricesTable.competitor, competitor));
  if (confidence)
    conditions.push(eq(competitorPricesTable.matchConfidence, confidence));
  if (period) conditions.push(eq(competitorPricesTable.effectiveDate, period));
  if (search) {
    const like = `%${search.toLowerCase()}%`;
    conditions.push(
      sql`(lower(coalesce(${competitorPricesTable.description}, '')) like ${like} or lower(coalesce(${competitorPricesTable.category}, '')) like ${like} or lower(coalesce(${competitorPricesTable.size}, '')) like ${like})`,
    );
  }

  const rows = await db
    .select({
      category: competitorPricesTable.category,
      description: competitorPricesTable.description,
      size: competitorPricesTable.size,
    })
    .from(competitorPricesTable)
    .where(and(...conditions));

  let high = 0;
  let medium = 0;
  let low = 0;
  if (rows.length > 0) {
    const candidates = await getCatalogCandidates();
    // Cache top tiers keyed by a catalog-version signature so flipping the
    // competitor/confidence/search filter reuses prior scoring instead of
    // re-running the full fuzzy match over every pending row each time.
    const version = catalogVersion(candidates);
    for (const r of rows) {
      const tier = topSuggestionTier(
        { category: r.category, description: r.description, size: r.size },
        candidates,
        version,
      );
      if (tier === "none") continue;
      const rank = TIERS.indexOf(tier);
      // A row counts toward every threshold at or below its top tier:
      // a high suggestion is accepted by "high only", "medium & up", and "all".
      low++;
      if (rank >= TIERS.indexOf("medium")) medium++;
      if (rank >= TIERS.indexOf("high")) high++;
    }
  }

  res.json({ high, medium, low, total: rows.length });
});

const BATCH_LIST_LIMIT = 10;

function serializeBatch(b: typeof acceptBatchesTable.$inferSelect) {
  return {
    id: b.id,
    kind: b.kind,
    competitor: b.competitor,
    competitorPriceIds: b.competitorPriceIds,
    count: b.count,
    createdAt: b.createdAt.toISOString(),
  };
}

// GET /catalog/mapping-review/accept-batches — recent bulk/auto accept batches
// that a reviewer can still send back to review (newest first). Persisting them
// means the undo survives dismissing the toast or navigating away.
router.get("/catalog/mapping-review/accept-batches", async (_req, res) => {
  const batches = await db
    .select()
    .from(acceptBatchesTable)
    .orderBy(desc(acceptBatchesTable.createdAt), desc(acceptBatchesTable.id))
    .limit(BATCH_LIST_LIMIT);
  res.json({ batches: batches.map(serializeBatch) });
});

// POST /catalog/mapping-review/accept-batches — record a freshly accepted batch
// (the exact competitor-price ids) so it can be reverted later.
router.post("/catalog/mapping-review/accept-batches", async (req, res) => {
  const body = req.body as {
    kind?: string;
    competitor?: string | null;
    ids?: number[];
  };
  const kind = body.kind === "auto" ? "auto" : "bulk";
  const competitor = strParam(body.competitor);
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((id): id is number => Number.isInteger(id))
    : [];
  if (ids.length === 0) {
    res.status(400).json({ error: "ids must be a non-empty array of integers" });
    return;
  }

  const [batch] = await db
    .insert(acceptBatchesTable)
    .values({ kind, competitor, competitorPriceIds: ids, count: ids.length })
    .returning();
  res.json(serializeBatch(batch));
});

// DELETE /catalog/mapping-review/accept-batches/:id — forget a recorded batch
// (after it was reverted, or to dismiss it from the recent list).
router.delete("/catalog/mapping-review/accept-batches/:id", async (req: Request<{ id: string }>, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "invalid batch id" });
    return;
  }
  const deleted = await db
    .delete(acceptBatchesTable)
    .where(eq(acceptBatchesTable.id, id))
    .returning({ id: acceptBatchesTable.id });
  res.json({ ok: true, deleted: deleted.length });
});

// GET /catalog/comparison/by-product — one row per matched Prayag SKU with a
// price cell for each competitor brand, so the user can compare Prayag against
// several brands side by side (cheapest rival highlighted per SKU).
router.get("/catalog/comparison/by-product", async (req, res) => {
  const category = strParam(req.query.category);
  const search = strParam(req.query.search);
  const expensiveOnly = req.query.expensiveOnly === "true";
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));

  const conditions = [];
  if (category) conditions.push(eq(competitorPricesTable.category, category));
  if (search) {
    const like = `%${search.toLowerCase()}%`;
    conditions.push(
      sql`(lower(coalesce(${competitorPricesTable.description}, '')) like ${like} or lower(coalesce(${competitorPricesTable.matchedPrayagCode}, '')) like ${like} or lower(coalesce(${competitorPricesTable.size}, '')) like ${like})`,
    );
  }

  const [maps, allRows, revisionRows] = await Promise.all([
    getPrayagMaps(),
    db.select().from(competitorPricesTable).where(and(...conditions)),
    db.select().from(competitorPricesTable),
  ]);
  const matchedRows = allRows.filter((row) => row.matchStatus === "matched");
  const competitorWindows = getCompetitorWindows(
    revisionRows.filter((row) => row.matchStatus === "matched"),
  );
  const pendingRevisions = getPendingRevisions(revisionRows);
  const currentMatchedRows = matchedRows.filter(
    (row) =>
      competitorWindows.get(row.id)?.isCurrent &&
      isAvailableComparisonRow(row, maps),
  );

  // Group competitor rows by the Prayag SKU they map to. A competitor can have
  // several rows for one SKU (e.g. different sizes), so we keep every row and
  // pick the most aggressive quote per competitor after per-metre normalization.
  interface CompCandidate {
    price: number;
    priceBasis: string | null;
    gstPct: number | null;
    description: string | null;
    size: string | null;
    unit: string | null;
    effectiveDate: string | null;
    validTo: string | null;
    upcomingPrice: number | null;
    upcomingEffectiveDate: string | null;
    upcomingChangePct: number | null;
    newerRevisionAwaitingReview: boolean;
    newerRevisionEffectiveDate: string | null;
    newerRevisionReviewStatus: string | null;
  }
  interface Group {
    itemCode: string;
    category: string | null;
    byCompetitor: Map<string, CompCandidate[]>;
  }
  const groups = new Map<string, Group>();
  for (const c of currentMatchedRows) {
    if (!c.matchedPrayagCode) continue;
    const key = normCode(c.matchedPrayagCode);
    let g = groups.get(key);
    if (!g) {
      g = {
        itemCode: c.matchedPrayagCode,
        category: c.category,
        byCompetitor: new Map(),
      };
      groups.set(key, g);
    }
    if (!g.category && c.category) g.category = c.category;
    // A row without a price (verified mapping, MRP pending) cannot be a quote
    // candidate; keep the group but skip the candidate.
    if (c.price == null) continue;
    const list = g.byCompetitor.get(c.competitor) ?? [];
    const priceWindow = competitorWindows.get(c.id);
    list.push({
      price: c.price,
      priceBasis: c.priceBasis,
      gstPct: c.gstPct,
      description: c.description,
      size: c.size,
      unit: c.unit,
      effectiveDate: c.effectiveDate,
      validTo: priceWindow?.validTo ?? null,
      upcomingPrice: priceWindow?.upcomingPrice ?? null,
      upcomingEffectiveDate: priceWindow?.upcomingEffectiveDate ?? null,
      upcomingChangePct: priceWindow?.upcomingChangePct ?? null,
      newerRevisionAwaitingReview: pendingRevisions.has(c.id),
      newerRevisionEffectiveDate: pendingRevisions.get(c.id)?.effectiveDate ?? null,
      newerRevisionReviewStatus: pendingRevisions.get(c.id)?.reviewStatus ?? null,
    });
    g.byCompetitor.set(c.competitor, list);
  }

  let rows = [...groups.entries()].map(([key, g]) => {
    const prayag = maps.get(key);
    const prayagMrp = prayag?.mrp ?? null;

    // Decide the row's comparison basis from the Prayag product: if it is a
    // length-based SKU (a single pack length parseable from its name), every
    // price for this SKU is compared per metre; otherwise per piece (raw).
    const prNorm: NormResult | null =
      prayagMrp != null
        ? normalizePerMetre({
            description: prayag?.productName ?? null,
            size: null,
            unit: null,
            price: prayagMrp,
          })
        : null;
    const isLenRow = prNorm?.status === "normalized";
    const prayagBasis = isLenRow ? prNorm!.perMetre : prayagMrp;

    // For one competitor, reduce each candidate row to the comparison basis and
    // keep the cheapest. A row whose unit basis is ambiguous can't be placed on
    // the per-metre axis, so it is surfaced (flagged) but never ranked/charted.
    interface Picked {
      competitor: string;
      price: number;
      perMetre: number | null;
      basisPrice: number | null;
      unitAmbiguous: boolean;
      effectiveDate: string | null;
      validTo: string | null;
      upcomingPrice: number | null;
      upcomingEffectiveDate: string | null;
      upcomingChangePct: number | null;
      newerRevisionAwaitingReview: boolean;
      newerRevisionEffectiveDate: string | null;
      newerRevisionReviewStatus: string | null;
    }
    const picks: Picked[] = [];
    for (const [competitor, candidates] of g.byCompetitor) {
      let best: Picked | null = null;
      for (const cand of candidates) {
        let perMetre: number | null = null;
        let basisPrice: number | null;
        let ambiguous = false;
        const effectiveCandidatePrice = effectivePrice(
          cand.unit,
          cand.price,
          cand.priceBasis,
          cand.gstPct,
        );
        if (isLenRow) {
          const n = normalizePerMetre({
            description: cand.description,
            size: cand.size,
            unit: cand.unit,
            price: effectiveCandidatePrice,
          });
          if (n.status === "normalized") {
            perMetre = n.perMetre;
            basisPrice = n.perMetre;
          } else {
            basisPrice = null;
            ambiguous = true;
          }
        } else {
          basisPrice = effectiveCandidatePrice;
        }
        const candPick: Picked = {
          competitor,
          price: cand.price,
          perMetre,
          basisPrice,
          unitAmbiguous: ambiguous,
          effectiveDate: cand.effectiveDate,
          validTo: cand.validTo,
          upcomingPrice: cand.upcomingPrice,
          upcomingEffectiveDate: cand.upcomingEffectiveDate,
          upcomingChangePct: cand.upcomingChangePct,
          newerRevisionAwaitingReview: cand.newerRevisionAwaitingReview,
          newerRevisionEffectiveDate: cand.newerRevisionEffectiveDate,
          newerRevisionReviewStatus: cand.newerRevisionReviewStatus,
        };
        // Prefer rows that can be placed on the basis; among those, the cheapest.
        if (!best) best = candPick;
        else if (best.basisPrice == null && candPick.basisPrice != null) best = candPick;
        else if (
          candPick.basisPrice != null &&
          best.basisPrice != null &&
          candPick.basisPrice < best.basisPrice
        )
          best = candPick;
      }
      if (best) picks.push(best);
    }

    let cheapestRival: number | null = null;
    let cheapestRivalName: string | null = null;
    for (const p of picks) {
      if (p.basisPrice == null) continue;
      if (cheapestRival == null || p.basisPrice < cheapestRival) {
        cheapestRival = p.basisPrice;
        cheapestRivalName = p.competitor;
      }
    }

    const competitors = picks
      .map((p) => {
        let diffPct: number | null = null;
        const rawGap = marketGapPct(prayagBasis, p.basisPrice);
        diffPct = rawGap == null ? null : Math.round(rawGap * 10) / 10;
        return {
          competitor: p.competitor,
          price: p.price,
          perMetre: p.perMetre,
          diffPct,
          isCheapest: p.competitor === cheapestRivalName,
          unitAmbiguous: p.unitAmbiguous,
          effectiveDate: p.effectiveDate,
          validTo: p.validTo,
          upcomingPrice: p.upcomingPrice,
          upcomingEffectiveDate: p.upcomingEffectiveDate,
          upcomingChangePct: p.upcomingChangePct,
          newerRevisionAwaitingReview: p.newerRevisionAwaitingReview,
          newerRevisionEffectiveDate: p.newerRevisionEffectiveDate,
          newerRevisionReviewStatus: p.newerRevisionReviewStatus,
        };
      })
      .sort((a, b) => a.competitor.localeCompare(b.competitor));

    let diffPct: number | null = null;
    const rawCheapestGap = marketGapPct(prayagBasis, cheapestRival);
    diffPct =
      rawCheapestGap == null ? null : Math.round(rawCheapestGap * 10) / 10;
    const prayagLowest =
      prayagBasis != null && cheapestRival != null && prayagBasis <= cheapestRival;

    // Whole-market read across every loaded rival brand for this SKU, on the
    // comparison basis. Median is the true sample median (avg of the two middle
    // prices for an even count).
    const rivalPrices = picks
      .map((p) => p.basisPrice)
      .filter((v): v is number => v != null)
      .sort((a, b) => a - b);
    let marketMin: number | null = null;
    let marketMedian: number | null = null;
    let marketMax: number | null = null;
    if (rivalPrices.length > 0) {
      marketMin = rivalPrices[0]!;
      marketMax = rivalPrices[rivalPrices.length - 1]!;
      const mid = Math.floor(rivalPrices.length / 2);
      const med =
        rivalPrices.length % 2 === 1
          ? rivalPrices[mid]!
          : (rivalPrices[mid - 1]! + rivalPrices[mid]!) / 2;
      marketMedian = Math.round(med * 100) / 100;
    }

    // Prayag's position vs the whole market (same thresholds as the Console
    // engine): leader ≤ min, competitive ≤ median, above_market ≤ max, else
    // overpriced; no_data when there is no MRP or no rivals.
    let marketPosition: string = "no_data";
    if (prayagBasis != null && rivalPrices.length > 0) {
      if (prayagBasis <= marketMin!) marketPosition = "leader";
      else if (prayagBasis <= marketMedian!) marketPosition = "competitive";
      else if (prayagBasis <= marketMax!) marketPosition = "above_market";
      else marketPosition = "overpriced";
    }

    return {
      itemCode: g.itemCode,
      prayagProductName: prayag?.productName ?? null,
      category: g.category,
      prayagMrp,
      prayagPerMetre: isLenRow ? prNorm!.perMetre : null,
      lengthNormalized: isLenRow,
      unitAmbiguous: competitors.some((c) => c.unitAmbiguous),
      prayagEffectiveDate: prayag?.effectiveDate ?? null,
      prayagValidTo: prayag?.validTo ?? null,
      upcomingPrayagMrp: prayag?.upcomingMrp ?? null,
      upcomingPrayagEffectiveDate: prayag?.upcomingEffectiveDate ?? null,
      upcomingPrayagChangePct: prayag?.upcomingChangePct ?? null,
      competitors,
      cheapestRival,
      cheapestRivalName,
      prayagLowest,
      rivalCount: competitors.filter((c) => !c.unitAmbiguous).length,
      diffPct,
      marketMin,
      marketMedian,
      marketMax,
      marketPosition,
    };
  }).filter((row) => row.prayagMrp != null && row.competitors.length > 0);

  if (expensiveOnly) {
    rows = rows.filter(
      (r) =>
        r.prayagMrp != null && r.cheapestRival != null && !r.prayagLowest,
    );
  }

  rows.sort(
    (a, b) =>
      (a.category ?? "").localeCompare(b.category ?? "") ||
      a.itemCode.localeCompare(b.itemCode),
  );

  // Column set: every brand present across the filtered SKUs, so the table
  // header is stable across pages.
  const competitorSet = new Set<string>();
  for (const r of rows) for (const c of r.competitors) competitorSet.add(c.competitor);
  const competitors = [...competitorSet].sort((a, b) => a.localeCompare(b));

  const total = rows.length;
  const start = (page - 1) * pageSize;
  res.json({
    competitors,
    rows: rows.slice(start, start + pageSize),
    total,
    page,
    pageSize,
  });
});

// GET /catalog/comparison/filters — competitors, categories, match statuses, periods.
// Optional ?competitor= scopes the returned periods to that competitor's rows only.
router.get("/catalog/comparison/filters", async (req, res) => {
  const competitor = strParam(req.query.competitor);

  const compRows = await db
    .selectDistinct({ competitor: competitorPricesTable.competitor })
    .from(competitorPricesTable)
    .orderBy(asc(competitorPricesTable.competitor));
  const catRows = await db
    .selectDistinct({ category: competitorPricesTable.category })
    .from(competitorPricesTable)
    .orderBy(asc(competitorPricesTable.category));
  const statusRows = await db
    .selectDistinct({ matchStatus: competitorPricesTable.matchStatus })
    .from(competitorPricesTable)
    .orderBy(asc(competitorPricesTable.matchStatus));
  const confRows = await db
    .selectDistinct({ matchConfidence: competitorPricesTable.matchConfidence })
    .from(competitorPricesTable);

  // Distinct effective dates for unmatched rows (the set the period filter applies to),
  // scoped to the selected competitor when one is active, newest first.
  const periodConditions = [ne(competitorPricesTable.matchStatus, "matched")];
  if (competitor) periodConditions.push(eq(competitorPricesTable.competitor, competitor));
  const periodRows = await db
    .selectDistinct({ effectiveDate: competitorPricesTable.effectiveDate })
    .from(competitorPricesTable)
    .where(and(...periodConditions));
  const periods = periodRows
    .map((r) => r.effectiveDate)
    .filter((d): d is string => !!d)
    .sort((a, b) => b.localeCompare(a)); // newest first

  // Stable, meaningful order for the confidence tiers rather than alphabetical.
  const CONF_ORDER = ["High", "Medium", "Low"];
  const confidences = confRows
    .map((r) => r.matchConfidence)
    .filter((c): c is string => !!c)
    .sort((a, b) => {
      const ia = CONF_ORDER.indexOf(a);
      const ib = CONF_ORDER.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });

  res.json({
    competitors: compRows.map((r) => r.competitor).filter((c): c is string => !!c),
    categories: catRows.map((r) => r.category).filter((c): c is string => !!c),
    matchStatuses: statusRows
      .map((r) => r.matchStatus)
      .filter((c): c is string => !!c),
    confidences,
    periods,
  });
});

// GET /catalog/mapping-review — competitor rows needing manual mapping.
router.get("/catalog/mapping-review", async (req, res) => {
  const competitor = strParam(req.query.competitor);
  const confidence = strParam(req.query.confidence);
  const period = strParam(req.query.period);
  const search = strParam(req.query.search);
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));

  const conditions = [ne(competitorPricesTable.matchStatus, "matched")];
  if (competitor) conditions.push(eq(competitorPricesTable.competitor, competitor));
  if (confidence)
    conditions.push(eq(competitorPricesTable.matchConfidence, confidence));
  if (period) conditions.push(eq(competitorPricesTable.effectiveDate, period));
  if (search) {
    const like = `%${search.toLowerCase()}%`;
    conditions.push(
      sql`(lower(coalesce(${competitorPricesTable.description}, '')) like ${like} or lower(coalesce(${competitorPricesTable.category}, '')) like ${like} or lower(coalesce(${competitorPricesTable.size}, '')) like ${like})`,
    );
  }
  const whereExpr = and(...conditions);

  const totalRow = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(competitorPricesTable)
    .where(whereExpr);
  const total = totalRow[0]?.count ?? 0;

  const rows = await db
    .select({
      id: competitorPricesTable.id,
      competitor: competitorPricesTable.competitor,
      effectiveDate: competitorPricesTable.effectiveDate,
      category: competitorPricesTable.category,
      description: competitorPricesTable.description,
      size: competitorPricesTable.size,
      price: competitorPricesTable.price,
      unit: competitorPricesTable.unit,
      matchedPrayagCode: competitorPricesTable.matchedPrayagCode,
      matchStatus: competitorPricesTable.matchStatus,
      matchConfidence: competitorPricesTable.matchConfidence,
    })
    .from(competitorPricesTable)
    .where(whereExpr)
    .orderBy(
      asc(competitorPricesTable.category),
      asc(competitorPricesTable.description),
      asc(competitorPricesTable.id),
    )
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  // Attach fuzzy match suggestions for the rows on this page only.
  const candidates = rows.length > 0 ? await getCatalogCandidates() : [];
  const withSuggestions = rows.map((r) => ({
    ...r,
    suggestions: suggestMatches(
      { category: r.category, description: r.description, size: r.size },
      candidates,
    ),
  }));

  res.json({ rows: withSuggestions, total, page, pageSize });
});

// GET /catalog/comparison/matrix — side-by-side view: one row per Prayag
// product with each competitor's price + live diff%. Only matched rows
// contribute, so unreliable (review) mappings never pollute the matrix.
router.get("/catalog/comparison/matrix", async (req, res) => {
  const category = strParam(req.query.category);
  const search = strParam(req.query.search);
  const expensiveOnly = req.query.expensiveOnly === "true";
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));

  const maps = await getPrayagMaps();

  const all = await db
    .select()
    .from(competitorPricesTable)
    .where(eq(competitorPricesTable.matchStatus, "matched"));
  const matchedWindows = getCompetitorWindows(all);

  const available = all.filter(
    (row) =>
      matchedWindows.get(row.id)?.isCurrent &&
      isAvailableComparisonRow(row, maps),
  );
  const competitors = [...new Set(available.map((c) => c.competitor))].sort();

  interface Cell {
    competitor: string;
    price: number | null;
    effectivePrice: number | null;
    diffPct: number | null;
    prayagCheaper: boolean | null;
    matchConfidence: string | null;
  }
  interface MatrixRow {
    prayagCode: string;
    prayagProductName: string | null;
    category: string | null;
    prayagMrp: number | null;
    cells: Cell[];
  }

  const byCode = new Map<string, MatrixRow>();
  for (const c of available) {
    if (!c.matchedPrayagCode) continue;
    const key = normCode(c.matchedPrayagCode);
    const prayag = maps.get(key);
    let group = byCode.get(key);
    if (!group) {
      group = {
        prayagCode: c.matchedPrayagCode,
        prayagProductName: prayag?.productName ?? null,
        category: c.category ?? null,
        prayagMrp: prayag?.mrp ?? null,
        cells: [],
      };
      byCode.set(key, group);
    }
    const prayagMrp = group.prayagMrp;
    let diffPct: number | null = null;
    let prayagCheaper: boolean | null = null;
    const rawGap = marketGapPct(
      prayagMrp,
      c.price == null
        ? null
        : effectivePrice(c.unit, c.price, c.priceBasis, c.gstPct),
    );
    diffPct = rawGap == null ? null : Math.round(rawGap * 10) / 10;
    prayagCheaper = prayagCheaperForGap(rawGap);
    // If a competitor has multiple rows mapped to the same Prayag code, keep
    // the cheapest (most aggressive) competitor price for that competitor.
    const existing = group.cells.find((x) => x.competitor === c.competitor);
    if (!existing) {
      group.cells.push({
        competitor: c.competitor,
        price: c.price,
        effectivePrice:
          c.price == null
            ? null
            : effectivePrice(c.unit, c.price, c.priceBasis, c.gstPct),
        diffPct,
        prayagCheaper,
        matchConfidence: c.matchConfidence,
      });
    } else if (
      c.price != null &&
      (existing.effectivePrice == null ||
        effectivePrice(c.unit, c.price, c.priceBasis, c.gstPct) < existing.effectivePrice)
    ) {
      existing.price = c.price;
      existing.effectivePrice = effectivePrice(c.unit, c.price, c.priceBasis, c.gstPct);
      existing.diffPct = diffPct;
      existing.prayagCheaper = prayagCheaper;
      existing.matchConfidence = c.matchConfidence;
    }
  }

  let rows = [...byCode.values()];
  if (category) rows = rows.filter((r) => r.category === category);
  if (search) {
    const s = search.toLowerCase();
    rows = rows.filter(
      (r) =>
        (r.prayagProductName ?? "").toLowerCase().includes(s) ||
        r.prayagCode.toLowerCase().includes(s),
    );
  }
  if (expensiveOnly) {
    rows = rows.filter((r) => r.cells.some((c) => c.prayagCheaper === false));
  }
  rows.sort(
    (a, b) =>
      (a.category ?? "").localeCompare(b.category ?? "") ||
      (a.prayagProductName ?? "").localeCompare(b.prayagProductName ?? "") ||
      a.prayagCode.localeCompare(b.prayagCode),
  );

  const total = rows.length;
  const start = (page - 1) * pageSize;
  res.json({
    competitors,
    rows: rows.slice(start, start + pageSize).map((row) => ({
      ...row,
      cells: row.cells.map(({ effectivePrice: _effectivePrice, ...cell }) => cell),
    })),
    total,
    page,
    pageSize,
  });
});

// PATCH /catalog/competitor-prices/:id — assign/correct a row's mapping.
router.patch("/catalog/competitor-prices/:id", async (req: Request<{ id: string }>, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const body = req.body as {
    matchedPrayagCode?: string | null;
    matchStatus?: string;
    matchConfidence?: string | null;
  };
  const { matchedPrayagCode, matchStatus, matchConfidence } = normalizeMapping(body);

  const maps = await getPrayagMaps();
  const prayagMrpAtCompare = snapshotPrayagMrp(maps, matchedPrayagCode, matchStatus);
  const updated = await db
    .update(competitorPricesTable)
    .set({
      matchedPrayagCode,
      matchStatus,
      matchConfidence,
      prayagMrpAtCompare,
      updatedAt: new Date(),
    })
    .where(eq(competitorPricesTable.id, id))
    .returning();
  const row = updated[0];
  if (!row) {
    res.status(404).json({ error: "Competitor price not found" });
    return;
  }

  const windows = await getAllCompetitorWindows();
  res.json(buildComparisonRow(row, maps, windows.get(row.id)));
});

// GET /catalog/mapping-review/export — full filtered review list as CSV/XLSX.
router.get("/catalog/mapping-review/export", async (req, res) => {
  const competitor = strParam(req.query.competitor);
  const period = strParam(req.query.period);
  const search = strParam(req.query.search);
  const format = String(req.query.format ?? "xlsx");

  const conditions = [ne(competitorPricesTable.matchStatus, "matched")];
  if (competitor) conditions.push(eq(competitorPricesTable.competitor, competitor));
  if (period) conditions.push(eq(competitorPricesTable.effectiveDate, period));
  if (search) {
    const like = `%${search.toLowerCase()}%`;
    conditions.push(
      sql`(lower(coalesce(${competitorPricesTable.description}, '')) like ${like} or lower(coalesce(${competitorPricesTable.category}, '')) like ${like} or lower(coalesce(${competitorPricesTable.size}, '')) like ${like})`,
    );
  }

  const maps = await getPrayagMaps();
  const all = await db
    .select()
    .from(competitorPricesTable)
    .where(and(...conditions))
    .orderBy(
      asc(competitorPricesTable.category),
      asc(competitorPricesTable.description),
      asc(competitorPricesTable.id),
    );
  const windows = await getAllCompetitorWindows();
  const rows = all.map((c) =>
    buildComparisonRow(c, maps, windows.get(c.id)),
  );

  const header = [
    "Competitor",
    "Category",
    "Description",
    "Size",
    "Competitor Price (Row Period)",
    "Unit",
    "Competitor Valid From",
    "Competitor Valid To",
    "Competitor Next Price",
    "Competitor Next Effective Date",
    "Competitor Next Change %",
    "Competitor Price Is Current",
    "Prayag Code",
    "Prayag Current MRP",
    "Prayag Current Valid From",
    "Prayag Current Valid To",
    "Prayag Next MRP",
    "Prayag Next Effective Date",
    "Prayag Next Change %",
    "Current-vs-Current Diff %",
    "Status",
  ];
  const body = rows.map((r) => [
    r.competitor,
    r.category,
    r.description,
    r.size,
    r.competitorPrice,
    r.unit,
    r.effectiveDate,
    r.competitorValidTo,
    r.upcomingCompetitorPrice,
    r.upcomingCompetitorEffectiveDate,
    r.upcomingCompetitorChangePct,
    r.competitorPriceIsCurrent ? "yes" : "no",
    r.matchedPrayagCode,
    r.prayagMrp,
    r.prayagEffectiveDate,
    r.prayagValidTo,
    r.upcomingPrayagMrp,
    r.upcomingPrayagEffectiveDate,
    r.upcomingPrayagChangePct,
    r.diffPct,
    r.matchStatus,
  ]);
  sendSheet(
    res,
    [header, ...body],
    "Mapping Review",
    "prayag-mapping-review",
    format,
  );
});

// DELETE /catalog/competitors/:competitor — remove all price rows for a brand
// the team no longer tracks. The brand then disappears from comparison filters,
// By Product columns, and summary KPIs (all computed live from these rows).
router.delete("/catalog/competitors/:competitor", async (req: Request<{ competitor: string }>, res) => {
  const competitor = strParam(req.params.competitor);
  if (!competitor) {
    res.status(400).json({ error: "competitor name is required" });
    return;
  }

  const deleted = await db
    .delete(competitorPricesTable)
    .where(eq(competitorPricesTable.competitor, competitor))
    .returning({ id: competitorPricesTable.id });

  if (deleted.length === 0) {
    res.status(404).json({ error: "Competitor not found" });
    return;
  }

  res.json({ ok: true, competitor, deleted: deleted.length });
});

// DELETE /catalog/competitors/:competitor/periods/:effectiveDate — remove a
// single price period for a brand without touching older or newer periods.
// After deletion the is_current flags are recomputed so the next-most-recent
// period becomes current.
router.delete(
  "/catalog/competitors/:competitor/periods/:effectiveDate",
  async (req, res) => {
    const competitor = strParam(req.params.competitor);
    const effectiveDate = strParam(req.params.effectiveDate);

    if (!competitor || !effectiveDate) {
      res
        .status(400)
        .json({ error: "competitor and effectiveDate are required" });
      return;
    }

    const deleted = await db
      .delete(competitorPricesTable)
      .where(
        sql`competitor = ${competitor} AND effective_date = ${effectiveDate}`,
      )
      .returning({ id: competitorPricesTable.id });

    if (deleted.length === 0) {
      res.status(404).json({ error: "Period not found" });
      return;
    }

    // Recompute is_current for this brand so the remaining periods are correct.
    // Check if any rows remain for the brand; if so, recompute flags.
    const remaining = await db
      .select({ id: competitorPricesTable.id })
      .from(competitorPricesTable)
      .where(eq(competitorPricesTable.competitor, competitor))
      .limit(1);

    if (remaining.length > 0) {
      await recomputeCompetitorCurrentFlags(competitor);
    }

    res.json({
      ok: true,
      competitor,
      effectiveDate,
      deleted: deleted.length,
    });
  },
);

export default router;
