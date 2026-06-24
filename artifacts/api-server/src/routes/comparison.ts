import { Router, type IRouter, type Response } from "express";
import { sql, eq, ne, asc, and } from "drizzle-orm";
import * as XLSX from "xlsx";
import {
  db,
  competitorPricesTable,
  catalogProductsTable,
  mrpPriceHistoryTable,
} from "@workspace/db";
import { normCode } from "../lib/catalog";
import { buildCandidate, suggestMatches, type CatalogCandidate } from "../lib/suggest";

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
  productName: string | null;
}

// Current MRP + product name, keyed by normalized item code, for live joins.
async function getPrayagMaps(): Promise<Map<string, PrayagInfo>> {
  const current = await db
    .select({
      itemCode: mrpPriceHistoryTable.itemCode,
      mrp: mrpPriceHistoryTable.mrp,
      effectiveDate: mrpPriceHistoryTable.effectiveDate,
    })
    .from(mrpPriceHistoryTable)
    .where(eq(mrpPriceHistoryTable.isCurrent, true));
  const products = await db
    .select({
      itemCode: catalogProductsTable.itemCode,
      productName: catalogProductsTable.productName,
    })
    .from(catalogProductsTable);

  const nameMap = new Map<string, string | null>();
  for (const p of products) nameMap.set(normCode(p.itemCode), p.productName);

  const map = new Map<string, PrayagInfo>();
  for (const c of current) {
    const key = normCode(c.itemCode);
    map.set(key, {
      mrp: c.mrp,
      effectiveDate: c.effectiveDate,
      productName: nameMap.get(key) ?? null,
    });
  }
  // Include matched products that have a name but no current price.
  for (const p of products) {
    const key = normCode(p.itemCode);
    if (!map.has(key)) {
      map.set(key, {
        mrp: null,
        effectiveDate: null,
        productName: p.productName,
      });
    }
  }
  return map;
}

// Catalog products with their current MRP, prepared for fuzzy matching. Built
// once per request so per-row scoring is cheap.
async function getCatalogCandidates(): Promise<CatalogCandidate[]> {
  const products = await db
    .select({
      itemCode: catalogProductsTable.itemCode,
      productName: catalogProductsTable.productName,
      division: catalogProductsTable.division,
      category: catalogProductsTable.category,
      size: catalogProductsTable.size,
    })
    .from(catalogProductsTable);
  const current = await db
    .select({
      itemCode: mrpPriceHistoryTable.itemCode,
      mrp: mrpPriceHistoryTable.mrp,
    })
    .from(mrpPriceHistoryTable)
    .where(eq(mrpPriceHistoryTable.isCurrent, true));

  const mrpByCode = new Map<string, number | null>();
  for (const c of current) mrpByCode.set(normCode(c.itemCode), c.mrp);

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

function buildComparisonRow(c: CompRow, maps: Map<string, PrayagInfo>) {
  const key = c.matchedPrayagCode ? normCode(c.matchedPrayagCode) : null;
  const prayag = key ? maps.get(key) : undefined;
  const prayagMrp = prayag?.mrp ?? null;
  let diffPct: number | null = null;
  let prayagCheaper: boolean | null = null;
  if (prayagMrp != null && c.price > 0) {
    diffPct = Math.round(((prayagMrp - c.price) / c.price) * 1000) / 10;
    prayagCheaper = prayagMrp <= c.price;
  }
  return {
    id: c.id,
    competitor: c.competitor,
    category: c.category,
    description: c.description,
    size: c.size,
    competitorPrice: c.price,
    unit: c.unit,
    effectiveDate: c.effectiveDate,
    matchedPrayagCode: c.matchedPrayagCode,
    matchStatus: c.matchStatus,
    matchConfidence: c.matchConfidence,
    prayagProductName: prayag?.productName ?? null,
    prayagMrp,
    prayagEffectiveDate: prayag?.effectiveDate ?? null,
    diffPct,
    prayagCheaper,
  };
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

  const maps = await getPrayagMaps();

  let q = db.select().from(competitorPricesTable).$dynamic();
  if (conditions.length > 0) q = q.where(and(...conditions));
  const all = await q.orderBy(
    asc(competitorPricesTable.category),
    asc(competitorPricesTable.description),
    asc(competitorPricesTable.id),
  );

  let rows = all.map((c) => buildComparisonRow(c, maps));
  if (expensiveOnly) rows = rows.filter((r) => r.prayagCheaper === false);

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

  const maps = await getPrayagMaps();
  let q = db.select().from(competitorPricesTable).$dynamic();
  if (conditions.length > 0) q = q.where(and(...conditions));
  const all = await q.orderBy(
    asc(competitorPricesTable.category),
    asc(competitorPricesTable.description),
    asc(competitorPricesTable.id),
  );

  let rows = all.map((c) => buildComparisonRow(c, maps));
  if (expensiveOnly) rows = rows.filter((r) => r.prayagCheaper === false);

  const header = [
    "Competitor",
    "Category",
    "Description",
    "Size",
    "Competitor Price",
    "Unit",
    "Effective Date",
    "Prayag Code",
    "Prayag Product Name",
    "Prayag MRP",
    "Prayag Effective Date",
    "Diff %",
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
    r.matchedPrayagCode,
    r.prayagProductName,
    r.prayagMrp,
    r.prayagEffectiveDate,
    r.diffPct,
    r.matchStatus,
  ]);
  sendSheet(res, [header, ...body], "Comparison", "prayag-comparison", format);
});

