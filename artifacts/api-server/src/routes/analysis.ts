import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, sql } from "drizzle-orm";
import * as XLSX from "xlsx";
import {
  db,
  competitorPricesTable,
  catalogProductsTable,
  mrpPriceHistoryTable,
  discountSettingsTable,
} from "@workspace/db";
import { normCode } from "../lib/catalog";
import {
  buildRow,
  parseFilters,
  applyFilters,
  gapStats,
  confidenceCounts,
  bucketize,
  toOpportunityItem,
  effectivePrice,
  pct,
  round1,
  strParam,
  resolveCompetitorPeriodDate,
  DEFAULT_PRAYAG_DISCOUNT,
  DEFAULT_COMPETITOR_DISCOUNT,
  type PrayagInfo,
  type AnalysisRow,
  type CompareMode,
  type BuildRowOpts,
} from "../lib/analysis";
import {
  priceChangePct,
  validToFromNextDate,
  validToFromNextDateOrDiscontinuation,
} from "../lib/priceWindow.js";

const router: IRouter = Router();

/** Returns today's date as YYYY-MM-DD (local calendar). */
function todayString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Current MRP + catalog attributes keyed by normalized item code.
// Always uses DISTINCT ON (item_code) WHERE effective_date <= resolvedDate —
// never falls back to the is_current flag. When no period filter is given,
// resolvedDate defaults to today (CURRENT_DATE).
// Also queries the next upcoming revision (effective_date > resolvedDate) so
// consumers can show "Upcoming w.e.f. <date>" without a second round-trip.
//
// Exported for integration testing only. Not part of the public HTTP surface.
export async function getPrayagCatalogMapForPeriod(atDate?: string | null): Promise<Map<string, PrayagInfo>> {
  const resolvedDate = atDate ?? todayString();
  type PriceRow = { item_code: string; mrp: number | null; effective_date: string | null };

  const [products, currentResult, upcomingResult] = await Promise.all([
    db
      .select({
        itemCode: catalogProductsTable.itemCode,
        productName: catalogProductsTable.productName,
        division: catalogProductsTable.division,
        category: catalogProductsTable.category,
        discontinuedFrom: catalogProductsTable.discontinuedFrom,
      })
      .from(catalogProductsTable)
      .where(and(
        eq(catalogProductsTable.isActive, true),
        sql`(${catalogProductsTable.discontinuedFrom} is null or ${catalogProductsTable.discontinuedFrom} > ${resolvedDate})`,
      )),
    db.execute<PriceRow>(sql`
      SELECT DISTINCT ON (item_code) item_code, mrp, effective_date
      FROM mrp_price_history
      WHERE effective_date <= ${resolvedDate}
        AND mrp IS NOT NULL
        AND review_status = 'approved'
      ORDER BY item_code, effective_date DESC, id DESC
    `),
    db.execute<PriceRow>(sql`
      SELECT DISTINCT ON (item_code) item_code, mrp, effective_date
      FROM mrp_price_history
      WHERE effective_date > ${resolvedDate}
        AND mrp IS NOT NULL
        AND review_status = 'approved'
      ORDER BY item_code, effective_date ASC, id DESC
    `),
  ]);

  const priceMap = new Map<string, { mrp: number | null; effectiveDate: string | null }>();
  for (const c of currentResult.rows) {
    priceMap.set(normCode(c.item_code), { mrp: c.mrp, effectiveDate: c.effective_date });
  }

  const upcomingMap = new Map<string, { mrp: number | null; effectiveDate: string | null }>();
  for (const c of upcomingResult.rows) {
    upcomingMap.set(normCode(c.item_code), { mrp: c.mrp, effectiveDate: c.effective_date });
  }

  const map = new Map<string, PrayagInfo>();
  for (const p of products) {
    const key = normCode(p.itemCode);
    const price = priceMap.get(key);
    const scheduled = upcomingMap.get(key);
    const upcoming =
      scheduled && (!p.discontinuedFrom || scheduled.effectiveDate! < p.discontinuedFrom)
        ? scheduled
        : undefined;
    map.set(key, {
      mrp: price?.mrp ?? null,
      division: p.division,
      category: p.category,
      productName: p.productName,
      effectiveDate: price?.effectiveDate ?? null,
      upcomingMrp: upcoming?.mrp ?? null,
      upcomingMrpDate: upcoming?.effectiveDate ?? null,
      validTo: validToFromNextDateOrDiscontinuation(
        upcoming?.effectiveDate ?? null,
        p.discontinuedFrom,
      ),
      upcomingChangePct: priceChangePct(price?.mrp ?? null, upcoming?.mrp ?? null),
    });
  }
  return map;
}

