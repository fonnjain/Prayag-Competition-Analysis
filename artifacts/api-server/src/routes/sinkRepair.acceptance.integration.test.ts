import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import supertest from "supertest";
import {
  db,
  catalogProductsTable,
  mrpLoadBatchesTable,
  mrpPriceHistoryTable,
} from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";
import { getPrayagCatalogMapForPeriod } from "./analysis";
import catalogRouter from "./catalog";

const FUTURE_FIXTURES = Array.from(
  { length: 68 },
  (_, index) => `__SINK_ACCEPTANCE_FUTURE_${Date.now()}_${index}__`,
);

beforeAll(async () => {
  await db.insert(catalogProductsTable).values(
    FUTURE_FIXTURES.map((itemCode) => ({
      itemCode,
      productName: "September-only acceptance fixture",
      division: "PTMT & Plastic Fittings",
      category: "Scheduled period acceptance",
    })),
  );
  await db.insert(mrpPriceHistoryTable).values(
    FUTURE_FIXTURES.map((itemCode, index) => ({
      itemCode,
      mrp: 100 + index,
      priceBasis: "MRP",
      effectiveDate: "2026-09-01",
      loadDate: "2026-08-19",
      reviewStatus: "approved",
      isCurrent: false,
    })),
  );
});

afterAll(async () => {
  await db
    .delete(mrpPriceHistoryTable)
    .where(inArray(mrpPriceHistoryTable.itemCode, FUTURE_FIXTURES));
  await db
    .delete(catalogProductsTable)
    .where(inArray(catalogProductsTable.itemCode, FUTURE_FIXTURES));
});

describe("SINK September repair acceptance", () => {
  it("resolves corrected and historical SINK prices by date", async () => {
    const august = await getPrayagCatalogMapForPeriod("2026-08-31");
    const september = await getPrayagCatalogMapForPeriod("2026-09-01");

    expect(august.get("911-D")?.mrp).toBe(3240);
    expect(september.get("911-D")?.mrp).toBe(3490);
    expect(september.get("1230-D")?.mrp).toBe(8630);
    expect(august.get("616-D")?.mrp).toBe(2490);
    expect(september.has("616-D")).toBe(false);
  });

  it("has exactly the documented legitimate sub-₹50 PTMT rows", async () => {
    const result = await db.execute<{ count: number }>(sql`
      SELECT count(*)::int AS count
      FROM (
        SELECT DISTINCT ON (h.item_code) h.item_code, h.mrp
        FROM mrp_price_history h
        JOIN catalog_products p USING (item_code)
        WHERE h.effective_date <= '2026-09-01'
          AND h.review_status = 'approved'
          AND lower(coalesce(p.division, '')) LIKE '%ptmt%'
          AND (p.discontinued_from IS NULL OR p.discontinued_from > '2026-09-01')
        ORDER BY h.item_code, h.effective_date DESC, h.id DESC
      ) current_prices
      WHERE mrp < 50
    `);
    // The rebuilt 19 Aug PTMT source has 11 live sub-₹50 items. The previous
    // value of 12 was a pre-rebuild expectation, not an extra valid price.
    expect(result.rows[0]?.count).toBe(11);
  });

  it("removes all 18 source-invalid September rows and keeps the confirmed withdrawal set", async () => {
    const result = await db.execute<{
      phantom_count: number;
      scheduled_count: number;
       other_confirmed_count: number;
    }>(sql`
      SELECT
        (
          SELECT count(*)::int FROM mrp_price_history
          WHERE effective_date = '2026-09-01'
            AND item_code = ANY(ARRAY[
              '616-D','618-D','620-D','622-D','623-D','624-D','624-XD','624-SD','625-D',
              '616-DM','618-DM','620-DM','622-DM','623-DM','624-DM','624-XDM','624-SDM','625-DM'
            ])
        ) AS phantom_count,
        (
          SELECT count(*)::int FROM catalog_products
          WHERE item_code = ANY(ARRAY[
            '616-D','618-D','620-D','622-D','623-D','624-D','624-XD','624-SD','625-D',
            '616-DM','618-DM','620-DM','622-DM','623-DM','624-DM','624-XDM','624-SDM','625-DM'
          ])
            AND discontinued_from = '2026-09-01'
        ) AS scheduled_count,
        (
          SELECT count(*)::int FROM catalog_products
          WHERE item_code <> ALL(ARRAY[
            '616-D','618-D','620-D','622-D','623-D','624-D','624-XD','624-SD','625-D',
            '616-DM','618-DM','620-DM','622-DM','623-DM','624-DM','624-XDM','624-SDM','625-DM'
          ])
            AND discontinued_from IS NOT NULL
            AND left(item_code, 2) <> '__'
            AND coalesce(division, '') <> 'Test'
        ) AS other_confirmed_count
    `);
    expect(result.rows[0]).toEqual({
      phantom_count: 0,
      // v4 confirms all nine standard SINK codes and their nine Matt twins
      // are withdrawn from 01 Sep 2026.
      scheduled_count: 18,
      // The signed-off correction workbook confirms 90 total codes; 72 are
      // outside this SINK subset and are therefore expected, not unexpected.
      other_confirmed_count: 72,
    });
  });

  it("keeps 616-D visible in a historical catalog query", async () => {
    const app = express();
    app.use(catalogRouter);
    const response = await supertest(app)
      .get("/catalog/products")
      .query({ asOf: "2026-08-31", search: "616-D" });
    expect(response.status).toBe(200);
    expect(response.body.rows.map((row: { itemCode: string }) => row.itemCode)).toContain("616-D");
  });

  it("keeps the PTMT load record intact after source-invalid rows are removed", async () => {
    const [ptmt] = await db
      .select({
        id: mrpLoadBatchesTable.id,
        rowCount: mrpLoadBatchesTable.rowCount,
      })
      .from(mrpLoadBatchesTable)
      .where(
        eq(
          mrpLoadBatchesTable.fileName,
          "NEW PTMT MRP w.e.f. List as on 01st Sep, 2026.xlsx",
        ),
      );
    expect(ptmt?.rowCount).toBe(4309);

    const linked = await db.execute<{ count: number }>(sql`
      SELECT COUNT(*)::int AS count
      FROM mrp_price_history
      WHERE load_batch_id = ${ptmt!.id}
    `);
    expect(linked.rows[0]?.count).toBe(4291);
  });

  it("keeps the 68 PTMT products introduced on 01 September live", async () => {
    const september = await getPrayagCatalogMapForPeriod("2026-09-01");
    expect(
      FUTURE_FIXTURES.filter((itemCode) => september.get(itemCode)?.mrp != null),
    ).toHaveLength(68);
  });
});