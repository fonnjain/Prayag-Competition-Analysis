/**
 * Regression: the reproducible database readback must use the exact same
 * population, basis conversion, as-of date, and sign as GET /analysis/overview.
 * This protects the report after future MRP-history rebuilds.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import supertest from "supertest";
import { eq, sql } from "drizzle-orm";
import {
  catalogProductsTable,
  competitorPricesTable,
  db,
  mrpPriceHistoryTable,
} from "@workspace/db";
import analysisRouter from "./analysis.js";
import comparisonRouter from "./comparison.js";

const RUN = Date.now();
const COMPETITOR = `__market_gap_regression_${RUN}__`;
const AS_OF_DATE = "2026-08-19";
const MRP_DATE = "2026-08-01";
const NEXT_DATE = "2026-09-01";
const ITEM_A = `MKT-GAP-A-${RUN}`;
const ITEM_B = `MKT-GAP-B-${RUN}`;
const ITEM_C = `MKT-GAP-C-${RUN}`;
const ITEM_D = `MKT-GAP-D-${RUN}`;
const ITEM_E = `MKT-GAP-E-${RUN}`;
const ITEM_F = `MKT-GAP-STATUS-${RUN}`;
const ITEM_G = `MKT-GAP-LENGTH-${RUN}`;

const app = express();
app.use(express.json());
app.use(analysisRouter);
app.use(comparisonRouter);
const request = supertest(app);

beforeAll(async () => {
  await db.insert(catalogProductsTable).values([
    { itemCode: ITEM_A, productName: "Market gap MRP", division: "Test", category: "Gap" },
    { itemCode: ITEM_B, productName: "Market gap ex-GST", division: "Test", category: "Gap" },
    { itemCode: ITEM_C, productName: "Market gap latest competitor period", division: "Test", category: "Gap" },
    { itemCode: ITEM_D, productName: "Market gap unmatched exclusion", division: "Test", category: "Gap" },
    { itemCode: ITEM_E, productName: "Market gap null price exclusion", division: "Test", category: "Gap" },
    { itemCode: ITEM_F, productName: "Market gap status transition", division: "Test", category: "Gap" },
    { itemCode: ITEM_G, productName: "Market gap pipe 3 Mtr", division: "Test", category: "Gap" },
  ]);
  await db.insert(mrpPriceHistoryTable).values([
    { itemCode: ITEM_A, mrp: 100, priceBasis: "MRP", effectiveDate: MRP_DATE, loadDate: MRP_DATE },
    { itemCode: ITEM_B, mrp: 100, priceBasis: "MRP", effectiveDate: MRP_DATE, loadDate: MRP_DATE },
    { itemCode: ITEM_C, mrp: 100, priceBasis: "MRP", effectiveDate: MRP_DATE, loadDate: MRP_DATE },
    // Must be excluded as a future revision when the report is run as of Aug 19.
    { itemCode: ITEM_C, mrp: 120, priceBasis: "MRP", effectiveDate: NEXT_DATE, loadDate: NEXT_DATE },
    { itemCode: ITEM_D, mrp: 100, priceBasis: "MRP", effectiveDate: MRP_DATE, loadDate: MRP_DATE },
    { itemCode: ITEM_E, mrp: 100, priceBasis: "MRP", effectiveDate: MRP_DATE, loadDate: MRP_DATE },
    { itemCode: ITEM_F, mrp: 100, priceBasis: "MRP", effectiveDate: MRP_DATE, loadDate: MRP_DATE },
    { itemCode: ITEM_G, mrp: 300, priceBasis: "MRP", effectiveDate: MRP_DATE, loadDate: MRP_DATE },
  ]);
  await db.insert(competitorPricesTable).values([
    // +10%: MRP basis.
    { competitor: COMPETITOR, price: 110, priceBasis: "MRP", matchedPrayagCode: ITEM_A, matchStatus: "matched", effectiveDate: MRP_DATE },
    // +18% after explicit ex-GST gross-up.
    { competitor: COMPETITOR, price: 100, priceBasis: "Ex-GST", gstPct: 18, matchedPrayagCode: ITEM_B, matchStatus: "matched", effectiveDate: MRP_DATE },
    // Earlier revision must be superseded by the +5% row below.
    { competitor: COMPETITOR, price: 90, priceBasis: "MRP", matchedPrayagCode: ITEM_C, matchStatus: "matched", effectiveDate: "2026-07-01" },
    { competitor: COMPETITOR, price: 105, priceBasis: "MRP", matchedPrayagCode: ITEM_C, matchStatus: "matched", effectiveDate: MRP_DATE },
    // These two rows must not enter the report population.
    { competitor: COMPETITOR, price: 150, priceBasis: "MRP", matchedPrayagCode: ITEM_D, matchStatus: "no match (review)", effectiveDate: MRP_DATE },
    { competitor: COMPETITOR, price: null, priceBasis: "MRP", matchedPrayagCode: ITEM_E, matchStatus: "matched", effectiveDate: MRP_DATE },
    // A later unconfirmed mapping must not displace the latest confirmed quote.
    { competitor: COMPETITOR, price: 107, priceBasis: "MRP", matchedPrayagCode: ITEM_F, matchStatus: "matched", effectiveDate: "2026-07-01" },
    { competitor: COMPETITOR, price: 70, priceBasis: "MRP", matchedPrayagCode: ITEM_F, matchStatus: "needs_review", effectiveDate: MRP_DATE },
    // ₹100/m versus a ₹300 3-mtr pack is 0% per metre, but -66.7% by the
    // canonical raw-MRP market-gap definition.
    { competitor: COMPETITOR, description: "Market gap pipe", unit: "Rate/mtr", price: 100, priceBasis: "MRP", matchedPrayagCode: ITEM_G, matchStatus: "matched", effectiveDate: MRP_DATE },
  ]);
});

afterAll(async () => {
  await db.delete(competitorPricesTable).where(eq(competitorPricesTable.competitor, COMPETITOR));
  await db.delete(mrpPriceHistoryTable).where(
    sql`${mrpPriceHistoryTable.itemCode} IN (${ITEM_A}, ${ITEM_B}, ${ITEM_C}, ${ITEM_D}, ${ITEM_E}, ${ITEM_F}, ${ITEM_G})`,
  );
  await db.delete(catalogProductsTable).where(
    sql`${catalogProductsTable.itemCode} IN (${ITEM_A}, ${ITEM_B}, ${ITEM_C}, ${ITEM_D}, ${ITEM_E}, ${ITEM_F}, ${ITEM_G})`,
  );
});

describe("market-gap report and analysis dashboard", () => {
  it("uses the raw MRP market gap consistently even for length-normalized rows", async () => {
    const overview = await request.get(
      `/analysis/overview?${new URLSearchParams({
        competitor: COMPETITOR,
        effectivePeriod: AS_OF_DATE,
      })}`,
    );
    expect(overview.status).toBe(200);
    expect(overview.body).toMatchObject({
      comparableSkus: 5,
      medianPriceDiffPct: 7,
      avgPriceDiffPct: -5.3,
    });

    type Readback = {
      comparable_skus: number | string;
      median_gap_pct: number | string | null;
      avg_gap_pct: number | string | null;
    };
    const readback = await db.execute<Readback>(sql`
      WITH current_competitor AS (
        SELECT DISTINCT ON (cp.competitor, cp.matched_prayag_code)
          cp.id, cp.matched_prayag_code, cp.price, cp.unit, cp.price_basis, cp.gst_pct
        FROM competitor_prices cp
        WHERE cp.competitor = ${COMPETITOR}
          AND cp.match_status = 'matched'
          AND cp.matched_prayag_code IS NOT NULL
          AND cp.price IS NOT NULL
          AND cp.effective_date <= ${AS_OF_DATE}
        ORDER BY cp.competitor, cp.matched_prayag_code, cp.effective_date DESC, cp.id DESC
      ),
      current_prayag AS (
        SELECT DISTINCT ON (h.item_code) h.item_code, h.mrp
        FROM mrp_price_history h
        WHERE h.review_status = 'approved'
          AND h.mrp IS NOT NULL
          AND h.effective_date <= ${AS_OF_DATE}
        ORDER BY h.item_code, h.effective_date DESC, h.id DESC
      ),
      comparable AS (
        SELECT ((CASE
          WHEN cc.price_basis = 'Ex-GST'
            THEN cc.price * (1 + COALESCE(cc.gst_pct, 18) / 100.0)
          WHEN cc.price_basis IS NULL AND btrim(COALESCE(cc.unit, '')) = 'Rate (ex-GST)'
            THEN cc.price * 1.18
          ELSE cc.price
        END) - pr.mrp) / pr.mrp * 100.0 AS gap_pct
        FROM current_competitor cc
        JOIN catalog_products product ON product.item_code = cc.matched_prayag_code
        JOIN current_prayag pr ON pr.item_code = product.item_code
        WHERE product.is_active IS TRUE
          AND (product.discontinued_from IS NULL OR product.discontinued_from > ${AS_OF_DATE})
          AND pr.mrp > 0
      )
      SELECT
        count(*)::int AS comparable_skus,
        round(percentile_cont(0.5) WITHIN GROUP (ORDER BY gap_pct)::numeric, 1) AS median_gap_pct,
        round(avg(gap_pct)::numeric, 1) AS avg_gap_pct
      FROM comparable
    `);

    const report = readback.rows[0]!;
    expect(Number(report.comparable_skus)).toBe(5);
    expect(Number(report.median_gap_pct)).toBe(7);
    expect(Number(report.avg_gap_pct)).toBe(-5.3);
    expect(overview.body.comparableSkus).toBe(Number(report.comparable_skus));
    expect(overview.body.medianPriceDiffPct).toBe(Number(report.median_gap_pct));
    expect(overview.body.avgPriceDiffPct).toBe(Number(report.avg_gap_pct));

    const lengthRow = await request.get(
      `/catalog/comparison?${new URLSearchParams({
        competitor: COMPETITOR,
        search: ITEM_G,
      })}`,
    );
    expect(lengthRow.status).toBe(200);
    expect(lengthRow.body.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ diffPct: -66.7, effectiveDiffPct: 0 }),
      ]),
    );

    const summary = await request.get(
      `/catalog/comparison/summary?competitor=${encodeURIComponent(COMPETITOR)}`,
    );
    expect(summary.status).toBe(200);
    expect(summary.body).toMatchObject({
      comparableRows: 5,
      avgDiffPct: -5.3,
    });
  });
});