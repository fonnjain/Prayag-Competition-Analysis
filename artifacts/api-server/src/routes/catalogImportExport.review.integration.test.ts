import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import supertest from "supertest";
import * as XLSX from "xlsx";
import { eq, inArray, sql } from "drizzle-orm";
import {
  catalogProductsTable,
  db,
  mrpHistoryProvenanceEventsTable,
  mrpLoadBatchesTable,
  mrpPriceHistoryTable,
} from "@workspace/db";
import router from "./catalogImportExport";
import catalogRouter from "./catalog";
import { discontinuationCorrectionV2 } from "../data/discontinuationCorrectionV2";

const RUN = Date.now();
const FLAGGED = `__MRP_REVIEW_FLAGGED_${RUN}__`;
const CLEAN = `__MRP_REVIEW_CLEAN_${RUN}__`;
const CANCELLED = `__MRP_REVIEW_CANCELLED_${RUN}__`;
const REINTRODUCED = `__MRP_REMOVAL_REINTRODUCED_${RUN}__`;
const WITHDRAWN = `__MRP_REMOVAL_WITHDRAWN_${RUN}__`;
const CODES = [FLAGGED, CLEAN, CANCELLED, REINTRODUCED, WITHDRAWN];
const OLD_DATE = "2026-07-01";
const LOAD_DATE = "2026-08-19";
const REVIEW_FILE = `review-test-${RUN}.csv`;
const REVIEW_CANCEL_FILE = `review-cancel-test-${RUN}.csv`;
const REINTRO_MARKER_FILE = `removal-marker-${RUN}.xlsx`;
const REINTRO_PRICE_FILE = `removal-reintroduction-${RUN}.xlsx`;
const WITHDRAWAL_MARKER_FILE = `removal-withdrawal-${RUN}.xlsx`;
const CORRECTION_PROTECTION_FILE = `correction-protection-${RUN}.xlsx`;
const TEST_FILES = [
  REVIEW_FILE,
  REVIEW_CANCEL_FILE,
  REINTRO_MARKER_FILE,
  REINTRO_PRICE_FILE,
  WITHDRAWAL_MARKER_FILE,
  CORRECTION_PROTECTION_FILE,
];

const app = express();
app.use(express.json());
app.use(catalogRouter);
app.use(router);
const request = supertest(app);
let ptmtSourceId = 0;

function workbookBuffer(rows: Array<[string, string | number]>): Buffer {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([["Item Code", "MRP"], ...rows]);
  XLSX.utils.book_append_sheet(workbook, sheet, "MASTER");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

function correctionWorkbookBuffer(): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(
      discontinuationCorrectionV2.unmarkedCodes.map((item_code) => ({ item_code })),
    ),
    "1_UNMARK_not_discontinued",
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(
      discontinuationCorrectionV2.confirmed.map((row) => ({
        item_code: row.itemCode,
        discontinued_from: row.discontinuedFrom,
      })),
    ),
    "2_Confirmed_discontinued",
  );
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

beforeAll(async () => {
  const sources = await request.get("/catalog/mrp-sources");
  const ptmtSource = sources.body.sources.find(
    (source: { division: string }) =>
      source.division === "PTMT & Plastic Fittings",
  );
  ptmtSourceId = ptmtSource?.id ?? 0;
  if (!ptmtSourceId) throw new Error("PTMT MRP source fixture was not seeded");

  await db.insert(catalogProductsTable).values([
    {
      itemCode: FLAGGED,
      productName: "Flagged MRP review fixture",
      division: "PTMT & Plastic Fittings",
      category: "Review test",
    },
    {
      itemCode: CLEAN,
      productName: "Clean MRP review fixture",
      division: "PTMT & Plastic Fittings",
      category: "Review test",
    },
    {
      itemCode: CANCELLED,
      productName: "Cancelled MRP review fixture",
      division: "PTMT & Plastic Fittings",
      category: "Review test",
    },
    {
      itemCode: REINTRODUCED,
      productName: "Reintroduced removal fixture",
      division: "PTMT & Plastic Fittings",
      category: "Removal test",
    },
    {
      itemCode: WITHDRAWN,
      productName: "Withdrawn removal fixture",
      division: "PTMT & Plastic Fittings",
      category: "Removal test",
    },
  ]);
  await db.insert(mrpPriceHistoryTable).values([
    {
      itemCode: FLAGGED,
      mrp: 100,
      priceBasis: "MRP",
      effectiveDate: OLD_DATE,
      loadDate: OLD_DATE,
      reviewStatus: "approved",
      isCurrent: true,
    },
    {
      itemCode: CLEAN,
      mrp: 100,
      priceBasis: "MRP",
      effectiveDate: OLD_DATE,
      loadDate: OLD_DATE,
      reviewStatus: "approved",
      isCurrent: true,
    },
    {
      itemCode: CANCELLED,
      mrp: 100,
      priceBasis: "MRP",
      effectiveDate: OLD_DATE,
      loadDate: OLD_DATE,
      reviewStatus: "approved",
      isCurrent: true,
    },
    {
      itemCode: REINTRODUCED,
      mrp: 100,
      priceBasis: "MRP",
      effectiveDate: "2024-05-01",
      loadDate: "2024-05-01",
      reviewStatus: "approved",
      isCurrent: false,
    },
    {
      itemCode: WITHDRAWN,
      mrp: 2490,
      priceBasis: "MRP",
      effectiveDate: "2026-03-05",
      loadDate: "2026-03-05",
      reviewStatus: "approved",
      isCurrent: false,
    },
  ]);
});

