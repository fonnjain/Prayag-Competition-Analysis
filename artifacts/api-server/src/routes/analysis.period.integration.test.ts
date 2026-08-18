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
import * as XLSX from "xlsx";
import {
  db,
  catalogProductsTable,
  mrpPriceHistoryTable,
  competitorPricesTable,
} from "@workspace/db";
import analysisRouter, {
  getPrayagCatalogMapForPeriod,
  getCompetitorRowsForPeriod,
} from "./analysis.js";
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

// ---------------------------------------------------------------------------
// Level 3: getCompetitorRowsForPeriod — DISTINCT ON picks the right batch
// ---------------------------------------------------------------------------
//
// Scenario: two competitor_prices rows for the same (competitor,
// matched_prayag_code) pair across two effective dates:
//   2026-01-15 → price 500   (earlier batch)
//   2026-06-01 → price 550   (later batch)
//
// Expected resolution:
//   asOf 2026-03-01  (between the two dates)  → earlier row (500)
//   asOf 2026-08-01  (after both dates)        → later row   (550)
//   asOf 2025-12-01  (before both dates)       → no row for this product
//
// The test uses a dedicated item code and competitor name so it cannot
// interact with the fixtures defined at the top of this file.

describe("getCompetitorRowsForPeriod — DISTINCT ON selects latest batch on-or-before date", () => {
  const CP_ITEM = `__TEST_COMP_PERIOD_${Date.now()}__`;
  const CP_COMP = `__test_comp_period_${Date.now()}__`;

  const JAN_DATE = "2026-01-15";
  const JAN_PRICE = 500;

  const JUN_DATE = "2026-06-01";
  const JUN_PRICE = 550;

  beforeAll(async () => {
    // No catalog product needed — matched_prayag_code is plain text with no FK.
    // Insert two competitor rows: same competitor + matched code, different dates.
    await db.insert(competitorPricesTable).values([
      {
        competitor: CP_COMP,
        description: "Test Comp Period SKU — Jan batch",
        price: JAN_PRICE,
        unit: null,
        matchedPrayagCode: CP_ITEM,
        matchStatus: "matched",
        matchConfidence: "High",
        prayagMrpAtCompare: 480,
        effectiveDate: JAN_DATE,
        isCurrent: false,
      },
      {
        competitor: CP_COMP,
        description: "Test Comp Period SKU — Jun batch",
        price: JUN_PRICE,
        unit: null,
        matchedPrayagCode: CP_ITEM,
        matchStatus: "matched",
        matchConfidence: "High",
        prayagMrpAtCompare: 520,
        effectiveDate: JUN_DATE,
        isCurrent: true,
      },
    ]);
  });

  afterAll(async () => {
    await db
      .delete(competitorPricesTable)
      .where(eq(competitorPricesTable.competitor, CP_COMP));
  });

  /** Pull out our test row from the result set (returns undefined if absent). */
  async function findRow(atDate: string) {
    const rows = await getCompetitorRowsForPeriod(atDate);
    return rows.find(
      (r) => r.competitor === CP_COMP && r.matchedPrayagCode === CP_ITEM,
    );
  }

  it("asOf 2026-03-01 (between batches) → returns Jan batch (price=500)", async () => {
    const row = await findRow("2026-03-01");
    expect(
      row,
      "Expected Jan batch row to be present for 2026-03-01",
    ).toBeDefined();
    expect(row!.price).toBe(JAN_PRICE);
    expect(row!.effectiveDate).toBe(JAN_DATE);
  });

  it("asOf 2026-08-01 (after both batches) → returns Jun batch (price=550)", async () => {
    const row = await findRow("2026-08-01");
    expect(
      row,
      "Expected Jun batch row to be present for 2026-08-01",
    ).toBeDefined();
    expect(row!.price).toBe(JUN_PRICE);
    expect(row!.effectiveDate).toBe(JUN_DATE);
  });

  it("asOf 2025-12-01 (before both batches) → returns no row for this product", async () => {
    const row = await findRow("2025-12-01");
    expect(
      row,
      "Expected no row for this product before earliest batch date",
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Level 4: prayagMrpDate resolution — future vs past effectivePeriod
// ---------------------------------------------------------------------------
//
// getFilteredRows() caps prayagMrpDate at today:
//   future effectivePeriod → prayagMrpDate === today
//   past   effectivePeriod → prayagMrpDate === effectivePeriod
//
// Dates are computed dynamically at test runtime so the assertions stay
// correct regardless of when the suite is run.
//
// Verified via two observable surfaces:
//   1. GET /analysis/opportunities  — prayagMrpDate field in the JSON body
//   2. GET /analysis/export?format=csv — column header "Prayag MRP (as of <date>)"

/** Matches todayString() in analysis.ts — local-calendar YYYY-MM-DD. */
function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** A date that is safely in the future (1 year from today). */
function futureDateStr(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** A date that is safely in the past (30 days ago). */
function pastDateStr(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

describe("prayagMrpDate resolution — future vs past effectivePeriod", () => {
  const mrpApp = express();
  mrpApp.use(express.json());
  mrpApp.use(analysisRouter);
  const mrpRequest = supertest(mrpApp);

  // ── /analysis/opportunities ──────────────────────────────────────────────

  it(
    "future effectivePeriod → prayagMrpDate === today in /analysis/opportunities",
    async () => {
      // A date one year from today is always in the future.
      // getFilteredRows() must clamp it down to today.
      const qs = new URLSearchParams({ effectivePeriod: futureDateStr() });
      const res = await mrpRequest.get(`/analysis/opportunities?${qs}`);
      expect(res.status).toBe(200);
      expect(res.body.prayagMrpDate).toBe(todayStr());
    },
  );

  it(
    "past effectivePeriod → prayagMrpDate === that past date in /analysis/opportunities",
    async () => {
      // A date 30 days ago is always in the past.
      const past = pastDateStr();
      const qs = new URLSearchParams({ effectivePeriod: past });
      const res = await mrpRequest.get(`/analysis/opportunities?${qs}`);
      expect(res.status).toBe(200);
      expect(res.body.prayagMrpDate).toBe(past);
    },
  );

  // ── /analysis/export column header ──────────────────────────────────────

  it(
    'future effectivePeriod → export CSV column header contains "Prayag MRP (as of <today>)"',
    async () => {
      const qs = new URLSearchParams({
        effectivePeriod: futureDateStr(),
        format: "csv",
      });
      const res = await mrpRequest.get(`/analysis/export?${qs}`);
      expect(res.status).toBe(200);

      const firstLine = (res.text as string).split("\n")[0];
      expect(firstLine).toContain(`Prayag MRP (as of ${todayStr()})`);
    },
  );

  it(
    'past effectivePeriod → export CSV column header contains "Prayag MRP (as of <past date>)"',
    async () => {
      const past = pastDateStr();
      const qs = new URLSearchParams({
        effectivePeriod: past,
        format: "csv",
      });
      const res = await mrpRequest.get(`/analysis/export?${qs}`);
      expect(res.status).toBe(200);

      const firstLine = (res.text as string).split("\n")[0];
      expect(firstLine).toContain(`Prayag MRP (as of ${past})`);
    },
  );
});

// ---------------------------------------------------------------------------
// Level 5: GET /analysis/export — period-filtered row data (CSV + XLSX)
// ---------------------------------------------------------------------------
//
// Scenario: two competitor_prices rows for the same (competitor,
// matched_prayag_code) pair at two different effective dates:
//   2026-01-15 → price 450   (earlier batch)
//   2026-06-15 → price 510   (later batch)
//
// When effectivePeriod targets a date between the two batches the export must
// include the Jan price (450); when it targets a date after both batches it
// must include the Jun price (510). Both CSV and XLSX formats are verified.
//
// The export header row layout (0-indexed):
//   0  Competitor
//   1  Prayag Code
//   2  Prayag Product
//   3  Division
//   4  Category
//   5  Match Status
//   6  Match Confidence
//   7  Prayag MRP (as of <date>)
//   8  Competitor Price         ← asserted below
//   9  Unit / Basis
//  10  Competitor Effective Price
//  11  Price Diff
//  12  Price Diff %
//  13  Prayag Cheaper

describe("GET /analysis/export — period-filtered row data (CSV + XLSX)", () => {
  const EX_ITEM = `__TEST_EXP_PERIOD_${Date.now()}__`;
  const EX_COMP = `__test_exp_period_${Date.now()}__`;

  const EX_MRP = 400;
  const EX_MRP_DATE = "2026-01-01";

  const EX_JAN_DATE = "2026-01-15";
  const EX_JAN_PRICE = 450;

  const EX_JUN_DATE = "2026-06-15";
  const EX_JUN_PRICE = 510;

  // Date between the two batches — resolves to Jan
  const AS_OF_BETWEEN = "2026-03-01";
  // Date after both batches — resolves to Jun
  const AS_OF_AFTER = "2026-08-01";

  const exportApp = express();
  exportApp.use(express.json());
  exportApp.use(analysisRouter);
  const exportRequest = supertest(exportApp);

  beforeAll(async () => {
    // Catalog product so buildRow can populate prayagCode / prayagProductName
    await db.insert(catalogProductsTable).values({
      itemCode: EX_ITEM,
      productName: "Test Export Period Product",
      division: "Test Division",
      category: "Test Category",
    });

    // One MRP revision so the row is comparable in the export
    await db.insert(mrpPriceHistoryTable).values({
      itemCode: EX_ITEM,
      mrp: EX_MRP,
      priceBasis: "MRP",
      effectiveDate: EX_MRP_DATE,
      loadDate: EX_MRP_DATE,
      isCurrent: false,
    });

    // Two competitor rows — same competitor + matched code, different dates
    await db.insert(competitorPricesTable).values([
      {
        competitor: EX_COMP,
        description: "Test Export Period SKU — Jan batch",
        price: EX_JAN_PRICE,
        unit: null,
        matchedPrayagCode: EX_ITEM,
        matchStatus: "matched",
        matchConfidence: "High",
        prayagMrpAtCompare: EX_MRP,
        effectiveDate: EX_JAN_DATE,
        isCurrent: false,
      },
      {
        competitor: EX_COMP,
        description: "Test Export Period SKU — Jun batch",
        price: EX_JUN_PRICE,
        unit: null,
        matchedPrayagCode: EX_ITEM,
        matchStatus: "matched",
        matchConfidence: "High",
        prayagMrpAtCompare: EX_MRP,
        effectiveDate: EX_JUN_DATE,
        isCurrent: true,
      },
    ]);
  });

  afterAll(async () => {
    await db
      .delete(competitorPricesTable)
      .where(eq(competitorPricesTable.competitor, EX_COMP));
    await db
      .delete(mrpPriceHistoryTable)
      .where(eq(mrpPriceHistoryTable.itemCode, EX_ITEM));
    await db
      .delete(catalogProductsTable)
      .where(eq(catalogProductsTable.itemCode, EX_ITEM));
  });

  // ── CSV helpers ─────────────────────────────────────────────────────────

  /**
   * Parse a CSV string into a 2-D array of cells.
   * Handles double-quoted fields (strips surrounding quotes; does not unescape
   * embedded quotes — sufficient for our test data which has no commas or
   * quotes inside values).
   */
  function parseCSV(text: string): string[][] {
    return text
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) =>
        line.split(",").map((cell) => cell.replace(/^"|"$/g, "").trim()),
      );
  }

  /** Return the first data row whose Competitor column (index 0) matches. */
  function findCSVRow(rows: string[][], competitor: string): string[] | undefined {
    return rows.slice(1).find((r) => r[0] === competitor);
  }

  // ── XLSX helpers ─────────────────────────────────────────────────────────

  /**
   * Fetch the export as an XLSX buffer via supertest's binary parse hook and
   * return the first worksheet as a 2-D array of cells.
   */
  async function fetchXLSX(qs: URLSearchParams): Promise<(string | number | null)[][]> {
    const res = await exportRequest
      .get(`/analysis/export?${qs}`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      });
    expect(res.status, `XLSX export returned ${res.status}`).toBe(200);
    expect(res.headers["content-type"]).toContain("spreadsheetml");

    const wb = XLSX.read(res.body as Buffer, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, {
      header: 1,
    });
  }

  /** Return the first data row whose Competitor column (index 0) matches. */
  function findXLSXRow(
    aoa: (string | number | null)[][],
    competitor: string,
  ): (string | number | null)[] | undefined {
    return aoa.slice(1).find((r) => r[0] === competitor);
  }

  // ── CSV tests ────────────────────────────────────────────────────────────

  it(
    "CSV — effectivePeriod before Jun batch → Competitor Price column shows Jan price (450)",
    async () => {
      const qs = new URLSearchParams({
        effectivePeriod: AS_OF_BETWEEN,
        format: "csv",
        competitor: EX_COMP,
      });
      const res = await exportRequest.get(`/analysis/export?${qs}`);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("text/csv");

      const rows = parseCSV(res.text as string);
      const dataRow = findCSVRow(rows, EX_COMP);
      expect(
        dataRow,
        `Row for ${EX_COMP} not found in CSV (effectivePeriod=${AS_OF_BETWEEN})`,
      ).toBeDefined();
      // Column 8 = "Competitor Price"
      expect(Number(dataRow![8])).toBe(EX_JAN_PRICE);
    },
  );

  it(
    "CSV — effectivePeriod after both batches → Competitor Price column shows Jun price (510)",
    async () => {
      const qs = new URLSearchParams({
        effectivePeriod: AS_OF_AFTER,
        format: "csv",
        competitor: EX_COMP,
      });
      const res = await exportRequest.get(`/analysis/export?${qs}`);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("text/csv");

      const rows = parseCSV(res.text as string);
      const dataRow = findCSVRow(rows, EX_COMP);
      expect(
        dataRow,
        `Row for ${EX_COMP} not found in CSV (effectivePeriod=${AS_OF_AFTER})`,
      ).toBeDefined();
      expect(Number(dataRow![8])).toBe(EX_JUN_PRICE);
    },
  );

  // ── XLSX tests ───────────────────────────────────────────────────────────

  it(
    "XLSX — effectivePeriod before Jun batch → Competitor Price column shows Jan price (450)",
    async () => {
      const qs = new URLSearchParams({
        effectivePeriod: AS_OF_BETWEEN,
        format: "xlsx",
        competitor: EX_COMP,
      });
      const aoa = await fetchXLSX(qs);
      const dataRow = findXLSXRow(aoa, EX_COMP);
      expect(
        dataRow,
        `Row for ${EX_COMP} not found in XLSX (effectivePeriod=${AS_OF_BETWEEN})`,
      ).toBeDefined();
      expect(Number(dataRow![8])).toBe(EX_JAN_PRICE);
    },
  );

  it(
    "XLSX — effectivePeriod after both batches → Competitor Price column shows Jun price (510)",
    async () => {
      const qs = new URLSearchParams({
        effectivePeriod: AS_OF_AFTER,
        format: "xlsx",
        competitor: EX_COMP,
      });
      const aoa = await fetchXLSX(qs);
      const dataRow = findXLSXRow(aoa, EX_COMP);
      expect(
        dataRow,
        `Row for ${EX_COMP} not found in XLSX (effectivePeriod=${AS_OF_AFTER})`,
      ).toBeDefined();
      expect(Number(dataRow![8])).toBe(EX_JUN_PRICE);
    },
  );
});

// ---------------------------------------------------------------------------
// Level 6: GET /analysis/export — zero-row guard when period pre-dates all data
// ---------------------------------------------------------------------------
//
// When effectivePeriod is set to a date that pre-dates every row in both price
// tables (e.g. "2000-01-01"), the export must:
//   • Return HTTP 200 — not a 500 or 404.
//   • Return a file that contains only the header row (no data rows).
//   • Set X-Export-Row-Count: 0 so the UI can detect the empty result.
//   • Set X-Export-Warning so the UI can surface a human-readable message.
//
// The "data pre-dates all rows" scenario is trivially guaranteed by using a
// date far in the past ("2000-01-01"). No fixture data is inserted because
// the test relies on the absence of rows for that date.

describe("GET /analysis/export — zero-row guard for pre-data effectivePeriod", () => {
  const zeroRowApp = express();
  zeroRowApp.use(express.json());
  zeroRowApp.use(analysisRouter);
  const zeroRowRequest = supertest(zeroRowApp);

  // A date guaranteed to pre-date every row in any environment.
  const PRE_DATA_DATE = "2000-01-01";

  // Self-contained fixture for the non-zero ("warning absent") test so it
  // does not depend on data inserted by the Level 5 describe block.
  const ZR_ITEM = `__TEST_ZR_NOZERO_${Date.now()}__`;
  const ZR_COMP = `__test_zr_nozero_${Date.now()}__`;
  const ZR_DATE = "2026-05-01";
  const ZR_MRP = 300;
  const ZR_PRICE = 350;

  beforeAll(async () => {
    await db.insert(catalogProductsTable).values({
      itemCode: ZR_ITEM,
      productName: "Zero-Row Guard Non-Zero Fixture",
      division: "Test Division",
      category: "Test Category",
    });
    await db.insert(mrpPriceHistoryTable).values({
      itemCode: ZR_ITEM,
      mrp: ZR_MRP,
      priceBasis: "MRP",
      effectiveDate: ZR_DATE,
      loadDate: ZR_DATE,
      isCurrent: false,
    });
    await db.insert(competitorPricesTable).values({
      competitor: ZR_COMP,
      description: "Zero-Row Guard Non-Zero Fixture SKU",
      price: ZR_PRICE,
      unit: null,
      matchedPrayagCode: ZR_ITEM,
      matchStatus: "matched",
      matchConfidence: "High",
      prayagMrpAtCompare: ZR_MRP,
      effectiveDate: ZR_DATE,
      isCurrent: true,
    });
  });

  afterAll(async () => {
    await db
      .delete(competitorPricesTable)
      .where(eq(competitorPricesTable.competitor, ZR_COMP));
    await db
      .delete(mrpPriceHistoryTable)
      .where(eq(mrpPriceHistoryTable.itemCode, ZR_ITEM));
    await db
      .delete(catalogProductsTable)
      .where(eq(catalogProductsTable.itemCode, ZR_ITEM));
  });

  it(
    "CSV — returns HTTP 200 with header row only (no data rows) when effectivePeriod pre-dates all data",
    async () => {
      const qs = new URLSearchParams({
        effectivePeriod: PRE_DATA_DATE,
        format: "csv",
      });
      const res = await zeroRowRequest.get(`/analysis/export?${qs}`);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("text/csv");

      // Only the header line should be present (filter out trailing blank lines)
      const lines = (res.text as string)
        .split("\n")
        .filter((l) => l.trim() !== "");
      expect(
        lines.length,
        "CSV must contain exactly 1 line (header only) when no rows match",
      ).toBe(1);
    },
  );

  it(
    "CSV — X-Export-Row-Count header is 0 when effectivePeriod pre-dates all data",
    async () => {
      const qs = new URLSearchParams({
        effectivePeriod: PRE_DATA_DATE,
        format: "csv",
      });
      const res = await zeroRowRequest.get(`/analysis/export?${qs}`);
      expect(res.status).toBe(200);
      expect(res.headers["x-export-row-count"]).toBe("0");
    },
  );

  it(
    "CSV — X-Export-Warning header is present when effectivePeriod pre-dates all data",
    async () => {
      const qs = new URLSearchParams({
        effectivePeriod: PRE_DATA_DATE,
        format: "csv",
      });
      const res = await zeroRowRequest.get(`/analysis/export?${qs}`);
      expect(res.status).toBe(200);
      expect(
        res.headers["x-export-warning"],
        "X-Export-Warning must be set when the export has zero data rows",
      ).toBeTruthy();
    },
  );

  it(
    "XLSX — returns HTTP 200 with header row only (no data rows) when effectivePeriod pre-dates all data",
    async () => {
      const qs = new URLSearchParams({
        effectivePeriod: PRE_DATA_DATE,
        format: "xlsx",
      });
      const res = await zeroRowRequest
        .get(`/analysis/export?${qs}`)
        .buffer(true)
        .parse((response, callback) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => chunks.push(chunk));
          response.on("end", () => callback(null, Buffer.concat(chunks)));
        });
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("spreadsheetml");

      const wb = XLSX.read(res.body as Buffer, { type: "buffer" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, {
        header: 1,
      });
      // Sheet must have exactly 1 row (the header)
      expect(
        aoa.length,
        "XLSX must contain exactly 1 row (header only) when no rows match",
      ).toBe(1);
    },
  );

  it(
    "XLSX — X-Export-Row-Count: 0 and X-Export-Warning present when effectivePeriod pre-dates all data",
    async () => {
      const qs = new URLSearchParams({
        effectivePeriod: PRE_DATA_DATE,
        format: "xlsx",
      });
      const res = await zeroRowRequest
        .get(`/analysis/export?${qs}`)
        .buffer(true)
        .parse((response, callback) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => chunks.push(chunk));
          response.on("end", () => callback(null, Buffer.concat(chunks)));
        });
      expect(res.status).toBe(200);
      expect(res.headers["x-export-row-count"]).toBe("0");
      expect(res.headers["x-export-warning"]).toBeTruthy();
    },
  );

  it(
    "non-zero rows — X-Export-Row-Count > 0 and X-Export-Warning absent when data rows are present",
    async () => {
      // Use the self-contained fixture seeded in beforeAll above.
      // ZR_DATE = "2026-05-01"; querying on "2026-06-01" (after ZR_DATE) must
      // return at least the one seeded row for ZR_COMP, giving a non-zero count.
      const qs = new URLSearchParams({
        effectivePeriod: "2026-06-01",
        format: "csv",
        competitor: ZR_COMP,
      });
      const res = await zeroRowRequest.get(`/analysis/export?${qs}`);
      expect(res.status).toBe(200);

      const rowCount = Number(res.headers["x-export-row-count"]);
      expect(rowCount, "X-Export-Row-Count must be >= 1 for the seeded fixture row").toBeGreaterThanOrEqual(1);

      expect(
        res.headers["x-export-warning"],
        "X-Export-Warning must be absent when data rows are present",
      ).toBeUndefined();
    },
  );
});