// Competitor rows for analysis. Always date-driven — returns the latest
// effective_date <= resolvedDate per (competitor, matched_prayag_code) for
// matched rows, and the latest period at or before resolvedDate for unmatched
// rows. resolvedDate defaults to today when no period filter is provided.
//
// NOTE: db.execute() returns raw PostgreSQL column names (snake_case), but
// buildRow() reads camelCase properties (matchStatus, matchedPrayagCode, etc.).
// mapCompetitorRow() bridges the gap so field lookups in buildRow always succeed.
type CompetitorRow = typeof competitorPricesTable.$inferSelect;

type RawCompetitorRow = {
  id: number;
  competitor: string;
  category: string | null;
  description: string | null;
  size: string | null;
  price: number | null;
  unit: string | null;
  competitor_code: string | null;
  effective_date: string | null;
  matched_prayag_code: string | null;
  match_status: string;
  match_confidence: string | null;
  prayag_mrp_at_compare: number | null;
  is_current: boolean;
  price_basis: string | null;
  gst_pct: number | null;
  created_at: Date | null;
  updated_at: Date | null;
  upcoming_price: number | null;
  upcoming_effective_date: string | null;
  upcoming_price_basis: string | null;
  upcoming_gst_pct: number | null;
  newer_revision_effective_date: string | null;
  newer_revision_review_status: string | null;
};

function mapCompetitorRow(r: RawCompetitorRow): CompetitorRow {
  // Cast via unknown: priceBasis/gstPct exist in the source schema but the
  // generated dist types are stale (task #61). The fields ARE present in the
  // runtime object and are read by buildRow() via the CompInput interface.
  return {
    id: r.id,
    competitor: r.competitor,
    category: r.category ?? null,
    description: r.description ?? null,
    size: r.size ?? null,
    price: r.price ?? null,
    unit: r.unit ?? null,
    competitorCode: r.competitor_code ?? null,
    effectiveDate: r.effective_date ?? null,
    matchedPrayagCode: r.matched_prayag_code ?? null,
    matchStatus: r.match_status ?? "no match (review)",
    matchConfidence: r.match_confidence ?? null,
    prayagMrpAtCompare: r.prayag_mrp_at_compare ?? null,
    isCurrent: r.is_current ?? true,
    priceBasis: r.price_basis ?? null,
    gstPct: r.gst_pct ?? null,
    validTo: validToFromNextDate(r.upcoming_effective_date ?? null),
    upcomingPrice: r.upcoming_price ?? null,
    upcomingEffectiveDate: r.upcoming_effective_date ?? null,
    upcomingPriceBasis: r.upcoming_price_basis ?? null,
    upcomingGstPct: r.upcoming_gst_pct ?? null,
    newerRevisionEffectiveDate: r.newer_revision_effective_date ?? null,
    newerRevisionReviewStatus: r.newer_revision_review_status ?? null,
    // created_at / updated_at are NOT NULL in the schema; cast directly.
    createdAt: r.created_at as Date,
    updatedAt: r.updated_at as Date,
  } as unknown as CompetitorRow;
}