// GET /catalog/comparison/summary — competitive share KPI + category win-rate.
router.get("/catalog/comparison/summary", async (req, res) => {
  const competitor = strParam(req.query.competitor);
  const maps = await getPrayagMaps();

  let q = db.select().from(competitorPricesTable).$dynamic();
  if (competitor) q = q.where(eq(competitorPricesTable.competitor, competitor));
  const all = await q;
  const rows = all.map((c) => buildComparisonRow(c, maps));

  const matched = rows.filter((r) => !!r.matchedPrayagCode);
  const comparable = rows.filter((r) => r.diffPct != null);
  const cheaper = comparable.filter((r) => r.prayagCheaper);
  const reviewRows = rows.filter((r) => r.matchStatus !== "matched");

  const confidenceCounts = {
    high: rows.filter((r) => r.matchConfidence === "High").length,
    medium: rows.filter((r) => r.matchConfidence === "Medium").length,
    low: rows.filter((r) => r.matchConfidence === "Low").length,
    none: rows.filter((r) => !r.matchConfidence).length,
  };

  const avgDiffPct =
    comparable.length > 0
      ? Math.round(
          (comparable.reduce((s, r) => s + (r.diffPct ?? 0), 0) /
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
    if (r.prayagCheaper) e.cheaper++;
    e.diffSum += r.diffPct ?? 0;
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
    confidenceCounts,
    categoryWinRates,
  });
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

  const conditions = [eq(competitorPricesTable.matchStatus, "matched")];
  if (category) conditions.push(eq(competitorPricesTable.category, category));
  if (search) {
    const like = `%${search.toLowerCase()}%`;
    conditions.push(
      sql`(lower(coalesce(${competitorPricesTable.description}, '')) like ${like} or lower(coalesce(${competitorPricesTable.matchedPrayagCode}, '')) like ${like} or lower(coalesce(${competitorPricesTable.size}, '')) like ${like})`,
    );
  }

  const maps = await getPrayagMaps();

  const matchedRows = await db
    .select()
    .from(competitorPricesTable)
    .where(and(...conditions));

  // Group competitor rows by the Prayag SKU they map to. A competitor can have
  // several rows for one SKU (e.g. different sizes), so we keep the lowest price
  // per competitor — the most aggressive rival quote for that SKU.
  interface Group {
    itemCode: string;
    category: string | null;
    byCompetitor: Map<string, number>;
  }
  const groups = new Map<string, Group>();
  for (const c of matchedRows) {
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
    const prev = g.byCompetitor.get(c.competitor);
    if (prev == null || c.price < prev) g.byCompetitor.set(c.competitor, c.price);
  }

  let rows = [...groups.entries()].map(([key, g]) => {
    const prayag = maps.get(key);
    const prayagMrp = prayag?.mrp ?? null;

    let cheapestRival: number | null = null;
    let cheapestRivalName: string | null = null;
    for (const [name, price] of g.byCompetitor) {
      if (cheapestRival == null || price < cheapestRival) {
        cheapestRival = price;
        cheapestRivalName = name;
      }
    }

    const competitors = [...g.byCompetitor.entries()]
      .map(([competitor, price]) => {
        let diffPct: number | null = null;
        if (prayagMrp != null && price > 0) {
          diffPct = Math.round(((prayagMrp - price) / price) * 1000) / 10;
        }
        return {
          competitor,
          price,
          diffPct,
          isCheapest: competitor === cheapestRivalName,
        };
      })
      .sort((a, b) => a.competitor.localeCompare(b.competitor));

    let diffPct: number | null = null;
    if (prayagMrp != null && cheapestRival != null && cheapestRival > 0) {
      diffPct = Math.round(((prayagMrp - cheapestRival) / cheapestRival) * 1000) / 10;
    }
    const prayagLowest =
      prayagMrp != null && cheapestRival != null && prayagMrp <= cheapestRival;

    return {
      itemCode: g.itemCode,
      prayagProductName: prayag?.productName ?? null,
      category: g.category,
      prayagMrp,
      prayagEffectiveDate: prayag?.effectiveDate ?? null,
      competitors,
      cheapestRival,
      cheapestRivalName,
      prayagLowest,
      rivalCount: competitors.length,
      diffPct,
    };
  });

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

// GET /catalog/comparison/filters — competitors, categories, match statuses.
router.get("/catalog/comparison/filters", async (_req, res) => {
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
  });
});

