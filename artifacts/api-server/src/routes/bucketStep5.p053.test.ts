import express from "express";
import supertest from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db, pool, bucketPreferencesTable, bucketEnforcementTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import routes from "./index";
import { loadBucketWorld } from "../lib/bucketLists";
import { isLiveBucketProduct } from "../lib/bucketMembership";

// Run with vitest.p051.config.ts only: fixture mutations never reach public.
function requester(id: string, role: "admin" | "user" | null) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.isAuthenticated = (() => role !== null) as never;
    if (role) req.user = { id, role, email: `${id}@example.test`, mustChangePassword: false } as never;
    next();
  });
  app.use("/api", routes);
  return supertest(app);
}
const owner = requester("step5-owner", "user"), fresh = requester("step5-fresh", "user");
const admin = requester("step5-admin", "admin"), anonymous = requester("step5-anon", null);
let codes: string[], sparshCodes: string[], before: unknown;
const snapshot = async () => (await pool.query(`SELECT
  (SELECT md5(string_agg(row_to_json(p)::text,'|' ORDER BY id)) FROM public.catalog_products p) AS catalogue,
  (SELECT md5(string_agg(row_to_json(p)::text,'|' ORDER BY id)) FROM public.mrp_price_history p) AS mrp,
  (SELECT md5(string_agg(row_to_json(p)::text,'|' ORDER BY id)) FROM public.competitor_prices p) AS competitor`)).rows[0];
const create = async (name: string, type: "included" | "excluded", addedCodes: string[], extra = {}, client = owner) => {
  const result = await client.post("/api/bucket-lists").send({ name, type, addedCodes, rules: [], removedCodes: [], visibility: "only_me", ...extra });
  expect(result.status, JSON.stringify(result.body)).toBe(201);
  return result.body;
};
const select = (id: string | null, active = true, client = owner) =>
  client.put("/api/bucket-lists/active").send({ listId: id, active }).expect(200);
const enforce = async (id: string) => {
  const state = await admin.get("/api/bucket-lists/enforcement").expect(200);
  return admin.post("/api/bucket-lists/enforcement").send({ listId: id, expectedVersion: state.body.version }).expect(200);
};
beforeAll(async () => {
  expect((await db.execute(sql`SELECT current_schema() AS schema`)).rows[0].schema).toMatch(/^p051_suite_/);
  before = await snapshot();
  const world = await loadBucketWorld();
  codes = world.catalogue.filter(p => isLiveBucketProduct(p)).slice(0, 4).map(p => p.itemCode);
  const live = new Set(world.catalogue.filter(p => isLiveBucketProduct(p)).map(p => p.itemCode));
  const brands = new Map<string, Set<string>>();
  for (const quote of world.quotes ?? []) {
    if (!quote.matchedPrayagCode || quote.price == null || !(quote.price > 0)) continue;
    const set = brands.get(quote.matchedPrayagCode) ?? new Set<string>();
    set.add(quote.competitor); brands.set(quote.matchedPrayagCode, set);
  }
  sparshCodes = [...brands].filter(([code, set]) => live.has(code) && set.size === 1 && set.has("Sparsh Pearl"))
    .slice(0, 2).map(([code]) => code);
  expect(codes).toHaveLength(4); expect(sparshCodes).toHaveLength(2);
});
beforeEach(async () => {
  await db.delete(bucketPreferencesTable);
  await db.update(bucketEnforcementTable).set({ listId: null }).where(sql`id=1`);
});
afterAll(async () => expect(await snapshot()).toEqual(before));

