import express from "express";
import supertest from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, like } from "drizzle-orm";
import {
  db,
  catalogPriceEditAuditsTable,
  catalogProductsTable,
  competitorPricesTable,
  mrpPriceHistoryTable,
  mrpHistoryProvenanceEventsTable,
  mrpLoadBatchesTable,
  mrpSourcesTable,
} from "@workspace/db";
import { dateMeaning } from "./priceEditor";
import { warningFor } from "./mrpRevision";
import priceEditorRouter from "./priceEditor";
import { createMrpFixtureBatch, deleteMrpFixtureBatch } from "./testMrpFixture";

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.isAuthenticated = (() => true) as typeof req.isAuthenticated;
  req.user = { id: "editor-test", email: "editor-test@example.com", role: "admin", mustChangePassword: false } as any;
  next();
});
app.use(priceEditorRouter);
const request = supertest(app);
const testCode = `__price_editor_${Date.now()}__`;
const testCode2 = `${testCode}_first_mapping`;
const testCompetitor = `__price_editor_competitor_${Date.now()}__`;
let fixtureBatchId = 0;

beforeAll(async () => {
  fixtureBatchId = await createMrpFixtureBatch("price-editor", Date.now());
  await db.insert(catalogProductsTable).values({
    itemCode: testCode,
    productName: "Price editor test product",
    division: "PTMT",
    category: "Test",
    uom: "NOS",
  });
  await db.insert(catalogProductsTable).values({
    itemCode: testCode2,
    productName: "Price editor first mapping test product",
    division: "PTMT",
    category: "Test",
    uom: "NOS",
  });
  // This row makes the competitor configured without mapping it to our product.
  await db.insert(competitorPricesTable).values({
    competitor: testCompetitor,
    price: 88,
    effectiveDate: "2025-01-01",
    matchedPrayagCode: "__other_product__",
    matchStatus: "matched",
  });
});

afterAll(async () => {
  await db.delete(catalogPriceEditAuditsTable).where(eq(catalogPriceEditAuditsTable.itemCode, testCode));
  await db.delete(catalogPriceEditAuditsTable).where(eq(catalogPriceEditAuditsTable.itemCode, testCode2));
  // Remove competitor rows before the fixture batch: competitor_prices.load_batch_id
  // references the MRP fixture batch and must not block its cleanup.
  await db.delete(competitorPricesTable).where(
    eq(competitorPricesTable.competitor, testCompetitor),
  );
  await db.delete(mrpPriceHistoryTable).where(eq(mrpPriceHistoryTable.itemCode, testCode));
  await deleteMrpFixtureBatch(fixtureBatchId);
  await db.delete(mrpLoadBatchesTable).where(
    like(mrpLoadBatchesTable.fileName, `manual-competitor-correction:${testCompetitor}:%`),
  );
  const source = (await db.select({ id: mrpSourcesTable.id }).from(mrpSourcesTable)
    .where(eq(mrpSourcesTable.sheetId, "manual-competitor-corrections")).limit(1))[0];
  if (source && !(await db.select({ id: mrpLoadBatchesTable.id }).from(mrpLoadBatchesTable)
    .where(eq(mrpLoadBatchesTable.sourceId, source.id)).limit(1)).length) {
    await db.delete(mrpSourcesTable).where(eq(mrpSourcesTable.id, source.id));
  }
  await db.delete(catalogProductsTable).where(eq(catalogProductsTable.itemCode, testCode));
  await db.delete(catalogProductsTable).where(eq(catalogProductsTable.itemCode, testCode2));
});

