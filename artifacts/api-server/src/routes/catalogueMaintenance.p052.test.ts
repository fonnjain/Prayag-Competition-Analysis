import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import supertest from "supertest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, catalogProductsTable, mrpPriceHistoryTable } from "@workspace/db";
import catalogRoutes from "./catalog";
import syncRoutes from "./catalogSync";
import editorRoutes from "./priceEditor";
import { loadCatalogSeed, seedCatalogIfEmpty } from "../lib/catalogSeed";
import { applyCatalogSyncBundle } from "../lib/catalogSync";
import { catalogueMaintenanceActions, assertCatalogueReplacementAllowed, earlyCatalogueReplacementBoundary } from "../lib/catalogueMaintenancePolicy";

// The P051 test adapter routes all data to a disposable schema, never public.
const api = (role: "admin" | "user" = "admin") => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.isAuthenticated = (() => true) as never;
    req.user = { id: "p052-private", email: "private@example.test", role, mustChangePassword: false } as never;
    req.log = { error() {}, info() {}, warn() {}, debug() {} } as never;
    next();
  });
  app.use("/api", catalogRoutes, syncRoutes, editorRoutes);
  return supertest(app);
};
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("P052 production catalogue boundary", () => {
  it("refuses at the application boundary before authentication/session database work", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const app = express();
    app.use(earlyCatalogueReplacementBoundary);
    const authenticate = vi.fn((_req: express.Request, res: express.Response) => res.status(500).send("Authentication must not run"));
    app.use(authenticate);
    for (const path of ["/api/catalog/reset", "/api/catalog/sync/apply", "/API/CATALOG/RESET/"]) {
      expect((await supertest(app).post(path).set("x-catalog-sync-test-environment", "development")).status).toBe(403);
    }
    expect((await supertest(app).get("/api/catalog/reset/preview")).status).toBe(403);
    expect(authenticate).not.toHaveBeenCalled();
  });
  it("rejects reset and sync before any database call, ignoring spoofed fields/headers", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("REPLIT_DEPLOYMENT", "");
    const select = vi.spyOn(db, "select").mockImplementation(() => { throw new Error("Database accessed"); });
    const transaction = vi.spyOn(db, "transaction").mockImplementation(async () => { throw new Error("Database accessed"); });
    const insert = vi.spyOn(db, "insert").mockImplementation(() => { throw new Error("Database accessed"); });
    for (const path of ["/catalog/reset", "/catalog/sync/apply", "/catalog/sync/preflight"]) {
      const response = await api().post(`/api${path}`)
        .set("NODE_ENV", "development").set("x-catalog-sync-test-environment", "development")
        .send({ environment: "development", force: true, categorySpellingFingerprint: "spoof" });
      expect(response.status).toBe(403);
      expect(response.body.code).toBe("PRODUCTION_CATALOGUE_REPLACEMENT_DISABLED");
    }
    expect((await api().get("/api/catalog/reset/preview")).status).toBe(403);
    expect(select).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });
  it("guards internal seed/empty-seed/sync entrypoints before input or database access", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const select = vi.spyOn(db, "select").mockImplementation(() => { throw new Error("Database accessed"); });
    const transaction = vi.spyOn(db, "transaction").mockImplementation(async () => { throw new Error("Database accessed"); });
    const insert = vi.spyOn(db, "insert").mockImplementation(() => { throw new Error("Database accessed"); });
    await expect(loadCatalogSeed()).rejects.toThrow("disabled in production");
    await expect(seedCatalogIfEmpty()).rejects.toThrow("disabled in production");
    // Poisoned input proves the guard runs before reading the bundle.
    await expect(applyCatalogSyncBundle(null as never, "", "")).rejects.toThrow("disabled in production");
    expect(select).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });
  it("also refuses a deployment with a non-production NODE_ENV, but development keeps access", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("REPLIT_DEPLOYMENT", "1");
    expect(() => assertCatalogueReplacementAllowed("Reset")).toThrow("disabled in production");
    vi.stubEnv("REPLIT_DEPLOYMENT", "");
    expect(() => assertCatalogueReplacementAllowed("Reset")).not.toThrow();
    expect(catalogueMaintenanceActions("admin")).toEqual(["resetCatalog"]);
    expect(catalogueMaintenanceActions("user")).toEqual([]);
  });
  it("offers no production reset action, regardless of administrator role", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(catalogueMaintenanceActions("admin")).toEqual([]);
  });
  it("leaves development reset/sync routes enabled without executing a reset or seed", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("REPLIT_DEPLOYMENT", "");
    expect((await api().post("/api/catalog/reset").send({})).status).toBe(409);
    expect((await api().post("/api/catalog/sync/apply").send({})).status).toBe(400);
    expect((await api().post("/api/catalog/sync/preflight").send({})).status).toBe(400);
  });
});

