import { afterEach, describe, expect, it } from "vitest";
import express from "express";
import supertest from "supertest";
import { eq } from "drizzle-orm";
import {
  competitorPriceStagingTable,
  db,
  importBatchesTable,
} from "@workspace/db";
import importBatchesRouter from "./importBatches.js";

const app = express();
app.use(express.json());
app.use(importBatchesRouter);
const request = supertest(app);

let competitor = "";

afterEach(async () => {
  if (!competitor) return;
  const batches = await db
    .select({ id: importBatchesTable.id })
    .from(importBatchesTable)
    .where(eq(importBatchesTable.competitor, competitor));
  for (const batch of batches) {
    await db
      .delete(competitorPriceStagingTable)
      .where(eq(competitorPriceStagingTable.batchId, batch.id));
  }
  await db.delete(importBatchesTable).where(eq(importBatchesTable.competitor, competitor));
  competitor = "";
});

function uploadPdf(effectiveDate?: string) {
  competitor = `__test_upload_date_${Date.now()}__`;
  const upload = request
    .post("/catalog/import-batches")
    .field("competitor", competitor)
    .field("priceBasis", "MRP")
    .attach("file", Buffer.from("%PDF-1.4\n% test fixture"), {
      filename: "fixture.pdf",
      contentType: "application/pdf",
    });
  return effectiveDate === undefined ? upload : upload.field("effectiveDate", effectiveDate);
}

async function assertNoBatchCreated() {
  const rows = await db
    .select({ id: importBatchesTable.id })
    .from(importBatchesTable)
    .where(eq(importBatchesTable.competitor, competitor));
  expect(rows).toHaveLength(0);
}

describe("PDF catalogue upload effective date", () => {
  it("rejects a missing date before creating a batch", async () => {
    const response = await uploadPdf();

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/effectiveDate.*required/i);
    await assertNoBatchCreated();
  });

  it("rejects a malformed or impossible calendar date before creating a batch", async () => {
    const response = await uploadPdf("2026-02-30");

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/effectiveDate.*valid/i);
    await assertNoBatchCreated();
  });

  it("returns the persisted submitted effective date to the import review flow", async () => {
    competitor = `__test_review_date_${Date.now()}__`;
    const [batch] = await db
      .insert(importBatchesTable)
      .values({
        competitor,
        effectiveDate: "2026-09-01",
        sourceFileName: "verified-period.pdf",
        priceBasis: "MRP",
        status: "pending",
        rowCounts: JSON.stringify({ ok: 0, needs_review: 0, not_found: 0, new_products: 0 }),
      })
      .returning({ id: importBatchesTable.id });

    const response = await request.get(`/catalog/import-batches/${batch!.id}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: batch!.id,
      competitor,
      effectiveDate: "2026-09-01",
    });
  });
});