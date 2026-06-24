import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, competitorsTable, comparisonsTable } from "@workspace/db";
import {
  GetCompetitorsResponse,
  UpdateCompetitorParams,
  UpdateCompetitorBody,
  UpdateCompetitorResponse,
  DeleteCompetitorParams,
  DeleteCompetitorResponse,
} from "@workspace/api-zod";
import { loadEngineData, competitorSummaries } from "../lib/engine";

const router: IRouter = Router();

router.get("/competitors", async (_req, res) => {
  const data = await loadEngineData();
  const summaries = competitorSummaries(data).sort(
    (a, b) => b.productsCompared - a.productsCompared,
  );
  res.json(GetCompetitorsResponse.parse(summaries));
});

router.patch("/competitors/:name", async (req, res) => {
  const { name } = UpdateCompetitorParams.parse(req.params);
  const body = UpdateCompetitorBody.parse(req.body);

  const updated = await db
    .update(competitorsTable)
    .set({ hidden: body.hidden })
    .where(eq(competitorsTable.name, name))
    .returning();
  if (updated.length === 0) {
    res.status(404).json({ error: "Competitor not found" });
    return;
  }

  const data = await loadEngineData();
  const summary = competitorSummaries(data).find((s) => s.name === name)!;
  res.json(UpdateCompetitorResponse.parse(summary));
});

router.delete("/competitors/:name", async (req, res) => {
  const { name } = DeleteCompetitorParams.parse(req.params);
  await db.delete(comparisonsTable).where(eq(comparisonsTable.competitor, name));
  await db.delete(competitorsTable).where(eq(competitorsTable.name, name));
  res.json(DeleteCompetitorResponse.parse({ ok: true }));
});

export default router;
