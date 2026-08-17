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