export async function getCompetitorRowsForPeriod(atDate?: string | null): Promise<CompetitorRow[]> {
  const resolvedDate = atDate ?? todayString();
  const [matched, unmatched] = await Promise.all([
    db.execute<RawCompetitorRow>(sql`
      WITH current_rows AS (
        SELECT DISTINCT ON (competitor, matched_prayag_code) *
        FROM competitor_prices
        WHERE matched_prayag_code IS NOT NULL
          AND match_status = 'matched'
          AND effective_date IS NOT NULL
          AND effective_date <= ${resolvedDate}
          AND price IS NOT NULL
        ORDER BY competitor, matched_prayag_code, effective_date DESC, id DESC
      )
      SELECT
        current_rows.*,
        next_price.price AS upcoming_price,
        next_price.effective_date AS upcoming_effective_date,
        next_price.price_basis AS upcoming_price_basis,
        next_price.gst_pct AS upcoming_gst_pct,
        pending_revision.effective_date AS newer_revision_effective_date,
        pending_revision.match_status AS newer_revision_review_status
      FROM current_rows
      LEFT JOIN LATERAL (
        SELECT cp.price, cp.effective_date, cp.price_basis, cp.gst_pct
        FROM competitor_prices cp
        WHERE cp.competitor = current_rows.competitor
          AND cp.matched_prayag_code = current_rows.matched_prayag_code
          AND cp.effective_date > current_rows.effective_date
          AND cp.price IS NOT NULL
        ORDER BY cp.effective_date ASC, cp.id DESC
        LIMIT 1
      ) next_price ON true
      LEFT JOIN LATERAL (
        SELECT cp.effective_date, cp.match_status
        FROM competitor_prices cp
        WHERE cp.competitor = current_rows.competitor
          AND cp.matched_prayag_code = current_rows.matched_prayag_code
          AND cp.effective_date > current_rows.effective_date
          AND cp.price IS NOT NULL
          AND cp.match_status <> 'matched'
        ORDER BY cp.effective_date DESC, cp.id DESC
        LIMIT 1
      ) pending_revision ON true
    `),
    db.execute<RawCompetitorRow>(sql`
      SELECT
        cp.*,
        NULL::double precision AS upcoming_price,
        NULL::date AS upcoming_effective_date,
        NULL::text AS upcoming_price_basis,
        NULL::double precision AS upcoming_gst_pct,
        NULL::date AS newer_revision_effective_date,
        NULL::text AS newer_revision_review_status
      FROM competitor_prices cp
      JOIN (
        SELECT competitor, MAX(effective_date) AS max_date
        FROM competitor_prices
        WHERE matched_prayag_code IS NULL
          AND effective_date IS NOT NULL
          AND effective_date <= ${resolvedDate}
        GROUP BY competitor
      ) latest ON cp.competitor = latest.competitor
        AND cp.effective_date = latest.max_date
      WHERE cp.matched_prayag_code IS NULL
    `),
  ]);
  return [...matched.rows, ...unmatched.rows].map(mapCompetitorRow);
}

const PRAYAG_SCOPE = "prayag";

interface ResolvedDiscounts {
  prayag: number;
  byCompetitor: Map<string, number>;
  updatedAt: string | null;
}

// Read the per-scope discounts, seeding defaults on first use: prayag = 5%, and
// every distinct competitor in competitor_prices = 40%. Seeding is idempotent
// (scope is unique) so concurrent requests cannot create duplicates.
async function getDiscounts(): Promise<ResolvedDiscounts> {
  let rows = await db.select().from(discountSettingsTable);
  const existing = new Set(rows.map((r) => r.scope));

  // Backfill any missing default rows on every call so newly imported
  // competitors always get a configurable default-40% entry, not just on the
  // very first access. onConflictDoNothing keeps this idempotent/concurrent-safe.
  const comps = await db
    .selectDistinct({ competitor: competitorPricesTable.competitor })
    .from(competitorPricesTable);
  const seed = [
    { scope: PRAYAG_SCOPE, discountPct: DEFAULT_PRAYAG_DISCOUNT },
    ...comps
      .map((c) => c.competitor)
      .filter((c): c is string => !!c && c.trim() !== "")
      .map((competitor) => ({
        scope: competitor,
        discountPct: DEFAULT_COMPETITOR_DISCOUNT,
      })),
  ].filter((s) => !existing.has(s.scope));

  if (seed.length > 0) {
    await db
      .insert(discountSettingsTable)
      .values(seed)
      .onConflictDoNothing({ target: discountSettingsTable.scope });
    rows = await db.select().from(discountSettingsTable);
  }

  const byCompetitor = new Map<string, number>();
  let prayag = DEFAULT_PRAYAG_DISCOUNT;
  let updatedAt: string | null = null;
  for (const r of rows) {
    if (r.scope === PRAYAG_SCOPE) prayag = r.discountPct;
    else byCompetitor.set(r.scope, r.discountPct);
    const ts = r.updatedAt?.toISOString() ?? null;
    if (ts && (!updatedAt || ts > updatedAt)) updatedAt = ts;
  }
  return { prayag, byCompetitor, updatedAt };
}

function parseMode(query: Record<string, unknown>): CompareMode {
  return strParam(query.mode) === "net" ? "net" : "mrp";
}

interface FilteredRowsResult {
  rows: AnalysisRow[];
  /** The resolved Prayag MRP date (YYYY-MM-DD) used for comparison — always ≤ today. */
  prayagMrpDate: string;
  /**
   * The latest competitor effective_date that is ≤ the requested period
   * (YYYY-MM-DD), or null when no competitor rows with a known effective date
   * exist for that period.
   */
  competitorPeriodDate: string | null;
}

