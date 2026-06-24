import { Router, type IRouter } from "express";
import { GetDashboardResponse } from "@workspace/api-zod";
import {
  loadEngineData,
  computeAllRows,
  competitorSummaries,
} from "../lib/engine";

const router: IRouter = Router();

router.get("/dashboard", async (_req, res) => {
  const data = await loadEngineData();
  const { rows } = computeAllRows(data);

  const compared = rows.filter((r) => r.status !== "no_data");
  const leaderCount = compared.filter((r) => r.status === "leader").length;
  const competitiveCount = compared.filter(
    (r) => r.status === "competitive",
  ).length;
  const aboveMarketCount = compared.filter(
    (r) => r.status === "above_market",
  ).length;
  const overpricedCount = compared.filter(
    (r) => r.status === "overpriced",
  ).length;
  const competitiveShare =
    compared.length > 0
      ? (leaderCount + competitiveCount) / compared.length
      : 0;

  const summaries = competitorSummaries(data).filter((s) => !s.hidden);
  const competitorWinRates = summaries
    .map((s) => ({
      competitor: s.name,
      basis: s.basis,
      productsCompared: s.productsCompared,
      prayagCheaper: s.prayagCheaper,
      prayagCheaperPct: s.prayagCheaperPct,
      avgSavingPct: s.avgSavingPct,
    }))
    .sort((a, b) => b.productsCompared - a.productsCompared);

  const catMap = new Map<
    string,
    {
      total: number;
      leader: number;
      competitive: number;
      aboveMarket: number;
      overpriced: number;
      comparedTotal: number;
    }
  >();
  for (const r of rows) {
    const e =
      catMap.get(r.category) ??
      {
        total: 0,
        leader: 0,
        competitive: 0,
        aboveMarket: 0,
        overpriced: 0,
        comparedTotal: 0,
      };
    e.total += 1;
    if (r.status !== "no_data") e.comparedTotal += 1;
    if (r.status === "leader") e.leader += 1;
    else if (r.status === "competitive") e.competitive += 1;
    else if (r.status === "above_market") e.aboveMarket += 1;
    else if (r.status === "overpriced") e.overpriced += 1;
    catMap.set(r.category, e);
  }
  const categoryBreakdown = Array.from(catMap.entries())
    .map(([category, e]) => ({
      category,
      total: e.total,
      leader: e.leader,
      competitive: e.competitive,
      aboveMarket: e.aboveMarket,
      overpriced: e.overpriced,
      competitivePct:
        e.comparedTotal > 0
          ? (e.leader + e.competitive) / e.comparedTotal
          : null,
    }))
    .sort((a, b) => b.total - a.total);

  res.json(
    GetDashboardResponse.parse({
      totalProducts: rows.length,
      comparedProducts: compared.length,
      competitiveShare,
      leaderCount,
      competitiveCount,
      aboveMarketCount,
      overpricedCount,
      competitorWinRates,
      categoryBreakdown,
    }),
  );
});

export default router;
