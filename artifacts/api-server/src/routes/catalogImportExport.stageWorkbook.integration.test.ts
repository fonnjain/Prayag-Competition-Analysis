/**
 * Database-backed coverage for the non-PDF competitor workbook review flow.
 * Every fixture is uniquely named and removed in afterEach so this test never
 * shares rows with ordinary catalogue or competitor data.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import supertest from "supertest";
import { eq, inArray } from "drizzle-orm";
import {
  catalogProductsTable,
  competitorPricesTable,
  competitorPriceStagingTable,
  db,
  importBatchesTable,
} from "@workspace/db";
import catalogRouter from "./catalogImportExport.js";
import importBatchesRouter from "./importBatches.js";

const app = express();
app.use(express.json());
app.use(catalogRouter);
app.use(importBatchesRouter);
const request = supertest(app);

let competitor = "";
let effectiveDate = "";
let itemCodes: string[] = [];

beforeEach(async () => {
  const run = `${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
  competitor = `__test_workbook_stage_${run}__`;
  // A future period is isolated from normal effective-date imports as an
  // additional safeguard, while the unique competitor is the primary scope.
  effectiveDate = "2099-12-31";
  itemCodes = Array.from({ length: 5 }, (_, index) => `__TWS_${run}_${index + 1}__`);
  await db.insert(catalogProductsTable).values(
    itemCodes.map((itemCode) => ({
      itemCode,
      productName: `Workbook staging fixture ${itemCode}`,
      isActive: true,
    })),
  );
});

afterEach(async () => {
  if (competitor) {
    const batches = await db
      .select({ id: importBatchesTable.id })
      .from(importBatchesTable)
      .where(eq(importBatchesTable.competitor, competitor));
    if (batches.length) {
      await db.delete(competitorPriceStagingTable)
        .where(inArray(competitorPriceStagingTable.batchId, batches.map((batch) => batch.id)));
    }
    await db.delete(importBatchesTable).where(eq(importBatchesTable.competitor, competitor));
    await db.delete(competitorPricesTable).where(eq(competitorPricesTable.competitor, competitor));
  }
  if (itemCodes.length) {
    await db.delete(catalogProductsTable).where(inArray(catalogProductsTable.itemCode, itemCodes));
  }
  competitor = "";
  itemCodes = [];
});

function workbookCsv(): Buffer {
  const rows = itemCodes.map((itemCode, index) =>
    `${itemCode},Fixture product ${index + 1},${100 + index * 10}`,
  );
  return Buffer.from(["Prayag Code,Description,MRP", ...rows].join("\n"));
}

async function stageWorkbook() {
  return request
    .post("/catalog/stage-competitor-workbook")
    .field("competitor", competitor)
    .field("effectiveDate", effectiveDate)
    .field("priceBasis", "MRP")
    .attach("file", workbookCsv(), {
      filename: "competitor-prices.csv",
      contentType: "text/csv",
    });
}

async function committedRows() {
  return db.select().from(competitorPricesTable)
    .where(eq(competitorPricesTable.competitor, competitor));
}

describe("staged competitor workbook import", () => {
  it("persists a pending CSV preview without changing prices, then commits only on approval", async () => {
    const beforeUpload = await committedRows();
    expect(beforeUpload).toHaveLength(0);

    const staged = await stageWorkbook();
    expect(staged.status).toBe(201);
    expect(staged.body).toMatchObject({ status: "pending", batchIds: [staged.body.batchId] });
    expect(staged.body.batchId).toEqual(expect.any(Number));

    // Staging is not a write to the live price table.
    expect(await committedRows()).toHaveLength(beforeUpload.length);

    // The durable GET endpoint is what makes preview survive navigation/reload.
    const preview = await request.get(`/catalog/import-batches/${staged.body.batchId}`);
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({
      id: staged.body.batchId,
      competitor,
      effectiveDate,
      status: "pending",
      rowCounts: { ok: 5, needs_review: 0, not_found: 0, new_products: 0 },
    });
    expect(preview.body.rows).toHaveLength(5);
    expect(preview.body.rows.map((row: { matchedPrayagCode: string }) => row.matchedPrayagCode)
      .sort()).toEqual([...itemCodes].sort());

    const approved = await request.post(`/catalog/import-batches/${staged.body.batchId}/approve`);
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({ ok: true, committed: 5 });

    const committed = await committedRows();
    expect(committed).toHaveLength(5);
    expect(committed.map((row) => row.effectiveDate)).toEqual(
      Array(5).fill(effectiveDate),
    );
    expect(committed.map((row) => Number(row.price)).sort((a, b) => a - b))
      .toEqual([100, 110, 120, 130, 140]);
  });

  it("discarding a staged CSV batch deletes its preview and writes no live prices", async () => {
    const beforeUpload = await committedRows();
    const staged = await stageWorkbook();
    expect(staged.status).toBe(201);

    expect(await committedRows()).toHaveLength(beforeUpload.length);
    const discarded = await request.delete(`/catalog/import-batches/${staged.body.batchId}`);
    expect(discarded.status).toBe(200);
    expect(discarded.body).toEqual({ ok: true });
    expect(await committedRows()).toHaveLength(beforeUpload.length);

    const preview = await request.get(`/catalog/import-batches/${staged.body.batchId}`);
    expect(preview.status).toBe(200);
    expect(preview.body.status).toBe("discarded");
    expect(preview.body.rows).toHaveLength(0);
  });
});