async function getFilteredRows(query: Record<string, unknown>): Promise<FilteredRowsResult> {
  const mode = parseMode(query);
  const atDate = strParam(query.effectivePeriod);
  // Prayag MRP always resolves to the latest revision that is already in effect
  // (effective_date <= today), regardless of which competitor period the user is
  // viewing.  A future Prayag MRP (e.g. w.e.f. 01-Sep) surfaces as
  // upcomingPrayagMrp / upcomingPrayagMrpDate on each row instead.
  const today = todayString();
  const prayagMrpDate = atDate && atDate < today ? atDate : today;
  // A future period may be selected for planning, but headline comparisons
  // must remain current-vs-current until that period actually starts.
  const competitorAsOfDate = atDate && atDate < today ? atDate : today;
  const [maps, all, discounts] = await Promise.all([
    getPrayagCatalogMapForPeriod(prayagMrpDate),
    getCompetitorRowsForPeriod(competitorAsOfDate),
    mode === "net"
      ? getDiscounts()
      : Promise.resolve<ResolvedDiscounts>({
          prayag: DEFAULT_PRAYAG_DISCOUNT,
          byCompetitor: new Map(),
          updatedAt: null,
        }),
  ]);
  const opts: BuildRowOpts = {
    mode,
    prayagDiscount: discounts.prayag,
    discountFor: (c) => discounts.byCompetitor.get(c) ?? DEFAULT_COMPETITOR_DISCOUNT,
  };
  const rows = all
    .filter((c) => {
      if (c.matchStatus !== "matched") return true;
      if (!c.matchedPrayagCode) return false;
      return maps.get(normCode(c.matchedPrayagCode))?.mrp != null;
    })
    .map((c) => buildRow(c, maps, opts));
  const competitorPeriodDate = resolveCompetitorPeriodDate(all);
  return { rows: applyFilters(rows, parseFilters(query)), prayagMrpDate, competitorPeriodDate };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// GET /analysis/filters — option lists for the filter bar.
router.get("/analysis/filters", async (_req, res) => {
  const [comps, products] = await Promise.all([
    db
      .selectDistinct({
        competitor: competitorPricesTable.competitor,
        matchStatus: competitorPricesTable.matchStatus,
        matchConfidence: competitorPricesTable.matchConfidence,
      })
      .from(competitorPricesTable),
    db
      .selectDistinct({
        division: catalogProductsTable.division,
        category: catalogProductsTable.category,
      })
      .from(catalogProductsTable),
  ]);

  const competitors = [...new Set(comps.map((c) => c.competitor))].sort();
  const matchStatuses = [...new Set(comps.map((c) => c.matchStatus))].sort();
  const matchConfidences = [
    ...new Set(
      comps
        .map((c) => c.matchConfidence)
        .filter((v): v is string => v != null && v.trim() !== ""),
    ),
  ].sort();
  const divisions = [
    ...new Set(
      products
        .map((p) => p.division)
        .filter((v): v is string => v != null && v.trim() !== ""),
    ),
  ].sort();
  const categories = [
    ...new Set(
      products
        .map((p) => p.category)
        .filter((v): v is string => v != null && v.trim() !== ""),
    ),
  ].sort();

  res.json({ competitors, divisions, categories, matchConfidences, matchStatuses });
});

// GET /analysis/overview — headline KPIs.
router.get("/analysis/overview", async (req, res) => {
  const { rows, prayagMrpDate, competitorPeriodDate } = await getFilteredRows(req.query);
  const matched = rows.filter((r) => r.matched).length;
  const gap = gapStats(rows);
  res.json({
    totalSkus: rows.length,
    matchedSkus: matched,
    unmatchedSkus: rows.length - matched,
    coveragePct: pct(matched, rows.length),
    comparableSkus: gap.comparableSkus,
    prayagCheaperCount: gap.prayagCheaperCount,
    prayagCostlierCount: gap.prayagCostlierCount,
    prayagCheaperPct: gap.prayagCheaperPct,
    avgPriceDiffPct: gap.avgPriceDiffPct,
    medianPriceDiffPct: gap.medianPriceDiffPct,
    competitorCount: new Set(rows.map((r) => r.competitor)).size,
    matchQuality: confidenceCounts(rows),
    pendingRevisionCount: rows.filter((r) => r.newerRevisionAwaitingReview).length,
    prayagMrpDate,
    competitorPeriodDate,
  });
});

// GET /analysis/by-brand — per-competitor breakdown.
router.get("/analysis/by-brand", async (req, res) => {
  const { rows } = await getFilteredRows(req.query);
  const byComp = new Map<string, AnalysisRow[]>();
  for (const r of rows) {
    const list = byComp.get(r.competitor);
    if (list) list.push(r);
    else byComp.set(r.competitor, [r]);
  }
  const result = [...byComp.entries()]
    .map(([competitor, list]) => {
      const matched = list.filter((r) => r.matched).length;
      const gap = gapStats(list);
      return {
        competitor,
        totalSkus: list.length,
        matchedSkus: matched,
        coveragePct: pct(matched, list.length),
        comparableSkus: gap.comparableSkus,
        prayagCheaperCount: gap.prayagCheaperCount,
        prayagCostlierCount: gap.prayagCostlierCount,
        prayagCheaperPct: gap.prayagCheaperPct,
        avgPriceDiffPct: gap.avgPriceDiffPct,
        medianPriceDiffPct: gap.medianPriceDiffPct,
      };
    })
    .sort((a, b) => a.competitor.localeCompare(b.competitor));
  res.json(result);
});

// GET /analysis/by-category — per Prayag category breakdown (matched rows).
router.get("/analysis/by-category", async (req, res) => {
  const { rows } = await getFilteredRows(req.query);
  const byCat = new Map<string, AnalysisRow[]>();
  for (const r of rows) {
    if (!r.category) continue;
    const list = byCat.get(r.category);
    if (list) list.push(r);
    else byCat.set(r.category, [r]);
  }
  const result = [...byCat.entries()]
    .map(([category, list]) => {
      const gap = gapStats(list);
      return {
        category,
        division: list[0]?.division ?? null,
        totalSkus: list.length,
        comparableSkus: gap.comparableSkus,
        prayagCheaperCount: gap.prayagCheaperCount,
        prayagCostlierCount: gap.prayagCostlierCount,
        prayagCheaperPct: gap.prayagCheaperPct,
        avgPriceDiffPct: gap.avgPriceDiffPct,
      };
    })
    .sort((a, b) => b.comparableSkus - a.comparableSkus);
  res.json(result);
});

// GET /analysis/positioning — histogram of price_diff_pct across comparable SKUs.
router.get("/analysis/positioning", async (req, res) => {
  const { rows } = await getFilteredRows(req.query);
  const diffs = rows
    .filter((r) => r.comparable && r.priceDiffPct != null)
    .map((r) => r.priceDiffPct!);
  res.json({ comparableSkus: diffs.length, buckets: bucketize(diffs) });
});

// GET /analysis/coverage-matrix — per-competitor coverage and match quality.
router.get("/analysis/coverage-matrix", async (req, res) => {
  const { rows } = await getFilteredRows(req.query);
  const byComp = new Map<string, AnalysisRow[]>();
  for (const r of rows) {
    const list = byComp.get(r.competitor);
    if (list) list.push(r);
    else byComp.set(r.competitor, [r]);
  }

  function rowFor(competitor: string, list: AnalysisRow[]) {
    const matched = list.filter((r) => r.matched).length;
    const cc = confidenceCounts(list);
    return {
      competitor,
      total: list.length,
      matched,
      unmatched: list.length - matched,
      coveragePct: pct(matched, list.length),
      high: cc.high,
      medium: cc.medium,
      low: cc.low,
      none: cc.none,
    };
  }

  const matrixRows = [...byComp.entries()]
    .map(([competitor, list]) => rowFor(competitor, list))
    .sort((a, b) => a.competitor.localeCompare(b.competitor));
  const totals = rowFor("All competitors", rows);

  res.json({ rows: matrixRows, totals });
});

// GET /analysis/opportunities — biggest margin headroom and pricing threats.
router.get("/analysis/opportunities", async (req, res) => {
  const { rows, prayagMrpDate } = await getFilteredRows(req.query);
  const rawThreshold = Number(req.query.thresholdPct);
  const thresholdPct =
    Number.isFinite(rawThreshold) && rawThreshold >= 0 ? rawThreshold : 10;
  const LIMIT = 50;

  const comparable = rows.filter((r) => r.comparable && r.priceDiffPct != null);

  const marginHeadroom = comparable
    .filter((r) => r.priceDiffPct! >= thresholdPct)
    .sort((a, b) => b.priceDiffPct! - a.priceDiffPct!)
    .slice(0, LIMIT)
    .map(toOpportunityItem);

  const priceThreats = comparable
    .filter((r) => r.priceDiffPct! <= -thresholdPct)
    .sort((a, b) => a.priceDiffPct! - b.priceDiffPct!)
    .slice(0, LIMIT)
    .map(toOpportunityItem);

  res.json({ thresholdPct, marginHeadroom, priceThreats, prayagMrpDate });
});

// GET /analysis/export — filtered comparison rows as CSV/XLSX.
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
    res.setHeader("Content-Disposition", `attachment; filename="${fileBase}.csv"`);
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
  res.setHeader("Content-Disposition", `attachment; filename="${fileBase}.xlsx"`);
  res.send(buf);
}

