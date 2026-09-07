import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import supertest from "supertest";
import { inArray } from "drizzle-orm";
import {
  catalogProductsTable,
  db,
  mrpPriceHistoryTable,
} from "@workspace/db";
import analysisRouter from "./analysis.js";
import catalogRouter from "./catalog.js";
import catalogImportExportRouter from "./catalogImportExport.js";
import priceFinderRouter from "./priceFinder.js";
import { createMrpFixtureBatch, deleteMrpFixtureBatch } from "./testMrpFixture.js";

const RUN = Date.now();
const DATE = "2026-09-01";
const SAFE_CODE = `OPAQUE-${RUN}-SAFE`;
const ITEM_CODES = [
  SAFE_CODE,
  `OPAQUE-${RUN}/SLASH`,
  `OPAQUE-${RUN}%PERCENT`,
  `OPAQUE-${RUN}#HASH`,
  `OPAQUE-${RUN}+PLUS`,
  `OPAQUE-${RUN} SPACE`,
];
let fixtureBatchId = 0;

const app = express();
app.use(express.json());
app.use(catalogRouter);
app.use(priceFinderRouter);
app.use(analysisRouter);
app.use(catalogImportExportRouter);
const request = supertest(app);

beforeAll(async () => {
  fixtureBatchId = await createMrpFixtureBatch("opaque-codes", RUN);
  await db.insert(catalogProductsTable).values(
    ITEM_CODES.map((itemCode) => ({
      itemCode,
      productName: `Opaque route fixture ${itemCode}`,
      division: "Route fixtures",
      category: "Opaque codes",
      isActive: true,
    })),
  );
  await db.insert(mrpPriceHistoryTable).values(
    ITEM_CODES.map((itemCode, index) => ({
      itemCode,
      loadBatchId: fixtureBatchId,
      mrp: 100 + index,
      priceBasis: "MRP",
      effectiveDate: DATE,
      loadDate: DATE,
      variant: "Standard",
      reviewStatus: "approved",
      isCurrent: true,
    })),
  );
});

afterAll(async () => {
  await db
    .delete(mrpPriceHistoryTable)
    .where(inArray(mrpPriceHistoryTable.itemCode, ITEM_CODES));
  await deleteMrpFixtureBatch(fixtureBatchId);
  await db
    .delete(catalogProductsTable)
    .where(inArray(catalogProductsTable.itemCode, ITEM_CODES));
});

describe("opaque item-code query routes", () => {
  it.each(ITEM_CODES)("round-trips %s through every read route", async (itemCode) => {
    const catalog = await request
      .get("/catalog/product")
      .query({ itemCode, asOf: DATE });
    expect(catalog.status).toBe(200);
    expect(catalog.body.product.itemCode).toBe(itemCode);

    const finder = await request
      .get("/price-finder/product")
      .query({ itemCode });
    expect(finder.status).toBe(200);
    expect(finder.body.product.itemCode).toBe(itemCode);

    const history = await request
      .get("/analysis/price-history")
      .query({ itemCode, asOf: DATE });
    expect(history.status).toBe(200);
    expect(history.body.itemCode).toBe(itemCode);
  });

  it("keeps the legacy path route for path-safe bookmarks", async () => {
    const response = await request
      .get(`/catalog/products/${SAFE_CODE}`)
      .query({ asOf: DATE });
    expect(response.status).toBe(200);
    expect(response.body.product.itemCode).toBe(SAFE_CODE);
  });

  it("exports distinct in-force and exact-date revision scopes", async () => {
    const inForce = await request
      .get("/catalog/export")
      .query({ type: "catalog", scope: "in-force", format: "csv", asOf: DATE });
    expect(inForce.status).toBe(200);
    for (const itemCode of ITEM_CODES) expect(inForce.text).toContain(itemCode);

    const revisions = await request
      .get("/catalog/export")
      .query({ type: "catalog", scope: "revisions", format: "csv", asOf: DATE });
    expect(revisions.status).toBe(200);
    for (const itemCode of ITEM_CODES) expect(revisions.text).toContain(itemCode);
    expect(inForce.headers["content-disposition"]).toContain("in-force");
    expect(revisions.headers["content-disposition"]).toContain("revisions");
  });
});