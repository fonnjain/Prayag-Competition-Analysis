import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import supertest from "supertest";
import { inArray } from "drizzle-orm";
import {
  catalogProductsTable,
  db,
  mrpLoadBatchesTable,
  mrpPriceHistoryTable,
} from "@workspace/db";
import router from "./catalogImportExport";
import catalogRouter from "./catalog";

const RUN = Date.now();
const FLAGGED = `__MRP_REVIEW_FLAGGED_${RUN}__`;
const CLEAN = `__MRP_REVIEW_CLEAN_${RUN}__`;
const CANCELLED = `__MRP_REVIEW_CANCELLED_${RUN}__`;
const CODES = [FLAGGED, CLEAN, CANCELLED];
const OLD_DATE = "2026-07-01";
const LOAD_DATE = "2026-08-19";
const TEST_FILES = [
  "review-test.csv",
  "review-cancel-test.csv",
];

const app = express();
app.use(express.json());
app.use(catalogRouter);
app.use(router);
const request = supertest(app);
let ptmtSourceId = 0;

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
  ]);
});

afterAll(async () => {
  await db
    .delete(mrpPriceHistoryTable)
    .where(inArray(mrpPriceHistoryTable.itemCode, CODES));
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
        filename: "review-test.csv",
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

    const duplicate = await request
      .post("/catalog/load-mrp")
      .field("effectiveDate", LOAD_DATE)
      .field("sourceId", String(ptmtSourceId))
      .field("downloadedAt", LOAD_DATE)
      .attach("file", Buffer.from(csv), {
        filename: "review-test.csv",
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
        filename: "review-test.csv",
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
        filename: "review-cancel-test.csv",
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
  });
});