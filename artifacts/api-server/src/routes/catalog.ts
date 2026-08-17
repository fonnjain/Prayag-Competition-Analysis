import { Router, type IRouter, type Request } from "express";
import { sql, eq, asc, desc, and } from "drizzle-orm";
import { recomputeCurrentFlags } from "../lib/catalog";
import {
  db,
  catalogProductsTable,
  mrpPriceHistoryTable,
  codeConflictsTable,
  competitorPricesTable,
} from "@workspace/db";
import { loadCatalogSeed } from "../lib/catalogSeed";

const router: IRouter = Router();

interface CurrentPrice {
  mrp: number | null;
  net: number | null;
  basis: string | null;
  effectiveDate: string | null;
}

async function getCurrentPriceMap(): Promise<Map<string, CurrentPrice>> {
  const rows = await db
    .select({
      itemCode: mrpPriceHistoryTable.itemCode,
      mrp: mrpPriceHistoryTable.mrp,
      net: mrpPriceHistoryTable.netPrice,
      basis: mrpPriceHistoryTable.priceBasis,
      effectiveDate: mrpPriceHistoryTable.effectiveDate,
    })
    .from(mrpPriceHistoryTable)
    .where(eq(mrpPriceHistoryTable.isCurrent, true));
  const map = new Map<string, CurrentPrice>();
  for (const r of rows) {
    map.set(r.itemCode, {
      mrp: r.mrp,
      net: r.net,
      basis: r.basis,
      effectiveDate: r.effectiveDate,
    });
  }
  return map;
}

// GET /catalog/products — paginated list with filters and current MRP.
router.get("/catalog/products", async (req, res) => {
  const division =
    typeof req.query.division === "string" && req.query.division.trim()
      ? req.query.division.trim()
      : null;
  const category =
    typeof req.query.category === "string" && req.query.category.trim()
      ? req.query.category.trim()
      : null;
  const search =
    typeof req.query.search === "string" && req.query.search.trim()
      ? req.query.search.trim()
      : null;
  const priceStatus =
    typeof req.query.priceStatus === "string" ? req.query.priceStatus : null;

  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));

  const conditions = [];
  if (division) conditions.push(eq(catalogProductsTable.division, division));
  if (category) conditions.push(eq(catalogProductsTable.category, category));
  if (search) {
    const like = `%${search.toLowerCase()}%`;
    conditions.push(
      sql`(lower(${catalogProductsTable.itemCode}) like ${like} or lower(coalesce(${catalogProductsTable.productName}, '')) like ${like})`,
    );
  }

  const currentMap = await getCurrentPriceMap();

  const whereExpr =
    conditions.length > 0
      ? sql.join(conditions, sql` and `)
      : undefined;

  let baseQuery = db
    .select()
    .from(catalogProductsTable)
    .$dynamic();
  if (whereExpr) baseQuery = baseQuery.where(whereExpr);

  // Fetch all matching products (catalog is small: <5k rows) then apply the
  // price-status filter in memory (depends on the current-price map) and
  // paginate. Keeps the SQL simple and correct.
  const allMatching = await baseQuery.orderBy(asc(catalogProductsTable.itemCode));

  let withPrice = allMatching.map((p) => {
    const cur = currentMap.get(p.itemCode);
    return {
      id: p.id,
      itemCode: p.itemCode,
      productName: p.productName,
      division: p.division,
      category: p.category,
      seriesRange: p.seriesRange,
      size: p.size,
      uom: p.uom,
      isActive: p.isActive,
      dataFlag: p.dataFlag,
      hasPrice: !!cur,
      currentMrp: cur?.mrp ?? null,
      currentNet: cur?.net ?? null,
      currentBasis: cur?.basis ?? null,
      effectiveDate: cur?.effectiveDate ?? null,
    };
  });

  if (priceStatus === "priced") {
    withPrice = withPrice.filter((p) => p.hasPrice);
  } else if (priceStatus === "pending") {
    withPrice = withPrice.filter((p) => !p.hasPrice);
  }

  const total = withPrice.length;
  const start = (page - 1) * pageSize;
  const rows = withPrice.slice(start, start + pageSize);

  res.json({ rows, total, page, pageSize });
});