router.get("/analysis/export", async (req, res) => {
  const { rows, prayagMrpDate } = await getFilteredRows(req.query);
  const format = String(req.query.format ?? "xlsx") === "csv" ? "csv" : "xlsx";

  const header = [
    "Competitor",
    "Prayag Code",
    "Prayag Product",
    "Division",
    "Category",
    "Match Status",
    "Match Confidence",
    "Prayag Current MRP",
    "Prayag Current Valid From",
    "Prayag Current Valid To",
    "Prayag Next MRP",
    "Prayag Next Effective Date",
    "Prayag Next Change %",
    "Competitor Current Listed Price",
    "Unit / Basis",
    "Competitor Current Effective Price",
    "Competitor Current Valid From",
    "Competitor Current Valid To",
    "Competitor Next Listed Price",
    "Competitor Next Effective Price",
    "Competitor Next Effective Date",
    "Competitor Next Change %",
    "Official Gap Note",
    "Newer Revision Awaiting Review",
    "Newer Revision Effective Date",
    "Newer Revision Review Status",
    "Current-vs-Current Price Diff",
    "Current-vs-Current Price Diff %",
    "Prayag Cheaper (Current-vs-Current)",
  ];

  const body = rows.map((r) => [
    r.competitor,
    r.prayagCode,
    r.prayagProductName,
    r.division,
    r.category,
    r.matchStatus,
    r.matchConfidence,
    r.prayagMrp,
    r.prayagEffectiveDate,
    r.prayagValidTo,
    r.upcomingPrayagMrp,
    r.upcomingPrayagMrpDate,
    r.upcomingPrayagChangePct,
    r.competitorPrice,
    r.unit,
    r.competitorEffectivePrice == null ? null : round1(r.competitorEffectivePrice),
    r.competitorEffectiveDate,
    r.competitorValidTo,
    r.upcomingCompetitorPrice,
    r.upcomingCompetitorEffectivePrice == null
      ? null
      : round1(r.upcomingCompetitorEffectivePrice),
    r.upcomingCompetitorPriceDate,
    r.upcomingCompetitorChangePct,
    r.newerRevisionAwaitingReview
      ? "Using confirmed price; newer revision awaits review"
      : "",
    r.newerRevisionAwaitingReview ? "yes" : "no",
    r.newerRevisionEffectiveDate,
    r.newerRevisionReviewStatus,
    r.priceDiff == null ? null : round1(r.priceDiff),
    r.priceDiffPct == null ? null : round1(r.priceDiffPct),
    r.prayagCheaper == null ? "" : r.prayagCheaper ? "Yes" : "No",
  ]);

  // Surface row-count metadata so clients can show a warning without parsing
  // the file. When zero data rows are found (e.g. effectivePeriod pre-dates
  // all data) the file still returns HTTP 200 with a header-only sheet, but
  // the X-Export-Warning header tells the UI something went wrong.
  res.setHeader("X-Export-Row-Count", String(body.length));
  if (body.length === 0) {
    res.setHeader(
      "X-Export-Warning",
      "No rows matched the requested period or filters; the file contains a header row only.",
    );
  }

  sendSheet(res, [header, ...body], "Analysis", "prayag-competition-analysis", format);
});

