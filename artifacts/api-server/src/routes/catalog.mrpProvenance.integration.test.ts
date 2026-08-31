import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import supertest from "supertest";
import { eq, inArray, sql } from "drizzle-orm";
import {
  catalogProductsTable,
  db,
  mrpHistoryProvenanceEventsTable,
  mrpLoadBatchesTable,
  mrpPriceHistoryTable,
  mrpSourcesTable,
} from "@workspace/db";
import catalogRouter from "./catalog";
import catalogImportExportRouter from "./catalogImportExport";
import { classifyLegacyMrpRows } from "../lib/mrpProvenance";

const RUN = Date.now();
const MANUAL_CODE = `__MRP_MANUAL_PROVENANCE_${RUN}__`;
const LEGACY_CODE = `__MRP_LEGACY_PROVENANCE_${RUN}__`;
const PERIOD_CODE = `__MRP_PERIOD_PROVENANCE_${RUN}__`;
const CLASSIFIED_CODE = `__MRP_CLASSIFIED_PROVENANCE_${RUN}__`;
const EFFECTIVE_DATE = "2026-08-19";
const PERIOD_DATE = "2039-12-31";
const PENDING_REVIEW_BATCH = `manual-pending-review-${RUN}`;
const CODES = [MANUAL_CODE, LEGACY_CODE, PERIOD_CODE, CLASSIFIED_CODE];
const LEGACY_SOURCE_SHEET_ID = `legacy-provenance-test-${RUN}`;

const app = express();
app.use(express.json());
app.use(catalogRouter);
app.use(catalogImportExportRouter);
const request = supertest(app);

beforeAll(async () => {
  await db.insert(catalogProductsTable).values(
    CODES.map((itemCode) => ({
      itemCode,
      productName: "MRP provenance fixture",
      division: "Test",
      category: "Audit",
    })),
  );
});

afterAll(async () => {
  await db.transaction(async (tx) => {
    // Other MRP tests can finish at the same time. Share the mutation lock so
    // teardown never interleaves deletes across the related audit tables.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(917_130)`);
    await tx
      .delete(mrpHistoryProvenanceEventsTable)
      .where(inArray(mrpHistoryProvenanceEventsTable.itemCode, CODES));
    await tx
      .delete(mrpPriceHistoryTable)
      .where(inArray(mrpPriceHistoryTable.itemCode, CODES));
    await tx
      .delete(catalogProductsTable)
      .where(inArray(catalogProductsTable.itemCode, CODES));
    const source = await tx
      .select({ id: mrpSourcesTable.id })
      .from(mrpSourcesTable)
      .where(eq(mrpSourcesTable.sheetId, LEGACY_SOURCE_SHEET_ID));
    if (source[0]) {
      await tx
        .delete(mrpLoadBatchesTable)
        .where(eq(mrpLoadBatchesTable.sourceId, source[0].id));
      await tx
        .delete(mrpSourcesTable)
        .where(eq(mrpSourcesTable.id, source[0].id));
    }
  });
});