// GET /catalog/mapping-review — competitor rows needing manual mapping.
router.get("/catalog/mapping-review", async (req, res) => {
  const competitor = strParam(req.query.competitor);
  const confidence = strParam(req.query.confidence);
  const search = strParam(req.query.search);
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));

  const conditions = [ne(competitorPricesTable.matchStatus, "matched")];
  if (competitor) conditions.push(eq(competitorPricesTable.competitor, competitor));
  if (confidence)
    conditions.push(eq(competitorPricesTable.matchConfidence, confidence));
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

  const competitors = [...new Set(all.map((c) => c.competitor))].sort();

  interface Cell {
    competitor: string;
    price: number | null;
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
  for (const c of all) {
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
    if (prayagMrp != null && c.price > 0) {
      diffPct = Math.round(((prayagMrp - c.price) / c.price) * 1000) / 10;
      prayagCheaper = prayagMrp <= c.price;
    }
    // If a competitor has multiple rows mapped to the same Prayag code, keep
    // the cheapest (most aggressive) competitor price for that competitor.
    const existing = group.cells.find((x) => x.competitor === c.competitor);
    if (!existing) {
      group.cells.push({
        competitor: c.competitor,
        price: c.price,
        diffPct,
        prayagCheaper,
        matchConfidence: c.matchConfidence,
      });
    } else if (existing.price == null || c.price < existing.price) {
      existing.price = c.price;
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
    rows: rows.slice(start, start + pageSize),
    total,
    page,
    pageSize,
  });
});

// GET /catalog/mapping-review/export — full filtered review list as CSV/XLSX.
router.get("/catalog/mapping-review/export", async (req, res) => {
  const competitor = strParam(req.query.competitor);
  const search = strParam(req.query.search);
  const format = String(req.query.format ?? "xlsx");

  const conditions = [ne(competitorPricesTable.matchStatus, "matched")];
  if (competitor) conditions.push(eq(competitorPricesTable.competitor, competitor));
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
  const rows = all.map((c) => buildComparisonRow(c, maps));

  const header = [
    "Competitor",
    "Category",
    "Description",
    "Size",
    "Competitor Price",
    "Unit",
    "Effective Date",
    "Prayag Code",
    "Prayag MRP",
    "Diff %",
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
    r.matchedPrayagCode,
    r.prayagMrp,
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

// PATCH /catalog/competitor-prices/:id — assign/correct a row's mapping.
router.patch("/catalog/competitor-prices/:id", async (req, res) => {
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
  const matchedPrayagCode =
    typeof body.matchedPrayagCode === "string" && body.matchedPrayagCode.trim()
      ? body.matchedPrayagCode.trim()
      : null;
  // Canonical statuses: "matched" vs "no match (review)". Anything else is
  // coerced from whether a code was supplied, keeping API + UI consistent.
  // Invariant: a row can only be "matched" when it has a non-empty code, so a
  // null code always forces review status (never a phantom matched+null row).
  const ALLOWED_STATUSES = new Set(["matched", "no match (review)"]);
  const requested =
    typeof body.matchStatus === "string" ? body.matchStatus.trim() : "";
  const matchStatus = !matchedPrayagCode
    ? "no match (review)"
    : ALLOWED_STATUSES.has(requested)
      ? requested
      : "matched";
  // A manual mapping correction is authoritative: default it to High confidence
  // unless the caller explicitly passes a tier. Clear confidence when unmatched.
  const matchConfidence =
    matchStatus !== "matched"
      ? null
      : typeof body.matchConfidence === "string" && body.matchConfidence.trim()
        ? body.matchConfidence.trim()
        : "High";

  const updated = await db
    .update(competitorPricesTable)
    .set({ matchedPrayagCode, matchStatus, matchConfidence, updatedAt: new Date() })
    .where(eq(competitorPricesTable.id, id))
    .returning();
  const row = updated[0];
  if (!row) {
    res.status(404).json({ error: "Competitor price not found" });
    return;
  }

  const maps = await getPrayagMaps();
  res.json(buildComparisonRow(row, maps));
});

export default router;
