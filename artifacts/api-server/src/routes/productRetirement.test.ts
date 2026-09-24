import express from "express";
import supertest from "supertest";
import { describe, expect, it } from "vitest";
import { db, catalogProductsTable } from "@workspace/db";
import { and, eq, isNotNull, lte } from "drizzle-orm";
import retirementRouter from "./productRetirement";
import catalogRouter from "./catalog";

function requester(role: "admin" | "user") {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.isAuthenticated = (() => true) as never;
    req.user = { id: "retirement-test", email: "retirement-test@example.invalid", role,
      mustChangePassword: false } as never;
    next();
  });
  app.use(retirementRouter);
  return supertest(app);
}

describe("retirement safety boundary (read-only checks)", () => {
  it("refuses non-admin preview, apply, and undo", async () => {
    const user = requester("user");
    const responses = await Promise.all([
      user.post("/admin/product-retirement/preview").send({ itemCodes: ["TEST"], discontinuedFrom: "2026-09-24" }),
      user.post("/admin/product-retirement/apply").send({ items: [], discontinuedFrom: "2026-09-24", reason: "test" }),
      user.post("/admin/product-retirement/undo/1"),
    ]);
    expect(responses.map((response) => response.status)).toEqual([403, 403, 403]);
  });

  it("rejects invalid calendar dates, duplicate codes, and apply without preview", async () => {
    const admin = requester("admin");
    expect((await admin.post("/admin/product-retirement/preview")
      .send({ itemCodes: ["TEST"], discontinuedFrom: "2026-02-30" })).status).toBe(400);
    expect((await admin.post("/admin/product-retirement/preview")
      .send({ itemCodes: ["TEST", "TEST"], discontinuedFrom: "2026-09-24" })).status).toBe(400);
    expect((await admin.post("/admin/product-retirement/apply")
      .send({ items: [{ itemCode: "TEST" }], discontinuedFrom: "2026-09-24", reason: "test" })).status).toBe(400);
  });

  it("previews without removing price rows and refuses stale apply", async () => {
    const [product] = await db.select({ itemCode: catalogProductsTable.itemCode })
      .from(catalogProductsTable).where(eq(catalogProductsTable.isActive, true))
      .limit(1);
    expect(product).toBeDefined();
    const admin = requester("admin");
    const preview = await admin.post("/admin/product-retirement/preview")
      .send({ itemCodes: [product.itemCode], discontinuedFrom: "2035-03-01" });
    expect(preview.status).toBe(200);
    expect(preview.body.historyAfter).toBe(preview.body.historyBefore);
    expect(preview.body.results[0].itemCode).toBe(product.itemCode);
    if (preview.body.results[0].allowed) {
      const switchedDate = await admin.post("/admin/product-retirement/apply").send({
        items: [{ itemCode: product.itemCode, fingerprint: preview.body.results[0].fingerprint }],
        discontinuedFrom: "2035-03-02", reason: "testing a changed date",
      });
      expect(switchedDate.body.results).toMatchObject([{ itemCode: product.itemCode, applied: false }]);
    }
    const stale = await admin.post("/admin/product-retirement/apply").send({
      items: [{ itemCode: product.itemCode, fingerprint: "0".repeat(64) }],
      discontinuedFrom: "2035-03-01", reason: "testing stale preview",
    });
    expect(stale.status).toBe(200);
    expect(stale.body.results).toMatchObject([{ itemCode: product.itemCode, applied: false }]);
    const [unchanged] = await db.select({ discontinuedFrom: catalogProductsTable.discontinuedFrom })
      .from(catalogProductsTable).where(eq(catalogProductsTable.itemCode, product.itemCode)).limit(1);
    expect(unchanged.discontinuedFrom).toBe(preview.body.results[0].priorDiscontinuedFrom);
  });

  it("does not expose the unverified Delete draft", async () => {
    const response = await requester("admin").post("/admin/product-lifecycle/delete");
    expect(response.status).toBe(404);
  });

  it("lets an admin recover undo IDs after leaving the confirmation dialog", async () => {
    const response = await requester("admin").get("/admin/product-retirement/recent");
    expect(response.status).toBe(200);
    expect(response.body.results).toEqual(expect.any(Array));
  });

  it("retired products remain historically resolvable and visible to external catalogue consumers", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const [product] = await db.select({
      itemCode: catalogProductsTable.itemCode, discontinuedFrom: catalogProductsTable.discontinuedFrom,
    }).from(catalogProductsTable).where(and(
      eq(catalogProductsTable.isActive, true),
      isNotNull(catalogProductsTable.discontinuedFrom),
      lte(catalogProductsTable.discontinuedFrom, today),
    )).limit(1);
    expect(product?.discontinuedFrom).toBeTruthy();
    const previous = new Date(`${product.discontinuedFrom}T00:00:00Z`);
    previous.setUTCDate(previous.getUTCDate() - 1);
    const pastDate = previous.toISOString().slice(0, 10);
    const internal = express(); internal.use(catalogRouter);
    const external = express(); external.use((_req, res, next) => { res.locals.includeRetiredProducts = true; next(); }); external.use(catalogRouter);
    const path = `/catalog/product?itemCode=${encodeURIComponent(product.itemCode)}`;
    expect((await supertest(internal).get(`${path}&asOf=${pastDate}`)).status).toBe(200);
    expect((await supertest(internal).get(`${path}&asOf=${product.discontinuedFrom}`)).status).toBe(404);
    const retired = await supertest(external).get(`${path}&asOf=${product.discontinuedFrom}`);
    expect(retired.status).toBe(200);
    expect(retired.body.product.discontinuedFrom).toBe(product.discontinuedFrom);
    expect(retired.body.history.every((row: { isCurrent: boolean }) => !row.isCurrent)).toBe(true);
    const listPath = `/catalog/products?search=${encodeURIComponent(product.itemCode)}`;
    expect((await supertest(internal).get(listPath)).body.rows).not.toContainEqual(expect.objectContaining({ itemCode: product.itemCode }));
    const externalList = await supertest(external).get(listPath);
    expect(externalList.body.rows).toContainEqual(expect.objectContaining({
      itemCode: product.itemCode, discontinuedFrom: product.discontinuedFrom, hasPrice: false,
    }));
  });
});