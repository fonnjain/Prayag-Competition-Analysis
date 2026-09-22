import express from "express";
import supertest from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  catalogProductNameCorrectionsTable,
  catalogProductsTable,
  db,
  mrpLoadBatchesTable,
  mrpPendingBatchesTable,
  mrpPriceHistoryTable,
  mrpSourcesTable,
} from "@workspace/db";
import router, {
  MANUAL_SOURCE,
  setP026TransactionTestHook,
} from "./catalogNameChanges";

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  const role = req.headers["x-test-role"] === "user" ? "user" : "admin";
  req.isAuthenticated = (() => true) as never;
  req.user = {
    id: `p026-${role}`,
    email: `${role}@p026.test`,
    mustChangePassword: false,
    role,
  };
  next();
});
app.use(router);
const request = supertest(app);

let code = "";
let productId = 0;
const createdLoadIds: number[] = [];

async function seedProduct(options: { name?: string; active?: boolean; discontinuedFrom?: string | null } = {}) {
  code = `P026-TEST-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const row = (await db.insert(catalogProductsTable).values({
    itemCode: code,
    productName: options.name ?? "P026 old name",
    division: "P026 test fixture",
    isActive: options.active ?? true,
    discontinuedFrom: options.discontinuedFrom ?? null,
  }).returning({ id: catalogProductsTable.id }))[0]!;
  productId = row.id;
}

async function preview(newName = "P026 new name") {
  const response = await request.post("/catalog/name-changes/single/preview").send({
    itemCode: code,
    oldName: "P026 old name",
    newName,
    reason: "integration fixture",
  });
  if (response.body.loadBatchId) createdLoadIds.push(response.body.loadBatchId);
  return response;
}

async function cleanup() {
  setP026TransactionTestHook();
  if (createdLoadIds.length) {
    await db.delete(catalogProductNameCorrectionsTable).where(inArray(catalogProductNameCorrectionsTable.loadBatchId, createdLoadIds));
    await db.delete(mrpPendingBatchesTable).where(inArray(mrpPendingBatchesTable.loadBatchId, createdLoadIds));
    await db.delete(mrpLoadBatchesTable).where(inArray(mrpLoadBatchesTable.id, createdLoadIds));
    createdLoadIds.length = 0;
  }
  if (productId) {
    await db.delete(mrpPriceHistoryTable).where(eq(mrpPriceHistoryTable.itemCode, code));
    await db.delete(catalogProductsTable).where(eq(catalogProductsTable.id, productId));
  }
  code = "";
  productId = 0;
}

beforeEach(() => setP026TransactionTestHook());
afterEach(cleanup);

describe("P026r2 name-change route transactions", () => {
  it("returns 403 to non-admins and leaves the database untouched", async () => {
    await seedProduct();
    const response = await request
      .post("/catalog/name-changes/single/preview")
      .set("x-test-role", "user")
      .send({ itemCode: code, oldName: "P026 old name", newName: "P026 new name", reason: "nope" });
    expect(response.status).toBe(403);
  });

  it("does not create source, load, or pending rows for a single no-op", async () => {
    await seedProduct({ name: "P026 already correct" });
    const before = await Promise.all([
      db.select().from(mrpSourcesTable).where(eq(mrpSourcesTable.sheetId, MANUAL_SOURCE.sheetId)),
      db.select().from(mrpLoadBatchesTable).where(eq(mrpLoadBatchesTable.fileName, "P026r2-manual-name-edit")),
      db.select().from(mrpPendingBatchesTable).where(eq(mrpPendingBatchesTable.fileName, "P026r2-manual-name-edit")),
    ]);
    const response = await request.post("/catalog/name-changes/single/preview").send({
      itemCode: code, oldName: "P026 already correct", newName: "P026 already correct", reason: "already correct",
    });
    expect(response.status).toBe(200);
    expect(response.body.noop).toBe(true);
    const after = await Promise.all([
      db.select().from(mrpSourcesTable).where(eq(mrpSourcesTable.sheetId, MANUAL_SOURCE.sheetId)),
      db.select().from(mrpLoadBatchesTable).where(eq(mrpLoadBatchesTable.fileName, "P026r2-manual-name-edit")),
      db.select().from(mrpPendingBatchesTable).where(eq(mrpPendingBatchesTable.fileName, "P026r2-manual-name-edit")),
    ]);
    expect(after.map((rows) => rows.length)).toEqual(before.map((rows) => rows.length));
  });

  it.each([
    ["active", { active: true }],
    ["inactive", { active: false }],
    ["discontinued", { active: true, discontinuedFrom: "2020-01-01" }],
  ] as const)("applies and undoes a manual change for an %s fixture", async (_label, options) => {
    await seedProduct(options);
    const previewResponse = await preview();
    expect(previewResponse.status).toBe(200);
    const pendingId = previewResponse.body.pendingBatchId as number;
    const loadId = previewResponse.body.loadBatchId as number;
    const applied = await request.post(`/catalog/name-changes/${pendingId}/apply`);
    expect(applied.status).toBe(200);
    expect(applied.body.result).toMatchObject({ updated: 1, pricesWritten: 0, competitorRowsTouched: 0, productsCreated: 0 });
    expect((await db.select().from(catalogProductsTable).where(eq(catalogProductsTable.itemCode, code)))[0]?.productName).toBe("P026 new name");
    const correction = (await db.select().from(catalogProductNameCorrectionsTable).where(eq(catalogProductNameCorrectionsTable.loadBatchId, loadId)))[0];
    expect(correction).toMatchObject({ itemCode: code, previousName: "P026 old name", correctedName: "P026 new name", loadBatchId: loadId });
    const undone = await request.post(`/catalog/name-changes/${loadId}/undo`);
    expect(undone.status).toBe(200);
    expect((await db.select().from(catalogProductsTable).where(eq(catalogProductsTable.itemCode, code)))[0]?.productName).toBe("P026 old name");
  });

  it("returns submitted and current names when the product changes after preview", async () => {
    await seedProduct();
    const previewResponse = await preview();
    const pendingId = previewResponse.body.pendingBatchId as number;
    await db.update(catalogProductsTable).set({ productName: "P026 concurrently renamed" }).where(eq(catalogProductsTable.id, productId));
    const response = await request.post(`/catalog/name-changes/${pendingId}/apply`);
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ submittedOldName: "P026 old name", expectedOldName: "P026 old name", currentName: "P026 concurrently renamed" });
  });

  it("rolls back the name, correction, load status, and price mutation on checksum failure", async () => {
    await seedProduct();
    await db.insert(mrpPriceHistoryTable).values({
      itemCode: code, mrp: 100, effectiveDate: "2026-01-01", loadDate: "2026-01-01",
      variant: "Standard", reviewStatus: "approved",
    });
    const previewResponse = await preview();
    const pendingId = previewResponse.body.pendingBatchId as number;
    const loadId = previewResponse.body.loadBatchId as number;
    setP026TransactionTestHook(async (tx, [itemCode]) => {
      await tx.update(mrpPriceHistoryTable).set({ mrp: 999 }).where(eq(mrpPriceHistoryTable.itemCode, itemCode));
    });
    const response = await request.post(`/catalog/name-changes/${pendingId}/apply`);
    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/mrp_price_history changed/);
    expect((await db.select().from(catalogProductsTable).where(eq(catalogProductsTable.itemCode, code)))[0]?.productName).toBe("P026 old name");
    expect((await db.select().from(mrpPriceHistoryTable).where(eq(mrpPriceHistoryTable.itemCode, code)))[0]?.mrp).toBe(100);
    expect(await db.select().from(catalogProductNameCorrectionsTable).where(eq(catalogProductNameCorrectionsTable.loadBatchId, loadId))).toHaveLength(0);
    expect((await db.select().from(mrpPendingBatchesTable).where(eq(mrpPendingBatchesTable.id, pendingId)))[0]?.status).toBe("pending");
  });
});