import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import supertest from "supertest";
import * as XLSX from "xlsx";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  catalogProductsTable,
  competitorPricesTable,
  db,
  importBatchesTable,
  mrpPriceHistoryTable,
} from "@workspace/db";
import router from "./catalogImportExport.js";
import priceFinderRouter from "./priceFinder.js";
import { parsePrinceCompetitorMaster } from "../lib/princeMaster.js";

const MASTER_PATH = fileURLToPath(new URL(
  "../../../../attached_assets/Competitor_Master_-_Plumbing_(1)_1789458928829.xlsx",
  import.meta.url,
));
const PRINCE = "Prince";
const EFFECTIVE_DATE = "2026-03-01";
const SHA256 = "5338bb3bc49e07f7aa39f8f913559cac015c57ef265ba64ce23c4a02ba381b0c";
const describeLoader = process.env.RUN_TRUSTED_PRINCE_LOADER_INTEGRATION === "true"
  ? describe
  : describe.skip;

async function protectedSnapshot(table: "catalog_products" | "mrp_price_history") {
  const result = await db.execute<{ count: number | string; digest: string }>(sql.raw(
    `SELECT count(*)::int AS count, md5(coalesce(string_agg(row_to_json(t)::text, '' ORDER BY t.id), '')) AS digest FROM ${table} t`,
  ));
  return { count: Number(result.rows[0]?.count ?? 0), digest: result.rows[0]?.digest ?? "" };
}

const app = express();
app.use(express.json());
app.use(router);
app.use(priceFinderRouter);
const request = supertest(app);
let catalogBefore: Awaited<ReturnType<typeof protectedSnapshot>>;
let mrpBefore: Awaited<ReturnType<typeof protectedSnapshot>>;
let sparshBefore = 0;
let ashirvadBefore = 0;
let princeBefore: { count: number; digest: string };
let existingBatchBefore: (typeof importBatchesTable)["$inferSelect"] | undefined;
let fixtureBatchId: number | undefined;
let fixturePriceIds: number[] = [];

async function princeSnapshot() {
  const result = await db.execute<{ count: number | string; digest: string }>(sql`
    SELECT count(*)::int AS count,
      md5(coalesce(string_agg(row_to_json(t)::text, '' ORDER BY t.id), '')) AS digest
    FROM competitor_prices t
    WHERE t.competitor = ${PRINCE} AND t.effective_date = ${EFFECTIVE_DATE}
  `);
  return { count: Number(result.rows[0]?.count ?? 0), digest: result.rows[0]?.digest ?? "" };
}

