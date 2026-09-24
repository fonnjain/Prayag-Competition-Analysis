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
import {
  reconcileSanitarywareVariantProvenance,
  sha256ForBuffer,
} from "../lib/mrpProvenance";
import { createMrpFixtureBatch } from "./testMrpFixture.js";

const RUN = Date.now();
const MANUAL_CODE = `__MRP_MANUAL_PROVENANCE_${RUN}__`;
const UNTRACED_CODE = `__MRP_UNTRACED_PROVENANCE_${RUN}__`;
const PERIOD_CODE = `__MRP_PERIOD_PROVENANCE_${RUN}__`;
const RECONCILED_CODE = `__MRP_RECONCILED_PROVENANCE_${RUN}__`;
const MAY_CODE = `__MRP_MAY_PROVENANCE_${RUN}__`;
const EFFECTIVE_DATE = "2026-08-19";
const PERIOD_DATE = "2039-12-31";
const PENDING_REVIEW_BATCH = `manual-pending-review-${RUN}`;
const CODES = [
  MANUAL_CODE,
  UNTRACED_CODE,
  PERIOD_CODE,
  RECONCILED_CODE,
  MAY_CODE,
];
const VARIANT_SOURCE_SHEET_ID = `variant-provenance-test-${RUN}`;
const MAY_SOURCE_SHEET_ID = `may-authoritative-test-${RUN}`;
let fixtureBatchId = 0;

const app = express();
app.use(express.json());
app.use(catalogRouter);
app.use(catalogImportExportRouter);
const request = supertest(app);

beforeAll(async () => {
  fixtureBatchId = await createMrpFixtureBatch("mrp-provenance", RUN);
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
      .delete(mrpHistoryProvenanceEventsTable)
      .where(eq(mrpHistoryProvenanceEventsTable.loadBatchId, fixtureBatchId));
    await tx
      .delete(mrpLoadBatchesTable)
      .where(eq(mrpLoadBatchesTable.id, fixtureBatchId));
    await tx
      .delete(catalogProductsTable)
      .where(inArray(catalogProductsTable.itemCode, CODES));
    const sources = await tx
      .select({ id: mrpSourcesTable.id })
      .from(mrpSourcesTable)
      .where(
        inArray(mrpSourcesTable.sheetId, [
          VARIANT_SOURCE_SHEET_ID,
          MAY_SOURCE_SHEET_ID,
        ]),
      );
    for (const source of sources) {
      await tx
        .delete(mrpLoadBatchesTable)
        .where(eq(mrpLoadBatchesTable.sourceId, source.id));
      await tx
        .delete(mrpSourcesTable)
        .where(eq(mrpSourcesTable.id, source.id));
    }
  });
});

