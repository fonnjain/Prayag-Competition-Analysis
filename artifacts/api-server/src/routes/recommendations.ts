import { Router, type IRouter } from "express";
import { GetRecommendationsQueryParams, GetRecommendationsResponse } from "@workspace/api-zod";
import { loadEngineData, computeAllRows } from "../lib/engine";

const router: IRouter = Router();

router.get("/recommendations", async (req, res) => {
  const q = GetRecommendationsQueryParams.parse(req.query);
  const data = await loadEngineData();
  const { rows } = computeAllRows(data);

  let filtered = rows.filter((r) => r.status !== "no_data");
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
  if (q.status && q.status !== "all")
    filtered = filtered.filter((r) => r.status === q.status);

  const items = filtered
    .map((r) => ({
      itemCode: r.itemCode,
      category: r.category,
      size: r.size,
      basis: r.basis,
      currentPrice: r.shownPrice,
      marketMin: r.marketMin,
      marketMedian: r.marketMedian,
      marketMax: r.marketMax,
      status: r.status,
      suggestedPrice: r.suggestedPrice,
      aggressiveTarget: r.aggressiveTarget,
      gap: r.gap,
      gapPct: r.gapPct,
      marginConstrained: r.marginConstrained,
      rivalCount: r.rivalCount,
    }))
    .sort((a, b) => (a.gap ?? 0) - (b.gap ?? 0));

  res.json(GetRecommendationsResponse.parse(items));
});

export default router;