describeLoader("trusted Prince workbook loader", () => {
  beforeAll(async () => {
    [catalogBefore, mrpBefore] = await Promise.all([
      protectedSnapshot("catalog_products"),
      protectedSnapshot("mrp_price_history"),
    ]);
    [sparshBefore, ashirvadBefore] = await Promise.all([
      db.select({ id: competitorPricesTable.id }).from(competitorPricesTable)
        .where(eq(competitorPricesTable.competitor, "Sparsh Pearl")).then((rows) => rows.length),
      db.select({ id: competitorPricesTable.id }).from(competitorPricesTable)
        .where(eq(competitorPricesTable.competitor, "Ashirvad")).then((rows) => rows.length),
    ]);
    [princeBefore, existingBatchBefore] = await Promise.all([
      princeSnapshot(),
      db.select().from(importBatchesTable).where(and(
        eq(importBatchesTable.competitor, PRINCE),
        eq(importBatchesTable.effectiveDate, EFFECTIVE_DATE),
        eq(importBatchesTable.fileSha256, SHA256),
      )).orderBy(sql`id DESC`).then((rows) => rows[0]),
    ]);
    if (!existingBatchBefore && princeBefore.count === 0) {
      const buffer = readFileSync(MASTER_PATH);
      const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
      const preliminary = parsePrinceCompetitorMaster(buffer, workbook, new Map());
      const unmatched = new Set([
        "C133", "PMR-8", "PMR-9", "U-11CS", "U-13CS",
        "U-14CS", "U-15CS", "U-16CS", "U-13BS", "U-14BS",
      ]);
      const canonical = new Map(preliminary.rows.map((row) => [
        row.prayagCode.replace(/\s+/g, "").toUpperCase(),
        row.prayagCode,
      ] as [string, string]).filter(([, code]) => !unmatched.has(code)));
      const master = parsePrinceCompetitorMaster(buffer, workbook, canonical);
      const values = master.catalogMatchedRows.map((row) => ({
        competitor: PRINCE,
        category: row.category,
        description: null,
        size: row.lengthMeters ? `${row.lengthMeters} m` : null,
        price: row.price,
        unit: "MRP",
        competitorCode: row.princeCode,
        effectiveDate: EFFECTIVE_DATE,
        matchedPrayagCode: row.canonicalPrayagCode!,
        matchStatus: "matched",
        matchConfidence: "High",
        prayagMrpAtCompare: null,
        isCurrent: false,
        priceBasis: "MRP",
        gstPct: null,
      }));
      await db.transaction(async (tx) => {
        const [batch] = await tx.insert(importBatchesTable).values({
          competitor: PRINCE,
          effectiveDate: EFFECTIVE_DATE,
          sourceFileName: "trusted-prince-integration-fixture.xlsx",
          priceBasis: "MRP",
          gstPct: null,
          status: "approved",
          rowCounts: JSON.stringify({
            total: 813,
            matched: values.length,
            fixture: true,
            source_mappings: Array.from({ length: 813 }, (_, index) => ({ sourceRow: index + 1 })),
          }),
          extractionModel: null,
          fileSha256: SHA256,
          fileSizeBytes: buffer.length,
          extractorVersion: null,
          catalogueProfileRevision: null,
          promptRevision: null,
          model: null,
          pagesRequested: null,
          passesRun: null,
          itemsAdjudicated: null,
        }).returning({ id: importBatchesTable.id });
        fixtureBatchId = batch?.id;
        if (values.length) {
          const inserted = await tx.insert(competitorPricesTable).values(values).returning({ id: competitorPricesTable.id });
          fixturePriceIds = inserted.map((row) => row.id);
        }
      });
    }
  });

  afterAll(async () => {
    if (fixturePriceIds.length) {
      await db.delete(competitorPricesTable).where(inArray(competitorPricesTable.id, fixturePriceIds));
    }
    if (fixtureBatchId != null) {
      await db.delete(importBatchesTable).where(eq(importBatchesTable.id, fixtureBatchId));
    }
    // Existing trusted rows/batches are read-only; only fixture IDs are removed.
    await expect(princeSnapshot()).resolves.toEqual(princeBefore);
    await expect(db.select().from(importBatchesTable).where(and(
      eq(importBatchesTable.competitor, PRINCE),
      eq(importBatchesTable.effectiveDate, EFFECTIVE_DATE),
      eq(importBatchesTable.fileSha256, SHA256),
    )).orderBy(sql`id DESC`).then((rows) => rows[0])).resolves.toEqual(existingBatchBefore);
  });

  it("loads 813 workbook rows as 803 mapped prices, reports the ten unmatched codes, and is idempotent", async () => {
    const upload = () => request
      .post("/catalog/load-competitor")
      .field("competitor", PRINCE)
      .field("effectiveDate", EFFECTIVE_DATE)
      .attach("file", readFileSync(MASTER_PATH), {
        filename: "Competitor_Master_-_Plumbing.xlsx",
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });

    const preview = await request
      .post("/catalog/preview-competitor")
      .attach("file", readFileSync(MASTER_PATH), {
        filename: "Competitor_Master_-_Plumbing.xlsx",
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({
      isPrinceMaster: true,
      prince: { rows: 813, catalogMatched: 803, unmatched: 10 },
    });
    const first = await upload();
    expect(first.status).toBe(200);
    expect(first.body.results).toMatchObject({
      competitor: PRINCE,
      totalRows: 813,
      inserted: 803,
      matched: 803,
      unmatched: 10,
      effectiveDate: EFFECTIVE_DATE,
      fileSha256: SHA256,
    });
    expect(first.body.results.sourceMappings).toHaveLength(813);
    expect(first.body.results.unmatchedCodes).toHaveLength(10);
    expect(first.body.results.unmatchedCodes).toEqual(expect.arrayContaining([
      "C133", "PMR-8", "PMR-9", "U-11CS", "U-13CS",
      "U-14CS", "U-15CS", "U-16CS", "U-13BS", "U-14BS",
    ]));
    await expect(db.select({ id: competitorPricesTable.id }).from(competitorPricesTable).where(and(
      eq(competitorPricesTable.competitor, PRINCE),
      eq(competitorPricesTable.effectiveDate, EFFECTIVE_DATE),
    ))).resolves.toHaveLength(803);
    await expect(protectedSnapshot("catalog_products")).resolves.toEqual(catalogBefore);
    await expect(protectedSnapshot("mrp_price_history")).resolves.toEqual(mrpBefore);
    await expect(db.select({ id: competitorPricesTable.id }).from(competitorPricesTable)
      .where(eq(competitorPricesTable.competitor, "Sparsh Pearl"))).resolves.toHaveLength(sparshBefore);
    await expect(db.select({ id: competitorPricesTable.id }).from(competitorPricesTable)
      .where(eq(competitorPricesTable.competitor, "Ashirvad"))).resolves.toHaveLength(ashirvadBefore);

    const second = await upload();
    expect(second.status).toBe(200);
    expect(second.body.results.idempotent).toBe(true);
    expect(await db.select({ id: competitorPricesTable.id }).from(competitorPricesTable).where(and(
      eq(competitorPricesTable.competitor, PRINCE),
      eq(competitorPricesTable.effectiveDate, EFFECTIVE_DATE),
    ))).toHaveLength(803);
  });

  it("exposes the three selected competitors without turning missing data into zero", async () => {
    const [sample] = await db.select({ code: competitorPricesTable.matchedPrayagCode })
      .from(competitorPricesTable)
      .where(and(
        eq(competitorPricesTable.competitor, PRINCE),
        eq(competitorPricesTable.effectiveDate, EFFECTIVE_DATE),
      ))
      .limit(1);
    expect(sample?.code).toBeTruthy();
    const response = await request.get("/price-finder/comparison").query({
      code: sample!.code,
      competitor: ["Sparsh Pearl", "Ashirvad", PRINCE],
    });
    expect(response.status).toBe(200);
    expect(response.body.competitors).toEqual(["Sparsh Pearl", "Ashirvad", PRINCE]);
    expect(response.body.rows[0].competitors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ competitor: PRINCE }),
      ]),
    );
    for (const row of response.body.rows[0].competitors) {
      if (row.price == null) expect(row.difference).toBeNull();
    }
  });
});