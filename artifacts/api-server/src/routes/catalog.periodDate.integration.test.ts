import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import supertest from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import {
  catalogProductsTable,
  competitorPricesTable,
  db,
  mrpHistoryProvenanceEventsTable,
  mrpPriceHistoryTable,
} from "@workspace/db";
import catalogImportExportRouter from "./catalogImportExport";
import { createMrpFixtureBatch, deleteMrpFixtureBatch } from "./testMrpFixture.js";

const RUN = Date.now();
const MRP_CODE = `__PERIOD_DATE_MRP_${RUN}__`;
const COMPETITOR = `__PERIOD_DATE_COMP_${RUN}__`;
const OLD_MRP_DATE = "2037-01-10";
const NEW_MRP_DATE = "2037-01-11";
const OLD_COMPETITOR_DATE = "2037-02-10";
const NEW_COMPETITOR_DATE = "2037-02-11";
const COLLIDING_COMPETITOR_DATE = "2037-02-12";
let fixtureBatchId = 0;

const app = express();
app.use(express.json());
app.use(catalogImportExportRouter);
const request = supertest(app);

beforeAll(async () => {
  fixtureBatchId = await createMrpFixtureBatch("period-date", RUN);
  await db.insert(catalogProductsTable).values({
    itemCode: MRP_CODE,
    productName: "Effective-date move fixture",
    division: "Test",
    category: "Test",
  });
  await db.insert(mrpPriceHistoryTable).values({
    itemCode: MRP_CODE,
    loadBatchId: fixtureBatchId,
    mrp: 125,
    priceBasis: "MRP",
    effectiveDate: OLD_MRP_DATE,
    loadDate: OLD_MRP_DATE,
  });
  await db.insert(competitorPricesTable).values({
    competitor: COMPETITOR,
    price: 100,
    effectiveDate: OLD_COMPETITOR_DATE,
    competitorCode: `fixture-${RUN}`,
    matchStatus: "matched",
  });
});

afterAll(async () => {
  await db.delete(mrpHistoryProvenanceEventsTable)
    .where(eq(mrpHistoryProvenanceEventsTable.itemCode, MRP_CODE));
  await db.delete(mrpPriceHistoryTable).where(eq(mrpPriceHistoryTable.itemCode, MRP_CODE));
  await deleteMrpFixtureBatch(fixtureBatchId);
  await db.delete(catalogProductsTable).where(eq(catalogProductsTable.itemCode, MRP_CODE));
  await db.delete(competitorPricesTable).where(eq(competitorPricesTable.competitor, COMPETITOR));
});

describe("effective-date corrections", () => {
  it("moves an MRP period and preserves an audit event", async () => {
    const response = await request.patch("/catalog/mrp-period-date").send({
      currentEffectiveDate: OLD_MRP_DATE,
      newEffectiveDate: NEW_MRP_DATE,
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ moved: 1, previousEffectiveDate: OLD_MRP_DATE, effectiveDate: NEW_MRP_DATE });

    const [history] = await db.select().from(mrpPriceHistoryTable)
      .where(eq(mrpPriceHistoryTable.itemCode, MRP_CODE));
    expect(history?.effectiveDate).toBe(NEW_MRP_DATE);
    const [event] = await db.select().from(mrpHistoryProvenanceEventsTable)
      .where(and(
        eq(mrpHistoryProvenanceEventsTable.itemCode, MRP_CODE),
        eq(mrpHistoryProvenanceEventsTable.action, "period_effective_date_changed"),
      ));
    expect(event).toMatchObject({
      effectiveDate: NEW_MRP_DATE,
      reason: `Effective date corrected from ${OLD_MRP_DATE} to ${NEW_MRP_DATE}`,
    });
  });

  it("moves a competitor period without merging into an existing date", async () => {
    const response = await request.patch("/catalog/competitor-period-date").send({
      competitor: COMPETITOR,
      currentEffectiveDate: OLD_COMPETITOR_DATE,
      newEffectiveDate: NEW_COMPETITOR_DATE,
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ moved: 1, competitor: COMPETITOR, effectiveDate: NEW_COMPETITOR_DATE });
    const [price] = await db.select().from(competitorPricesTable)
      .where(eq(competitorPricesTable.competitor, COMPETITOR));
    expect(price?.effectiveDate).toBe(NEW_COMPETITOR_DATE);

    await db.insert(competitorPricesTable).values({
      competitor: COMPETITOR,
      price: 110,
      effectiveDate: COLLIDING_COMPETITOR_DATE,
      competitorCode: `collision-${RUN}`,
      matchStatus: "matched",
    });
    const conflict = await request.patch("/catalog/competitor-period-date").send({
      competitor: COMPETITOR,
      currentEffectiveDate: COLLIDING_COMPETITOR_DATE,
      newEffectiveDate: NEW_COMPETITOR_DATE,
    });
    expect(conflict.status).toBe(409);
  });
});