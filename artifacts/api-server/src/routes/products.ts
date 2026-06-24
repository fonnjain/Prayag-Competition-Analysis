import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, productsTable, comparisonsTable } from "@workspace/db";
import {
  GetProductsQueryParams,
  GetProductsResponse,
  GetCategoriesResponse,
  UpdateProductParams,
  UpdateProductBody,
  UpdateProductResponse,
  UpdateComparisonParams,
  UpdateComparisonBody,
  UpdateComparisonResponse,
} from "@workspace/api-zod";
import {
  loadEngineData,
  computeAllRows,
  computeRow,
  competitorSummaries,
  visibleCompetitorOrder,
  type ProductRow,
} from "../lib/engine";

const router: IRouter = Router();

function matchesStatus(row: ProductRow, status?: string): boolean {
  if (!status || status === "all") return true;
  return row.status === status;
}

router.get("/categories", async (_req, res) => {
  const data = await loadEngineData();
  const cats = Array.from(new Set(data.products.map((p) => p.category))).sort();
  res.json(GetCategoriesResponse.parse(cats));
});

router.get("/products", async (req, res) => {
  const q = GetProductsQueryParams.parse(req.query);
  const data = await loadEngineData();
  const { rows, visibleCompetitors } = computeAllRows(data);

  const summariesByName = new Map(
    competitorSummaries(data).map((s) => [s.name, s]),
  );
  const competitors = visibleCompetitors.map((name) => summariesByName.get(name)!);

  let filtered = rows;
  if (q.category && q.category !== "all")
    filtered = filtered.filter((r) => r.category === q.category);
  if (q.search) {
    const s = q.search.toLowerCase();
    filtered = filtered.filter(
      (r) =>
        r.itemCode.toLowerCase().includes(s) ||
        (r.size ?? "").toLowerCase().includes(s) ||
        r.category.toLowerCase().includes(s),
    );
  }
  if (q.status) filtered = filtered.filter((r) => matchesStatus(r, q.status));
  // z.coerce.boolean() turns any non-empty string (incl. "false") into true,
  // so read the raw query value explicitly.
  const onlyRivalCheaper = req.query["onlyRivalCheaper"] === "true";
  if (onlyRivalCheaper)
    filtered = filtered.filter(
      (r) =>
        r.shownPrice != null &&
        r.marketMin != null &&
        r.marketMin < r.shownPrice,
    );

  res.json(
    GetProductsResponse.parse({
      competitors,
      rows: filtered,
      total: filtered.length,
    }),
  );
});

async function recomputeSingle(itemCode: string): Promise<ProductRow | null> {
  const data = await loadEngineData();
  const product = data.products.find((p) => p.itemCode === itemCode);
  if (!product) return null;
  const visibleCompetitors = visibleCompetitorOrder(data);
  return computeRow(
    product,
    data.comparisons,
    visibleCompetitors,
    data.minimumMarginPct,
  );
}

router.patch("/products/:itemCode", async (req, res) => {
  const { itemCode } = UpdateProductParams.parse(req.params);
  const body = UpdateProductBody.parse(req.body);

  const updates: Record<string, unknown> = { edited: true };
  if (body.prayagMrp !== undefined) updates.prayagMrp = body.prayagMrp;
  if (body.prayagNet !== undefined) updates.prayagNet = body.prayagNet;
  if (body.kgCost !== undefined) updates.kgCost = body.kgCost;

  const updated = await db
    .update(productsTable)
    .set(updates)
    .where(eq(productsTable.itemCode, itemCode))
    .returning();
  if (updated.length === 0) {
    res.status(404).json({ error: "Product not found" });
    return;
  }

  const row = await recomputeSingle(itemCode);
  res.json(UpdateProductResponse.parse(row));
});

router.patch("/comparisons/:id", async (req, res) => {
  const { id } = UpdateComparisonParams.parse(req.params);
  const body = UpdateComparisonBody.parse(req.body);

  const updated = await db
    .update(comparisonsTable)
    .set({ compPrice: body.compPrice, edited: true })
    .where(eq(comparisonsTable.id, id))
    .returning();
  if (updated.length === 0) {
    res.status(404).json({ error: "Comparison not found" });
    return;
  }

  const row = await recomputeSingle(updated[0]!.itemCode);
  res.json(UpdateComparisonResponse.parse(row));
});

export default router;
