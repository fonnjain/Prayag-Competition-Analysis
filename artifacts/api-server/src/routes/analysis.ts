import { Router, type IRouter, type Response } from "express";
import { eq } from "drizzle-orm";
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
  pct,
  round1,
  strParam,
  DEFAULT_PRAYAG_DISCOUNT,
  DEFAULT_COMPETITOR_DISCOUNT,
  type PrayagInfo,
  type AnalysisRow,
  type CompareMode,
  type BuildRowOpts,
} from "../lib/analysis";

const router: IRouter = Router();

// Current MRP + catalog attributes keyed by normalized item code.
async function getPrayagCatalogMap(): Promise<Map<string, PrayagInfo>> {
  const products = await db
    .select({
      itemCode: catalogProductsTable.itemCode,
      productName: catalogProductsTable.productName,
      division: catalogProductsTable.division,
      category: catalogProductsTable.category,
    })
    .from(catalogProductsTable);
  const current = await db
    .select({
      itemCode: mrpPriceHistoryTable.itemCode,
      mrp: mrpPriceHistoryTable.mrp,
      effectiveDate: mrpPriceHistoryTable.effectiveDate,
    })
    .from(mrpPriceHistoryTable)
    .where(eq(mrpPriceHistoryTable.isCurrent, true));

  const priceMap = new Map<string, { mrp: number | null; effectiveDate: string | null }>();
  for (const c of current) {
    priceMap.set(normCode(c.itemCode), {
      mrp: c.mrp,
      effectiveDate: c.effectiveDate,
    });
  }

  const map = new Map<string, PrayagInfo>();
  for (const p of products) {
    const key = normCode(p.itemCode);
    const price = priceMap.get(key);
    map.set(key, {
      mrp: price?.mrp ?? null,
      division: p.division,
      category: p.category,
      productName: p.productName,
      effectiveDate: price?.effectiveDate ?? null,
    });
  }
  return map;
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

async function getFilteredRows(query: Record<string, unknown>): Promise<AnalysisRow[]> {
  const mode = parseMode(query);
  const [maps, all, discounts] = await Promise.all([
    getPrayagCatalogMap(),
    db.select().from(competitorPricesTable),
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
  const rows = all.map((c) => buildRow(c, maps, opts));
  return applyFilters(rows, parseFilters(query));
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
  const rows = await getFilteredRows(req.query);
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
  });
});

// GET /analysis/by-brand — per-competitor breakdown.
router.get("/analysis/by-brand", async (req, res) => {
  const rows = await getFilteredRows(req.query);
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
  const rows = await getFilteredRows(req.query);
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
  const rows = await getFilteredRows(req.query);
  const diffs = rows
    .filter((r) => r.comparable && r.priceDiffPct != null)
    .map((r) => r.priceDiffPct!);
  res.json({ comparableSkus: diffs.length, buckets: bucketize(diffs) });
});

// GET /analysis/coverage-matrix — per-competitor coverage and match quality.
router.get("/analysis/coverage-matrix", async (req, res) => {
  const rows = await getFilteredRows(req.query);
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
  const rows = await getFilteredRows(req.query);
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

  res.json({ thresholdPct, marginHeadroom, priceThreats });
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
  const rows = await getFilteredRows(req.query);
  const format = String(req.query.format ?? "xlsx") === "csv" ? "csv" : "xlsx";

  const header = [
    "Competitor",
    "Prayag Code",
    "Prayag Product",
    "Division",
    "Category",
    "Match Status",
    "Match Confidence",
    "Prayag MRP",
    "Competitor Price",
    "Unit / Basis",
    "Competitor Effective Price",
    "Price Diff",
    "Price Diff %",
    "Prayag Cheaper",
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
    r.competitorPrice,
    r.unit,
    r.competitorEffectivePrice == null ? null : round1(r.competitorEffectivePrice),
    r.priceDiff == null ? null : round1(r.priceDiff),
    r.priceDiffPct == null ? null : round1(r.priceDiffPct),
    r.prayagCheaper == null ? "" : r.prayagCheaper ? "Yes" : "No",
  ]);

  sendSheet(res, [header, ...body], "Analysis", "prayag-competition-analysis", format);
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
