import { createHash } from "node:crypto";
import { Router } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { catalogProductsTable, db, mrpPriceHistoryTable, productLifecycleBatchesTable } from "@workspace/db";
import { requireAdmin } from "../middlewares/authMiddleware";
import { checkEverSoldForCodes } from "../lib/hasEverBeenSold";

const router = Router();
const UNDO_WINDOW_MS = 24 * 60 * 60 * 1000;
type Product = typeof catalogProductsTable.$inferSelect;

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function digest(product: Product, dates: string[], proposedDate: string): string {
  return createHash("sha256").update(JSON.stringify({
    id: product.id, code: product.itemCode, updatedAt: product.updatedAt.toISOString(),
    isActive: product.isActive, discontinuedFrom: product.discontinuedFrom,
    discontinuedCheckedBy: product.discontinuedCheckedBy,
    discontinuedStatusNote: product.discontinuedStatusNote, dates, proposedDate,
  })).digest("hex");
}

async function priceDates(executor: Pick<typeof db, "select">, itemCode: string): Promise<string[]> {
  const rows = await executor.select({
    id: mrpPriceHistoryTable.id, effectiveDate: mrpPriceHistoryTable.effectiveDate,
  }).from(mrpPriceHistoryTable).where(eq(mrpPriceHistoryTable.itemCode, itemCode))
    .orderBy(mrpPriceHistoryTable.id);
  return rows.map((row) => `${row.id}:${row.effectiveDate}`);
}

function parseCodes(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100 ||
    value.some((code) => typeof code !== "string" || !code.trim() || code.trim().length > 200)) return null;
  const codes = value.map((code: string) => code.trim());
  return new Set(codes).size === codes.length ? codes : null;
}

// Read-only Sales gate. The destructive productLifecycle router is deliberately
// not mounted. This lets admins see why a deletion cannot yet be justified.
router.get("/admin/product-retirement/sales-check", requireAdmin, async (req, res): Promise<void> => {
  const raw = req.query.itemCode;
  const codes = parseCodes(Array.isArray(raw) ? raw : [raw]);
  if (!codes) {
    res.status(400).json({ error: "Provide 1–100 unique itemCode values." });
    return;
  }
  try {
    const evidence = await checkEverSoldForCodes(codes);
    res.json({ action: "read-only-sales-check", results: codes.map((itemCode) => ({
      itemCode, ...evidence.get(itemCode.toUpperCase())!,
    })) });
  } catch {
    res.json({ action: "read-only-sales-check", results: codes.map((itemCode) => ({
      itemCode, status: "unknown", reason: "Delete blocked: Sales register could not be checked.",
      periods: [], catalogueStatus: null,
    })) });
  }
});

router.post("/admin/product-retirement/preview", requireAdmin, async (req, res): Promise<void> => {
  const itemCodes = parseCodes(req.body?.itemCodes);
  const date = req.body?.discontinuedFrom;
  if (!itemCodes || !validDate(date)) {
    res.status(400).json({ error: "Provide unique item codes (1–100) and a valid discontinuation date (YYYY-MM-DD)." });
    return;
  }
  const results = [];
  for (const itemCode of itemCodes) {
    const [product] = await db.select().from(catalogProductsTable).where(eq(catalogProductsTable.itemCode, itemCode)).limit(1);
    if (!product) {
      results.push({ itemCode, allowed: false, reason: "Product not found." });
      continue;
    }
    const dates = await priceDates(db, itemCode);
    results.push({
      itemCode, productName: product.productName, allowed: product.isActive && !product.discontinuedFrom,
      reason: !product.isActive || product.discontinuedFrom ? "Already inactive or discontinued; no change applied." : null,
      priorDiscontinuedFrom: product.discontinuedFrom, discontinuedFrom: date,
      priceRowCount: dates.length, priceDates: dates.map((entry) => entry.split(":")[1]),
      fingerprint: digest(product, dates, date),
    });
  }
  const [total] = await db.select({ count: sql<number>`count(*)::int` }).from(mrpPriceHistoryTable);
  res.json({ action: "retire", results, historyBefore: total?.count ?? 0, historyAfter: total?.count ?? 0, undoHours: 24 });
});

