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
import comparisonRouter from "./comparison.js";
import { validToFromNextDate } from "../lib/priceWindow.js";

const RUN = Date.now();
const ITEM_CODE = `CMP-WINDOW-${RUN}`;
const FUTURE_MRP_ITEM = `CMP-FUTURE-${RUN}`;
const WITHDRAWN_ITEM = `CMP-WITHDRAWN-${RUN}`;
const COMPETITOR = `Comparison Window ${RUN}`;
const WITHDRAWN_COMPETITOR = `Withdrawn Comparison Window ${RUN}`;
const REVIEW_COMPETITOR = `Review Window ${RUN}`;
const EDGE_COMPETITOR = `Comparison Edge Window ${RUN}`;

function dateOffset(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const HISTORICAL_DATE = dateOffset(-60);
const CURRENT_DATE = dateOffset(-20);
const PLACEHOLDER_DATE = dateOffset(-5);
const NEXT_DATE = dateOffset(10);
let historicalCompetitorRowId = 0;
let futureCompetitorRowId = 0;

const app = express();
app.use(express.json());
app.use(comparisonRouter);
const request = supertest(app);

beforeAll(async () => {
  await db.insert(catalogProductsTable).values([
    {
      itemCode: ITEM_CODE,
      productName: "Current Comparison Fixture",
      division: "Test",
      category: "Comparison",
    },
    {
      itemCode: FUTURE_MRP_ITEM,
      productName: "Future MRP Comparison Fixture",
      division: "Test",
      category: "Comparison",
    },
    {
      itemCode: WITHDRAWN_ITEM,
      productName: "Withdrawn Comparison Fixture",
      division: "Test",
      category: "Comparison",
      discontinuedFrom: dateOffset(0),
    },
  ]);
  await db.insert(mrpPriceHistoryTable).values([
    {
      itemCode: ITEM_CODE,
      mrp: 150,
      priceBasis: "MRP",
      effectiveDate: CURRENT_DATE,
      loadDate: CURRENT_DATE,
      isCurrent: false,
    },
    {
      itemCode: ITEM_CODE,
      mrp: 165,
      priceBasis: "MRP",
      effectiveDate: NEXT_DATE,
      loadDate: NEXT_DATE,
      isCurrent: true,
    },
    {
      itemCode: FUTURE_MRP_ITEM,
      mrp: 500,
      priceBasis: "MRP",
      effectiveDate: NEXT_DATE,
      loadDate: NEXT_DATE,
      isCurrent: true,
    },
    {
      itemCode: WITHDRAWN_ITEM,
      mrp: 500,
      priceBasis: "MRP",
      effectiveDate: CURRENT_DATE,
      loadDate: CURRENT_DATE,
      isCurrent: true,
    },
  ]);
  const insertedCompetitorRows = await db.insert(competitorPricesTable).values([
    {
      competitor: COMPETITOR,
      description: "Historical price",
      category: "Comparison",
      price: 200,
      matchedPrayagCode: ITEM_CODE,
      matchStatus: "matched",
      matchConfidence: "High",
      effectiveDate: HISTORICAL_DATE,
      isCurrent: true,
    },
    {
      competitor: WITHDRAWN_COMPETITOR,
      description: "Withdrawn Prayag product competitor",
      category: "Comparison",
      price: 450,
      matchedPrayagCode: WITHDRAWN_ITEM,
      matchStatus: "matched",
      matchConfidence: "High",
      effectiveDate: CURRENT_DATE,
      isCurrent: true,
    },
    {
      competitor: COMPETITOR,
      description: "Current price",
      category: "Comparison",
      price: 100,
      matchedPrayagCode: ITEM_CODE,
      matchStatus: "matched",
      matchConfidence: "High",
      effectiveDate: CURRENT_DATE,
      isCurrent: false,
    },
    {
      competitor: COMPETITOR,
      description: "Future price",
      category: "Comparison",
      price: 10,
      matchedPrayagCode: ITEM_CODE,
      matchStatus: "matched",
      matchConfidence: "High",
      effectiveDate: NEXT_DATE,
      isCurrent: true,
    },
    {
      competitor: COMPETITOR,
      description: "Future-MRP-only product competitor",
      category: "Comparison",
      price: 450,
      matchedPrayagCode: FUTURE_MRP_ITEM,
      matchStatus: "matched",
      matchConfidence: "High",
      effectiveDate: CURRENT_DATE,
      isCurrent: true,
    },
    {
      competitor: REVIEW_COMPETITOR,
      competitorCode: `REVIEW-${RUN}`,
      description: "Review price window",
      category: "Comparison",
      price: 180,
      matchedPrayagCode: ITEM_CODE,
      matchStatus: "needs_review",
      matchConfidence: "Medium",
      effectiveDate: HISTORICAL_DATE,
      isCurrent: true,
    },
    {
      competitor: REVIEW_COMPETITOR,
      competitorCode: `REVIEW-${RUN}`,
      description: "Review price window",
      category: "Comparison",
      price: 190,
      matchedPrayagCode: ITEM_CODE,
      matchStatus: "needs_review",
      matchConfidence: "Medium",
      effectiveDate: CURRENT_DATE,
      isCurrent: false,
    },
    {
      competitor: REVIEW_COMPETITOR,
      competitorCode: `REVIEW-${RUN}`,
      description: "Review price window",
      category: "Comparison",
      price: 200,
      matchedPrayagCode: ITEM_CODE,
      matchStatus: "needs_review",
      matchConfidence: "Medium",
      effectiveDate: NEXT_DATE,
      isCurrent: true,
    },
    {
      competitor: EDGE_COMPETITOR,
      description: "Same-day superseded price",
      category: "Comparison",
      price: 125,
      matchedPrayagCode: ITEM_CODE,
      matchStatus: "matched",
      matchConfidence: "High",
      effectiveDate: CURRENT_DATE,
      isCurrent: true,
    },
    {
      competitor: EDGE_COMPETITOR,
      description: "Same-day current winner",
      category: "Comparison",
      price: 120,
      matchedPrayagCode: ITEM_CODE,
      matchStatus: "matched",
      matchConfidence: "High",
      effectiveDate: CURRENT_DATE,
      isCurrent: false,
    },
    {
      competitor: EDGE_COMPETITOR,
      description: "Later null-price placeholder",
      category: "Comparison",
      price: null,
      matchedPrayagCode: ITEM_CODE,
      matchStatus: "matched",
      matchConfidence: "High",
      effectiveDate: PLACEHOLDER_DATE,
      isCurrent: true,
    },
    {
      competitor: EDGE_COMPETITOR,
      description: "Same-day future superseded price",
      category: "Comparison",
      price: 130,
      matchedPrayagCode: ITEM_CODE,
      matchStatus: "matched",
      matchConfidence: "High",
      effectiveDate: NEXT_DATE,
      isCurrent: true,
    },
    {
      competitor: EDGE_COMPETITOR,
      description: "Same-day future winner",
      category: "Comparison",
      price: 132,
      matchedPrayagCode: ITEM_CODE,
      matchStatus: "matched",
      matchConfidence: "High",
      effectiveDate: NEXT_DATE,
      isCurrent: false,
    },
  ]).returning();
  historicalCompetitorRowId = insertedCompetitorRows.find(
    (row) =>
      row.competitor === COMPETITOR &&
      row.effectiveDate === HISTORICAL_DATE &&
      row.matchedPrayagCode === ITEM_CODE,
  )!.id;
  futureCompetitorRowId = insertedCompetitorRows.find(
    (row) =>
      row.competitor === COMPETITOR &&
      row.effectiveDate === NEXT_DATE &&
      row.matchedPrayagCode === ITEM_CODE,
  )!.id;
});

afterAll(async () => {
  await db
    .delete(competitorPricesTable)
    .where(eq(competitorPricesTable.competitor, COMPETITOR));
  await db
    .delete(competitorPricesTable)
    .where(eq(competitorPricesTable.competitor, WITHDRAWN_COMPETITOR));
  await db
    .delete(competitorPricesTable)
    .where(eq(competitorPricesTable.competitor, REVIEW_COMPETITOR));
  await db
    .delete(competitorPricesTable)
    .where(eq(competitorPricesTable.competitor, EDGE_COMPETITOR));
  await db
    .delete(mrpPriceHistoryTable)
    .where(eq(mrpPriceHistoryTable.itemCode, ITEM_CODE));
  await db
    .delete(mrpPriceHistoryTable)
    .where(eq(mrpPriceHistoryTable.itemCode, FUTURE_MRP_ITEM));
  await db
    .delete(mrpPriceHistoryTable)
    .where(eq(mrpPriceHistoryTable.itemCode, WITHDRAWN_ITEM));
  await db
    .delete(catalogProductsTable)
    .where(eq(catalogProductsTable.itemCode, ITEM_CODE));
  await db
    .delete(catalogProductsTable)
    .where(eq(catalogProductsTable.itemCode, FUTURE_MRP_ITEM));
  await db
    .delete(catalogProductsTable)
    .where(eq(catalogProductsTable.itemCode, WITHDRAWN_ITEM));
});

describe("comparison current price windows", () => {
  it("uses the in-force competitor row for the current-vs-current side-by-side gap", async () => {
    const response = await request.get(
      `/catalog/comparison/by-product?search=${encodeURIComponent(ITEM_CODE)}`,
    );
    expect(response.status).toBe(200);
    const row = response.body.rows.find(
      (candidate: { itemCode: string }) => candidate.itemCode === ITEM_CODE,
    );
    expect(row).toMatchObject({
      prayagMrp: 150,
      prayagEffectiveDate: CURRENT_DATE,
      prayagValidTo: validToFromNextDate(NEXT_DATE),
      upcomingPrayagMrp: 165,
      upcomingPrayagEffectiveDate: NEXT_DATE,
      upcomingPrayagChangePct: 10,
      diffPct: -33.3,
    });
    expect(row.competitors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          competitor: COMPETITOR,
          price: 100,
          effectiveDate: CURRENT_DATE,
          validTo: validToFromNextDate(NEXT_DATE),
          upcomingPrice: 10,
          upcomingEffectiveDate: NEXT_DATE,
          upcomingChangePct: -90,
          diffPct: -33.3,
        }),
      ]),
    );
  });

  it("does not surface a product whose first Prayag MRP is still future-dated", async () => {
    const response = await request.get(
      `/catalog/comparison/by-product?search=${encodeURIComponent(FUTURE_MRP_ITEM)}`,
    );
    expect(response.status).toBe(200);
    expect(response.body.rows).toEqual([]);
  });

  it("does not surface a product on or after its scheduled withdrawal date", async () => {
    const [byProduct, comparison, summary, matrix, exported] = await Promise.all([
      request.get(
        `/catalog/comparison/by-product?search=${encodeURIComponent(WITHDRAWN_ITEM)}`,
      ),
      request.get(
        `/catalog/comparison?competitor=${encodeURIComponent(WITHDRAWN_COMPETITOR)}&pageSize=20`,
      ),
      request.get(
        `/catalog/comparison/summary?competitor=${encodeURIComponent(WITHDRAWN_COMPETITOR)}`,
      ),
      request.get(
        `/catalog/comparison/matrix?search=${encodeURIComponent(WITHDRAWN_ITEM)}`,
      ),
      request.get(
        `/catalog/comparison/export?competitor=${encodeURIComponent(WITHDRAWN_COMPETITOR)}&format=csv`,
      ),
    ]);
    expect(byProduct.status).toBe(200);
    expect(byProduct.body.rows).toEqual([]);
    expect(comparison.status).toBe(200);
    expect(comparison.body).toMatchObject({ rows: [], total: 0 });
    expect(summary.status).toBe(200);
    expect(summary.body).toMatchObject({ totalRows: 0, matchedRows: 0 });
    expect(matrix.status).toBe(200);
    expect(matrix.body).toMatchObject({ rows: [], total: 0 });
    expect(exported.status).toBe(200);
    expect(exported.text).not.toContain(WITHDRAWN_ITEM);
  }, 15_000);

  it("exports explicit current/window/next columns and leaves future-row gaps blank", async () => {
    const response = await request.get(
      `/catalog/comparison/export?competitor=${encodeURIComponent(COMPETITOR)}&format=csv`,
    );
    expect(response.status).toBe(200);
    const rows = response.text
      .trim()
      .split("\n")
      .map((line) =>
        line.split(",").map((cell) => cell.replace(/^"|"$/g, "").trim()),
      );
    const header = rows[0]!;
    expect(header).toEqual(
      expect.arrayContaining([
        "Competitor Valid From",
        "Competitor Valid To",
        "Competitor Next Price",
        "Prayag Current MRP",
        "Prayag Current Valid To",
        "Prayag Next MRP",
        "Current-vs-Current Diff %",
      ]),
    );

    const dateIndex = header.indexOf("Competitor Valid From");
    const currentIndex = header.indexOf("Competitor Price Is Current");
    const gapIndex = header.indexOf("Current-vs-Current Diff %");
    const currentRow = rows.find((row) => row[dateIndex] === CURRENT_DATE)!;
    const futureRow = rows.find((row) => row[dateIndex] === NEXT_DATE)!;
    expect(currentRow[currentIndex]).toBe("yes");
    expect(Number(currentRow[gapIndex])).toBe(-33.3);
    expect(futureRow[currentIndex]).toBe("no");
    expect(futureRow[gapIndex]).toBe("");
  });

  it("ignores null placeholders and uses the highest-id same-day competitor revision everywhere", async () => {
    const [comparison, summary, exported] = await Promise.all([
      request.get(
        `/catalog/comparison?competitor=${encodeURIComponent(EDGE_COMPETITOR)}&pageSize=20`,
      ),
      request.get(
        `/catalog/comparison/summary?competitor=${encodeURIComponent(EDGE_COMPETITOR)}`,
      ),
      request.get(
        `/catalog/comparison/export?competitor=${encodeURIComponent(EDGE_COMPETITOR)}&format=csv`,
      ),
    ]);

    expect(comparison.status).toBe(200);
    const currentRows = comparison.body.rows.filter(
      (row: { competitorPriceIsCurrent: boolean }) =>
        row.competitorPriceIsCurrent,
    );
    expect(currentRows).toHaveLength(1);
    expect(currentRows[0]).toMatchObject({
      description: "Same-day current winner",
      competitorPrice: 120,
      effectiveDate: CURRENT_DATE,
      competitorValidTo: validToFromNextDate(NEXT_DATE),
      upcomingCompetitorPrice: 132,
      upcomingCompetitorEffectiveDate: NEXT_DATE,
      upcomingCompetitorChangePct: 10,
      diffPct: -20,
    });
    const placeholder = comparison.body.rows.find(
      (row: { description: string }) =>
        row.description === "Later null-price placeholder",
    );
    expect(placeholder).toMatchObject({
      competitorPrice: null,
      competitorPriceIsCurrent: false,
      competitorValidTo: null,
      upcomingCompetitorPrice: null,
      upcomingCompetitorEffectiveDate: null,
      upcomingCompetitorChangePct: null,
      diffPct: null,
    });
    for (const description of [
      "Same-day superseded price",
      "Same-day future superseded price",
    ]) {
      const superseded = comparison.body.rows.find(
        (row: { description: string }) => row.description === description,
      );
      expect(superseded).toMatchObject({
        competitorPriceIsCurrent: false,
        competitorValidTo: null,
        upcomingCompetitorPrice: null,
        upcomingCompetitorEffectiveDate: null,
        upcomingCompetitorChangePct: null,
        diffPct: null,
      });
    }

    expect(summary.status).toBe(200);
    expect(summary.body).toMatchObject({
      totalRows: 1,
      matchedRows: 1,
      comparableRows: 1,
      avgDiffPct: -20,
    });

    expect(exported.status).toBe(200);
    const exportRows = exported.text
      .trim()
      .split("\n")
      .map((line) =>
        line.split(",").map((cell) => cell.replace(/^"|"$/g, "").trim()),
      );
    const header = exportRows[0]!;
    const descriptionIndex = header.indexOf("Description");
    const currentIndex = header.indexOf("Competitor Price Is Current");
    const validToIndex = header.indexOf("Competitor Valid To");
    const nextPriceIndex = header.indexOf("Competitor Next Price");
    const gapIndex = header.indexOf("Current-vs-Current Diff %");
    expect(
      exportRows.slice(1).filter((row) => row[currentIndex] === "yes"),
    ).toHaveLength(1);
    const exportedCurrent = exportRows.find(
      (row) => row[descriptionIndex] === "Same-day current winner",
    )!;
    expect(exportedCurrent[currentIndex]).toBe("yes");
    expect(Number(exportedCurrent[nextPriceIndex])).toBe(132);
    expect(Number(exportedCurrent[gapIndex])).toBe(-20);
    const exportedPlaceholder = exportRows.find(
      (row) => row[descriptionIndex] === "Later null-price placeholder",
    )!;
    expect(exportedPlaceholder[currentIndex]).toBe("no");
    expect(exportedPlaceholder[nextPriceIndex]).toBe("");
    expect(exportedPlaceholder[gapIndex]).toBe("");
    for (const description of [
      "Same-day superseded price",
      "Same-day future superseded price",
    ]) {
      const exportedSuperseded = exportRows.find(
        (row) => row[descriptionIndex] === description,
      )!;
      expect(exportedSuperseded[currentIndex]).toBe("no");
      expect(exportedSuperseded[validToIndex]).toBe("");
      expect(exportedSuperseded[nextPriceIndex]).toBe("");
      expect(exportedSuperseded[gapIndex]).toBe("");
    }
  });

  it("enriches the mapping-review export with both validity windows and next revisions", async () => {
    const response = await request.get(
      `/catalog/mapping-review/export?competitor=${encodeURIComponent(REVIEW_COMPETITOR)}&format=csv`,
    );
    expect(response.status).toBe(200);
    const rows = response.text
      .trim()
      .split("\n")
      .map((line) =>
        line.split(",").map((cell) => cell.replace(/^"|"$/g, "").trim()),
      );
    const header = rows[0]!;
    expect(header).toEqual(
      expect.arrayContaining([
        "Competitor Valid From",
        "Competitor Valid To",
        "Competitor Next Price",
        "Competitor Next Change %",
        "Prayag Current MRP",
        "Prayag Current Valid To",
        "Prayag Next MRP",
        "Current-vs-Current Diff %",
      ]),
    );
    const fromIndex = header.indexOf("Competitor Valid From");
    const toIndex = header.indexOf("Competitor Valid To");
    const nextPriceIndex = header.indexOf("Competitor Next Price");
    const nextChangeIndex = header.indexOf("Competitor Next Change %");
    const currentIndex = header.indexOf("Competitor Price Is Current");
    const currentRow = rows.find((row) => row[fromIndex] === CURRENT_DATE)!;
    expect(currentRow[toIndex]).toBe(validToFromNextDate(NEXT_DATE));
    expect(Number(currentRow[nextPriceIndex])).toBe(200);
    expect(Number(currentRow[nextChangeIndex])).toBe(5.3);
    expect(currentRow[currentIndex]).toBe("yes");
  });

  it("returns the actual window when a future mapping row is updated", async () => {
    const response = await request
      .patch(`/catalog/competitor-prices/${futureCompetitorRowId}`)
      .send({
        matchedPrayagCode: ITEM_CODE,
        matchStatus: "matched",
        matchConfidence: "High",
      });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: futureCompetitorRowId,
      competitorPriceIsCurrent: false,
      competitorValidTo: null,
      upcomingCompetitorPrice: null,
    });
    expect(response.body.diffPct).toBeNull();
  });

  it("returns the actual window when historical mappings are bulk-updated", async () => {
    const response = await request
      .patch("/catalog/competitor-prices/bulk")
      .send({
        updates: [
          {
            id: historicalCompetitorRowId,
            matchedPrayagCode: ITEM_CODE,
            matchStatus: "matched",
            matchConfidence: "High",
          },
        ],
      });
    expect(response.status).toBe(200);
    expect(response.body.rows[0]).toMatchObject({
      id: historicalCompetitorRowId,
      competitorPriceIsCurrent: false,
      competitorValidTo: validToFromNextDate(CURRENT_DATE),
      upcomingCompetitorPrice: 100,
      upcomingCompetitorEffectiveDate: CURRENT_DATE,
      upcomingCompetitorChangePct: -50,
    });
    expect(response.body.rows[0].diffPct).toBeNull();
  });
});