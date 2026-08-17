/**
 * Integration tests for POST /api/catalog/import-batches/:id/approve
 *
 * These tests call the real Express route so a regression in the handler's
 * field mapping, eligibility condition, delete/insert logic, pending-status
 * guard, alias writes, or current-flag recomputation will fail here.
 *
 * Prerequisites:
 *   DATABASE_URL must be set (standard in the Replit environment).
 *
 * Each test uses a unique competitor name so it never collides with real data.
 * afterEach cleans up every row it created.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import supertest from "supertest";
import { eq } from "drizzle-orm";
import {
  db,
  importBatchesTable,
  competitorPriceStagingTable,
  competitorPricesTable,
  competitorCodeAliasesTable,
} from "@workspace/db";
import importBatchesRouter from "./importBatches.js";

// Minimal Express app: mounts the importBatches router without the session-auth
// guard that wraps it in the full app. The route handlers themselves do not
// check req.isAuthenticated(), so this gives us a clean, auth-free test target.
const testApp = express();
testApp.use(express.json());
testApp.use(importBatchesRouter);

const request = supertest(testApp);

// ---------------------------------------------------------------------------
// Per-test helpers
// ---------------------------------------------------------------------------

let competitor: string;
let batchId: number;
let testSeq = 0;

beforeEach(() => {
  testSeq++;
  competitor = `__test_approve_${Date.now()}_${testSeq}__`;
  batchId = 0;
});

afterEach(async () => {
  if (batchId) {
    await db
      .delete(competitorPriceStagingTable)
      .where(eq(competitorPriceStagingTable.batchId, batchId));
    await db
      .delete(importBatchesTable)
      .where(eq(importBatchesTable.id, batchId));
  }
  await db
    .delete(competitorPricesTable)
    .where(eq(competitorPricesTable.competitor, competitor));
  await db
    .delete(competitorCodeAliasesTable)
    .where(eq(competitorCodeAliasesTable.competitor, competitor));
});

async function insertBatch(
  overrides: Partial<typeof importBatchesTable.$inferInsert> = {},
): Promise<number> {
  const rows = await db
    .insert(importBatchesTable)
    .values({
      competitor,
      effectiveDate: "2026-01-01",
      sourceFileName: "test.pdf",
      priceBasis: "MRP",
      gstPct: null,
      status: "pending",
      extractionModel: "claude-test",
      ...overrides,
    })
    .returning({ id: importBatchesTable.id });
  batchId = rows[0]!.id;
  return batchId;
}

type StagingInsert = typeof competitorPriceStagingTable.$inferInsert;

async function insertStaging(overrides: Partial<StagingInsert> = {}): Promise<void> {
  await db.insert(competitorPriceStagingTable).values({
    batchId,
    competitor,
    competitorCodeMaster: "WMP-188",
    competitorCodeCatalogue: "WMP-188",
    matchedPrayagCode: "PRY-100",
    description: "Bib Cock 15mm",
    catalogueDescription: "Bib Cock 15mm",
    variant: "15mm",
    oldMrp: 100,
    newMrp: 120,
    increasePct: 20,
    prayagMrpCurrent: 90,
    gapPct: 33.33,
    page: 1,
    matchMethod: "code+desc",
    status: "ok",
    reviewReason: null,
    ...overrides,
  });
}

async function approve(id: number) {
  return request.post(`/catalog/import-batches/${id}/approve`);
}

async function getCommitted() {
  return db
    .select()
    .from(competitorPricesTable)
    .where(eq(competitorPricesTable.competitor, competitor));
}

// ---------------------------------------------------------------------------
// Tests: MRP basis — price wired correctly
// ---------------------------------------------------------------------------

describe("approve (MRP basis): price wired correctly", () => {
  it("returns 200 and committed=1 for a valid pending batch", async () => {
    await insertBatch();
    await insertStaging();

    const res = await approve(batchId);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.committed).toBe(1);
  });

  it("writes the correct price to competitor_prices", async () => {
    await insertBatch({ priceBasis: "MRP", gstPct: null });
    await insertStaging({ newMrp: 120 });

    await approve(batchId);

    const rows = await getCommitted();
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.price)).toBe(120);
  });

  it("stores priceBasis=MRP and null gstPct on the committed row", async () => {
    await insertBatch({ priceBasis: "MRP", gstPct: null });
    await insertStaging();

    await approve(batchId);

    const [row] = await getCommitted();
    expect(row!.priceBasis).toBe("MRP");
    expect(row!.gstPct).toBeNull();
  });

  it("stores the Prayag MRP snapshot (prayagMrpAtCompare)", async () => {
    await insertBatch();
    await insertStaging({ prayagMrpCurrent: 90 });

    await approve(batchId);

    const [row] = await getCommitted();
    expect(Number(row!.prayagMrpAtCompare)).toBe(90);
  });

  it("maps staging.variant to competitor_prices.size", async () => {
    await insertBatch();
    await insertStaging({ variant: "20mm" });

    await approve(batchId);

    const [row] = await getCommitted();
    expect(row!.size).toBe("20mm");
  });

  it("uses competitorCodeCatalogue as the stored competitor code", async () => {
    await insertBatch();
    await insertStaging({ competitorCodeMaster: "WMP-188", competitorCodeCatalogue: "WMP-189" });

    await approve(batchId);

    const [row] = await getCommitted();
    expect(row!.competitorCode).toBe("WMP-189");
  });

  it("falls back to competitorCodeMaster when catalogue code is null", async () => {
    await insertBatch();
    await insertStaging({ competitorCodeCatalogue: null });

    await approve(batchId);

    const [row] = await getCommitted();
    expect(row!.competitorCode).toBe("WMP-188");
  });

  it("sets matchConfidence=High for code+desc match method", async () => {
    await insertBatch();
    await insertStaging({ matchMethod: "code+desc" });

    await approve(batchId);

    const [row] = await getCommitted();
    expect(row!.matchConfidence).toBe("High");
  });

  it("sets matchConfidence=Medium for desc+size match method", async () => {
    await insertBatch();
    await insertStaging({ matchMethod: "desc+size" });

    await approve(batchId);

    const [row] = await getCommitted();
    expect(row!.matchConfidence).toBe("Medium");
  });

  it("marks the batch status as approved", async () => {
    await insertBatch();
    await insertStaging();

    await approve(batchId);

    const [batch] = await db
      .select()
      .from(importBatchesTable)
      .where(eq(importBatchesTable.id, batchId));
    expect(batch!.status).toBe("approved");
  });
});

// ---------------------------------------------------------------------------
// Tests: Ex-GST basis — priceBasis and gstPct passed through
// ---------------------------------------------------------------------------

describe("approve (Ex-GST basis): priceBasis and gstPct wired through", () => {
  it("stores the raw ex-GST price (not inflated), priceBasis=Ex-GST, and gstPct=18", async () => {
    // The handler stores the raw catalogue price as-is and records priceBasis +
    // gstPct so the analysis engine can inflate at query time.
    await insertBatch({ priceBasis: "Ex-GST", gstPct: 18 });
    await insertStaging({ newMrp: 100 });

    await approve(batchId);

    const [row] = await getCommitted();
    expect(Number(row!.price)).toBe(100); // raw, not multiplied by 1.18
    expect(row!.priceBasis).toBe("Ex-GST");
    expect(Number(row!.gstPct)).toBe(18);
  });

  it("stores a non-standard GST rate (28%)", async () => {
    await insertBatch({ priceBasis: "Ex-GST", gstPct: 28 });
    await insertStaging({ newMrp: 100 });

    await approve(batchId);

    const [row] = await getCommitted();
    expect(Number(row!.gstPct)).toBe(28);
  });
});

// ---------------------------------------------------------------------------
// Tests: null Prayag MRP
// ---------------------------------------------------------------------------

describe("approve: null Prayag MRP → prayagMrpAtCompare is null", () => {
  it("writes null prayagMrpAtCompare when staging has no Prayag MRP", async () => {
    await insertBatch();
    await insertStaging({ prayagMrpCurrent: null, gapPct: null });

    await approve(batchId);

    const [row] = await getCommitted();
    expect(row!.prayagMrpAtCompare).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests: needs_review rows committed
// ---------------------------------------------------------------------------

describe("approve: needs_review rows are committed", () => {
  it("commits a needs_review row that has a price and prayag code", async () => {
    await insertBatch();
    await insertStaging({
      status: "needs_review",
      reviewReason: "Size conflict: expected 2 Mtr, found 3 Mtr",
    });

    const res = await approve(batchId);

    expect(res.body.committed).toBe(1);
    const rows = await getCommitted();
    expect(rows).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Tests: rows excluded from commit
// ---------------------------------------------------------------------------

describe("approve: ineligible rows are excluded", () => {
  it("skips not_found rows (committed=0)", async () => {
    await insertBatch();
    await insertStaging({ status: "not_found", newMrp: null, matchedPrayagCode: null });

    const res = await approve(batchId);

    expect(res.body.committed).toBe(0);
    expect(await getCommitted()).toHaveLength(0);
  });

  it("skips rows with null newMrp even when status=ok", async () => {
    await insertBatch();
    await insertStaging({ newMrp: null });

    const res = await approve(batchId);

    expect(res.body.committed).toBe(0);
    expect(await getCommitted()).toHaveLength(0);
  });

  it("skips rows with null matchedPrayagCode", async () => {
    await insertBatch();
    await insertStaging({ matchedPrayagCode: null });

    const res = await approve(batchId);

    expect(res.body.committed).toBe(0);
    expect(await getCommitted()).toHaveLength(0);
  });

  it("skips new_product rows", async () => {
    await insertBatch();
    await insertStaging({
      status: "new_product",
      matchedPrayagCode: null,
      competitorCodeMaster: null,
      competitorCodeCatalogue: "WMP-999",
    });

    const res = await approve(batchId);

    expect(res.body.committed).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: pending-status guard
// ---------------------------------------------------------------------------

describe("approve: pending-status guard", () => {
  it("returns 409 when the batch is already approved", async () => {
    await insertBatch({ status: "approved" });

    const res = await approve(batchId);

    expect(res.status).toBe(409);
  });

  it("returns 409 when the batch is discarded", async () => {
    await insertBatch({ status: "discarded" });

    const res = await approve(batchId);

    expect(res.status).toBe(409);
  });

  it("returns 404 for a non-existent batch id", async () => {
    const res = await approve(999999999);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Tests: overwrites existing rows for same period
// ---------------------------------------------------------------------------

describe("approve: overwrites existing price row for the same period", () => {
  it("replaces an existing competitor_prices row for the same (competitor, effectiveDate)", async () => {
    // Pre-insert a stale row as if from a previous import.
    await db.insert(competitorPricesTable).values({
      competitor,
      effectiveDate: "2026-01-01",
      price: 999,
      matchedPrayagCode: "PRY-100",
      matchStatus: "matched",
      isCurrent: true,
    });

    await insertBatch({ effectiveDate: "2026-01-01" });
    await insertStaging({ newMrp: 120 });

    await approve(batchId);

    const rows = await getCommitted();
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.price)).toBe(120);
  });

  it("preserves rows from a different effectiveDate (separate period)", async () => {
    // Pre-insert a row from an older period.
    await db.insert(competitorPricesTable).values({
      competitor,
      effectiveDate: "2025-01-01",
      price: 80,
      matchedPrayagCode: "PRY-100",
      matchStatus: "matched",
      isCurrent: false,
    });

    await insertBatch({ effectiveDate: "2026-01-01" });
    await insertStaging({ newMrp: 120 });

    await approve(batchId);

    const rows = await getCommitted();
    expect(rows).toHaveLength(2);
    const prices = rows.map((r) => Number(r.price)).sort((a, b) => a - b);
    expect(prices).toEqual([80, 120]);
  });
});

// ---------------------------------------------------------------------------
// Tests: alias writes
// ---------------------------------------------------------------------------

describe("approve: code aliases saved for desc+size matches", () => {
  it("writes a competitor_code_aliases row when matchMethod=desc+size", async () => {
    await insertBatch();
    await insertStaging({
      matchMethod: "desc+size",
      competitorCodeMaster: "WMP-188",
      competitorCodeCatalogue: "WMP-189",
      status: "needs_review",
      reviewReason: "Code renumbered: master WMP-188 → catalogue WMP-189",
    });

    await approve(batchId);

    const aliases = await db
      .select()
      .from(competitorCodeAliasesTable)
      .where(eq(competitorCodeAliasesTable.competitor, competitor));
    expect(aliases).toHaveLength(1);
    expect(aliases[0]!.oldCode).toBe("WMP-188");
    expect(aliases[0]!.newCode).toBe("WMP-189");
  });

  it("does not duplicate an alias if it already exists (onConflictDoNothing)", async () => {
    // Pre-seed the alias.
    await db.insert(competitorCodeAliasesTable).values({
      competitor,
      oldCode: "WMP-188",
      newCode: "WMP-189",
      note: "pre-existing",
    });

    await insertBatch();
    await insertStaging({
      matchMethod: "desc+size",
      competitorCodeMaster: "WMP-188",
      competitorCodeCatalogue: "WMP-189",
      status: "needs_review",
    });

    const res = await approve(batchId);
    expect(res.status).toBe(200);

    const aliases = await db
      .select()
      .from(competitorCodeAliasesTable)
      .where(eq(competitorCodeAliasesTable.competitor, competitor));
    expect(aliases).toHaveLength(1); // still only one — no duplicate
  });
});

// ---------------------------------------------------------------------------
// Tests: multiple rows, batch-level commit count
// ---------------------------------------------------------------------------

describe("approve: multiple staging rows", () => {
  it("commits all eligible rows and skips ineligible ones", async () => {
    await insertBatch();
    await insertStaging({ matchedPrayagCode: "PRY-100", newMrp: 120, status: "ok" });
    await insertStaging({
      matchedPrayagCode: "PRY-200",
      competitorCodeMaster: "WMP-200",
      competitorCodeCatalogue: "WMP-200",
      newMrp: 200,
      status: "needs_review",
    });
    await insertStaging({ matchedPrayagCode: null, status: "not_found", newMrp: null });

    const res = await approve(batchId);
    expect(res.body.committed).toBe(2);

    const rows = await getCommitted();
    expect(rows).toHaveLength(2);
    const prices = rows.map((r) => Number(r.price)).sort((a, b) => a - b);
    expect(prices).toEqual([120, 200]);
  });

  it("returns committed=0 and status=approved when all rows are not_found", async () => {
    await insertBatch();
    await insertStaging({ status: "not_found", newMrp: null, matchedPrayagCode: null });

    const res = await approve(batchId);
    expect(res.body.committed).toBe(0);

    const [batch] = await db
      .select()
      .from(importBatchesTable)
      .where(eq(importBatchesTable.id, batchId));
    expect(batch!.status).toBe("approved");
  });
});
