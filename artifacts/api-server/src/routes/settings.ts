import { Router, type IRouter } from "express";
import { db, settingsTable } from "@workspace/db";
import {
  GetSettingsResponse,
  UpdateSettingsBody,
  UpdateSettingsResponse,
  ResetDataResponse,
} from "@workspace/api-zod";
import { loadSeed } from "../lib/seed";

const router: IRouter = Router();

router.get("/settings", async (_req, res) => {
  const rows = await db.select().from(settingsTable);
  const minimumMarginPct = rows[0]?.minimumMarginPct ?? 15;
  res.json(GetSettingsResponse.parse({ minimumMarginPct }));
});

router.put("/settings", async (req, res) => {
  const body = UpdateSettingsBody.parse(req.body);
  const rows = await db.select().from(settingsTable);
  if (rows.length === 0) {
    await db.insert(settingsTable).values({ minimumMarginPct: body.minimumMarginPct });
  } else {
    await db
      .update(settingsTable)
      .set({ minimumMarginPct: body.minimumMarginPct });
  }
  res.json(UpdateSettingsResponse.parse({ minimumMarginPct: body.minimumMarginPct }));
});

router.post("/reset", async (_req, res) => {
  await loadSeed();
  res.json(ResetDataResponse.parse({ ok: true }));
});

export default router;