describe("P053 Step 5 guarded composition and exports", () => {
  it("two Excluded lists remove both sets, independent of selection order", async () => {
    const first = await create("Step5 hide first", "excluded", [codes[0]]);
    const second = await create("Step5 hide second", "excluded", [codes[1]]);
    await select(first.id); await select(second.id);
    const active = await owner.get("/api/bucket-lists/active").expect(200);
    expect(active.body.excluded.map((l: any) => l.id).sort()).toEqual([first.id, second.id].sort());
    for (const code of codes.slice(0, 2)) await owner.get(`/api/catalog/products/${encodeURIComponent(code)}`).expect(404);
    await owner.get(`/api/catalog/products/${encodeURIComponent(codes[2])}`).expect(200);
    await select(null); await select(second.id); await select(first.id);
    const reversed = await owner.get("/api/bucket-lists/active");
    expect(reversed.body.banner).toBe(active.body.banner);
    await select(first.id, false);
    expect((await owner.get("/api/bucket-lists/active")).body.excluded.map((l: any) => l.id)).toEqual([second.id]);
    await owner.get(`/api/catalog/products/${encodeURIComponent(codes[0])}`).expect(200);
  });
  it("a second Included replaces only the first and returns a one-line notice", async () => {
    const first = await create("Step5 included first", "included", [codes[0], codes[1]]);
    const second = await create("Step5 included second", "included", [codes[2]]);
    const excluded = await create("Step5 persistent exclusion", "excluded", [codes[0]]);
    await select(first.id); await select(excluded.id);
    const next = await select(second.id);
    expect(next.body.included.id).toBe(second.id);
    expect(next.body.excluded.map((l: any) => l.id)).toEqual([excluded.id]);
    expect(next.body.message).toBe("Included list “Step5 included first” replaced by “Step5 included second”.");
    expect((await owner.get("/api/catalog/products")).body.total).toBe(1);
  });
  it("automatically enforces for fresh users and anonymous Price Finder; personal clear cannot remove it", async () => {
    const company = await create("Step5 automatic company", "excluded", [codes[0]], { visibility: "everyone" }, admin);
    await enforce(company.id);
    const active = await fresh.get("/api/bucket-lists/active").expect(200);
    expect(active.body.enforced.id).toBe(company.id); expect(active.body.personalLists).toEqual([]);
    await fresh.get(`/api/catalog/products/${encodeURIComponent(codes[0])}`).expect(404);
    await anonymous.get(`/api/price-finder/product/${encodeURIComponent(codes[0])}`).expect(404);
    await select(null, true, fresh);
    await fresh.get(`/api/catalog/products/${encodeURIComponent(codes[0])}`).expect(404);
    await fresh.put("/api/bucket-lists/active").send({ listId: company.id, active: false }).expect(403);
    await fresh.post("/api/bucket-lists/enforcement/release").send({ expectedVersion: 1 }).expect(403);
    await fresh.put("/api/bucket-lists/active").send({ listId: null, enforced: null }).expect(400);
    expect((await fresh.get("/api/bucket-lists/active")).body.enforced.id).toBe(company.id);
  });
  it("composes Enforced then Included then both Excluded, names all four in CSV", async () => {
    const company = await create("Step5 Company restriction", "excluded", [codes[2]], { visibility: "everyone" }, admin);
    const included = await create("Step5 Included scope", "included", codes);
    const one = await create("Step5 Excluded one", "excluded", [codes[0]]);
    const two = await create("Step5 Excluded two", "excluded", [codes[1]]);
    await enforce(company.id); await select(included.id); await select(one.id); await select(two.id);
    const active = await owner.get("/api/bucket-lists/active").expect(200);
    expect(active.body.personalLists.map((l: any) => l.id)).toEqual([included.id, one.id, two.id]);
    expect((await owner.get("/api/catalog/products")).body.total).toBe(1);
    const csv = await owner.get("/api/catalog/export").query({ format: "csv" }).expect(200);
    for (const name of [company.name, included.name, one.name, two.name]) expect(csv.text).toContain(name);
    expect(csv.text.indexOf(company.name)).toBeLessThan(csv.text.indexOf(included.name));
    for (const code of codes.slice(0, 3)) expect(csv.text).not.toMatch(new RegExp(`\\n${code},`));
  });
  it("counts newly lost last quotes only once, not per list or already missing products", async () => {
    const included = await create("Step5 quoted scope", "included", sparshCodes);
    const one = await create("Step5 Sparsh one", "excluded", [], { rules: [{ competitor: "Sparsh Pearl", scope: "everywhere" }] });
    const two = await create("Step5 Sparsh duplicate", "excluded", [], { rules: [{ competitor: "Sparsh Pearl", scope: "everywhere" }] });
    await select(included.id); await select(one.id); await select(two.id);
    const active = await owner.get("/api/bucket-lists/active").expect(200);
    expect(active.body.noCompetitorPriceCount).toBe(2);
    const csv = await owner.get("/api/catalog/export").query({ format: "csv" }).expect(200);
    expect(csv.text.split("2 products have no competitor price under this filter")).toHaveLength(2);
    await select(one.id, false); await select(two.id, false);
    expect((await owner.get("/api/bucket-lists/active")).body.noCompetitorPriceCount).toBe(0);
    const zero = await owner.get("/api/catalog/export").query({ format: "csv" }).expect(200);
    expect(zero.text).not.toContain("products have no competitor price under this filter");
  });
  it("describes competitor-only lists as zero products and one competitor, and removes deleted exclusions", async () => {
    const list = await create("Step5 competitor only", "excluded", [], { rules: [{ competitor: "Sparsh Pearl", scope: "everywhere" }] });
    expect(list.count).toBe(0); expect(list.competitorCount).toBe(1); expect(list.divisions).toEqual([]);
    await select(list.id);
    await owner.delete(`/api/bucket-lists/${list.id}`).expect(200);
    expect((await owner.get("/api/bucket-lists/active")).body.personalLists).toEqual([]);
  });
});
