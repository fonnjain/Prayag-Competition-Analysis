import express from "express";
import supertest from "supertest";
import { describe, expect, it } from "vitest";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import routes from "./index";

function requestAs(role?: "admin" | "user" | "counter") {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.isAuthenticated = (() => Boolean(role)) as never;
    if (role) {
      req.user = {
        id: `test-${role}`,
        email: `${role}@example.test`,
        mustChangePassword: false,
        role,
      };
    }
    next();
  });
  app.use(routes);
  return supertest(app);
}

describe("admin-only catalogue writes", () => {
  it("keeps Price Finder public while anonymous writes receive 401", async () => {
    const anonymous = requestAs();
    const [finder, ...writes] = await Promise.all([
      anonymous.get("/price-finder/search?q="),
      anonymous.post("/catalog/load-mrp"),
      anonymous.post("/catalog/sync/preflight"),
      anonymous.post("/catalog/import-batches/999999/approve"),
      anonymous.post("/keys").send({ name: "not-allowed" }),
    ]);
    expect(finder.status).toBe(200);
    for (const response of writes) {
      expect(response.status).toBe(401);
      expect(response.body.error).toBe("Unauthorized");
    }
  });

  it("allows normal users to read workspace data but rejects administrative writes", async () => {
    const user = requestAs("user");
    const beforeSources = await db.execute(sql`
      SELECT COUNT(*)::int AS count,
        md5(COALESCE(string_agg(to_jsonb(s)::text, '|' ORDER BY s.id), '')) AS digest
      FROM mrp_sources s
      WHERE s.source_kind = 'official'
    `);
    const [
      finder,
      catalog,
      comparison,
      analysis,
      sources,
      provenance,
      dataHealth,
      ...writes
    ] = await Promise.all([
      user.get("/price-finder/search?q="),
      user.get("/catalog/products?pageSize=1"),
      user.get("/catalog/comparison/filters"),
      user.get("/analysis/filters"),
      user.get("/catalog/mrp-sources"),
      user.get("/catalog/mrp-provenance"),
      user.get("/catalog/data-health"),
      user.post("/catalog/load-mrp"),
      user.post("/catalog/sync/preflight"),
      user.post("/catalog/import-batches/999999/approve"),
      user.post("/catalog/mrp-revisions/999999/apply"),
      user.post("/catalog/mrp-revisions/999999/rollback"),
      user.post("/keys").send({ name: "not-allowed" }),
      user.patch("/catalog/products/TEST/mrp").send({ mrp: 100, reason: "test" }),
      user.patch("/catalog/competitor-prices/bulk").send({ updates: [] }),
      user.put("/analysis/discount-settings").send({ prayagDiscountPct: 40 }),
      user.post("/catalog/variant-provenance/reconcile").send({ confirmation: "no" }),
    ]);
    expect(finder.status).toBe(200);
    for (const response of [
      catalog,
      comparison,
      analysis,
      sources,
      provenance,
      dataHealth,
    ]) {
      expect(response.status).toBe(200);
    }
    for (const response of writes) {
      expect(response.status).toBe(403);
      expect(response.body.error).toBe("Admin access required.");
    }
    const afterSources = await db.execute(sql`
      SELECT COUNT(*)::int AS count,
        md5(COALESCE(string_agg(to_jsonb(s)::text, '|' ORDER BY s.id), '')) AS digest
      FROM mrp_sources s
      WHERE s.source_kind = 'official'
    `);
    expect(afterSources.rows).toEqual(beforeSources.rows);
  });

  it("allows an admin through the guard to normal route validation", async () => {
    const admin = requestAs("admin");
    const [
      importAttempt,
      syncAttempt,
      batchAttempt,
      keyAttempt,
      reconciliationAttempt,
    ] = await Promise.all([
      admin.post("/catalog/load-mrp"),
      admin
        .post("/catalog/sync/preflight")
        .set("x-catalog-sync-test-environment", "production"),
      admin.post("/catalog/import-batches/999999/approve"),
      admin.post("/keys").send({ name: "" }),
      admin.post("/catalog/variant-provenance/reconcile").send({ confirmation: "" }),
    ]);
    expect(importAttempt.status).toBe(400);
    expect(syncAttempt.status).toBe(400);
    expect(batchAttempt.status).toBe(404);
    expect(keyAttempt.status).toBe(400);
    expect(reconciliationAttempt.status).toBe(400);
  });

  it("allows counter accounts to read workspace data but not issue API keys", async () => {
    const counter = requestAs("counter");
    const [finder, catalog, analysis, keyWrite] = await Promise.all([
      counter.get("/price-finder/search?q="),
      counter.get("/catalog/products"),
      counter.get("/analysis/filters"),
      counter.post("/keys").send({ name: "counter-key" }),
    ]);
    expect(finder.status).toBe(200);
    expect(catalog.status).toBe(200);
    expect(analysis.status).toBe(200);
    expect(keyWrite.status).toBe(403);
    expect(keyWrite.body.error).toBe("Admin access required.");
  });
});