// ---------------------------------------------------------------------------
// GET /analysis/periods — distinct effective dates across both price tables.
// ---------------------------------------------------------------------------
router.get("/analysis/periods", async (_req, res) => {
  const today = new Date().toISOString().slice(0, 10);

  type DateRow = { effective_date: string };
  const [mrpDates, compDates] = await Promise.all([
    db.execute<DateRow>(sql`SELECT DISTINCT effective_date FROM mrp_price_history ORDER BY effective_date DESC`),
    db.execute<DateRow>(sql`SELECT DISTINCT effective_date FROM competitor_prices WHERE effective_date IS NOT NULL ORDER BY effective_date DESC`),
  ]);

  const allDates = new Set<string>();
  for (const r of mrpDates.rows) if (r.effective_date) allDates.add(r.effective_date);
  for (const r of compDates.rows) if (r.effective_date) allDates.add(r.effective_date);

  const periods = [...allDates].sort((a, b) => b.localeCompare(a));
  // Default = latest period that is not a future date
  const defaultPeriod = periods.find((d) => d <= today) ?? periods[0] ?? null;

  // Flag which periods are future-dated (Upcoming)
  const isFuturePeriod: Record<string, boolean> = {};
  for (const p of periods) isFuturePeriod[p] = p > today;

  res.json({ periods, defaultPeriod, isFuturePeriod });
});