afterAll(async () => {
  const testBatches = await db
    .select({ id: mrpLoadBatchesTable.id })
    .from(mrpLoadBatchesTable)
    .where(inArray(mrpLoadBatchesTable.fileName, TEST_FILES));
  const testBatchIds = testBatches.map((batch) => batch.id);

  await db
    .delete(mrpHistoryProvenanceEventsTable)
    .where(inArray(mrpHistoryProvenanceEventsTable.itemCode, CODES));
  await db
    .delete(mrpPriceHistoryTable)
    .where(inArray(mrpPriceHistoryTable.itemCode, CODES));
  if (testBatchIds.length > 0) {
    await db
      .delete(mrpPriceHistoryTable)
      .where(inArray(mrpPriceHistoryTable.loadBatchId, testBatchIds));
  }
  await db
    .delete(mrpLoadBatchesTable)
    .where(inArray(mrpLoadBatchesTable.fileName, TEST_FILES));
  await db
    .delete(catalogProductsTable)
    .where(inArray(catalogProductsTable.itemCode, CODES));
});

describe("MRP import blocking review", () => {
  it("requires both source and download date before reading a price file", async () => {
    const missingSource = await request
      .post("/catalog/load-mrp")
      .field("effectiveDate", LOAD_DATE)
      .attach("file", Buffer.from(`Item Code,MRP\n${FLAGGED},200\n`), {
        filename: "missing-source.csv",
        contentType: "text/csv",
      });
    expect(missingSource.status).toBe(400);
    expect(missingSource.body.error).toMatch(/official MRP source/i);

    const missingDate = await request
      .post("/catalog/load-mrp")
      .field("effectiveDate", LOAD_DATE)
      .field("sourceId", String(ptmtSourceId))
      .attach("file", Buffer.from(`Item Code,MRP\n${FLAGGED},200\n`), {
        filename: "missing-date.csv",
        contentType: "text/csv",
      });
    expect(missingDate.status).toBe(400);
    expect(missingDate.body.error).toMatch(/downloaded/i);
  });

  it("persists suspicious rows as pending until explicit approval", async () => {
    const csv = `Item Code,MRP\n${FLAGGED},200\n${CLEAN},110\n`;
    const upload = await request
      .post("/catalog/load-mrp")
      .field("effectiveDate", LOAD_DATE)
      .field("sourceId", String(ptmtSourceId))
      .field("downloadedAt", LOAD_DATE)
      .attach("file", Buffer.from(csv), {
        filename: REVIEW_FILE,
        contentType: "text/csv",
      });

    expect(upload.status).toBe(200);
    expect(upload.body.results).toMatchObject({
      flaggedMrpCount: 1,
      flaggedRows: [
        expect.objectContaining({
          itemCode: FLAGGED,
          oldMrp: 100,
          newMrp: 200,
        }),
      ],
    });
    const batchId = upload.body.results.reviewBatchId as string;
    expect(batchId).toBeTruthy();
    const health = await request.get("/catalog/data-health");
    expect(health.status).toBe(200);
    expect(health.body.flaggedMrpCount).toBeGreaterThanOrEqual(1);

    const staged = await db
      .select()
      .from(mrpPriceHistoryTable)
      .where(inArray(mrpPriceHistoryTable.itemCode, CODES));
    expect(
      staged.find(
        (row) => row.itemCode === FLAGGED && row.effectiveDate === LOAD_DATE,
      ),
    ).toMatchObject({ reviewStatus: "pending", isCurrent: false });
    expect(
      staged.find(
        (row) => row.itemCode === CLEAN && row.effectiveDate === LOAD_DATE,
      ),
    ).toMatchObject({
      reviewStatus: "approved",
      isCurrent: true,
      loadBatchId: upload.body.results.provenance.loadBatchId,
    });
    expect(
      staged.find(
        (row) => row.itemCode === FLAGGED && row.effectiveDate === OLD_DATE,
      ),
    ).toMatchObject({ isCurrent: true });
    const importEvents = await db
      .select()
      .from(mrpHistoryProvenanceEventsTable)
      .where(inArray(mrpHistoryProvenanceEventsTable.itemCode, [FLAGGED, CLEAN]));
    expect(importEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ itemCode: FLAGGED, action: "official_workbook_import" }),
        expect.objectContaining({ itemCode: CLEAN, action: "official_workbook_import" }),
      ]),
    );

    const approval = await request.post(
      `/catalog/mrp-review-batches/${batchId}/approve`,
    );
    expect(approval.status).toBe(200);
    expect(approval.body.approved).toBe(1);

    const approved = await db
      .select()
      .from(mrpPriceHistoryTable)
      .where(inArray(mrpPriceHistoryTable.itemCode, CODES));
    expect(
      approved.find(
        (row) => row.itemCode === FLAGGED && row.effectiveDate === LOAD_DATE,
      ),
    ).toMatchObject({ reviewStatus: "approved", isCurrent: true });
    const approvalEvents = await db
      .select()
      .from(mrpHistoryProvenanceEventsTable)
      .where(eq(mrpHistoryProvenanceEventsTable.action, "review_approved"));
    expect(approvalEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ itemCode: FLAGGED, effectiveDate: LOAD_DATE }),
      ]),
    );

    const duplicate = await request
      .post("/catalog/load-mrp")
      .field("effectiveDate", LOAD_DATE)
      .field("sourceId", String(ptmtSourceId))
      .field("downloadedAt", LOAD_DATE)
      .attach("file", Buffer.from(csv), {
        filename: REVIEW_FILE,
        contentType: "text/csv",
      });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.duplicate).toMatchObject({
      sourceDivision: "PTMT & Plastic Fittings",
      fileSha256: expect.any(String),
    });

    const confirmed = await request
      .post("/catalog/load-mrp")
      .field("effectiveDate", LOAD_DATE)
      .field("sourceId", String(ptmtSourceId))
      .field("downloadedAt", LOAD_DATE)
      .field("confirmDuplicate", "true")
      .attach("file", Buffer.from(csv), {
        filename: REVIEW_FILE,
        contentType: "text/csv",
      });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.results.newHistoryRows).toBe(0);
  });

  it("removes only pending rows when a reviewer cancels", async () => {
    const upload = await request
      .post("/catalog/load-mrp")
      .field("effectiveDate", LOAD_DATE)
      .field("sourceId", String(ptmtSourceId))
      .field("downloadedAt", LOAD_DATE)
      .attach("file", Buffer.from(`Item Code,MRP\n${CANCELLED},10\n`), {
        filename: REVIEW_CANCEL_FILE,
        contentType: "text/csv",
      });
    expect(upload.status).toBe(200);
    expect(upload.body.results.flaggedMrpCount).toBe(1);

    const cancellation = await request.post(
      `/catalog/mrp-review-batches/${upload.body.results.reviewBatchId}/cancel`,
    );
    expect(cancellation.status).toBe(200);
    expect(cancellation.body.cancelled).toBe(1);

    const rows = await db
      .select()
      .from(mrpPriceHistoryTable)
      .where(inArray(mrpPriceHistoryTable.itemCode, [CANCELLED]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      effectiveDate: OLD_DATE,
      reviewStatus: "approved",
    });
    const cancellationEvents = await db
      .select()
      .from(mrpHistoryProvenanceEventsTable)
      .where(eq(mrpHistoryProvenanceEventsTable.action, "review_cancelled"));
    expect(cancellationEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ itemCode: CANCELLED, effectiveDate: LOAD_DATE }),
      ]),
    );
  });

  it("reconciles real REMOVED markers and later source prices through workbook uploads", async () => {
    const firstMarker = await request
      .post("/catalog/load-mrp")
      .field("effectiveDate", "2025-01-01")
      .field("sourceId", String(ptmtSourceId))
      .field("downloadedAt", "2025-01-01")
      .attach("file", workbookBuffer([[REINTRODUCED, "REMOVED"]]), {
        filename: REINTRO_MARKER_FILE,
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
    expect(firstMarker.status).toBe(200);

    const [scheduled] = await db
      .select({ discontinuedFrom: catalogProductsTable.discontinuedFrom })
      .from(catalogProductsTable)
      .where(eq(catalogProductsTable.itemCode, REINTRODUCED));
    expect(scheduled?.discontinuedFrom).toBe("2025-01-01");

    const reintroduced = await request
      .post("/catalog/load-mrp")
      .field("effectiveDate", "2026-02-01")
      .field("sourceId", String(ptmtSourceId))
      .field("downloadedAt", "2026-02-01")
      .attach("file", workbookBuffer([[REINTRODUCED, 250]]), {
        filename: REINTRO_PRICE_FILE,
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
    expect(reintroduced.status).toBe(200);

    const [liveAgain] = await db
      .select({ discontinuedFrom: catalogProductsTable.discontinuedFrom })
      .from(catalogProductsTable)
      .where(eq(catalogProductsTable.itemCode, REINTRODUCED));
    expect(liveAgain?.discontinuedFrom).toBeNull();

    const withdrawalMarker = await request
      .post("/catalog/load-mrp")
      .field("effectiveDate", "2026-09-01")
      .field("sourceId", String(ptmtSourceId))
      .field("downloadedAt", "2026-09-01")
      .attach("file", workbookBuffer([[WITHDRAWN, "REMOVED"]]), {
        filename: WITHDRAWAL_MARKER_FILE,
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
    expect(withdrawalMarker.status).toBe(200);

    const [withdrawn] = await db
      .select({ discontinuedFrom: catalogProductsTable.discontinuedFrom })
      .from(catalogProductsTable)
      .where(eq(catalogProductsTable.itemCode, WITHDRAWN));
    expect(withdrawn?.discontinuedFrom).toBe("2026-09-01");
  });

  it("applies the versioned 69/90 correction manifest through the correction upload route", async () => {
    expect(discontinuationCorrectionV2.unmarkedCodes).toHaveLength(69);
    expect(discontinuationCorrectionV2.confirmed).toHaveLength(90);

    const uploaded = await request
      .post("/catalog/load-mrp")
      .attach("file", correctionWorkbookBuffer(), {
        filename: "Prayag_Discontinued_Correction_v2.xlsx",
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
    expect(uploaded.status).toBe(200);
    expect(uploaded.body.results).toMatchObject({
      kind: "discontinuation-correction",
      unmarkedCodes: 69,
      confirmedDiscontinuations: 90,
    });

    const [restored, confirmed] = await Promise.all([
      db
        .select({
          itemCode: catalogProductsTable.itemCode,
          discontinuedFrom: catalogProductsTable.discontinuedFrom,
        })
        .from(catalogProductsTable)
        .where(
          inArray(
            catalogProductsTable.itemCode,
            [...discontinuationCorrectionV2.unmarkedCodes],
          ),
        ),
      db
        .select({
          itemCode: catalogProductsTable.itemCode,
          discontinuedFrom: catalogProductsTable.discontinuedFrom,
        })
        .from(catalogProductsTable)
        .where(
          inArray(
            catalogProductsTable.itemCode,
            discontinuationCorrectionV2.confirmed.map((row) => row.itemCode),
          ),
        ),
    ]);
    expect(restored).toHaveLength(69);
    expect(confirmed).toHaveLength(90);
    expect(restored.every((product) => product.discontinuedFrom === null)).toBe(true);
    expect(
      restored.find((product) => product.itemCode === "WT-3LH-50"),
    ).toMatchObject({ discontinuedFrom: null });
    expect(
      confirmed.every((product) =>
        discontinuationCorrectionV2.confirmed.some(
          (row) =>
            row.itemCode === product.itemCode &&
            row.discontinuedFrom === product.discontinuedFrom,
        ),
      ),
    ).toBe(true);
    expect(
      confirmed.find((product) => product.itemCode === "616-D"),
    ).toMatchObject({ discontinuedFrom: "2026-09-01" });

    const protectionCheck = await request
      .post("/catalog/load-mrp")
      .field("effectiveDate", "2026-08-01")
      .field("sourceId", String(ptmtSourceId))
      .field("downloadedAt", "2026-08-19")
      .attach(
        "file",
        workbookBuffer([[discontinuationCorrectionV2.unmarkedCodes[0], "REMOVED"]]),
        {
          filename: CORRECTION_PROTECTION_FILE,
          contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
      );
    expect(protectionCheck.status).toBe(200);
    const [stillLive, discontinuedCount] = await Promise.all([
      db
        .select({ discontinuedFrom: catalogProductsTable.discontinuedFrom })
        .from(catalogProductsTable)
        .where(
          eq(
            catalogProductsTable.itemCode,
            discontinuationCorrectionV2.unmarkedCodes[0],
          ),
        ),
      db
        .select({ count: sql<number>`count(*)` })
        .from(catalogProductsTable)
        .where(sql`${catalogProductsTable.discontinuedFrom} IS NOT NULL`),
    ]);
    expect(stillLive[0]?.discontinuedFrom).toBeNull();
    expect(Number(discontinuedCount[0]?.count)).toBe(90);
  });
});