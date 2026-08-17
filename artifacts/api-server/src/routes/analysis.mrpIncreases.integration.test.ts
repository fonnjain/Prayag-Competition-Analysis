/**
 * Integration tests for GET /analysis/mrp-increases
 *
 * Verifies that the effectivePeriod query parameter correctly controls which
 * mrp_price_history rows are considered as "current" and "previous" when
 * computing MRP increases.
 *
 * Isolation strategy
 * ------------------
 * The route orders results by change_pct DESC and caps at limit=200. To avoid
 * our seeded item being crowded out by real data, every request passes a
 * sentinel division value (unique per test run via the test's item_code). The
 * route's optional division filter narrows the SQL JOIN so only our one test
 * item ever appears in the result set.
 *
 * Seeded scenario:
 *   dateOld = (year-3)-01-01   mrp = 1
 *   dateMid = (year-2)-01-01   mrp = 100    ← past-period cutoff stops here
 *   dateNew = (year-1)-01-01   mrp = 1000   ← always ≤ today
 *
 * With effectivePeriod=cutoffPast (between dateMid and dateNew):
 *   rn=1 → 100 (current), prev → 1  →  change_pct = 9900%
 *
 * Without effectivePeriod (ceiling = today, ≥ dateNew):
 *   rn=1 → 1000 (current), prev → 100  →  change_pct = 900%
 *
 * Prerequisites: DATABASE_URL must be set (standard in the Replit environment).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import supertest from "supertest";
import { eq } from "drizzle-orm";
import { db, catalogProductsTable, mrpPriceHistoryTable } from "@workspace/db";
import analysisRouter from "./analysis.js";

// Mount the analysis router on a minimal Express app (no auth guard needed —
// the route handlers do not call req.isAuthenticated()).
const testApp = express();
testApp.use(express.json());
testApp.use(analysisRouter);

const request = supertest(testApp);

// ---------------------------------------------------------------------------
// Build effective_dates relative to the server's real clock so the tests work
// regardless of the environment's system date.
// ---------------------------------------------------------------------------

function yearOffset(offset: number): string {
  const year = new Date().getFullYear() + offset;
  return `${year}-01-01`;
}

const dateOld = yearOffset(-3); // (year-3)-01-01
const dateMid = yearOffset(-2); // (year-2)-01-01
const dateNew = yearOffset(-1); // (year-1)-01-01  — always ≤ today

// Past-period cutoff: between dateMid and dateNew (mid-year in the dateMid year).
const cutoffPast = `${new Date().getFullYear() - 2}-06-01`;
// Cutoff well before all rows.
const cutoffWayBefore = `${new Date().getFullYear() - 4}-06-01`;
// Cutoff that includes only dateOld.
const cutoffOnlyOld = `${new Date().getFullYear() - 3}-06-01`;

// ---------------------------------------------------------------------------
// Per-test state
// ---------------------------------------------------------------------------

let itemCode: string;
let catalogId: number;
// Sentinel division: unique per test run so the ?division= filter isolates
// exactly our seeded item and ignores every real row in the shared database.
let sentinelDivision: string;
let testSeq = 0;

beforeEach(async () => {
  testSeq++;
  itemCode = `__TEST_MRPINC_${Date.now()}_${testSeq}__`;
  sentinelDivision = `__DIV_MRPINC_${Date.now()}_${testSeq}__`;

  // Insert a minimal catalog_products row so the route's JOIN resolves.
  const [cat] = await db
    .insert(catalogProductsTable)
    .values({
      itemCode,
      productName: "Test Bib Cock 15mm",
      division: sentinelDivision, // unique sentinel — real rows never match this
      category: "Bib Cock",
    })
    .returning({ id: catalogProductsTable.id });
  catalogId = cat!.id;

  // Three price-history rows. MRP 1 → 100 → 1000 produces outlier change-pcts
  // (9900% and 900%) that dominate even a small result set.
  await db.insert(mrpPriceHistoryTable).values([
    {
      itemCode,
      mrp: 1,
      effectiveDate: dateOld,
      loadDate: dateOld,
      isCurrent: false,
      priceBasis: "MRP",
    },
    {
      itemCode,
      mrp: 100,
      effectiveDate: dateMid,
      loadDate: dateMid,
      isCurrent: false,
      priceBasis: "MRP",
    },
    {
      itemCode,
      mrp: 1000,
      effectiveDate: dateNew,
      loadDate: dateNew,
      isCurrent: true,
      priceBasis: "MRP",
    },
  ]);
});

afterEach(async () => {
  await db
    .delete(mrpPriceHistoryTable)
    .where(eq(mrpPriceHistoryTable.itemCode, itemCode));
  await db
    .delete(catalogProductsTable)
    .where(eq(catalogProductsTable.id, catalogId));
});

// ---------------------------------------------------------------------------
// Helper: locate our seeded item in the response
// ---------------------------------------------------------------------------

function findItem(body: {
  items: Array<{ itemCode: string; currentMrp: number; prevMrp: number; changePct: number }>;
}) {
  return body.items.find((i) => i.itemCode === itemCode) ?? null;
}

// ---------------------------------------------------------------------------
// Tests: past effectivePeriod cuts off the newest row
// ---------------------------------------------------------------------------

describe("GET /analysis/mrp-increases — with a past effectivePeriod", () => {
  // cutoffPast sits between dateMid and dateNew, so only dateOld and dateMid qualify.
  // The ?division= sentinel ensures only our test item appears in the result.
  // change_pct = (100 - 1) / 1 * 100 = 9900%

  const qs = () =>
    `/analysis/mrp-increases?effectivePeriod=${cutoffPast}&division=${encodeURIComponent(sentinelDivision)}`;

  it("returns the item using the dateMid row as current (mrp=100)", async () => {
    const res = await request.get(qs());

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);

    const item = findItem(res.body);
    expect(item).not.toBeNull();
    expect(item!.currentMrp).toBe(100);
  });

  it("computes prevMrp from the dateOld row (mrp=1)", async () => {
    const res = await request.get(qs());

    const item = findItem(res.body);
    expect(item).not.toBeNull();
    expect(item!.prevMrp).toBe(1);
  });

  it("computes change_pct = 9900% (1 → 100)", async () => {
    const res = await request.get(qs());

    const item = findItem(res.body);
    expect(item).not.toBeNull();
    expect(item!.changePct).toBeCloseTo(9900, 0);
  });

  it("does NOT include the dateNew row (mrp=1000) — it is beyond the cutoff", async () => {
    // If the dateNew row leaked in, currentMrp would be 1000.
    const res = await request.get(qs());

    const item = findItem(res.body);
    expect(item).not.toBeNull();
    expect(item!.currentMrp).not.toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// Tests: no effectivePeriod uses today as the ceiling
// ---------------------------------------------------------------------------

describe("GET /analysis/mrp-increases — without effectivePeriod", () => {
  // dateNew = (year-1)-01-01 is always ≤ today, so all three rows qualify.
  // The ?division= sentinel ensures only our test item appears in the result.
  // change_pct = (1000 - 100) / 100 * 100 = 900%

  const url = () =>
    `/analysis/mrp-increases?division=${encodeURIComponent(sentinelDivision)}`;

  it("returns the dateNew row as current (mrp=1000)", async () => {
    const res = await request.get(url());

    expect(res.status).toBe(200);
    const item = findItem(res.body);
    expect(item).not.toBeNull();
    expect(item!.currentMrp).toBe(1000);
  });

  it("computes prevMrp from the dateMid row (mrp=100)", async () => {
    const res = await request.get(url());

    const item = findItem(res.body);
    expect(item).not.toBeNull();
    expect(item!.prevMrp).toBe(100);
  });

  it("computes change_pct = 900% (100 → 1000)", async () => {
    const res = await request.get(url());

    const item = findItem(res.body);
    expect(item).not.toBeNull();
    expect(item!.changePct).toBeCloseTo(900, 0);
  });

  it("picks dateNew as current, not dateMid (confirms today >= dateNew)", async () => {
    // With a past cutoff the item's currentMrp was 100 (dateMid); without the
    // param it must be 1000 (dateNew) — proving today's ceiling is later.
    const res = await request.get(url());

    const item = findItem(res.body);
    expect(item).not.toBeNull();
    expect((item as any).currentDate).toBe(dateNew);
  });
});

// ---------------------------------------------------------------------------
// Tests: effectivePeriod before any seeded row → item does not appear
// ---------------------------------------------------------------------------

describe("GET /analysis/mrp-increases — effectivePeriod before all rows", () => {
  it("does not return the item when the ceiling precedes all effective_dates", async () => {
    const res = await request.get(
      `/analysis/mrp-increases?effectivePeriod=${cutoffWayBefore}&division=${encodeURIComponent(sentinelDivision)}`,
    );

    expect(res.status).toBe(200);
    // 0 qualifying rows → LAG has nothing → WHERE r.prev_mrp IS NOT NULL fails.
    expect(findItem(res.body)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests: effectivePeriod that matches exactly one row → no previous → no result
// ---------------------------------------------------------------------------

describe("GET /analysis/mrp-increases — only one qualifying row (no previous)", () => {
  it("does not return the item when there is no previous row to compare against", async () => {
    // cutoffOnlyOld captures exactly dateOld (mrp=1).
    // With a single row LAG returns NULL → WHERE r.prev_mrp IS NOT NULL excludes it.
    const res = await request.get(
      `/analysis/mrp-increases?effectivePeriod=${cutoffOnlyOld}&division=${encodeURIComponent(sentinelDivision)}`,
    );

    expect(res.status).toBe(200);
    expect(findItem(res.body)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests: ?division= filter — excludes items from other divisions
//
// The outer beforeEach seeds itemA in sentinelDivision. Each test here seeds a
// second item (itemB) in an independent sentinelDivisionB and verifies that
// querying by one sentinel yields only that division's item.
// ---------------------------------------------------------------------------

describe("GET /analysis/mrp-increases — division filter narrows results", () => {
  let itemCodeB: string;
  let catalogIdB: number;
  let sentinelDivisionB: string;

  beforeEach(async () => {
    // sentinelDivisionB is guaranteed to be different from sentinelDivision set
    // up in the outer beforeEach because it embeds a distinct suffix.
    sentinelDivisionB = `__DIV_B_MRPINC_${Date.now()}_${testSeq}__`;
    itemCodeB = `__TEST_MRPINC_B_${Date.now()}_${testSeq}__`;

    const [cat] = await db
      .insert(catalogProductsTable)
      .values({
        itemCode: itemCodeB,
        productName: "Other Division Product 15mm",
        division: sentinelDivisionB,
        category: "Ball Valve",
      })
      .returning({ id: catalogProductsTable.id });
    catalogIdB = cat!.id;

    // Same MRP pattern (1 → 1000) so itemB also qualifies as an "increase" row.
    await db.insert(mrpPriceHistoryTable).values([
      {
        itemCode: itemCodeB,
        mrp: 1,
        effectiveDate: dateOld,
        loadDate: dateOld,
        isCurrent: false,
        priceBasis: "MRP",
      },
      {
        itemCode: itemCodeB,
        mrp: 1000,
        effectiveDate: dateNew,
        loadDate: dateNew,
        isCurrent: true,
        priceBasis: "MRP",
      },
    ]);
  });

  afterEach(async () => {
    await db
      .delete(mrpPriceHistoryTable)
      .where(eq(mrpPriceHistoryTable.itemCode, itemCodeB));
    await db
      .delete(catalogProductsTable)
      .where(eq(catalogProductsTable.id, catalogIdB));
  });

  it("returns only the item from the requested division", async () => {
    const res = await request.get(
      `/analysis/mrp-increases?division=${encodeURIComponent(sentinelDivision)}`,
    );

    expect(res.status).toBe(200);
    const items: Array<{ itemCode: string }> = res.body.items;

    // Our primary (sentinelDivision) item must appear.
    expect(items.some((i) => i.itemCode === itemCode)).toBe(true);
    // The other-division item must NOT appear.
    expect(items.some((i) => i.itemCode === itemCodeB)).toBe(false);
  });

  it("returns only itemB when filtering by the other division", async () => {
    const res = await request.get(
      `/analysis/mrp-increases?division=${encodeURIComponent(sentinelDivisionB)}`,
    );

    expect(res.status).toBe(200);
    const items: Array<{ itemCode: string }> = res.body.items;

    expect(items.some((i) => i.itemCode === itemCodeB)).toBe(true);
    expect(items.some((i) => i.itemCode === itemCode)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: ?category= filter — excludes items from other categories
//
// The outer beforeEach seeds itemA (category="Bib Cock") inside sentinelDivision.
// Each test here seeds itemB (category="Gate Valve") in the SAME sentinelDivision
// so both would appear without a category filter — then verifies that adding
// ?category= trims the result to just the matching category.
// ---------------------------------------------------------------------------

describe("GET /analysis/mrp-increases — category filter narrows results", () => {
  let itemCodeC: string;
  let catalogIdC: number;
  const altCategory = "Gate Valve";

  beforeEach(async () => {
    itemCodeC = `__TEST_MRPINC_C_${Date.now()}_${testSeq}__`;

    // Same sentinelDivision as itemA so both appear without a category filter.
    const [cat] = await db
      .insert(catalogProductsTable)
      .values({
        itemCode: itemCodeC,
        productName: "Gate Valve 20mm",
        division: sentinelDivision,
        category: altCategory,
      })
      .returning({ id: catalogProductsTable.id });
    catalogIdC = cat!.id;

    await db.insert(mrpPriceHistoryTable).values([
      {
        itemCode: itemCodeC,
        mrp: 1,
        effectiveDate: dateOld,
        loadDate: dateOld,
        isCurrent: false,
        priceBasis: "MRP",
      },
      {
        itemCode: itemCodeC,
        mrp: 1000,
        effectiveDate: dateNew,
        loadDate: dateNew,
        isCurrent: true,
        priceBasis: "MRP",
      },
    ]);
  });

  afterEach(async () => {
    await db
      .delete(mrpPriceHistoryTable)
      .where(eq(mrpPriceHistoryTable.itemCode, itemCodeC));
    await db
      .delete(catalogProductsTable)
      .where(eq(catalogProductsTable.id, catalogIdC));
  });

  it("without category filter: both items appear under the shared sentinel division", async () => {
    const res = await request.get(
      `/analysis/mrp-increases?division=${encodeURIComponent(sentinelDivision)}`,
    );

    expect(res.status).toBe(200);
    const items: Array<{ itemCode: string }> = res.body.items;
    expect(items.some((i) => i.itemCode === itemCode)).toBe(true);
    expect(items.some((i) => i.itemCode === itemCodeC)).toBe(true);
  });

  it("?category=Bib Cock returns only itemA, not the Gate Valve item", async () => {
    const res = await request.get(
      `/analysis/mrp-increases?division=${encodeURIComponent(sentinelDivision)}&category=${encodeURIComponent("Bib Cock")}`,
    );

    expect(res.status).toBe(200);
    const items: Array<{ itemCode: string }> = res.body.items;
    expect(items.some((i) => i.itemCode === itemCode)).toBe(true);
    expect(items.some((i) => i.itemCode === itemCodeC)).toBe(false);
  });

  it("?category=Gate Valve returns only itemC, not the Bib Cock item", async () => {
    const res = await request.get(
      `/analysis/mrp-increases?division=${encodeURIComponent(sentinelDivision)}&category=${encodeURIComponent(altCategory)}`,
    );

    expect(res.status).toBe(200);
    const items: Array<{ itemCode: string }> = res.body.items;
    expect(items.some((i) => i.itemCode === itemCodeC)).toBe(true);
    expect(items.some((i) => i.itemCode === itemCode)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: division + category combined — must satisfy both predicates
// ---------------------------------------------------------------------------

describe("GET /analysis/mrp-increases — combined division + category filter", () => {
  let itemCodeD: string; // same division as itemA, different category
  let catalogIdD: number;
  let itemCodeE: string; // different division, same category as itemA
  let catalogIdE: number;
  let sentinelDivisionE: string;

  beforeEach(async () => {
    sentinelDivisionE = `__DIV_E_MRPINC_${Date.now()}_${testSeq}__`;
    itemCodeD = `__TEST_MRPINC_D_${Date.now()}_${testSeq}__`;
    itemCodeE = `__TEST_MRPINC_E_${Date.now()}_${testSeq}__`;

    // itemD: same division as itemA (sentinelDivision), different category.
    const [catD] = await db
      .insert(catalogProductsTable)
      .values({
        itemCode: itemCodeD,
        productName: "Stop Cock 15mm",
        division: sentinelDivision,
        category: "Stop Cock",
      })
      .returning({ id: catalogProductsTable.id });
    catalogIdD = catD!.id;

    // itemE: different division, same category as itemA ("Bib Cock").
    const [catE] = await db
      .insert(catalogProductsTable)
      .values({
        itemCode: itemCodeE,
        productName: "Bib Cock 15mm",
        division: sentinelDivisionE,
        category: "Bib Cock",
      })
      .returning({ id: catalogProductsTable.id });
    catalogIdE = catE!.id;

    const priceRows = (code: string) => [
      {
        itemCode: code,
        mrp: 1,
        effectiveDate: dateOld,
        loadDate: dateOld,
        isCurrent: false,
        priceBasis: "MRP" as const,
      },
      {
        itemCode: code,
        mrp: 1000,
        effectiveDate: dateNew,
        loadDate: dateNew,
        isCurrent: true,
        priceBasis: "MRP" as const,
      },
    ];

    await db.insert(mrpPriceHistoryTable).values([
      ...priceRows(itemCodeD),
      ...priceRows(itemCodeE),
    ]);
  });

  afterEach(async () => {
    await db
      .delete(mrpPriceHistoryTable)
      .where(eq(mrpPriceHistoryTable.itemCode, itemCodeD));
    await db
      .delete(mrpPriceHistoryTable)
      .where(eq(mrpPriceHistoryTable.itemCode, itemCodeE));
    await db
      .delete(catalogProductsTable)
      .where(eq(catalogProductsTable.id, catalogIdD));
    await db
      .delete(catalogProductsTable)
      .where(eq(catalogProductsTable.id, catalogIdE));
  });

  it("?division=A&category=Bib Cock returns only itemA — not same-div/diff-cat or same-cat/diff-div", async () => {
    const res = await request.get(
      `/analysis/mrp-increases?division=${encodeURIComponent(sentinelDivision)}&category=${encodeURIComponent("Bib Cock")}`,
    );

    expect(res.status).toBe(200);
    const items: Array<{ itemCode: string }> = res.body.items;

    // itemA (sentinelDivision + Bib Cock) must appear.
    expect(items.some((i) => i.itemCode === itemCode)).toBe(true);
    // itemD (sentinelDivision + Stop Cock) must NOT appear — wrong category.
    expect(items.some((i) => i.itemCode === itemCodeD)).toBe(false);
    // itemE (sentinelDivisionE + Bib Cock) must NOT appear — wrong division.
    expect(items.some((i) => i.itemCode === itemCodeE)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: price DECREASE — must never appear in MRP Increases
// ---------------------------------------------------------------------------

describe("GET /analysis/mrp-increases — price decrease is excluded", () => {
  // Seed an independent product (separate item code / catalog row) whose MRP
  // went DOWN: 100 → 50.  The WHERE r.mrp > r.prev_mrp clause must reject it.

  let decItemCode: string;
  let decCatalogId: number;
  let decDivision: string;

  beforeEach(async () => {
    decItemCode = `__TEST_MRPDEC_${Date.now()}__`;
    decDivision = `__DIV_MRPDEC_${Date.now()}__`;

    const [cat] = await db
      .insert(catalogProductsTable)
      .values({
        itemCode: decItemCode,
        productName: "Test Ball Valve 25mm",
        division: decDivision,
        category: "Ball Valve",
      })
      .returning({ id: catalogProductsTable.id });
    decCatalogId = cat!.id;

    // Two rows: MRP 100 → 50 (a decrease).
    await db.insert(mrpPriceHistoryTable).values([
      {
        itemCode: decItemCode,
        mrp: 100,
        effectiveDate: dateMid,
        loadDate: dateMid,
        isCurrent: false,
        priceBasis: "MRP",
      },
      {
        itemCode: decItemCode,
        mrp: 50,
        effectiveDate: dateNew,
        loadDate: dateNew,
        isCurrent: true,
        priceBasis: "MRP",
      },
    ]);
  });

  afterEach(async () => {
    await db
      .delete(mrpPriceHistoryTable)
      .where(eq(mrpPriceHistoryTable.itemCode, decItemCode));
    await db
      .delete(catalogProductsTable)
      .where(eq(catalogProductsTable.id, decCatalogId));
  });

  it("does not return the item when MRP went down (100 → 50)", async () => {
    const res = await request.get(
      `/analysis/mrp-increases?division=${encodeURIComponent(decDivision)}`,
    );

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    const found = res.body.items.find(
      (i: { itemCode: string }) => i.itemCode === decItemCode,
    );
    expect(found).toBeUndefined();
  });

  it("does not return the item even when an effectivePeriod is supplied (100 → 50)", async () => {
    const res = await request.get(
      `/analysis/mrp-increases?effectivePeriod=${dateNew}&division=${encodeURIComponent(decDivision)}`,
    );

    expect(res.status).toBe(200);
    const found = res.body.items.find(
      (i: { itemCode: string }) => i.itemCode === decItemCode,
    );
    expect(found).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: unchanged price — must never appear in MRP Increases
// ---------------------------------------------------------------------------

describe("GET /analysis/mrp-increases — unchanged price is excluded", () => {
  // Seed an independent product whose MRP stayed the same: 100 → 100.
  // The WHERE r.mrp > r.prev_mrp clause (strict greater-than) must reject it.

  let flatItemCode: string;
  let flatCatalogId: number;
  let flatDivision: string;

  beforeEach(async () => {
    flatItemCode = `__TEST_MRPFLAT_${Date.now()}__`;
    flatDivision = `__DIV_MRPFLAT_${Date.now()}__`;

    const [cat] = await db
      .insert(catalogProductsTable)
      .values({
        itemCode: flatItemCode,
        productName: "Test Gate Valve 20mm",
        division: flatDivision,
        category: "Gate Valve",
      })
      .returning({ id: catalogProductsTable.id });
    flatCatalogId = cat!.id;

    // Two rows: MRP 100 → 100 (no change).
    await db.insert(mrpPriceHistoryTable).values([
      {
        itemCode: flatItemCode,
        mrp: 100,
        effectiveDate: dateMid,
        loadDate: dateMid,
        isCurrent: false,
        priceBasis: "MRP",
      },
      {
        itemCode: flatItemCode,
        mrp: 100,
        effectiveDate: dateNew,
        loadDate: dateNew,
        isCurrent: true,
        priceBasis: "MRP",
      },
    ]);
  });

  afterEach(async () => {
    await db
      .delete(mrpPriceHistoryTable)
      .where(eq(mrpPriceHistoryTable.itemCode, flatItemCode));
    await db
      .delete(catalogProductsTable)
      .where(eq(catalogProductsTable.id, flatCatalogId));
  });

  it("does not return the item when MRP stayed the same (100 → 100)", async () => {
    const res = await request.get(
      `/analysis/mrp-increases?division=${encodeURIComponent(flatDivision)}`,
    );

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    const found = res.body.items.find(
      (i: { itemCode: string }) => i.itemCode === flatItemCode,
    );
    expect(found).toBeUndefined();
  });

  it("does not return the item even when an effectivePeriod is supplied (100 → 100)", async () => {
    const res = await request.get(
      `/analysis/mrp-increases?effectivePeriod=${dateNew}&division=${encodeURIComponent(flatDivision)}`,
    );

    expect(res.status).toBe(200);
    const found = res.body.items.find(
      (i: { itemCode: string }) => i.itemCode === flatItemCode,
    );
    expect(found).toBeUndefined();
  });
});