// ---------------------------------------------------------------------------
// GET /analysis/mrp-increases — products with the biggest current-period MRP
// increase vs the previous period, ranked by changePct desc.
// ---------------------------------------------------------------------------
router.get("/analysis/mrp-increases", async (req, res) => {
  const division = strParam(req.query.division);
  const category = strParam(req.query.category);
  const limitRaw = Number(req.query.limit) || 50;
  const limit = Math.min(Math.max(1, limitRaw), 200);
  const atDate = strParam(req.query.effectivePeriod) ?? todayString();

  // Date-driven approach: rows with effective_date <= resolvedDate only.
  // ROW_NUMBER picks the most recent row per item (rn = 1); LAG (ascending)
  // supplies the previous period's MRP for the same item.
  type IncRow = {
    item_code: string;
    product_name: string | null;
    division: string | null;
    category: string | null;
    current_mrp: number;
    prev_mrp: number;
    current_date: string;
    prev_date: string;
    change_pct: number;
  };

  const divisionFilter = division ? sql`AND c.division = ${division}` : sql``;
  const categoryFilter = category ? sql`AND c.category = ${category}` : sql``;

  const rows = await db.execute<IncRow>(sql`
    WITH all_rows AS (
      SELECT
        h.item_code,
        h.mrp,
        h.effective_date,
        ROW_NUMBER() OVER (PARTITION BY h.item_code ORDER BY h.effective_date DESC, h.id DESC) AS rn,
        LAG(h.mrp)            OVER (PARTITION BY h.item_code ORDER BY h.effective_date ASC, h.id ASC) AS prev_mrp,
        LAG(h.effective_date) OVER (PARTITION BY h.item_code ORDER BY h.effective_date ASC, h.id ASC) AS prev_date
      FROM mrp_price_history h
      WHERE h.effective_date <= ${atDate}
        AND h.review_status = 'approved'
    )
    SELECT
      r.item_code,
      c.product_name,
      c.division,
      c.category,
      r.mrp            AS current_mrp,
      r.prev_mrp,
      r.effective_date AS current_date,
      r.prev_date,
      ROUND(((r.mrp - r.prev_mrp) / r.prev_mrp * 100)::numeric, 1) AS change_pct
    FROM all_rows r
    JOIN catalog_products c ON c.item_code = r.item_code
    WHERE r.rn = 1
      AND c.is_active IS TRUE
      AND (c.discontinued_from IS NULL OR c.discontinued_from > ${atDate})
      AND r.prev_mrp IS NOT NULL
      AND r.prev_mrp > 0
      AND r.mrp IS NOT NULL
      AND r.mrp > r.prev_mrp
      ${divisionFilter}
      ${categoryFilter}
    ORDER BY change_pct DESC
    LIMIT ${limit}
  `);

  res.json({
    items: rows.rows.map((r) => ({
      itemCode: r.item_code,
      productName: r.product_name,
      division: r.division,
      category: r.category,
      currentMrp: r.current_mrp,
      prevMrp: r.prev_mrp,
      currentDate: r.current_date,
      prevDate: r.prev_date,
      changePct: Number(r.change_pct),
    })),
  });
});