describe("single-product price editor semantics", () => {
  it("links competitor edits and restores the prior batch on undo", async () => {
    const effectiveDate = "2026-09-01";
    const [seed] = await db.insert(competitorPricesTable).values({
      competitor: testCompetitor, price: 91, effectiveDate,
      matchedPrayagCode: testCode, matchStatus: "matched", loadBatchId: fixtureBatchId,
    }).returning({ id: competitorPricesTable.id });
    const saved = await request.post("/catalog/price-editor/save").send({
      itemCode: testCode, series: testCompetitor, value: 99, effectiveDate,
      remarks: "isolated provenance test",
    }).expect(200);
    const changed = (await db.select().from(competitorPricesTable)
      .where(eq(competitorPricesTable.id, seed!.id)))[0]!;
    expect(changed.loadBatchId).toEqual(expect.any(Number));
    expect(changed.loadBatchId).not.toBe(fixtureBatchId);
    await request.post(`/catalog/price-editor/undo/${saved.body.audit.id}`).expect(200);
    const restored = (await db.select().from(competitorPricesTable)
      .where(eq(competitorPricesTable.id, seed!.id)))[0]!;
    expect(restored.price).toBe(91);
    expect(restored.loadBatchId).toBe(fixtureBatchId);
  });

  it("distinguishes correction, immediate, and scheduled changes", () => {
    expect(dateMeaning("2099-01-01", true).operation).toBe("correction");
    expect(dateMeaning("2000-01-01", false).operation).toBe("immediate");
    expect(dateMeaning("2099-01-01", false).operation).toBe("scheduled");
  });

  it("keeps plausibility warnings non-blocking and applies both guards", () => {
    const warnings = warningFor("TEST-PTMT", "PTMT", 100, 20);
    expect(warnings.some((warning) => warning.includes("below ₹50"))).toBe(true);
    expect(warnings.some((warning) => warning.includes("below -20%"))).toBe(true);
  });

  it("warns on a first PTMT price even without a previous value", () => {
    expect(warningFor("__first_price__", "PTMT", null, 25)
      .some((warning) => warning.includes("below ₹50"))).toBe(true);
  });

  it("does not classify an exact-period value as an addition", () => {
    expect(dateMeaning("2026-01-01", true)).toMatchObject({
      operation: "correction",
      wording: expect.stringContaining("corrects"),
    });
  });

  it("rejects non-admin sessions at the router boundary", async () => {
    const guarded = express();
    guarded.use(express.json());
    guarded.use((req, _res, next) => {
      req.isAuthenticated = (() => true) as typeof req.isAuthenticated;
      req.user = { id: "sales", email: "sales@example.com", role: "sales", mustChangePassword: false } as any;
      next();
    });
    guarded.use(priceEditorRouter);
    await supertest(guarded).post("/catalog/price-editor/save").send({}).expect(403);
    await supertest(guarded).post("/catalog/price-editor/new-product/preview").send({}).expect(403);
    await supertest(guarded).post("/catalog/price-editor/new-product/apply").send({}).expect(403);
    await supertest(guarded).post("/catalog/price-editor/new-product/undo/1").send({}).expect(403);
    await supertest(guarded).post("/catalog/price-editor/new-product/deactivate/1").send({}).expect(403);
  });

  it("requires remarks before any database mutation", async () => {
    await request.post("/catalog/price-editor/save").send({
      itemCode: "__missing_editor_product__",
      series: "Prayag MRP",
      value: 10,
      effectiveDate: "2026-01-01",
    }).expect(400);
  });

  it("rejects unknown products without creating an audit", async () => {
    const before = await db.select({ id: catalogPriceEditAuditsTable.id }).from(catalogPriceEditAuditsTable);
    await request.post("/catalog/price-editor/save").send({
      itemCode: "__missing_editor_product__",
      series: "Prayag MRP",
      value: 10,
      effectiveDate: "2026-01-01",
      remarks: "test",
    }).expect(404);
    const after = await db.select({ id: catalogPriceEditAuditsTable.id }).from(catalogPriceEditAuditsTable);
    expect(after.length).toBe(before.length);
  });

  it("saves one Prayag row and records complete immutable attribution", async () => {
    await db.insert(mrpPriceHistoryTable).values({
      itemCode: testCode,
      mrp: 90,
      priceBasis: "MRP",
      effectiveDate: "2098-01-01",
      loadDate: "2098-01-01",
      reviewStatus: "approved",
      variant: "Standard",
      loadBatchId: fixtureBatchId,
    });
    const before = await db.select({ count: mrpPriceHistoryTable.id }).from(mrpPriceHistoryTable)
      .where(eq(mrpPriceHistoryTable.itemCode, testCode));
    const response = await request.post("/catalog/price-editor/save").send({
      itemCode: testCode,
      series: "Prayag MRP",
      value: 125,
      effectiveDate: "2099-01-01",
      remarks: "Focused test correction",
    }).expect(200);
    const after = await db.select({ count: mrpPriceHistoryTable.id }).from(mrpPriceHistoryTable)
      .where(eq(mrpPriceHistoryTable.itemCode, testCode));
    expect(after.length - before.length).toBe(1);
    expect(response.body.audit).toMatchObject({
      actor: "editor-test@example.com",
      itemCode: testCode,
      series: "Prayag MRP",
      operationType: "save",
      oldValue: null,
      newValue: 125,
      previousResolvedValue: 90,
      effectiveDate: "2099-01-01",
      remarks: "Focused test correction",
    });
    const preview = await request.post("/catalog/price-editor/preview").send({
      itemCode: testCode, series: "Prayag MRP", value: 130, effectiveDate: "2099-02-01",
    }).expect(200);
    expect(preview.body.previousResolvedValue).toBe(125);
  });

  it("corrects an existing competitor period and supports first mapping", async () => {
    await db.insert(competitorPricesTable).values({
      competitor: testCompetitor,
      price: 100,
      effectiveDate: "2098-01-01",
      matchedPrayagCode: testCode,
      matchStatus: "matched",
    });
    const correction = await request.post("/catalog/price-editor/save").send({
      itemCode: testCode, series: testCompetitor, value: 110,
      effectiveDate: "2098-01-01", remarks: "Correct competitor period",
    }).expect(200);
    expect(correction.body.firstCompetitorMapping).toBe(false);
    const rows = await db.select().from(competitorPricesTable).where(and(
      eq(competitorPricesTable.competitor, testCompetitor),
      eq(competitorPricesTable.matchedPrayagCode, testCode),
      eq(competitorPricesTable.effectiveDate, "2098-01-01"),
    ));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.price).toBe(110);

    const first = await request.post("/catalog/price-editor/save").send({
      itemCode: testCode2, series: testCompetitor, value: 77,
      effectiveDate: "2097-01-01", remarks: "Add first mapped competitor price",
    }).expect(200);
    expect(first.body.firstCompetitorMapping).toBe(true);
    expect(first.body.audit.oldValue).toBeNull();
    const mapped = await db.select().from(competitorPricesTable).where(and(
      eq(competitorPricesTable.competitor, testCompetitor),
      eq(competitorPricesTable.matchedPrayagCode, testCode2),
      eq(competitorPricesTable.effectiveDate, "2097-01-01"),
    ));
    expect(mapped).toHaveLength(1);
  });

  it("undoes a save, preserves original audit, and rejects repeated/invalid undo", async () => {
    const saved = await request.post("/catalog/price-editor/save").send({
      itemCode: testCode, series: "Prayag MRP", value: 140,
      effectiveDate: "2096-01-01", remarks: "Undo fixture",
    }).expect(200);
    const originalId = saved.body.audit.id as number;
    const undone = await request.post(`/catalog/price-editor/undo/${originalId}`).expect(200);
    expect(undone.body.reversal).toMatchObject({
      operationType: "reversal",
      originalAuditId: originalId,
      oldValue: 140,
      newValue: null,
    });
    const audits = await db.select().from(catalogPriceEditAuditsTable).where(
      eq(catalogPriceEditAuditsTable.itemCode, testCode),
    );
    expect(audits.some((audit) => audit.id === originalId)).toBe(true);
    const restored = await db.select().from(mrpPriceHistoryTable).where(and(
      eq(mrpPriceHistoryTable.itemCode, testCode),
      eq(mrpPriceHistoryTable.effectiveDate, "2096-01-01"),
      eq(mrpPriceHistoryTable.variant, "Standard"),
    ));
    expect(restored).toHaveLength(0);
    await request.post(`/catalog/price-editor/undo/${originalId}`).expect(409);
    const stale = await request.post("/catalog/price-editor/save").send({
      itemCode: testCode, series: "Prayag MRP", value: 150,
      effectiveDate: "2095-01-01", remarks: "Stale undo fixture",
    }).expect(200);
    await db.update(mrpPriceHistoryTable).set({ mrp: 151 }).where(and(
      eq(mrpPriceHistoryTable.itemCode, testCode),
      eq(mrpPriceHistoryTable.effectiveDate, "2095-01-01"),
      eq(mrpPriceHistoryTable.variant, "Standard"),
    ));
    await request.post(`/catalog/price-editor/undo/${stale.body.audit.id}`).expect(409);
    await request.post("/catalog/price-editor/undo/not-an-id").expect(400);
  });

  it("previews, normalizes, attributes, and safely undoes one new product", async () => {
    const rawCode = `  p020_test_${Date.now()}.0 `;
    const preview = await request.post("/catalog/price-editor/new-product/preview").send({
      itemCode: rawCode, productName: "P020 Manual Product", division: "PTMT",
      series: "Test Range", category: "Test", size: "1", mrp: 321,
      effectiveDate: "2000-01-01", reason: "P020 focused creation test", newSeriesConfirmed: true,
    }).expect(200);
    expect(preview.body.normalizedCode).toBe(rawCode.toUpperCase().replace(/\s+/g, "").replace(/\.0$/, ""));
    expect(typeof preview.body.periodExists).toBe("boolean");
    const applied = await request.post("/catalog/price-editor/new-product/apply").send({
      ...preview.body, token: preview.body.token, unusualCodeConfirmed: true,
    });
    if (applied.status !== 200) throw new Error(`apply failed ${applied.status}: ${JSON.stringify(applied.body)}`);
    expect(applied.body.product.itemCode).toBe(preview.body.normalizedCode);
    expect(applied.body.movedCompetitorRows).toEqual([]);
    expect(applied.body.audit.actor).toBe("editor-test@example.com");
    const provenance = await db.select().from(mrpHistoryProvenanceEventsTable).where(eq(
      mrpHistoryProvenanceEventsTable.itemCode, preview.body.normalizedCode,
    ));
    expect(provenance).toHaveLength(1);
    const status = await request.get(`/catalog/price-editor/new-product/undo/${applied.body.audit.id}`).expect(200);
    expect(status.body.canUndo).toBe(true);
    await request.post(`/catalog/price-editor/new-product/undo/${applied.body.audit.id}`).expect(200);
    expect(await db.select().from(catalogProductsTable).where(eq(catalogProductsTable.itemCode, preview.body.normalizedCode))).toHaveLength(0);
    await request.post("/catalog/price-editor/new-product/apply").send({
      ...preview.body, token: preview.body.token, unusualCodeConfirmed: true,
    }).expect(409);
  });

  it("warns for unusual codes but requires explicit Continue anyway", async () => {
    const rawCode = `ZZZ_UNUSUAL_${Date.now()}`;
    const preview = await request.post("/catalog/price-editor/new-product/preview").send({
      itemCode: rawCode, productName: "P020 Unusual Product", division: "PTMT",
      series: "Test Range", category: "Test", mrp: 322, effectiveDate: "2099-01-01",
      reason: "unusual code confirmation test", newSeriesConfirmed: true,
    }).expect(200);
    expect(preview.body.unusualShape).toBe(true);
    await request.post("/catalog/price-editor/new-product/apply").send({
      ...preview.body, token: preview.body.token,
    }).expect(400);
    const applied = await request.post("/catalog/price-editor/new-product/apply").send({
      ...preview.body, token: preview.body.token, unusualCodeConfirmed: true,
    }).expect(200);
    await request.post(`/catalog/price-editor/new-product/undo/${applied.body.audit.id}`).expect(200);
  });

  it("offers deactivation only after a reference makes undo unsafe", async () => {
    const rawCode = `P020_REF_${Date.now()}`;
    const preview = await request.post("/catalog/price-editor/new-product/preview").send({
      itemCode: rawCode, productName: "P020 Referenced Product", division: "PTMT",
      series: "Test Range", category: "Test", mrp: 323, effectiveDate: "2099-01-01",
      reason: "reference safety test", newSeriesConfirmed: true,
    }).expect(200);
    const applied = await request.post("/catalog/price-editor/new-product/apply").send({
      ...preview.body, token: preview.body.token, unusualCodeConfirmed: true,
    }).expect(200);
    await db.insert(competitorPricesTable).values({
      competitor: testCompetitor, price: 40, effectiveDate: "2099-01-01",
      matchedPrayagCode: rawCode, matchStatus: "matched",
    });
    const status = await request.get(`/catalog/price-editor/new-product/undo/${applied.body.audit.id}`).expect(200);
    expect(status.body.canUndo).toBe(false);
    await request.post(`/catalog/price-editor/new-product/deactivate/${applied.body.audit.id}`)
      .send({ reason: "Referenced by competitor mapping" }).expect(200);
    await request.post(`/catalog/price-editor/new-product/deactivate/${applied.body.audit.id}`)
      .send({ reason: "Repeat" }).expect(409);
    await db.delete(competitorPricesTable).where(and(
      eq(competitorPricesTable.competitor, testCompetitor), eq(competitorPricesTable.matchedPrayagCode, rawCode),
    ));
    await db.delete(catalogPriceEditAuditsTable).where(eq(catalogPriceEditAuditsTable.itemCode, rawCode));
    await db.delete(mrpPriceHistoryTable).where(eq(mrpPriceHistoryTable.itemCode, rawCode));
    await db.delete(catalogProductsTable).where(eq(catalogProductsTable.itemCode, rawCode));
  });

  it("rejects duplicate normalized product codes with the existing product", async () => {
    const response = await request.post("/catalog/price-editor/new-product/preview").send({
      itemCode: ` ${testCode} `, productName: "Collision", division: "PTMT",
      series: "Test Range", category: "Test", mrp: 10, effectiveDate: "2099-01-01",
      reason: "duplicate check", newSeriesConfirmed: true,
    }).expect(400);
    expect(response.body.error).toContain("already exists");
  });
});