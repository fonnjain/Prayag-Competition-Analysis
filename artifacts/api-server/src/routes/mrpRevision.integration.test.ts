import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import supertest from "supertest";
import * as XLSX from "xlsx";
import { eq, inArray } from "drizzle-orm";
import {
  catalogProductsTable,
  db,
  mrpHistoryProvenanceEventsTable,
  mrpPriceHistoryTable,
  mrpRevisionBatchesTable,
  mrpRevisionRowsTable,
} from "@workspace/db";
import revisionRouter from "./mrpRevision";

const RUN = Date.now();
const CODE = `__MRP_REVISION_${RUN}__`;
const UNTOUCHED_CODE = `__MRP_REVISION_UNTOUCHED_${RUN}__`;
const DATE = "2040-03-05";
const request = supertest(express().use(express.json()).use(revisionRouter));
let batchId: number | null = null;

function workbook(): Buffer {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ["item_code", "effective_date", "variant", "new_mrp", "note"],
    [CODE, DATE, "Standard", 40, "intentional low-price test"],
    [CODE, "2040-03-06", "Standard", 110, "must not create a period"],
    ["DOES-NOT-EXIST", DATE, "Standard", 110, "must not create product"],
    [CODE, DATE, "Ivory", null, "blank must be rejected"],
  ]), "revision");
  // This intentionally dangerous-looking sheet proves the parser reads only
  // the explicitly named revision sheet.
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ["item_code", "effective_date", "new_mrp"],
    [CODE, DATE, 99999],
  ]), "reference_do_not_upload");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" });
}

beforeAll(async () => {
  await db.insert(catalogProductsTable).values([
    { itemCode: CODE, productName: "Revision fixture", division: "PTMT & Plastic Fittings", category: "Test" },
    { itemCode: UNTOUCHED_CODE, productName: "Untouched fixture", division: "PTMT & Plastic Fittings", category: "Test" },
  ]);
  await db.insert(mrpPriceHistoryTable).values([
    { itemCode: CODE, mrp: 100, priceBasis: "MRP", effectiveDate: DATE, loadDate: DATE, variant: "Standard" },
    { itemCode: UNTOUCHED_CODE, mrp: 200, priceBasis: "MRP", effectiveDate: DATE, loadDate: DATE, variant: "Standard" },
  ]);
});

afterAll(async () => {
  if (batchId) {
    await db.delete(mrpRevisionRowsTable).where(eq(mrpRevisionRowsTable.batchId, batchId));
    await db.delete(mrpRevisionBatchesTable).where(eq(mrpRevisionBatchesTable.id, batchId));
  }
  await db.delete(mrpHistoryProvenanceEventsTable)
    .where(inArray(mrpHistoryProvenanceEventsTable.itemCode, [CODE, UNTOUCHED_CODE]));
  await db.delete(mrpPriceHistoryTable)
    .where(inArray(mrpPriceHistoryTable.itemCode, [CODE, UNTOUCHED_CODE]));
  await db.delete(catalogProductsTable)
    .where(inArray(catalogProductsTable.itemCode, [CODE, UNTOUCHED_CODE]));
});

describe("MRP revision preview, apply and rollback", () => {
  it("never writes during preview, rejects invalid rows, acknowledges warnings, and restores exact previous values", async () => {
    const preview = await request.post("/catalog/mrp-revisions/preview")
      .field("targetType", "mrp")
      .field("reason", "Test the controlled revision pathway")
      .attach("file", workbook(), { filename: "revision.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });

    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({
      rowsInFile: 4,
      rowsChanged: 1,
      rowsNoop: 0,
      rowsRejected: 3,
    });
    expect(preview.body.warningCount).toBeGreaterThan(1);
    batchId = preview.body.batchId;

    const beforeApply = await db.select({ mrp: mrpPriceHistoryTable.mrp })
      .from(mrpPriceHistoryTable)
      .where(eq(mrpPriceHistoryTable.itemCode, CODE));
    expect(beforeApply[0]?.mrp).toBe(100);

    const missingAck = await request.post(`/catalog/mrp-revisions/${batchId}/apply`).send({});
    expect(missingAck.status).toBe(409);

    const applied = await request.post(`/catalog/mrp-revisions/${batchId}/apply`)
      .send({ acknowledgeWarnings: true });
    expect(applied.status).toBe(200);
    expect(applied.body.rowsChanged).toBe(1);
    const afterApply = await db.select({
      itemCode: mrpPriceHistoryTable.itemCode,
      mrp: mrpPriceHistoryTable.mrp,
      lastRevisionBatchId: mrpPriceHistoryTable.lastRevisionBatchId,
    }).from(mrpPriceHistoryTable)
      .where(inArray(mrpPriceHistoryTable.itemCode, [CODE, UNTOUCHED_CODE]));
    expect(afterApply.find((row) => row.itemCode === CODE)?.mrp).toBe(40);
    expect(afterApply.find((row) => row.itemCode === CODE)?.lastRevisionBatchId).toBe(batchId);
    expect(afterApply.find((row) => row.itemCode === UNTOUCHED_CODE)?.mrp).toBe(200);

    const rolledBack = await request.post(`/catalog/mrp-revisions/${batchId}/rollback`);
    expect(rolledBack.status).toBe(200);
    const restored = await db.select({ mrp: mrpPriceHistoryTable.mrp })
      .from(mrpPriceHistoryTable)
      .where(eq(mrpPriceHistoryTable.itemCode, CODE));
    expect(restored[0]?.mrp).toBe(100);
  });
});