describe("manual MRP provenance", () => {
  it("requires a reviewer reason and records a manual correction event", async () => {
    await db.insert(mrpPriceHistoryTable).values({
      itemCode: MANUAL_CODE,
      loadBatchId: fixtureBatchId,
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

  it("rejects an unbatched history insert without creating a row", async () => {
    await expect(db.execute(sql`
      INSERT INTO mrp_price_history (item_code, mrp, price_basis, effective_date, load_date, source_file)
      VALUES (${UNTRACED_CODE}, 99, 'MRP', ${EFFECTIVE_DATE}, ${EFFECTIVE_DATE}, 'unbatched-workbook.xlsx')
    `)).rejects.toMatchObject({ cause: { code: "23502", column: "load_batch_id" } });
    expect(await db.select().from(mrpPriceHistoryTable).where(eq(mrpPriceHistoryTable.itemCode, UNTRACED_CODE))).toHaveLength(0);
  });

  it.skip("legacy null-row reconciliation (requires an isolated pre-constraint schema)", async () => {
    const [maySource] = await db
      .insert(mrpSourcesTable)
      .values({
        division: `Authoritative May test ${RUN}`,
        sheetId: MAY_SOURCE_SHEET_ID,
        sheetUrl: "about:blank",
        expectedFileName: "authoritative-may-fixture.xlsx",
        sourceKind: "authoritative",
      })
      .returning({ id: mrpSourcesTable.id });
    const [mayBatch] = await db
      .insert(mrpLoadBatchesTable)
      .values({
        sourceId: maySource.id,
        fileName: "authoritative-may-fixture.xlsx",
        fileSha256: sha256ForBuffer(Buffer.from(`may-${RUN}`)),
        fileSizeBytes: 123,
        downloadedAt: EFFECTIVE_DATE,
        rowCount: 1,
      })
      .returning({ id: mrpLoadBatchesTable.id });
    const [mayRow] = await db
      .insert(mrpPriceHistoryTable)
      .values({
        itemCode: MAY_CODE,
        mrp: 654,
        priceBasis: "MRP",
        effectiveDate: "2026-05-01",
        loadDate: EFFECTIVE_DATE,
        sourceFile: "authoritative-may-fixture.xlsx",
        notes: "Authoritative May row",
        variant: "Ivory",
        loadBatchId: mayBatch.id,
      })
      .returning();
    const [sourceRow] = await db
      .insert(mrpPriceHistoryTable)
      .values({
        itemCode: RECONCILED_CODE,
        mrp: 321,
        netPrice: 222,
        discountPct: 30,
        priceBasis: "MRP",
        effectiveDate: "2026-01-15",
        loadDate: EFFECTIVE_DATE,
        sourceFile: "known-colour-source-fixture.xlsx",
        notes: "Original known-source note",
        variant: "Ivory",
        loadBatchId: mayBatch.id,
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
      WHERE id = ${sourceRow.id}
    `);
    const scope = {
      sourceSheetId: VARIANT_SOURCE_SHEET_ID,
      sourceDivision: `Known colour source test ${RUN}`,
      sourceFile: "known-colour-source-fixture.xlsx",
      effectiveDate: "2026-01-15",
      loadDate: EFFECTIVE_DATE,
      productDivision: "Test",
      expectedRows: 1,
      expectedDistinctCodes: 1,
      historyRowIds: [sourceRow.id],
      expectedIdentityMd5: digest.rows[0].identity_digest,
      payloadSha256: sha256ForBuffer(Buffer.from("known source fixture")),
      payloadBytes: Buffer.byteLength("known source fixture"),
    };

    await expect(
      reconcileSanitarywareVariantProvenance({
        loadedBy: "variant-test@example.test",
        scope: { ...scope, expectedIdentityMd5: "0".repeat(32) },
      }),
    ).rejects.toThrow(/audited manifest/i);
    const [stillUnclassified] = await db
      .select()
      .from(mrpPriceHistoryTable)
      .where(eq(mrpPriceHistoryTable.id, sourceRow.id));
    expect(stillUnclassified.loadBatchId).toBe(mayBatch.id);

    const first = await reconcileSanitarywareVariantProvenance({
      loadedBy: "variant-test@example.test",
      scope,
    });
    const second = await reconcileSanitarywareVariantProvenance({
      loadedBy: "variant-test@example.test",
      scope,
    });
    const [batchAfterSecondReconciliation] = await db
      .select({ notes: mrpLoadBatchesTable.notes })
      .from(mrpLoadBatchesTable)
      .where(eq(mrpLoadBatchesTable.id, first.loadBatchId));
    const third = await reconcileSanitarywareVariantProvenance({
      loadedBy: "variant-test@example.test",
      scope,
    });
    const [batchAfterThirdReconciliation] = await db
      .select({ notes: mrpLoadBatchesTable.notes })
      .from(mrpLoadBatchesTable)
      .where(eq(mrpLoadBatchesTable.id, first.loadBatchId));

    expect(first).toMatchObject({
      attachedRows: 1,
      distinctCodes: 1,
      alreadyReconciled: false,
    });
    expect(second).toEqual({
      loadBatchId: first.loadBatchId,
      attachedRows: 0,
      distinctCodes: 1,
      alreadyReconciled: true,
      payloadSha256: scope.payloadSha256,
    });
    expect(third).toEqual(second);
    expect(batchAfterThirdReconciliation.notes).toBe(
      batchAfterSecondReconciliation.notes,
    );
    const [history] = await db
      .select()
      .from(mrpPriceHistoryTable)
      .where(eq(mrpPriceHistoryTable.itemCode, RECONCILED_CODE));
    expect(history).toMatchObject({
      mrp: 321,
      netPrice: 222,
      discountPct: 30,
      effectiveDate: "2026-01-15",
      loadDate: EFFECTIVE_DATE,
      sourceFile: "known-colour-source-fixture.xlsx",
      notes: "Original known-source note",
      variant: "Ivory",
      loadBatchId: first.loadBatchId,
    });
    const events = await db
      .select()
      .from(mrpHistoryProvenanceEventsTable)
      .where(eq(mrpHistoryProvenanceEventsTable.historyRowId, history.id));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: "known_source_batch_backfilled",
      loadBatchId: first.loadBatchId,
      mrp: 321,
    });
    const [source] = await db
      .select()
      .from(mrpSourcesTable)
      .where(eq(mrpSourcesTable.sheetId, VARIANT_SOURCE_SHEET_ID));
    expect(source).toMatchObject({
      sourceKind: "known_source",
      expectedFileName: "known-colour-source-fixture.xlsx",
    });
    const [batch] = await db
      .select()
      .from(mrpLoadBatchesTable)
      .where(eq(mrpLoadBatchesTable.id, first.loadBatchId));
    expect(batch).toMatchObject({
      fileName: "known-colour-source-fixture.xlsx",
      fileSha256: scope.payloadSha256,
      fileSizeBytes: scope.payloadBytes,
      rowCount: 1,
    });
    expect(batch.notes).toMatch(/normalized 2026-01-15 period payload/i);
    expect(batch.notes).toMatch(/not a hash of the original XLSX bytes/i);
    expect(batch.notes).toMatch(/historical row load date/i);
    expect(batch.notes).toMatch(/original XLSX download date is not retained/i);
    const [unchangedMayRow] = await db
      .select()
      .from(mrpPriceHistoryTable)
      .where(eq(mrpPriceHistoryTable.id, mayRow.id));
    expect(unchangedMayRow).toEqual(mayRow);

    await db
      .delete(mrpHistoryProvenanceEventsTable)
      .where(eq(mrpHistoryProvenanceEventsTable.historyRowId, history.id));
    await expect(
      reconcileSanitarywareVariantProvenance({
        loadedBy: "variant-test@example.test",
        scope,
      }),
    ).rejects.toThrow(/does not exactly match/i);
  });

  it("retains a period deletion event after the history row is removed", async () => {
    await db.insert(mrpPriceHistoryTable).values({
      itemCode: PERIOD_CODE,
      loadBatchId: fixtureBatchId,
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