// GET /catalog/filters — divisions + categories (with their division).
router.get("/catalog/filters", async (_req, res) => {
  const divRows = await db
    .selectDistinct({ division: catalogProductsTable.division })
    .from(catalogProductsTable)
    .orderBy(asc(catalogProductsTable.division));
  const catRows = await db
    .selectDistinct({
      category: catalogProductsTable.category,
      division: catalogProductsTable.division,
    })
    .from(catalogProductsTable)
    .orderBy(asc(catalogProductsTable.category));

  const divisions = divRows
    .map((r) => r.division)
    .filter((d): d is string => !!d);
  const categories = catRows
    .filter((r): r is { category: string; division: string | null } => !!r.category)
    .map((r) => ({ category: r.category, division: r.division }));

  res.json({ divisions, categories });
});

// GET /catalog/data-health — conflicts, missing prices, duplicate sources.
router.get("/catalog/data-health", async (_req, res) => {
  const totalRow = await db
    .select({ count: sql<number>`cast(count(*) as int)` })
    .from(catalogProductsTable);
  const totalProducts = totalRow[0]?.count ?? 0;

  const pricedRow = await db
    .select({
      count: sql<number>`cast(count(distinct ${mrpPriceHistoryTable.itemCode}) as int)`,
    })
    .from(mrpPriceHistoryTable);
  const pricedProducts = pricedRow[0]?.count ?? 0;
  const pendingProducts = totalProducts - pricedProducts;

  const conflictRows = await db
    .select()
    .from(codeConflictsTable)
    .orderBy(asc(codeConflictsTable.itemCode));

  // Products that have no price history row at all.
  const missingRows = await db
    .select({
      itemCode: catalogProductsTable.itemCode,
      productName: catalogProductsTable.productName,
      division: catalogProductsTable.division,
      category: catalogProductsTable.category,
    })
    .from(catalogProductsTable)
    .where(
      sql`not exists (select 1 from ${mrpPriceHistoryTable} h where h.item_code = ${catalogProductsTable.itemCode})`,
    )
    .orderBy(asc(catalogProductsTable.itemCode))
    .limit(500);

  // Source files that appear on multiple products (duplicate-source list).
  const dupRows = await db
    .select({
      sourceFiles: catalogProductsTable.sourceFiles,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(catalogProductsTable)
    .where(sql`${catalogProductsTable.sourceFiles} is not null`)
    .groupBy(catalogProductsTable.sourceFiles)
    .having(sql`count(*) > 1`)
    .orderBy(desc(sql`count(*)`))
    .limit(100);

  res.json({
    totalProducts,
    pricedProducts,
    pendingProducts,
    conflictCount: conflictRows.length,
    conflicts: conflictRows,
    missingPriceCount: pendingProducts,
    missingPrices: missingRows,
    duplicateSources: dupRows
      .filter((d): d is { sourceFiles: string; count: number } => !!d.sourceFiles)
      .map((d) => ({ sourceFiles: d.sourceFiles, count: d.count })),
  });
});

// GET /catalog/products/:itemCode — product + full price history (newest first).
router.get("/catalog/products/:itemCode", async (req: Request<{ itemCode: string }>, res) => {
  const itemCode = req.params.itemCode;
  const products = await db
    .select()
    .from(catalogProductsTable)
    .where(eq(catalogProductsTable.itemCode, itemCode))
    .limit(1);
  const product = products[0];
  if (!product) {
    res.status(404).json({ error: "Product not found" });
    return;
  }

  const history = await db
    .select()
    .from(mrpPriceHistoryTable)
    .where(eq(mrpPriceHistoryTable.itemCode, itemCode))
    .orderBy(
      desc(mrpPriceHistoryTable.effectiveDate),
      desc(mrpPriceHistoryTable.id),
    );

  res.json({
    product: {
      id: product.id,
      itemCode: product.itemCode,
      productName: product.productName,
      division: product.division,
      category: product.category,
      seriesRange: product.seriesRange,
      size: product.size,
      uom: product.uom,
      kgCost: product.kgCost,
      isActive: product.isActive,
      sourceFiles: product.sourceFiles,
      dataFlag: product.dataFlag,
    },
    history,
  });
});

// PATCH /catalog/products/:itemCode/mrp — set a new current MRP inline
// (without uploading a file). Inserts a new mrp_price_history row with
// priceBasis="MRP", marks it current, and returns the updated row.
router.patch("/catalog/products/:itemCode/mrp", async (req: Request<{ itemCode: string }>, res) => {
  const { itemCode } = req.params;
  const body = req.body as { mrp?: unknown; effectiveDate?: unknown; notes?: unknown };

  const mrp = Number(body.mrp);
  if (isNaN(mrp) || mrp <= 0) {
    res.status(400).json({ error: "mrp must be a positive number" });
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const effectiveDate =
    typeof body.effectiveDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.effectiveDate.trim())
      ? body.effectiveDate.trim()
      : today;
  const notes =
    typeof body.notes === "string" && body.notes.trim()
      ? body.notes.trim()
      : "Manual edit";

  const product = await db
    .select({ itemCode: catalogProductsTable.itemCode })
    .from(catalogProductsTable)
    .where(eq(catalogProductsTable.itemCode, itemCode))
    .limit(1);
  if (!product[0]) {
    res.status(404).json({ error: "Product not found" });
    return;
  }

  // Upsert: if the same (itemCode, effectiveDate) already exists, overwrite the
  // price. This keeps the history clean when the user corrects a typo.
  await db
    .insert(mrpPriceHistoryTable)
    .values({
      itemCode,
      mrp,
      netPrice: null,
      discountPct: null,
      priceBasis: "MRP",
      effectiveDate,
      loadDate: today,
      sourceFile: "manual-edit",
      isCurrent: false,
      notes,
    })
    .onConflictDoUpdate({
      target: [mrpPriceHistoryTable.itemCode, mrpPriceHistoryTable.effectiveDate],
      set: { mrp, priceBasis: "MRP", loadDate: today, notes },
    });

  await recomputeCurrentFlags();

  // Read back the row that recomputeCurrentFlags() just promoted to isCurrent=true.
  // Effective-date ordering may have elected a different row than the one we just
  // inserted, so we must use the actual current MRP rather than the request body's
  // value when snapshotting competitor gaps.
  const [currentRow] = await db
    .select()
    .from(mrpPriceHistoryTable)
    .where(
      and(
        eq(mrpPriceHistoryTable.itemCode, itemCode),
        eq(mrpPriceHistoryTable.isCurrent, true),
      ),
    )
    .limit(1);

  const actualCurrentMrp = currentRow?.mrp ?? mrp;

  // Refresh the snapshot MRP stored on every matched competitor row so the
  // Competition Analysis dashboard reflects the new price immediately.
  const refreshed = await db
    .update(competitorPricesTable)
    .set({
      prayagMrpAtCompare: actualCurrentMrp,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(competitorPricesTable.matchedPrayagCode, itemCode),
        eq(competitorPricesTable.matchStatus, "matched"),
      ),
    )
    .returning({ id: competitorPricesTable.id });

  res.json({
    ok: true,
    itemCode,
    mrp: actualCurrentMrp,
    effectiveDate: currentRow?.effectiveDate ?? effectiveDate,
    current: currentRow ?? null,
    competitorRowsRefreshed: refreshed.length,
  });
});

// POST /catalog/reset — restore catalog to the original clean import.
router.post("/catalog/reset", async (req, res) => {
  try {
    await loadCatalogSeed();
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "catalog reset failed");
    res.status(500).json({ error: "Reset failed" });
  }
});

export default router;
