import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import supertest from "supertest";
import { and, eq, sql } from "drizzle-orm";
import {
  catalogProductsTable,
  db,
  mrpHistoryProvenanceEventsTable,
  mrpLoadBatchesTable,
  mrpPriceHistoryTable,
  mrpSourcesTable,
} from "@workspace/db";
import catalogRouter from "./catalog";

const ITEM_CODE = `__MANUAL_MRP_AUDIT_${Date.now()}__`;
const EFFECTIVE_DATE = "2026-09-01";
const FILE_NAME = `manual-correction:${ITEM_CODE}:${EFFECTIVE_DATE}`;
const request = supertest(express().use(express.json()).use(catalogRouter));

beforeAll(async () => {
  await db.insert(catalogProductsTable).values({
    itemCode: ITEM_CODE,
    productName: "Manual correction provenance fixture",
    division: "Test",
    category: "Test",
  });
});

afterAll(async () => {
  await db.transaction(async (tx) => {
    // Other MRP tests can finish at the same time. Share the mutation lock so
    // teardown never interleaves deletes across the related audit tables.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(917_130)`);
    await tx
      .delete(mrpHistoryProvenanceEventsTable)
      .where(eq(mrpHistoryProvenanceEventsTable.itemCode, ITEM_CODE));
    await tx
      .delete(mrpPriceHistoryTable)
      .where(eq(mrpPriceHistoryTable.itemCode, ITEM_CODE));
    await tx
      .delete(mrpLoadBatchesTable)
      .where(eq(mrpLoadBatchesTable.fileName, FILE_NAME));
    await tx
      .delete(catalogProductsTable)
      .where(eq(catalogProductsTable.itemCode, ITEM_CODE));
  });
});

describe("manual MRP correction provenance", () => {
  it("requires a reason before changing a price", async () => {
    const response = await request.patch(`/catalog/products/${ITEM_CODE}/mrp`).send({
      mrp: 125,
      effectiveDate: EFFECTIVE_DATE,
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/reason/i);
  });

  it("records each manual correction in a dedicated audit batch", async () => {
    const first = await request.patch(`/catalog/products/${ITEM_CODE}/mrp`).send({
      mrp: 125,
      effectiveDate: EFFECTIVE_DATE,
      reason: "Verified against the signed correction sheet.",
    });
    expect(first.status, first.text).toBe(200);
    expect(first.body.provenanceBatchId).toEqual(expect.any(Number));

    const second = await request.patch(`/catalog/products/${ITEM_CODE}/mrp`).send({
      mrp: 130,
      effectiveDate: EFFECTIVE_DATE,
      reason: "Corrected a transposed digit after reviewer verification.",
    });
    expect(second.status, second.text).toBe(200);
    expect(second.body.provenanceBatchId).toEqual(expect.any(Number));
    expect(second.body.provenanceBatchId).not.toBe(first.body.provenanceBatchId);

    const [history] = await db
      .select()
      .from(mrpPriceHistoryTable)
      .where(
        and(
          eq(mrpPriceHistoryTable.itemCode, ITEM_CODE),
          eq(mrpPriceHistoryTable.effectiveDate, EFFECTIVE_DATE),
        ),
      );
    expect(history).toMatchObject({
      mrp: 130,
      sourceFile: "manual-edit",
      loadBatchId: second.body.provenanceBatchId,
      notes: expect.stringContaining("transposed digit"),
    });

    const batches = await db
      .select({
        sourceKind: mrpSourcesTable.sourceKind,
        fileName: mrpLoadBatchesTable.fileName,
        rowCount: mrpLoadBatchesTable.rowCount,
        notes: mrpLoadBatchesTable.notes,
      })
      .from(mrpLoadBatchesTable)
      .innerJoin(
        mrpSourcesTable,
        eq(mrpLoadBatchesTable.sourceId, mrpSourcesTable.id),
      )
      .where(eq(mrpLoadBatchesTable.fileName, FILE_NAME));
    expect(batches).toHaveLength(2);
    expect(batches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceKind: "manual",
          rowCount: 1,
          notes: expect.stringContaining("signed correction"),
        }),
        expect.objectContaining({
          sourceKind: "manual",
          rowCount: 1,
          notes: expect.stringContaining("transposed digit"),
        }),
      ]),
    );
  });
});