router.get("/admin/product-retirement/recent", requireAdmin, async (_req, res): Promise<void> => {
  const rows = await db.select({
    id: productLifecycleBatchesTable.id,
    itemCode: productLifecycleBatchesTable.itemCode,
    actor: productLifecycleBatchesTable.actor,
    reason: productLifecycleBatchesTable.reason,
    priceRowCount: productLifecycleBatchesTable.priceRowCount,
    createdAt: productLifecycleBatchesTable.createdAt,
    undoneAt: productLifecycleBatchesTable.undoneAt,
    snapshot: productLifecycleBatchesTable.snapshot,
  }).from(productLifecycleBatchesTable).where(eq(productLifecycleBatchesTable.action, "retire"))
    .orderBy(desc(productLifecycleBatchesTable.createdAt)).limit(100);
  res.json({ results: rows.map((row) => ({
    batchId: row.id, itemCode: row.itemCode, actor: row.actor, reason: row.reason,
    priceRowCount: row.priceRowCount, createdAt: row.createdAt.toISOString(),
    undoneAt: row.undoneAt?.toISOString() ?? null,
    undoExpiresAt: new Date(row.createdAt.getTime() + UNDO_WINDOW_MS).toISOString(),
    canUndo: !row.undoneAt && Date.now() - row.createdAt.getTime() <= UNDO_WINDOW_MS,
    discontinuedFrom: (JSON.parse(row.snapshot) as { applied: { discontinuedFrom: string } }).applied.discontinuedFrom,
  })) });
});

router.post("/admin/product-retirement/apply", requireAdmin, async (req, res): Promise<void> => {
  const entries = req.body?.items;
  const itemCodes = parseCodes(Array.isArray(entries) ? entries.map((entry: { itemCode?: unknown }) => entry?.itemCode) : null);
  const date = req.body?.discontinuedFrom;
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (!itemCodes || !validDate(date) || !reason || reason.length > 1000 ||
    entries.some((entry: { fingerprint?: unknown }) => typeof entry?.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(entry.fingerprint))) {
    res.status(400).json({ error: "A fresh preview, a valid date, and a typed reason are required." });
    return;
  }
  const results = [];
  for (const [index, itemCode] of itemCodes.entries()) {
    try {
      const applied = await db.transaction(async (tx) => {
        // Serialise edits to this product with other lifecycle edits; check the
        // preview again while holding its row lock, not outside the transaction.
        const locked = await tx.execute(sql`SELECT id FROM catalog_products WHERE item_code = ${itemCode} FOR UPDATE`);
        if (!locked.rows.length) throw new Error("Product not found.");
        // Other price writers do not share a per-item advisory lock. SHARE
        // conflicts with their ROW EXCLUSIVE table locks, so no row can appear,
        // disappear or change between the price snapshot and transaction commit.
        await tx.execute(sql`LOCK TABLE mrp_price_history IN SHARE MODE`);
        const [product] = await tx.select().from(catalogProductsTable).where(eq(catalogProductsTable.itemCode, itemCode)).limit(1);
        const dates = await priceDates(tx, itemCode);
        if (!product?.isActive || product.discontinuedFrom || digest(product, dates, date) !== entries[index].fingerprint) {
          throw new Error("Preview is stale or product is already discontinued. Preview again.");
        }
        const now = new Date();
        const actor = req.user?.email ?? req.user?.id ?? "admin";
        const [updated] = await tx.update(catalogProductsTable).set({
          discontinuedFrom: date, discontinuedCheckedBy: actor,
          discontinuedStatusNote: reason, updatedAt: now,
        }).where(eq(catalogProductsTable.id, product.id)).returning();
        const [batch] = await tx.insert(productLifecycleBatchesTable).values({
          action: "retire", itemCode, actor, reason,
          snapshot: JSON.stringify({
            previous: { discontinuedFrom: product.discontinuedFrom, discontinuedCheckedBy: product.discontinuedCheckedBy,
              discontinuedStatusNote: product.discontinuedStatusNote, updatedAt: product.updatedAt.toISOString() },
            applied: { discontinuedFrom: updated.discontinuedFrom, discontinuedCheckedBy: updated.discontinuedCheckedBy,
              discontinuedStatusNote: updated.discontinuedStatusNote, updatedAt: updated.updatedAt.toISOString() },
          }),
          priceRowCount: dates.length, beforeCount: dates.length, afterCount: dates.length,
        }).returning({ id: productLifecycleBatchesTable.id });
        return { itemCode, applied: true, batchId: batch.id, priceRowCount: dates.length, discontinuedFrom: date };
      });
      results.push(applied);
    } catch (error) {
      results.push({ itemCode, applied: false, reason: error instanceof Error ? error.message : "Retirement failed." });
    }
  }
  res.json({ action: "retire", results, undoHours: 24 });
});

