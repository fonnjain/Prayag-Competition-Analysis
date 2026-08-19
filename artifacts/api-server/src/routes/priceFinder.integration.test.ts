import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import supertest from "supertest";
import { eq, inArray, sql } from "drizzle-orm";
import {
  catalogProductsTable,
  competitorPricesTable,
  db,
  mrpPriceHistoryTable,
} from "@workspace/db";
import priceFinderRouter from "./priceFinder.js";
import { validToFromNextDate } from "../lib/priceWindow.js";

const RUN = Date.now();
const CHANGING = `PF-CHANGE-${RUN}`;
const UNCHANGED = `PF-SAME-${RUN}`;
const OPEN = `PF-OPEN-${RUN}`;
const FUTURE_ONLY = `PF-FUTURE-${RUN}`;
const INACTIVE = `PF-INACTIVE-${RUN}`;
const WITHDRAWING = `PF-WITHDRAWING-${RUN}`;
const COMPETITOR = `PF Competitor ${RUN}`;
const ITEM_CODES = [CHANGING, UNCHANGED, OPEN, FUTURE_ONLY, INACTIVE, WITHDRAWING];
const LEGACY_MRP_TABLE = `mrp_price_history_pf_test_${process.pid}_${RUN}`;

function dateOffset(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const OLD_DATE = dateOffset(-60);
const CURRENT_DATE = dateOffset(-20);
const NEXT_DATE = dateOffset(10);
const NEXT_VALID_TO = validToFromNextDate(NEXT_DATE);

const app = express();
app.use(express.json());
app.use(priceFinderRouter);
const request = supertest(app);

beforeAll(async () => {
  await db.insert(catalogProductsTable).values([
    {
      itemCode: CHANGING,
      productName: "Changing Price Fixture",
      division: "Test",
      category: "Price Finder",
    },
    {
      itemCode: UNCHANGED,
      productName: "Unchanged Price Fixture",
      division: "Test",
      category: "Price Finder",
    },
    {
      itemCode: OPEN,
      productName: "Open Price Fixture",
      division: "Test",
      category: "Price Finder",
    },
    {
      itemCode: FUTURE_ONLY,
      productName: "Future Only Price Fixture",
      division: "Test",
      category: "Price Finder",
    },
    {
      itemCode: INACTIVE,
      productName: "Inactive Price Fixture",
      division: "Test",
      category: "Price Finder",
      isActive: false,
    },
    {
      itemCode: WITHDRAWING,
      productName: "Withdrawing Price Fixture",
      division: "Test",
      category: "Price Finder",
      discontinuedFrom: NEXT_DATE,
    },
  ]);

  await db.insert(mrpPriceHistoryTable).values([
    {
      itemCode: CHANGING,
      mrp: 80,
      priceBasis: "MRP",
      effectiveDate: OLD_DATE,
      loadDate: OLD_DATE,
      isCurrent: true,
    },
    {
      itemCode: CHANGING,
      mrp: 100,
      priceBasis: "MRP",
      effectiveDate: CURRENT_DATE,
      loadDate: CURRENT_DATE,
      isCurrent: false,
    },
    {
      itemCode: CHANGING,
      mrp: 120,
      priceBasis: "MRP",
      effectiveDate: NEXT_DATE,
      loadDate: NEXT_DATE,
      isCurrent: false,
    },
    {
      itemCode: UNCHANGED,
      mrp: 200,
      priceBasis: "MRP",
      effectiveDate: CURRENT_DATE,
      loadDate: CURRENT_DATE,
      isCurrent: true,
    },
    {
      itemCode: UNCHANGED,
      mrp: 200,
      priceBasis: "MRP",
      effectiveDate: NEXT_DATE,
      loadDate: NEXT_DATE,
      isCurrent: false,
    },
    {
      itemCode: OPEN,
      mrp: 300,
      priceBasis: "MRP",
      effectiveDate: CURRENT_DATE,
      loadDate: CURRENT_DATE,
      isCurrent: true,
    },
    {
      itemCode: FUTURE_ONLY,
      mrp: 400,
      priceBasis: "MRP",
      effectiveDate: NEXT_DATE,
      loadDate: NEXT_DATE,
      isCurrent: true,
    },
    {
      itemCode: INACTIVE,
      mrp: 500,
      priceBasis: "MRP",
      effectiveDate: CURRENT_DATE,
      loadDate: CURRENT_DATE,
      isCurrent: true,
    },
    {
      itemCode: WITHDRAWING,
      mrp: 600,
      priceBasis: "MRP",
      effectiveDate: CURRENT_DATE,
      loadDate: CURRENT_DATE,
      isCurrent: true,
    },
    {
      itemCode: WITHDRAWING,
      mrp: 700,
      priceBasis: "MRP",
      effectiveDate: NEXT_DATE,
      loadDate: NEXT_DATE,
      isCurrent: false,
    },
  ]);

  // The parent table's unique index prevents new same-day duplicates. An
  // inherited child safely simulates a restored legacy duplicate while keeping
  // that production backstop intact; parent-table reads include child rows.
  await db.execute(
    sql.raw(
      `CREATE TABLE ${LEGACY_MRP_TABLE} () INHERITS (mrp_price_history)`,
    ),
  );
  await db.execute(sql`
    INSERT INTO ${sql.raw(LEGACY_MRP_TABLE)}
      (item_code, mrp, price_basis, effective_date, load_date, is_current)
    VALUES
      (${CHANGING}, ${130}, 'MRP', ${NEXT_DATE}, ${NEXT_DATE}, false)
  `);

  await db.insert(competitorPricesTable).values([
    {
      competitor: COMPETITOR,
      description: "Current competitor fixture",
      price: 150,
      matchedPrayagCode: CHANGING,
      matchStatus: "matched",
      matchConfidence: "High",
      prayagMrpAtCompare: 100,
      effectiveDate: CURRENT_DATE,
      isCurrent: false,
      priceBasis: "MRP",
    },
    {
      competitor: COMPETITOR,
      description: "Next competitor fixture",
      price: 165,
      matchedPrayagCode: CHANGING,
      matchStatus: "matched",
      matchConfidence: "High",
      prayagMrpAtCompare: 120,
      effectiveDate: NEXT_DATE,
      isCurrent: true,
      priceBasis: "MRP",
    },
  ]);
});


afterAll(async () => {
  await db
    .delete(competitorPricesTable)
    .where(eq(competitorPricesTable.competitor, COMPETITOR));
  await db.execute(sql.raw(`DROP TABLE IF EXISTS ${LEGACY_MRP_TABLE}`));
  await db
    .delete(mrpPriceHistoryTable)
    .where(inArray(mrpPriceHistoryTable.itemCode, ITEM_CODES));
  await db
    .delete(catalogProductsTable)
    .where(inArray(catalogProductsTable.itemCode, ITEM_CODES));
});

describe("Price Finder date-driven validity", () => {
  it("uses the highest-id same-day next revision in product detail", async () => {
    const response = await request.get(
      `/price-finder/product/${encodeURIComponent(CHANGING)}`,
    );
    expect(response.status).toBe(200);
    expect(response.body.product).toMatchObject({
      currentMrp: 100,
      currentEffectiveDate: CURRENT_DATE,
      currentValidTo: NEXT_VALID_TO,
      upcomingMrp: 130,
      upcomingEffectiveDate: NEXT_DATE,
      upcomingChangePct: 30,
    });
  });

  it("returns an equivalent competitor validity window and current-vs-current gap", async () => {
    const response = await request.get(
      `/price-finder/product/${encodeURIComponent(CHANGING)}`,
    );
    const competitor = response.body.competitors.find(
      (row: { competitor: string }) => row.competitor === COMPETITOR,
    );
    expect(competitor).toMatchObject({
      price: 150,
      effectiveDate: CURRENT_DATE,
      validTo: NEXT_VALID_TO,
      upcomingPrice: 165,
      upcomingEffectiveDate: NEXT_DATE,
      upcomingChangePct: 10,
      gapPct: 50,
    });
  });

  it("retains a zero-percent scheduled revision for no-change UI wording", async () => {
    const response = await request.get(
      `/price-finder/product/${encodeURIComponent(UNCHANGED)}`,
    );
    expect(response.body.product).toMatchObject({
      currentMrp: 200,
      upcomingMrp: 200,
      upcomingChangePct: 0,
    });
  });

  it("keeps open-ended periods null without inventing a future line", async () => {
    const response = await request.get(
      `/price-finder/product/${encodeURIComponent(OPEN)}`,
    );
    expect(response.body.product).toMatchObject({
      currentMrp: 300,
      currentValidTo: null,
      upcomingMrp: null,
      upcomingEffectiveDate: null,
      upcomingChangePct: null,
    });
  });

  it("ends the current price at withdrawal and suppresses a phantom next revision", async () => {
    const response = await request.get(
      `/price-finder/product/${encodeURIComponent(WITHDRAWING)}`,
    );
    expect(response.status).toBe(200);
    expect(response.body.product).toMatchObject({
      itemCode: WITHDRAWING,
      currentMrp: 600,
      currentValidTo: NEXT_VALID_TO,
      upcomingMrp: null,
      upcomingEffectiveDate: null,
      discontinuedFrom: NEXT_DATE,
    });
  });

  it("excludes inactive and future-only products until they have an in-force MRP", async () => {
    const [futureDetail, inactiveDetail, search] = await Promise.all([
      request.get(`/price-finder/product/${encodeURIComponent(FUTURE_ONLY)}`),
      request.get(`/price-finder/product/${encodeURIComponent(INACTIVE)}`),
      request.get(
        `/price-finder/search?q=${encodeURIComponent("Price Fixture")}`,
      ),
    ]);
    expect(futureDetail.status).toBe(404);
    expect(inactiveDetail.status).toBe(404);
    const codes = search.body.results.map(
      (row: { itemCode: string }) => row.itemCode,
    );
    expect(codes).toContain(CHANGING);
    expect(codes).not.toContain(FUTURE_ONLY);
    expect(codes).not.toContain(INACTIVE);
  });

  it("keeps progressive filters and price windows in the same search response", async () => {
    const response = await request
      .get("/price-finder/search")
      .query({ filters: ["Changing", "Price Finder"], limit: 3000 });
    expect(response.status).toBe(200);
    expect(response.body.totalCount).toBe(1);
    expect(response.body.results[0]).toMatchObject({
      itemCode: CHANGING,
      currentMrp: 100,
      currentEffectiveDate: CURRENT_DATE,
      currentValidTo: NEXT_VALID_TO,
      upcomingMrp: 130,
      upcomingEffectiveDate: NEXT_DATE,
      upcomingChangePct: 30,
    });
  });

  it("keeps the last successful result list when the next filter is unmatched", async () => {
    const response = await request
      .get("/price-finder/search")
      .query({
        filters: [CHANGING, "misheard-no-such-product"],
        limit: 3000,
      });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      totalCount: 1,
      unmatchedFilters: ["misheard-no-such-product"],
    });
    expect(response.body.results).toEqual([
      expect.objectContaining({
        itemCode: CHANGING,
        currentMrp: 100,
        currentValidTo: NEXT_VALID_TO,
        upcomingMrp: 130,
      }),
    ]);
  });

  it("returns no products when the first filter is unmatched", async () => {
    const response = await request
      .get("/price-finder/search")
      .query({ filters: ["misheard-no-such-product"], limit: 3000 });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      results: [],
      totalCount: 0,
      unmatchedFilters: ["misheard-no-such-product"],
    });
  });

  it("returns price windows when browsing a division and category", async () => {
    const response = await request
      .get("/price-finder/browse")
      .query({ division: "Test", category: "Price Finder", limit: 300 });
    expect(response.status).toBe(200);
    const product = response.body.products.find(
      (row: { itemCode: string }) => row.itemCode === CHANGING,
    );
    expect(product).toMatchObject({
      currentMrp: 100,
      currentEffectiveDate: CURRENT_DATE,
      currentValidTo: NEXT_VALID_TO,
      upcomingMrp: 130,
      upcomingEffectiveDate: NEXT_DATE,
      upcomingChangePct: 30,
    });
  });
});