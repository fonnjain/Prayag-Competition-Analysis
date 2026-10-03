import { assertExactCategoryRestoration, readCategoryCatalogue, lockCategorySpellings } from "../lib/categorySpellingGuard";
import { Router, type Request } from "express";
import { and, eq, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import {
  db,
  catalogProductsTable,
  competitorPricesTable,
  mrpLoadBatchesTable,
  mrpSourcesTable,
  mrpPriceHistoryTable,
  productLifecycleBatchesTable,
  mrpGeneratorResultsTable,
} from "@workspace/db";
import { requireAdmin } from "../middlewares/authMiddleware";
import { checkEverSoldForCodes, type SoldEvidence } from "../lib/hasEverBeenSold";

const router = Router();
const UNDO_WINDOW_MS = 24 * 60 * 60 * 1000;

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function inspect(itemCode: string, sales: SoldEvidence) {
  const [product] = await db.select().from(catalogProductsTable)
    .where(eq(catalogProductsTable.itemCode, itemCode)).limit(1);
  if (!product) throw Object.assign(new Error("Product not found."), { status: 404 });
  const prices = await db.select().from(mrpPriceHistoryTable).where(eq(mrpPriceHistoryTable.itemCode, itemCode));
  const mapping = await db.select({ id: competitorPricesTable.id })
    .from(competitorPricesTable).where(eq(competitorPricesTable.matchedPrayagCode, itemCode)).limit(1);
  const scenario = await db.select({ id: mrpGeneratorResultsTable.id })
    .from(mrpGeneratorResultsTable).where(eq(mrpGeneratorResultsTable.itemCode, itemCode)).limit(1);
  const loaded = await db.execute<{ count: number }>(sql`
    SELECT count(*)::int AS count
    FROM mrp_price_history h JOIN mrp_load_batches b ON b.id = h.load_batch_id
    WHERE h.item_code = ${itemCode} AND b.file_sha256 IS NOT NULL
  `);
  const checks = {
    sales: sales.status === "never_sold",
    // Price rows are not a safety failure: they are shown in the confirmation
    // and removed only as this product's exact snapshot.
    priceHistory: true,
    competitorMapping: mapping.length === 0,
    scenarios: scenario.length === 0,
    fileLoad: Number(loaded.rows[0]?.count ?? 0) === 0,
  };
  const blockingReasons = [
    ...(sales.status !== "never_sold" ? [sales.reason] : []),
    ...(mapping.length ? ["Competitor SKU mapping exists."] : []),
    ...(scenario.length ? ["Saved scenario or analysis references this product."] : []),
    ...(Number(loaded.rows[0]?.count ?? 0) ? ["Product has file-loaded MRP provenance."] : []),
  ];
  return {
    itemCode, product, sales, prices, checks, blockingReasons,
    deletable: Object.values(checks).every(Boolean),
    priceRowCount: prices.length,
  };
}

router.get("/admin/product-lifecycle/preview", requireAdmin, async (req, res): Promise<any> => {
  const codes = Array.isArray(req.query.itemCode) ? req.query.itemCode : [req.query.itemCode];
  const itemCodes = codes.filter((v): v is string => typeof v === "string" && !!v.trim()).map((v) => v.trim());
  if (!itemCodes.length || itemCodes.length > 100) return res.status(400).json({ error: "Provide 1–100 itemCode values." });
  try {
    const sales = await checkEverSoldForCodes(itemCodes);
    const results = await Promise.all(itemCodes.map((itemCode) => inspect(itemCode, sales.get(itemCode.trim().toUpperCase())!)));
    const before = await db.select({ count: sql<number>`count(*)::int` }).from(mrpPriceHistoryTable);
    res.json({ action: "delete", beforeCount: before[0]?.count ?? 0, results, fingerprint: fingerprint(results.map((r) => ({ itemCode: r.itemCode, checks: r.checks, priceRowCount: r.priceRowCount }))) });
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500;
    res.status(status).json({ error: error instanceof Error ? error.message : "Preview failed." });
  }
});

router.post("/admin/product-lifecycle/retire", requireAdmin, async (req, res): Promise<any> => {
  const itemCode = typeof req.body?.itemCode === "string" ? req.body.itemCode.trim() : "";
  const date = typeof req.body?.discontinuedFrom === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.body.discontinuedFrom) ? req.body.discontinuedFrom : "";
  if (!itemCode || !date) return res.status(400).json({ error: "itemCode and discontinuedFrom (YYYY-MM-DD) are required." });
  const [updated] = await db.update(catalogProductsTable).set({
    discontinuedFrom: date, discontinuedCheckedBy: req.user?.email ?? req.user?.id ?? "admin",
    discontinuedStatusNote: typeof req.body.reason === "string" && req.body.reason.trim() ? req.body.reason.trim() : null,
    updatedAt: new Date(),
  }).where(eq(catalogProductsTable.itemCode, itemCode)).returning({ itemCode: catalogProductsTable.itemCode });
  if (!updated) return res.status(404).json({ error: "Product not found." });
  res.json({ ok: true, action: "retire", itemCode, discontinuedFrom: date });
});