router.post("/admin/product-retirement/undo/:batchId", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.batchId);
  if (!Number.isSafeInteger(id) || id < 1) {
    res.status(400).json({ error: "Invalid batch ID." });
    return;
  }
  try {
    const result = await db.transaction(async (tx) => {
      const lockedBatch = await tx.execute(sql`SELECT id FROM product_lifecycle_batches WHERE id = ${id} FOR UPDATE`);
      if (!lockedBatch.rows.length) throw new Error("Retirement batch not found.");
      const [batch] = await tx.select().from(productLifecycleBatchesTable).where(eq(productLifecycleBatchesTable.id, id)).limit(1);
      if (batch.action !== "retire" || batch.undoneAt ||
        Date.now() - batch.createdAt.getTime() > UNDO_WINDOW_MS) throw new Error("Undo is unavailable after 24 hours or already used.");
      const lockedProduct = await tx.execute(sql`SELECT id FROM catalog_products WHERE item_code = ${batch.itemCode} FOR UPDATE`);
      if (!lockedProduct.rows.length) throw new Error("Product no longer exists.");
      const [product] = await tx.select().from(catalogProductsTable).where(eq(catalogProductsTable.itemCode, batch.itemCode)).limit(1);
      const snapshot = JSON.parse(batch.snapshot) as {
        previous: { discontinuedFrom: string | null; discontinuedCheckedBy: string | null; discontinuedStatusNote: string | null; updatedAt: string };
        applied: { discontinuedFrom: string; discontinuedCheckedBy: string; discontinuedStatusNote: string; updatedAt: string };
      };
      if (product.updatedAt.toISOString() !== snapshot.applied.updatedAt ||
        product.discontinuedFrom !== snapshot.applied.discontinuedFrom ||
        product.discontinuedCheckedBy !== snapshot.applied.discontinuedCheckedBy ||
        product.discontinuedStatusNote !== snapshot.applied.discontinuedStatusNote) {
        throw new Error("Product changed since retirement; undo refused.");
      }
      await tx.update(catalogProductsTable).set({
        discontinuedFrom: snapshot.previous.discontinuedFrom,
        discontinuedCheckedBy: snapshot.previous.discontinuedCheckedBy,
        discontinuedStatusNote: snapshot.previous.discontinuedStatusNote,
        // Advance the version on undo; restoring the old timestamp would make
        // a previously issued preview usable again (an ABA state change).
        updatedAt: new Date(),
      }).where(eq(catalogProductsTable.id, product.id));
      await tx.update(productLifecycleBatchesTable).set({
        undoneAt: new Date(), undoneBy: req.user?.email ?? req.user?.id ?? "admin",
      }).where(and(eq(productLifecycleBatchesTable.id, id), eq(productLifecycleBatchesTable.action, "retire")));
      return { itemCode: batch.itemCode, batchId: id, priceRowCount: batch.priceRowCount };
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : "Undo failed." });
  }
});

export default router;