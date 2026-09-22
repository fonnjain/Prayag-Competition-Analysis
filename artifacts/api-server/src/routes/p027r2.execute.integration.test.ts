/**
 * Destructive-by-design operational rehearsal for P027r2.
 *
 * This is permanently skipped unless RUN_P027R2_EXECUTE=true.  It deliberately
 * does not clean up: the point is to prove the real preview/apply path against
 * the refreshed audited workbook and leave the resulting provenance available
 * for inspection.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import supertest from "supertest";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  db, competitorPricesTable, importBatchesTable, competitorPriceStagingTable,
} from "@workspace/db";
import catalogRouter from "./catalogImportExport.js";
import importBatchesRouter from "./importBatches.js";

process.env.NODE_ENV = "test";
const enabled = process.env.RUN_P027R2_EXECUTE === "true" ? describe : describe.skip;
const workbookPath = fileURLToPath(new URL(
  "../../../../attached_assets/Competitor_Master_-_Plumbing_Prince_1790080853652.xlsx",
  import.meta.url,
));
const app = express();
app.use(express.json());
app.use(catalogRouter);
app.use(importBatchesRouter);
const request = supertest(app);

async function snapshot(table: "catalog_products" | "mrp_price_history") {
  const result = await db.execute<{ count: number | string; digest: string }>(sql.raw(
    `SELECT count(*)::int AS count, md5(coalesce(string_agg(row_to_json(t)::text, '' ORDER BY t.id), '')) AS digest FROM ${table} t`,
  ));
  return { count: Number(result.rows[0]?.count ?? 0), digest: result.rows[0]?.digest ?? "" };
}

enabled("P027r2 execute rehearsal", () => {
  it("previews, safely rolls back, then applies and is idempotent", async () => {
    const buffer = readFileSync(workbookPath);
    const [catalogBefore, mrpBefore, competitorsBefore] = await Promise.all([
      snapshot("catalog_products"), snapshot("mrp_price_history"),
      db.select({ competitor: competitorPricesTable.competitor, id: competitorPricesTable.id })
        .from(competitorPricesTable).where(sql`${competitorPricesTable.competitor} <> 'Prince'`).orderBy(sql`id`),
    ]);
    const preview = await request.post("/catalog/preview-competitor")
      .attach("file", buffer, "Competitor_Master_-_Plumbing_Prince.xlsx");
    expect(preview.status).toBe(200);
    expect(preview.body.prince).toMatchObject({
      rows: 813, loadableRows: 811, contentFingerprint: "901d63a62e8eb4ea9de728e1cec2b3d4c1a1ef23d871a0b3246fa8e090658a17",
      priceSum: 1049375.55, exactMatches: 736, normalizedMatches: 74,
    });
    expect(preview.body.prince.unmatched).toBe(3);
    expect(preview.body.prince.unmatchedCodes).toEqual(["C133", "PMR-8", "PMR-9"]);
    expect(preview.body.prince.rejectedRows).toHaveLength(3);
    expect(preview.body.prince.worksheetDiagnostics.find((r: any) => r.sheet === "AGRI PIPE").princePriced).toBe(90);

    const stage = await request.post("/catalog/stage-competitor-workbook")
      .field("competitor", "Prince").attach("file", buffer, "Competitor_Master_-_Plumbing_Prince.xlsx");
    if (stage.status === 200 && stage.body.idempotent) {
      expect(stage.body.batchId).toBeTypeOf("number");
      const repeat = await request.post(`/catalog/import-batches/${stage.body.batchId}/approve`).send({});
      expect(repeat.status).toBe(200);
      expect(repeat.body.idempotent).toBe(true);
      const comparable = await db.execute<{ count: number | string }>(sql`
        WITH latest_mrp AS (
          SELECT DISTINCT ON (item_code) item_code, mrp
          FROM mrp_price_history
          WHERE variant = 'Standard' AND review_status = 'approved' AND effective_date <= CURRENT_DATE
          ORDER BY item_code, effective_date DESC, id DESC
        )
        SELECT count(*)::int AS count
        FROM competitor_prices cp
        JOIN latest_mrp m ON m.item_code = cp.matched_prayag_code
        WHERE cp.competitor = 'Prince' AND cp.effective_date = '2026-03-01' AND m.mrp IS NOT NULL
      `);
      expect(Number(comparable.rows[0]?.count ?? 0)).toBe(810);
      expect(await snapshot("catalog_products")).toEqual(catalogBefore);
      expect(await snapshot("mrp_price_history")).toEqual(mrpBefore);
      return;
    }
    expect(stage.status).toBe(201);
    const batchId = stage.body.batchId as number;
    const batch = await db.select().from(importBatchesTable).where(eq(importBatchesTable.id, batchId)).then((r) => r[0]!);
    const staged = await db.select().from(competitorPriceStagingTable).where(eq(competitorPriceStagingTable.batchId, batchId));
    expect(batch.status).toBe("pending");
    expect(staged.filter((r) => r.status === "ok")).toHaveLength(808);
    expect(staged.filter((r) => r.status === "needs_review")).toHaveLength(6);
    expect((await request.get(`/catalog/import-batches/${batchId}`)).status).toBe(200);

    const failed = await request.post(`/catalog/import-batches/${batchId}/approve`).send({ injectMrpMutation: true });
    expect(failed.status).toBe(500);
    expect((await db.select().from(importBatchesTable).where(eq(importBatchesTable.id, batchId)))[0]!.status).toBe("pending");
    expect(await snapshot("catalog_products")).toEqual(catalogBefore);
    expect(await snapshot("mrp_price_history")).toEqual(mrpBefore);

    const applied = await request.post(`/catalog/import-batches/${batchId}/approve`).send({});
    expect(applied.status).toBe(200);
    expect(applied.body).toMatchObject({ inserted: 7, updated: 0, unchanged: 801, comparableBefore: 803, comparableAfter: 810 });
    expect(await snapshot("catalog_products")).toEqual(catalogBefore);
    expect(await snapshot("mrp_price_history")).toEqual(mrpBefore);
    expect(await db.select({ competitor: competitorPriceStagingTable.competitor }).from(competitorPriceStagingTable)
      .where(and(eq(competitorPriceStagingTable.batchId, batchId), eq(competitorPriceStagingTable.competitor, "Prince")))).toHaveLength(814);
    const provenance = (await db.select({ id: competitorPricesTable.id, loadBatchId: competitorPricesTable.loadBatchId })
      .from(competitorPricesTable).where(and(eq(competitorPricesTable.competitor, "Prince"), eq(competitorPricesTable.effectiveDate, "2026-03-01"))));
    expect(provenance.filter((r) => r.loadBatchId != null).length).toBeGreaterThanOrEqual(10);
    expect(await db.select({ id: competitorPricesTable.id }).from(competitorPricesTable)
      .where(sql`${competitorPricesTable.competitor} <> 'Prince'`).orderBy(sql`id`)).toEqual(competitorsBefore);
    expect((await request.post(`/catalog/import-batches/${batchId}/approve`).send({})).body.idempotent).toBe(true);
  });
});