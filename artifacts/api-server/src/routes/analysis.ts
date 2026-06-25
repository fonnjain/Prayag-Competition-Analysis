import { Router, type IRouter, type Response } from "express";
import { eq } from "drizzle-orm";
import * as XLSX from "xlsx";
import {
  db,
  competitorPricesTable,
  catalogProductsTable,
  mrpPriceHistoryTable,
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
  type PrayagInfo,
  type AnalysisRow,
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

async function getFilteredRows(query: Record<string, unknown>): Promise<AnalysisRow[]> {
  const [maps, all] = await Promise.all([
    getPrayagCatalogMap(),
    db.select().from(competitorPricesTable),
  ]);
  const rows = all.map((c) => buildRow(c, maps));
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
    round1(r.competitorEffectivePrice),
    r.priceDiff == null ? null : round1(r.priceDiff),
    r.priceDiffPct == null ? null : round1(r.priceDiffPct),
    r.prayagCheaper == null ? "" : r.prayagCheaper ? "Yes" : "No",
  ]);

  sendSheet(res, [header, ...body], "Analysis", "prayag-competition-analysis", format);
});

export default router;