describe("manual MRP provenance", () => {
  it("requires a reviewer reason and records a manual correction event", async () => {
    await db.insert(mrpPriceHistoryTable).values({
      itemCode: MANUAL_CODE,
      mrp: 100,
      priceBasis: "MRP",
      effectiveDate: EFFECTIVE_DATE,
      loadDate: EFFECTIVE_DATE,
      reviewStatus: "pending",
      reviewReasons: "Suspicious increase",
      importBatchId: PENDING_REVIEW_BATCH,
      sourceFile: "pending-import.xlsx",
    });
    const missingReason = await request
      .patch(`/catalog/products/${MANUAL_CODE}/mrp`)
      .send({ mrp: 125, effectiveDate: EFFECTIVE_DATE });
    expect(missingReason.status).toBe(400);
    expect(missingReason.body.error).toMatch(/reason is required/i);

    const saved = await request
      .patch(`/catalog/products/${MANUAL_CODE}/mrp`)
      .send({
        mrp: 125,
        effectiveDate: EFFECTIVE_DATE,
        reason: "Verified against the distributor correction notice",
      });
    expect(saved.status).toBe(200);

    const [history] = await db
      .select()
      .from(mrpPriceHistoryTable)
      .where(eq(mrpPriceHistoryTable.itemCode, MANUAL_CODE));
    expect(history).toMatchObject({
      mrp: 125,
      sourceFile: "manual-edit",
      notes: "Manual correction: Verified against the distributor correction notice",
      loadBatchId: expect.any(Number),
      reviewStatus: "approved",
      reviewReasons: null,
      importBatchId: null,
    });

    const [event] = await db
      .select()
      .from(mrpHistoryProvenanceEventsTable)
      .where(eq(mrpHistoryProvenanceEventsTable.historyRowId, history.id));
    expect(event).toMatchObject({
      action: "manual_correction",
      itemCode: MANUAL_CODE,
      effectiveDate: EFFECTIVE_DATE,
      reason: "Verified against the distributor correction notice",
      sourceFile: "manual-edit",
      loadBatchId: history.loadBatchId,
      previousMrp: 100,
      mrp: 125,
    });
    const cancellation = await request.post(
      `/catalog/mrp-review-batches/${PENDING_REVIEW_BATCH}/cancel`,
    );
    expect(cancellation.status).toBe(404);
    const approval = await request.post(
      `/catalog/mrp-review-batches/${PENDING_REVIEW_BATCH}/approve`,
    );
    expect(approval.status).toBe(404);
    const [stillManual] = await db
      .select()
      .from(mrpPriceHistoryTable)
      .where(eq(mrpPriceHistoryTable.itemCode, MANUAL_CODE));
    expect(stillManual).toMatchObject({
      mrp: 125,
      reviewStatus: "approved",
      sourceFile: "manual-edit",
      loadBatchId: expect.any(Number),
      importBatchId: null,
    });
  });

  it("reports rows without an official batch or manual correction event", async () => {
    await db.insert(mrpPriceHistoryTable).values({
      itemCode: LEGACY_CODE,
      mrp: 99,
      priceBasis: "MRP",
      effectiveDate: EFFECTIVE_DATE,
      loadDate: EFFECTIVE_DATE,
      sourceFile: "legacy-workbook.xlsx",
    });

    const health = await request.get("/catalog/data-health");
    expect(health.status).toBe(200);
    expect(health.body.untracedMrpCount).toBeGreaterThan(0);
    expect(health.body.untracedMrpRows).toContainEqual(
      expect.objectContaining({
        itemCode: LEGACY_CODE,
        effectiveDate: EFFECTIVE_DATE,
        mrp: 99,
        sourceFile: "legacy-workbook.xlsx",
      }),
    );
    expect(health.body.untracedMrpRows).not.toContainEqual(
      expect.objectContaining({ itemCode: MANUAL_CODE }),
    );
  });

  it("classifies an exact legacy scope idempotently without changing price data", async () => {
    const [legacyRow] = await db
      .insert(mrpPriceHistoryTable)
      .values({
        itemCode: CLASSIFIED_CODE,
        mrp: 321,
        netPrice: 222,
        discountPct: 30,
        priceBasis: "MRP",
        effectiveDate: "2026-01-15",
        loadDate: EFFECTIVE_DATE,
        sourceFile: "legacy-classification-fixture.xlsx",
        notes: "Original legacy note",
        variant: "Ivory",
      })
      .returning({ id: mrpPriceHistoryTable.id });
    const digest = await db.execute<{ identity_digest: string }>(sql`
      SELECT md5(COALESCE(string_agg(
        concat_ws(chr(31),
          id, item_code, variant, effective_date, load_date, source_file,
          price_basis, review_status, mrp, net_price, discount_pct, notes,
          import_batch_id
        ),
        chr(30) ORDER BY id
      ), '')) AS identity_digest
      FROM mrp_price_history
      WHERE id = ${legacyRow.id}
    `);
    const scope = {
      sourceSheetId: LEGACY_SOURCE_SHEET_ID,
      sourceDivision: `Legacy provenance test ${RUN}`,
      sourceFile: "legacy-classification-fixture.xlsx",
      effectiveDate: "2026-01-15",
      loadDate: EFFECTIVE_DATE,
      productDivision: "Test",
      expectedRows: 1,
      expectedDistinctCodes: 1,
      historyRowIds: [legacyRow.id],
      expectedIdentityMd5: digest.rows[0].identity_digest,
    };

    await expect(
      classifyLegacyMrpRows({
        loadedBy: "legacy-test@example.test",
        scope: { ...scope, expectedIdentityMd5: "0".repeat(32) },
      }),
    ).rejects.toThrow(/audited manifest/i);
    const [stillUnclassified] = await db
      .select()
      .from(mrpPriceHistoryTable)
      .where(eq(mrpPriceHistoryTable.id, legacyRow.id));
    expect(stillUnclassified.loadBatchId).toBeNull();

    const first = await classifyLegacyMrpRows({
      loadedBy: "legacy-test@example.test",
      scope,
    });
    const second = await classifyLegacyMrpRows({
      loadedBy: "legacy-test@example.test",
      scope,
    });

    expect(first).toMatchObject({
      classifiedRows: 1,
      distinctCodes: 1,
      alreadyClassified: false,
    });
    expect(second).toEqual({
      loadBatchId: first.loadBatchId,
      classifiedRows: 0,
      distinctCodes: 1,
      alreadyClassified: true,
    });
    const [history] = await db
      .select()
      .from(mrpPriceHistoryTable)
      .where(eq(mrpPriceHistoryTable.itemCode, CLASSIFIED_CODE));
    expect(history).toMatchObject({
      mrp: 321,
      netPrice: 222,
      discountPct: 30,
      effectiveDate: "2026-01-15",
      loadDate: EFFECTIVE_DATE,
      sourceFile: "legacy-classification-fixture.xlsx",
      notes: "Original legacy note",
      variant: "Ivory",
      loadBatchId: first.loadBatchId,
    });
    const events = await db
      .select()
      .from(mrpHistoryProvenanceEventsTable)
      .where(eq(mrpHistoryProvenanceEventsTable.historyRowId, history.id));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: "pre_provenance_legacy_classified",
      loadBatchId: first.loadBatchId,
      mrp: 321,
    });
    const [source] = await db
      .select()
      .from(mrpSourcesTable)
      .where(eq(mrpSourcesTable.sheetId, LEGACY_SOURCE_SHEET_ID));
    expect(source).toMatchObject({
      sourceKind: "legacy",
      expectedFileName: "legacy-classification-fixture.xlsx",
    });

    await db
      .delete(mrpHistoryProvenanceEventsTable)
      .where(eq(mrpHistoryProvenanceEventsTable.historyRowId, history.id));
    await expect(
      classifyLegacyMrpRows({
        loadedBy: "legacy-test@example.test",
        scope,
      }),
    ).rejects.toThrow(/does not exactly match/i);
  });

  it("retains a period deletion event after the history row is removed", async () => {
    await db.insert(mrpPriceHistoryTable).values({
      itemCode: PERIOD_CODE,
      mrp: 175,
      priceBasis: "MRP",
      effectiveDate: PERIOD_DATE,
      loadDate: EFFECTIVE_DATE,
      sourceFile: "official-period.xlsx",
    });

    const deletion = await request.delete(`/catalog/mrp-period/${PERIOD_DATE}`);
    expect(deletion.status).toBe(200);
    expect(deletion.body).toEqual({ deleted: PERIOD_DATE });

    const removedRows = await db
      .select()
      .from(mrpPriceHistoryTable)
      .where(eq(mrpPriceHistoryTable.itemCode, PERIOD_CODE));
    expect(removedRows).toHaveLength(0);
    const [event] = await db
      .select()
      .from(mrpHistoryProvenanceEventsTable)
      .where(eq(mrpHistoryProvenanceEventsTable.itemCode, PERIOD_CODE));
    expect(event).toMatchObject({
      action: "period_deleted",
      effectiveDate: PERIOD_DATE,
      mrp: 175,
      sourceFile: "official-period.xlsx",
    });
  });
});