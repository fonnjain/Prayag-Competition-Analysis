import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import supertest from "supertest";
import { inArray } from "drizzle-orm";
import {
  catalogProductsTable,
  db,
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

const app = express();
app.use(express.json());
app.use(catalogRouter);
app.use(router);
const request = supertest(app);

beforeAll(async () => {
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
    .delete(catalogProductsTable)
    .where(inArray(catalogProductsTable.itemCode, CODES));
});

describe("MRP import blocking review", () => {
  it("persists suspicious rows as pending until explicit approval", async () => {
    const csv = `Item Code,MRP\n${FLAGGED},200\n${CLEAN},110\n`;
    const upload = await request
      .post("/catalog/load-mrp")
      .field("effectiveDate", LOAD_DATE)
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
    ).toMatchObject({ reviewStatus: "approved", isCurrent: true });
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
  });

  it("removes only pending rows when a reviewer cancels", async () => {
    const upload = await request
      .post("/catalog/load-mrp")
      .field("effectiveDate", LOAD_DATE)
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