router.post("/admin/product-lifecycle/delete", requireAdmin, async (req, res): Promise<any> => {
  const itemCodes: string[] = (Array.isArray(req.body?.itemCodes) ? req.body.itemCodes : [req.body?.itemCode])
    .filter((v: unknown): v is string => typeof v === "string" && !!v.trim()).map((v: string) => v.trim());
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  const previewFingerprint = typeof req.body?.previewFingerprint === "string" ? req.body.previewFingerprint : "";
  if (!itemCodes.length || !reason || !previewFingerprint) return res.status(400).json({ error: "itemCode(s), a typed reason, and a current preview are required." });
  const sales = await checkEverSoldForCodes(itemCodes);
  const inspected = await Promise.all([...new Set(itemCodes)].map((itemCode) => inspect(itemCode, sales.get(itemCode.trim().toUpperCase())!)));
  const expectedFingerprint = fingerprint(inspected.map((r) => ({ itemCode: r.itemCode, checks: r.checks, priceRowCount: r.priceRowCount })));
  if (expectedFingerprint !== previewFingerprint) return res.status(409).json({ error: "Preview is stale; run the five checks again before applying." });
  const results: unknown[] = [];
  for (const itemCode of [...new Set(itemCodes)]) {
    try {
      const result = inspected.find((entry) => entry.itemCode === itemCode)!;
      if (!result.deletable) { results.push({ itemCode, deleted: false, checks: result.checks, blockingReasons: result.blockingReasons, priceRowCount: result.priceRowCount }); continue; }
      const before = Number((await db.select({ count: sql<number>`count(*)::int` }).from(mrpPriceHistoryTable))[0]?.count ?? 0);
      const snapshot = JSON.stringify({ product: result.product, prices: result.prices });
      const deleted = await db.transaction(async (tx) => {
        const source = await tx.execute<{ id: number }>(sql`
          INSERT INTO mrp_sources (division, sheet_id, sheet_url, source_kind)
          VALUES ('Product lifecycle', 'product-delete', 'internal://product-delete', 'product-delete')
          ON CONFLICT (sheet_id) DO UPDATE SET source_kind = 'product-delete'
          RETURNING id
        `);
        const [loadBatch] = await tx.insert(mrpLoadBatchesTable).values({
          sourceId: source.rows[0]!.id,
          fileName: `product-delete:${itemCode}`,
          loadedBy: req.user?.email ?? req.user?.id ?? "admin",
          rowCount: result.priceRowCount,
          notes: JSON.stringify({ source: "product-delete", itemCode, reason, snapshot }),
        }).returning({ id: mrpLoadBatchesTable.id });
        const [batch] = await tx.insert(productLifecycleBatchesTable).values({
          action: "delete", itemCode, actor: req.user?.email ?? req.user?.id ?? "admin", reason,
          snapshot, priceRowCount: result.priceRowCount, beforeCount: before, loadBatchId: loadBatch.id,
        }).returning({ id: productLifecycleBatchesTable.id });
        await tx.delete(mrpPriceHistoryTable).where(eq(mrpPriceHistoryTable.itemCode, itemCode));
        await tx.delete(catalogProductsTable).where(eq(catalogProductsTable.itemCode, itemCode));
        const after = Number((await tx.select({ count: sql<number>`count(*)::int` }).from(mrpPriceHistoryTable))[0]?.count ?? 0);
        await tx.update(productLifecycleBatchesTable).set({ afterCount: after }).where(eq(productLifecycleBatchesTable.id, batch.id));
        return { batchId: batch.id, after };
      });
      results.push({ itemCode, deleted: true, ...deleted, beforeCount: before, removedPriceRows: result.priceRowCount });
    } catch (error) {
      results.push({ itemCode, deleted: false, blockingReasons: [error instanceof Error ? error.message : "Delete failed."] });
    }
  }
  res.json({ ok: true, results });
});

router.post("/admin/product-lifecycle/undo/:batchId", requireAdmin, async (req: Request<{ batchId: string }>, res): Promise<any> => {
  const id = Number(req.params.batchId);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid batch id." });
  const [batch] = await db.select().from(productLifecycleBatchesTable).where(eq(productLifecycleBatchesTable.id, id)).limit(1);
  if (!batch || batch.action !== "delete" || batch.undoneAt || Date.now() - batch.createdAt.getTime() > UNDO_WINDOW_MS) return res.status(409).json({ error: "Undo unavailable outside the 24-hour window or batch already undone." });
  const snapshot = JSON.parse(batch.snapshot) as { product: typeof catalogProductsTable.$inferInsert; prices: typeof mrpPriceHistoryTable.$inferInsert[] };
  try { await db.transaction(async (tx) => {
    await lockCategorySpellings(tx);
    assertExactCategoryRestoration([{
      itemCode: snapshot.product.itemCode, division: snapshot.product.division ?? null, category: snapshot.product.category ?? null,
    }], await readCategoryCatalogue(tx));
    await tx.insert(catalogProductsTable).values(snapshot.product);
    if (snapshot.prices.length) await tx.insert(mrpPriceHistoryTable).values(snapshot.prices);
    await tx.update(productLifecycleBatchesTable).set({ undoneAt: new Date(), undoneBy: req.user?.email ?? req.user?.id ?? "admin" }).where(eq(productLifecycleBatchesTable.id, id));
  }); } catch (error) {
    return res.status(409).json({ error: error instanceof Error ? error.message : "Exact restoration stopped; no rows were written." });
  }
  res.json({ ok: true, restoredItemCode: batch.itemCode, batchId: id });
});

export default router;