describe("P052 admin-only non-persisting spelling check", () => {
  it("requires admin and rejects non-scalar/empty query inputs", async () => {
    expect((await api("user").get("/api/catalog/price-editor/category-spelling-check").query({ division: "CP", category: "X" })).status).toBe(403);
    for (const query of [{ division: "CP", category: "" }, { division: ["CP", "Hardware"], category: "X" }, { category: "X" }]) {
      expect((await api().get("/api/catalog/price-editor/category-spelling-check").query(query)).status).toBe(400);
    }
  });
  it("returns Blaze 62 over BLAZE 62 and new; twenty checks leave every private table unchanged", async () => {
    const division = "CP Fittings / Faucets";
    await db.delete(catalogProductsTable).where(and(eq(catalogProductsTable.division, division),
      inArray(catalogProductsTable.category, ["Blaze 62", "BLAZE 62"])));
    await db.insert(catalogProductsTable).values(Array.from({ length: 38 }, (_, i) => ({
      itemCode: `P052-READONLY-${i}`, productName: "Private test fixture",
      division, category: i < 36 ? "Blaze 62" : "BLAZE 62", isActive: true,
    })));
    // Every table in this disposable schema, including token/batch/audit rows.
    const snapshot = async () => (await db.execute<{ snapshot: string }>(sql`
      SELECT string_agg(format('%s:%s', table_name,
        (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %I.%I', current_schema(), table_name),false,true,'')))[1]::text), ',' ORDER BY table_name) AS snapshot
      FROM information_schema.tables WHERE table_schema=current_schema() AND table_type='BASE TABLE'
    `)).rows[0]!.snapshot;
    const before = await snapshot();
    const insert = vi.spyOn(db, "insert");
    const update = vi.spyOn(db, "update");
    const remove = vi.spyOn(db, "delete");
    for (let i = 0; i < 20; i++) {
      const category = i % 2 ? "P052 Never Registered Category" : "blaze 62";
      const response = await api().get("/api/catalog/price-editor/category-spelling-check").query({ division, category });
      expect(response.status).toBe(200);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.body).not.toHaveProperty("token");
      expect(response.body).not.toHaveProperty("categorySpellingFingerprint");
      expect(response.body).not.toHaveProperty("batchId");
      if (i % 2) {
        expect(response.body.status).toBe("new");
        expect(response.body.candidates).toEqual([]);
      } else {
        expect(response.body.status).toBe("matched existing spelling");
        expect(response.body.selectedCategory).toBe("Blaze 62");
        expect(response.body.candidates).toEqual([
          { category: "Blaze 62", activeProducts: 36 }, { category: "BLAZE 62", activeProducts: 2 },
        ]);
      }
    }
    expect(await snapshot()).toBe(before);
    expect(insert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
  it("keeps production undo routes available (invalid requests reach their existing validation, not the replacement guard)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    for (const path of ["/catalog/price-editor/undo/not-an-id", "/catalog/price-editor/new-product/undo/not-an-id"]) {
      const response = await api().post(`/api${path}`).send({});
      expect(response.status).not.toBe(403);
      expect(response.body.code).not.toBe("PRODUCTION_CATALOGUE_REPLACEMENT_DISABLED");
    }
  });
  it("successfully undoes a single-price insertion in production-like runtime using only the disposable schema", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await db.insert(catalogProductsTable).values({
      itemCode: "P052-PRIVATE-UNDO", productName: "Private undo fixture",
      division: "Hardware", category: "Private", isActive: true,
    });
    const saved = await api().post("/api/catalog/price-editor/save").send({
      itemCode: "P052-PRIVATE-UNDO", series: "Prayag MRP", value: 100,
      effectiveDate: "2026-09-01", remarks: "Private production-policy undo test",
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const undone = await api().post(`/api/catalog/price-editor/undo/${saved.body.audit.id}`).send({});
    expect(undone.status).toBe(200);
    expect(await db.select().from(mrpPriceHistoryTable).where(eq(mrpPriceHistoryTable.itemCode, "P052-PRIVATE-UNDO"))).toEqual([]);
  });
});