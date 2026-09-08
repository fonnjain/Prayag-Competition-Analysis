import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import supertest from "supertest";
import { and, eq, sql } from "drizzle-orm";
import {
  catalogProductsTable,
  competitorPricesTable,
  db,
  importBatchesTable,
  mrpPriceHistoryTable,
} from "@workspace/db";
import router from "./catalogImportExport.js";

const MASTER_PATH = fileURLToPath(
  new URL(
    "../../../../attached_assets/Ashirvad_Competitor_Mapping_1788855202719.xlsx",
    import.meta.url,
  ),
);
const ASHIRVAD = "Ashirvad";
const EFFECTIVE_DATE = "2025-03-01";
const SHA256 = "5dfa4fdcc76595e4e3c090734808a506d85eb3902137428263274272e2b0e499";

// This test invokes the real trusted-master route and therefore must only run
// against an explicitly designated disposable integration database.
const describeTrustedLoader =
  process.env.RUN_TRUSTED_ASHIRVAD_LOADER_INTEGRATION === "true"
    ? describe
    : describe.skip;

async function tableSnapshot(table: "catalog_products" | "mrp_price_history") {
  const result = await db.execute<{ count: number | string; digest: string }>(sql.raw(
    `SELECT count(*)::int AS count, md5(coalesce(string_agg(row_to_json(t)::text, '' ORDER BY t.id), '')) AS digest FROM ${table} t`,
  ));
  return {
    count: Number(result.rows[0]?.count ?? 0),
    digest: result.rows[0]?.digest ?? "",
  };
}

const app = express();
app.use(express.json());
app.use(router);
const request = supertest(app);

let catalogBefore = { count: 0, digest: "" };
let mrpBefore = { count: 0, digest: "" };
let sparshCount = 0;

describeTrustedLoader("trusted Ashirvad loader", () => {
  beforeAll(async () => {
    [catalogBefore, mrpBefore] = await Promise.all([
      tableSnapshot("catalog_products"),
      tableSnapshot("mrp_price_history"),
    ]);
    const sparsh = await db
      .select({ id: competitorPricesTable.id })
      .from(competitorPricesTable)
      .where(eq(competitorPricesTable.competitor, "Sparsh Pearl"));
    sparshCount = sparsh.length;
  });

  afterAll(async () => {
    // The route only owns Ashirvad's trusted period. Cleanup is deliberately
    // equally narrow so a test cannot remove Sparsh or another Ashirvad period.
    await db.delete(competitorPricesTable).where(and(
      eq(competitorPricesTable.competitor, ASHIRVAD),
      eq(competitorPricesTable.effectiveDate, EFFECTIVE_DATE),
    ));
    await db.delete(importBatchesTable).where(and(
      eq(importBatchesTable.competitor, ASHIRVAD),
      eq(importBatchesTable.fileSha256, SHA256),
    ));
  });

  it("writes only the 669 mapped competitor rows and is idempotent", async () => {
    const upload = () =>
      request
        .post("/catalog/load-competitor")
        .field("competitor", ASHIRVAD)
        .field("effectiveDate", EFFECTIVE_DATE)
        .attach("file", readFileSync(MASTER_PATH), {
          filename: "Ashirvad_Competitor_Mapping.xlsx",
          contentType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });

    const first = await upload();
    expect(first.status).toBe(200);
    expect(first.body.results).toMatchObject({
      competitor: ASHIRVAD,
      inserted: 669,
      matched: 669,
      effectiveDate: EFFECTIVE_DATE,
      fileSha256: SHA256,
    });

    const [firstAshirvad, catalogAfter, mrpAfter, sparshAfter] = await Promise.all([
      db.select({ id: competitorPricesTable.id }).from(competitorPricesTable).where(and(
        eq(competitorPricesTable.competitor, ASHIRVAD),
        eq(competitorPricesTable.effectiveDate, EFFECTIVE_DATE),
      )),
      tableSnapshot("catalog_products"),
      tableSnapshot("mrp_price_history"),
      db.select({ id: competitorPricesTable.id }).from(competitorPricesTable)
        .where(eq(competitorPricesTable.competitor, "Sparsh Pearl")),
    ]);
    expect(firstAshirvad).toHaveLength(669);
    expect(catalogAfter).toEqual(catalogBefore);
    expect(mrpAfter).toEqual(mrpBefore);
    expect(sparshAfter).toHaveLength(sparshCount);

    const second = await upload();
    expect(second.status).toBe(200);
    const afterSecond = await db
      .select({ id: competitorPricesTable.id })
      .from(competitorPricesTable)
      .where(and(
        eq(competitorPricesTable.competitor, ASHIRVAD),
        eq(competitorPricesTable.effectiveDate, EFFECTIVE_DATE),
      ));
    expect(afterSecond).toHaveLength(669);
  });
});