// ---------------------------------------------------------------------------
// GET /analysis/price-history/:itemCode — period-to-period MRP history.
// ---------------------------------------------------------------------------
router.get("/analysis/price-history/:itemCode", async (req: Request<{ itemCode: string }>, res) => {
  const { itemCode } = req.params;
  if (!itemCode) { res.status(400).json({ error: "itemCode required" }); return; }

  type MrpRow = { effective_date: string; mrp: number | null; price_basis: string; is_current: boolean; notes: string | null };
  type CompRow = { competitor: string; price: number | null; unit: string | null; effective_date: string; is_current: boolean };

  const [productRows, mrpRows, compRows] = await Promise.all([
    db
      .select({ itemCode: catalogProductsTable.itemCode, productName: catalogProductsTable.productName })
      .from(catalogProductsTable)
      .where(eq(catalogProductsTable.itemCode, itemCode)),
    db.execute<MrpRow>(sql`
      SELECT effective_date, mrp, price_basis, is_current, notes
      FROM mrp_price_history
      WHERE item_code = ${itemCode}
        AND review_status = 'approved'
      ORDER BY effective_date ASC, id ASC
    `),
    db.execute<CompRow>(sql`
      SELECT competitor, price, unit, effective_date, is_current
      FROM competitor_prices
      WHERE matched_prayag_code = ${itemCode}
        AND price IS NOT NULL
      ORDER BY competitor ASC, effective_date ASC, id ASC
    `),
  ]);

  // Compute period-to-period % change for Prayag
  const prayagHistory = mrpRows.rows.map((r, i) => {
    const prev = mrpRows.rows[i - 1];
    const changePct =
      prev?.mrp != null && prev.mrp > 0 && r.mrp != null
        ? round1(((r.mrp - prev.mrp) / prev.mrp) * 100)
        : null;
    return { effectiveDate: r.effective_date, mrp: r.mrp, priceBasis: r.price_basis, isCurrent: r.is_current, notes: r.notes, changePct };
  });

  // Group competitor rows by brand and compute period-to-period % change
  const byCompetitor = new Map<string, CompRow[]>();
  for (const r of compRows.rows) {
    const list = byCompetitor.get(r.competitor) ?? [];
    list.push(r);
    byCompetitor.set(r.competitor, list);
  }
  const competitorHistory = [...byCompetitor.entries()].map(([competitor, rows]) => ({
    competitor,
    periods: rows.map((r, i) => {
      const effPrice = round1(effectivePrice(r.unit, r.price!));
      const prev = rows[i - 1];
      const prevEff = prev?.price != null ? effectivePrice(prev.unit, prev.price) : null;
      const changePct =
        prevEff != null && prevEff > 0 ? round1(((effPrice - prevEff) / prevEff) * 100) : null;
      return { effectiveDate: r.effective_date, price: r.price, unit: r.unit, effectivePrice: effPrice, isCurrent: r.is_current, changePct };
    }),
  }));

  res.json({
    itemCode,
    productName: productRows[0]?.productName ?? null,
    prayagHistory,
    competitorHistory,
  });
});

// ---------------------------------------------------------------------------
// Discount settings (Net-to-Net mode)
// ---------------------------------------------------------------------------

// GET /analysis/discount-settings — current per-scope discounts (seeds defaults
// on first access). Returns Prayag's discount plus one entry per competitor.
router.get("/analysis/discount-settings", async (_req, res) => {
  const discounts = await getDiscounts();
  const competitors = [...discounts.byCompetitor.entries()]
    .map(([scope, discountPct]) => ({ scope, discountPct }))
    .sort((a, b) => a.scope.localeCompare(b.scope));
  res.json({
    prayagDiscountPct: discounts.prayag,
    competitors,
    updatedAt: discounts.updatedAt,
  });
});

// PUT /analysis/discount-settings — upsert Prayag and/or competitor discounts.
router.put("/analysis/discount-settings", async (req, res) => {
  const body = req.body as {
    prayagDiscountPct?: unknown;
    competitors?: unknown;
  };

  const validPct = (v: unknown): v is number =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100;

  const upserts: { scope: string; discountPct: number }[] = [];

  if (body.prayagDiscountPct !== undefined) {
    if (!validPct(body.prayagDiscountPct)) {
      res
        .status(400)
        .json({ error: "prayagDiscountPct must be a number between 0 and 100." });
      return;
    }
    upserts.push({ scope: PRAYAG_SCOPE, discountPct: body.prayagDiscountPct });
  }

  if (body.competitors !== undefined) {
    if (!Array.isArray(body.competitors)) {
      res.status(400).json({ error: "competitors must be an array." });
      return;
    }
    for (const item of body.competitors) {
      const scope = (item as { scope?: unknown })?.scope;
      const discountPct = (item as { discountPct?: unknown })?.discountPct;
      const normalized = typeof scope === "string" ? scope.trim() : "";
      if (normalized === "" || normalized === PRAYAG_SCOPE) {
        res.status(400).json({ error: "Each competitor needs a non-empty scope." });
        return;
      }
      if (!validPct(discountPct)) {
        res.status(400).json({
          error: `Discount for "${normalized}" must be a number between 0 and 100.`,
        });
        return;
      }
      upserts.push({ scope: normalized, discountPct });
    }
  }

  // Ensure defaults exist (and the table is seeded) before applying updates.
  await getDiscounts();

  for (const u of upserts) {
    await db
      .insert(discountSettingsTable)
      .values({ scope: u.scope, discountPct: u.discountPct })
      .onConflictDoUpdate({
        target: discountSettingsTable.scope,
        set: { discountPct: u.discountPct, updatedAt: new Date() },
      });
  }

  const discounts = await getDiscounts();
  const competitors = [...discounts.byCompetitor.entries()]
    .map(([scope, discountPct]) => ({ scope, discountPct }))
    .sort((a, b) => a.scope.localeCompare(b.scope));
  res.json({
    prayagDiscountPct: discounts.prayag,
    competitors,
    updatedAt: discounts.updatedAt,
  });
});

export default router;
