import { Router, type IRouter } from "express";
import { sql, eq, ne, asc, and } from "drizzle-orm";
import {
  db,
  competitorPricesTable,
  catalogProductsTable,
  mrpPriceHistoryTable,
} from "@workspace/db";
import { normCode } from "../lib/catalog";

const router: IRouter = Router();

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
  const search = strParam(req.query.search);
  const expensiveOnly = req.query.expensiveOnly === "true";
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));

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

  const total = rows.length;
  const start = (page - 1) * pageSize;
  res.json({ rows: rows.slice(start, start + pageSize), total, page, pageSize });
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
    categoryWinRates,
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

  res.json({
    competitors: compRows.map((r) => r.competitor).filter((c): c is string => !!c),
    categories: catRows.map((r) => r.category).filter((c): c is string => !!c),
    matchStatuses: statusRows
      .map((r) => r.matchStatus)
      .filter((c): c is string => !!c),
  });
});

// GET /catalog/mapping-review — competitor rows needing manual mapping.
router.get("/catalog/mapping-review", async (req, res) => {
  const competitor = strParam(req.query.competitor);
  const search = strParam(req.query.search);
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));

  const conditions = [ne(competitorPricesTable.matchStatus, "matched")];
  if (competitor) conditions.push(eq(competitorPricesTable.competitor, competitor));
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

  res.json({ rows, total, page, pageSize });
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
  };
  const matchedPrayagCode =
    typeof body.matchedPrayagCode === "string" && body.matchedPrayagCode.trim()
      ? body.matchedPrayagCode.trim()
      : null;
  // Canonical statuses: "matched" vs "no match (review)". Anything else is
  // coerced from whether a code was supplied, keeping API + UI consistent.
  const ALLOWED_STATUSES = new Set(["matched", "no match (review)"]);
  const requested =
    typeof body.matchStatus === "string" ? body.matchStatus.trim() : "";
  const matchStatus = ALLOWED_STATUSES.has(requested)
    ? requested
    : matchedPrayagCode
      ? "matched"
      : "no match (review)";

  const updated = await db
    .update(competitorPricesTable)
    .set({ matchedPrayagCode, matchStatus, updatedAt: new Date() })
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
