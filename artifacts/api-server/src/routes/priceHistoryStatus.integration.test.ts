import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import supertest from "supertest";
import { eq } from "drizzle-orm";
import {
  catalogProductsTable,
  competitorPricesTable,
  db,
  mrpPriceHistoryTable,
} from "@workspace/db";
import analysisRouter from "./analysis.js";
import catalogRouter from "./catalog.js";
import catalogImportExportRouter from "./catalogImportExport.js";
import { createMrpFixtureBatch, deleteMrpFixtureBatch } from "./testMrpFixture.js";

const RUN = Date.now();
const ITEM_CODE = `__STATUS_${RUN}__`;
const COMPETITOR = `__STATUS_COMP_${RUN}__`;
const AUG_DATE = "2026-08-01";
const SEP_DATE = "2026-09-01";
const OCT_DATE = "2026-10-01";
let fixtureBatchId = 0;

const app = express();
app.use(express.json());
app.use(catalogRouter);
app.use(analysisRouter);
app.use(catalogImportExportRouter);
const request = supertest(app);

function historyByVariant(
  body: { history: Array<{ variant: string; effectiveDate: string; status: string; isCurrent: boolean }> },
  variant: string,
) {
  return body.history
    .filter((row) => row.variant === variant)
    .map(({ effectiveDate, status, isCurrent }) => ({ effectiveDate, status, isCurrent }))
    .reverse();
}

function exportedStatusByDate(csv: string): Map<string, string> {
  const lines = csv.trim().split(/\r?\n/);
  const header = lines[0]!.split(",");
  const codeIndex = header.indexOf("Item Code");
  const dateIndex = header.indexOf("Effective Date");
  const currentIndex = header.indexOf("Is Current");
  return new Map(
    lines
      .slice(1)
      .map((line) => line.split(",").map((cell) => cell.replace(/^"|"$/g, "")))
      .filter((row) => row[codeIndex] === ITEM_CODE)
      .map((row) => [row[dateIndex]!, row[currentIndex]!]),
  );
}

beforeAll(async () => {
  fixtureBatchId = await createMrpFixtureBatch("history-status", RUN);
  await db.insert(catalogProductsTable).values({
    itemCode: ITEM_CODE,
    productName: "Status derivation fixture",
    division: "Sanitaryware",
    category: "Fixture",
  });
  await db.insert(mrpPriceHistoryTable).values([
    {
      itemCode: ITEM_CODE,
      loadBatchId: fixtureBatchId,
      mrp: 100,
      priceBasis: "MRP",
      effectiveDate: AUG_DATE,
      loadDate: AUG_DATE,
      variant: "Standard",
      isCurrent: false,
    },
    {
      itemCode: ITEM_CODE,
      loadBatchId: fixtureBatchId,
      mrp: 1190,
      priceBasis: "MRP",
      effectiveDate: SEP_DATE,
      loadDate: SEP_DATE,
      variant: "Standard",
      isCurrent: true,
    },
    {
      itemCode: ITEM_CODE,
      loadBatchId: fixtureBatchId,
      mrp: 110,
      priceBasis: "MRP",
      effectiveDate: AUG_DATE,
      loadDate: AUG_DATE,
      variant: "Ivory",
      isCurrent: false,
    },
    {
      itemCode: ITEM_CODE,
      loadBatchId: fixtureBatchId,
      mrp: 120,
      priceBasis: "MRP",
      effectiveDate: SEP_DATE,
      loadDate: SEP_DATE,
      variant: "Ivory",
      isCurrent: true,
    },
  ]);
  await db.insert(competitorPricesTable).values([
    {
      competitor: COMPETITOR,
      matchedPrayagCode: ITEM_CODE,
      matchStatus: "matched",
      price: 500,
      effectiveDate: AUG_DATE,
      isCurrent: false,
    },
    {
      competitor: COMPETITOR,
      matchedPrayagCode: ITEM_CODE,
      matchStatus: "matched",
      price: 550,
      effectiveDate: SEP_DATE,
      isCurrent: true,
    },
    {
      competitor: COMPETITOR,
      matchedPrayagCode: ` ${ITEM_CODE}.0 `,
      matchStatus: "matched",
      price: 600,
      effectiveDate: OCT_DATE,
      isCurrent: false,
    },
  ]);
});

afterAll(async () => {
  await db
    .delete(competitorPricesTable)
    .where(eq(competitorPricesTable.competitor, COMPETITOR));
  await db
    .delete(mrpPriceHistoryTable)
    .where(eq(mrpPriceHistoryTable.itemCode, ITEM_CODE));
  await deleteMrpFixtureBatch(fixtureBatchId);
  await db
    .delete(catalogProductsTable)
    .where(eq(catalogProductsTable.itemCode, ITEM_CODE));
});

