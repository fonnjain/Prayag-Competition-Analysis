/**
 * Integration test: date-driven MRP price lookup in getPrayagCatalogMapForPeriod.
 *
 * Scenario: three mrp_price_history revisions for a single test item:
 *   2026-03-05 → 375.52
 *   2026-04-20 → 405.57  (w.e.f. 20 Apr)
 *   2026-09-01 → 406.00
 *
 * The DISTINCT ON … WHERE effective_date <= resolvedDate query must select:
 *   asOf 2026-08-17 → Apr revision (405.57), upcoming = Sep (406)
 *   asOf 2026-09-01 → Sep revision (406.00), upcoming = null
 *   asOf 2026-03-10 → Mar revision (375.52), upcoming = Apr (405.57)
 *
 * Tests run at two levels:
 *   1. Direct: call the exported getPrayagCatalogMapForPeriod() and inspect
 *      the PrayagInfo entry for mrp, upcomingMrp, and upcomingMrpDate.
 *   2. HTTP:   call GET /analysis/opportunities and verify upcomingPrayagMrp /
 *      upcomingPrayagMrpDate in the returned opportunity items — these are the
 *      observable fields that flow from the catalog map through buildRow.
 *
 * Prerequisites: DATABASE_URL must be set (standard in the Replit environment).
 *
 * Each test run uses a timestamp-seeded unique item code to avoid any collision
 * with production data. afterAll cleans up every row it created.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import supertest from "supertest";
import { eq } from "drizzle-orm";
import {
  db,
  catalogProductsTable,
  mrpPriceHistoryTable,
  competitorPricesTable,
} from "@workspace/db";
import analysisRouter, { getPrayagCatalogMapForPeriod } from "./analysis.js";
import { normCode } from "../lib/catalog.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const ITEM_CODE = `__TEST_PERIOD_${Date.now()}__`;
const COMPETITOR = `__test_period_comp_${Date.now()}__`;

// The three revisions under test (matching task spec):
const MAR_DATE = "2026-03-05";
const MAR_MRP = 375.52;

const APR_DATE = "2026-04-20";
const APR_MRP = 405.57;

const SEP_DATE = "2026-09-01";
const SEP_MRP = 406.0;

// asOf dates for assertions:
const AS_OF_AUG = "2026-08-17"; // today in the task; must resolve to Apr
const AS_OF_SEP = "2026-09-01"; // must resolve to Sep
const AS_OF_MAR = "2026-03-10"; // must resolve to Mar

// ---------------------------------------------------------------------------
// Setup and teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  // Insert catalog product
  await db.insert(catalogProductsTable).values({
    itemCode: ITEM_CODE,
    productName: "Test Period Product",
    division: "Test Division",
    category: "Test Category",
  });

  // Insert three MRP history rows
  await db.insert(mrpPriceHistoryTable).values([
    {
      itemCode: ITEM_CODE,
      mrp: MAR_MRP,
      priceBasis: "MRP",
      effectiveDate: MAR_DATE,
      loadDate: MAR_DATE,
      isCurrent: false,
    },
    {
      itemCode: ITEM_CODE,
      mrp: APR_MRP,
      priceBasis: "MRP",
      effectiveDate: APR_DATE,
      loadDate: APR_DATE,
      isCurrent: false,
    },
    {
      itemCode: ITEM_CODE,
      mrp: SEP_MRP,
      priceBasis: "MRP",
      effectiveDate: SEP_DATE,
      loadDate: SEP_DATE,
      isCurrent: false,
    },
  ]);

  // Insert a matched competitor price row so opportunities has something to
  // return in the HTTP tests. prayagMrpAtCompare is set to the Apr MRP so
  // the row is comparable. Competitor price is higher so it appears as margin
  // headroom.
  // priceBasis / gstPct omitted: stale generated types don't include them yet
  // (task #61). unit=null means effectivePrice() returns price as-is (no GST
  // gross-up), which is correct for this MRP-basis test row.
  await db.insert(competitorPricesTable).values({
    competitor: COMPETITOR,
    description: "Test Period Competitor SKU",
    price: 600,
    unit: null,
    matchedPrayagCode: ITEM_CODE,
    matchStatus: "matched",
    matchConfidence: "High",
    prayagMrpAtCompare: APR_MRP,
    effectiveDate: APR_DATE,
    isCurrent: true,
  });
});

afterAll(async () => {
  await db
    .delete(competitorPricesTable)
    .where(eq(competitorPricesTable.competitor, COMPETITOR));
  await db
    .delete(mrpPriceHistoryTable)
    .where(eq(mrpPriceHistoryTable.itemCode, ITEM_CODE));
  await db
    .delete(catalogProductsTable)
    .where(eq(catalogProductsTable.itemCode, ITEM_CODE));
});

// ---------------------------------------------------------------------------
// Level 1: Direct function tests
// ---------------------------------------------------------------------------

describe("getPrayagCatalogMapForPeriod — direct date resolution", () => {
  it("asOf 2026-08-17 (today) → resolves to Apr revision (405.57), upcoming = Sep (406)", async () => {
    const map = await getPrayagCatalogMapForPeriod(AS_OF_AUG);
    const info = map.get(normCode(ITEM_CODE));

    expect(info, "item must be present in catalog map").toBeDefined();
    expect(info!.mrp).toBe(APR_MRP); // 405.57, not 375.52 or 406
    expect(info!.effectiveDate).toBe(APR_DATE);
    expect(info!.upcomingMrp).toBe(SEP_MRP);
    expect(info!.upcomingMrpDate).toBe(SEP_DATE);
  });

  it("asOf 2026-09-01 → resolves to Sep revision (406.00), no upcoming", async () => {
    const map = await getPrayagCatalogMapForPeriod(AS_OF_SEP);
    const info = map.get(normCode(ITEM_CODE));

    expect(info).toBeDefined();
    expect(info!.mrp).toBe(SEP_MRP); // 406, not Apr or Mar
    expect(info!.effectiveDate).toBe(SEP_DATE);
    expect(info!.upcomingMrp).toBeNull(); // no revision after Sep 1
    expect(info!.upcomingMrpDate).toBeNull();
  });

  it("asOf 2026-03-10 → resolves to Mar revision (375.52), upcoming = Apr (405.57)", async () => {
    const map = await getPrayagCatalogMapForPeriod(AS_OF_MAR);
    const info = map.get(normCode(ITEM_CODE));

    expect(info).toBeDefined();
    expect(info!.mrp).toBe(MAR_MRP); // 375.52, not Apr or Sep
    expect(info!.effectiveDate).toBe(MAR_DATE);
    expect(info!.upcomingMrp).toBe(APR_MRP);
    expect(info!.upcomingMrpDate).toBe(APR_DATE);
  });

  it("asOf before any revision → item has no MRP (mrp is null)", async () => {
    const map = await getPrayagCatalogMapForPeriod("2026-01-01");
    const info = map.get(normCode(ITEM_CODE));

    // The catalog product exists but no price row qualifies for Jan 1
    expect(info).toBeDefined();
    expect(info!.mrp).toBeNull();
    expect(info!.effectiveDate).toBeNull();
    // Upcoming should be the earliest revision (Mar)
    expect(info!.upcomingMrp).toBe(MAR_MRP);
    expect(info!.upcomingMrpDate).toBe(MAR_DATE);
  });
});

// ---------------------------------------------------------------------------
// Level 1b: GET /analysis/overview — snake_case mapping smoke test
//
// Confirms that mapCompetitorRow() correctly bridges the raw snake_case column
// names returned by db.execute() to the camelCase properties expected by
// buildRow(). Before the fix, matchStatus was always undefined so every row
// was treated as unmatched, producing comparableSkus = 0 silently.
// ---------------------------------------------------------------------------

describe("GET /analysis/overview — comparableSkus non-zero after mapCompetitorRow fix", () => {
  const overviewApp = express();
  overviewApp.use(express.json());
  overviewApp.use(analysisRouter);
  const overviewRequest = supertest(overviewApp);

  type OverviewBody = {
    comparableSkus: number;
    prayagCheaperCount: number;
    prayagCostlierCount: number;
  };

  it("reports comparableSkus >= 1 for the seeded matched competitor row", async () => {
    // Use AS_OF_AUG so the Apr-dated competitor row (effectiveDate <= Aug 17)
    // is included in getCompetitorRowsForPeriod.
    const qs = new URLSearchParams({ effectivePeriod: AS_OF_AUG });
    const res = await overviewRequest.get(`/analysis/overview?${qs}`);
    expect(res.status).toBe(200);

    const body = res.body as OverviewBody;
    expect(
      body.comparableSkus,
      "comparableSkus must be >= 1 — if it is 0, mapCompetitorRow() is broken and matchStatus is not being read",
    ).toBeGreaterThanOrEqual(1);
  });

  it("prayagCheaperCount + prayagCostlierCount === comparableSkus (no null gaps)", async () => {
    const qs = new URLSearchParams({ effectivePeriod: AS_OF_AUG });
    const res = await overviewRequest.get(`/analysis/overview?${qs}`);
    expect(res.status).toBe(200);

    const body = res.body as OverviewBody;
    expect(body.prayagCheaperCount + body.prayagCostlierCount).toBe(
      body.comparableSkus,
    );
  });

  it("the seeded competitor SKU (price=600 > prayagMrp=405.57) is counted as prayagCheaper", async () => {
    // Competitor price 600 > Prayag MRP 405.57 → Prayag is cheaper.
    // Filter by the test competitor so other real data doesn't interfere.
    const qs = new URLSearchParams({
      effectivePeriod: AS_OF_AUG,
      competitor: COMPETITOR,
    });
    const res = await overviewRequest.get(`/analysis/overview?${qs}`);
    expect(res.status).toBe(200);

    const body = res.body as OverviewBody;
    expect(body.comparableSkus).toBe(1);
    expect(body.prayagCheaperCount).toBe(1);
    expect(body.prayagCostlierCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Level 2: HTTP pipeline tests (upcomingPrayagMrp flows from catalog map)
// ---------------------------------------------------------------------------

const testApp = express();
testApp.use(express.json());
testApp.use(analysisRouter);
const request = supertest(testApp);

describe("GET /analysis/opportunities — upcomingPrayagMrp reflects period-resolved catalog map", () => {
  type OpItem = {
    prayagCode: string | null;
    upcomingPrayagMrp: number | null;
    upcomingPrayagMrpDate: string | null;
    prayagMrp: number | null;
  };

  /** Fetch opportunities for a given period and find the test item by prayagCode. */
  async function fetchTestItem(effectivePeriod: string): Promise<OpItem> {
    const qs = new URLSearchParams({ thresholdPct: "0" });
    qs.set("effectivePeriod", effectivePeriod);
    const res = await request.get(`/analysis/opportunities?${qs}`);
    expect(res.status).toBe(200);

    const allItems: OpItem[] = [
      ...res.body.marginHeadroom,
      ...res.body.priceThreats,
    ];

    const found = allItems.find((i) => i.prayagCode === ITEM_CODE);
    expect(
      found,
      `Test item ${ITEM_CODE} not found in opportunities (marginHeadroom=${res.body.marginHeadroom.length}, priceThreats=${res.body.priceThreats.length}) for effectivePeriod=${effectivePeriod}`,
    ).toBeDefined();
    return found!;
  }

  it("asOf 2026-08-17 → upcomingPrayagMrp=406, upcomingPrayagMrpDate=2026-09-01", async () => {
    const item = await fetchTestItem(AS_OF_AUG);
    expect(item.upcomingPrayagMrp).toBe(SEP_MRP);
    expect(item.upcomingPrayagMrpDate).toBe(SEP_DATE);
  });

  it("asOf 2026-09-01 → upcomingPrayagMrp=null (no future revision)", async () => {
    const item = await fetchTestItem(AS_OF_SEP);
    expect(item.upcomingPrayagMrp).toBeNull();
    expect(item.upcomingPrayagMrpDate).toBeNull();
  });

  it("asOf 2026-03-10 → upcomingPrayagMrp=405.57, upcomingPrayagMrpDate=2026-04-20", async () => {
    // For Mar 10, the competitor row (effectiveDate=Apr 20) is after the asOf
    // date, so it won't be returned by getCompetitorRowsForPeriod. The item
    // will only appear if a competitor row with effectiveDate <= 2026-03-10
    // exists. Since none does, we validate via the direct catalog map instead.
    // This HTTP scenario is covered by the direct function test above.
    const map = await getPrayagCatalogMapForPeriod(AS_OF_MAR);
    const info = map.get(normCode(ITEM_CODE));
    expect(info).toBeDefined();
    expect(info!.mrp).toBe(MAR_MRP);
    expect(info!.upcomingMrp).toBe(APR_MRP);
    expect(info!.upcomingMrpDate).toBe(APR_DATE);
  });
});