describe("date-derived price-history status", () => {
  it("derives product-detail status independently for Standard and Ivory", async () => {
    const august = await request.get(
      `/catalog/products/${ITEM_CODE}?asOf=2026-08-31`,
    );
    const september = await request.get(
      `/catalog/products/${ITEM_CODE}?asOf=2026-09-01`,
    );

    expect(august.status).toBe(200);
    expect(historyByVariant(august.body, "Standard")).toEqual([
      { effectiveDate: AUG_DATE, status: "Current", isCurrent: true },
      { effectiveDate: SEP_DATE, status: "Upcoming", isCurrent: false },
    ]);
    expect(historyByVariant(august.body, "Ivory")).toEqual([
      { effectiveDate: AUG_DATE, status: "Current", isCurrent: true },
      { effectiveDate: SEP_DATE, status: "Upcoming", isCurrent: false },
    ]);
    expect(historyByVariant(september.body, "Standard")).toEqual([
      { effectiveDate: AUG_DATE, status: "Superseded", isCurrent: false },
      { effectiveDate: SEP_DATE, status: "Current", isCurrent: true },
    ]);
    expect(historyByVariant(september.body, "Ivory")).toEqual([
      { effectiveDate: AUG_DATE, status: "Superseded", isCurrent: false },
      { effectiveDate: SEP_DATE, status: "Current", isCurrent: true },
    ]);
  });

  it("returns derived MRP and competitor status from analysis history", async () => {
    const response = await request.get(
      `/analysis/price-history/${ITEM_CODE}?asOf=2026-08-31`,
    );

    expect(response.status).toBe(200);
    expect(response.body.prayagHistory.map(
      ({ effectiveDate, status, isCurrent }: { effectiveDate: string; status: string; isCurrent: boolean }) =>
        ({ effectiveDate, status, isCurrent }),
    )).toEqual([
      { effectiveDate: AUG_DATE, status: "Current", isCurrent: true },
      { effectiveDate: SEP_DATE, status: "Upcoming", isCurrent: false },
    ]);
    expect(response.body.competitorHistory[0].periods.map(
      ({ effectiveDate, status, isCurrent }: { effectiveDate: string; status: string; isCurrent: boolean }) =>
        ({ effectiveDate, status, isCurrent }),
    )).toEqual([
      { effectiveDate: AUG_DATE, status: "Current", isCurrent: true },
      { effectiveDate: SEP_DATE, status: "Upcoming", isCurrent: false },
      { effectiveDate: OCT_DATE, status: "Upcoming", isCurrent: false },
    ]);
  });

  it("includes whitespace and .0 code variants in the Comparison-equivalent competitor timeline", async () => {
    const response = await request.get(
      `/analysis/price-history/${ITEM_CODE}?asOf=${OCT_DATE}`,
    );

    expect(response.status).toBe(200);
    expect(response.body.competitorHistory[0].periods.map(
      ({ effectiveDate, status }: { effectiveDate: string; status: string }) =>
        ({ effectiveDate, status }),
    )).toEqual([
      { effectiveDate: AUG_DATE, status: "Superseded" },
      { effectiveDate: SEP_DATE, status: "Superseded" },
      { effectiveDate: OCT_DATE, status: "Current" },
    ]);
  });

  it("derives the MRP history export Current column", async () => {
    const august = await request.get(
      "/catalog/export?type=history&format=csv&asOf=2026-08-31",
    );
    const september = await request.get(
      "/catalog/export?type=history&format=csv&asOf=2026-09-01",
    );

    expect(august.status).toBe(200);
    expect(exportedStatusByDate(august.text)).toEqual(new Map([
      [AUG_DATE, "Yes"],
      [SEP_DATE, "No"],
    ]));
    expect(exportedStatusByDate(september.text)).toEqual(new Map([
      [AUG_DATE, "No"],
      [SEP_DATE, "Yes"],
    ]));
  });

  it("changing stored flags changes no API status or export Current value", async () => {
    const beforeProduct = await request.get(
      `/catalog/products/${ITEM_CODE}?asOf=2026-09-01`,
    );
    const beforeAnalysis = await request.get(
      `/analysis/price-history/${ITEM_CODE}?asOf=2026-09-01`,
    );
    const beforeExport = await request.get(
      "/catalog/export?type=history&format=csv&asOf=2026-09-01",
    );

    await db
      .update(mrpPriceHistoryTable)
      .set({ isCurrent: false })
      .where(eq(mrpPriceHistoryTable.itemCode, ITEM_CODE));
    await db
      .update(competitorPricesTable)
      .set({ isCurrent: false })
      .where(eq(competitorPricesTable.competitor, COMPETITOR));

    const afterProduct = await request.get(
      `/catalog/products/${ITEM_CODE}?asOf=2026-09-01`,
    );
    const afterAnalysis = await request.get(
      `/analysis/price-history/${ITEM_CODE}?asOf=2026-09-01`,
    );
    const afterExport = await request.get(
      "/catalog/export?type=history&format=csv&asOf=2026-09-01",
    );

    expect(afterProduct.body).toEqual(beforeProduct.body);
    expect(afterAnalysis.body).toEqual(beforeAnalysis.body);
    expect(exportedStatusByDate(afterExport.text)).toEqual(
      exportedStatusByDate(beforeExport.text),
    );
  });
});
