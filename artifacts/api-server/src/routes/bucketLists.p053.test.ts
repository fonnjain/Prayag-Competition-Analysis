import express from "express";
import supertest from "supertest";
import XLSX from "xlsx";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, pool, catalogProductsTable, mrpPriceHistoryTable, competitorPricesTable } from "@workspace/db";
import routes from "./index";
import { bucketRouteApplies, withBucketContext } from "../lib/bucketFilter";
import { bucketRunSummary } from "../lib/bucketGeneratorView";
import { deleteBucketDataForAccount } from "../lib/bucketLists";
import { classifyBucketUpload, matchesBucketRule, resolveBucketCodes } from "../lib/bucketMembership";

// Run only with vitest.p051.config.ts, whose adapter clones bucket_* as well as
// catalogue tables. No fixture or bucket mutation may reach public.
const A = "P053-A", B = "P053-B";
const requester = (id = "p053-owner", role: "admin" | "user" | "counter" | null = "user") => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.isAuthenticated = (() => !!role) as never;
    if (role) req.user = { id, role, email: `${id}@example.test`, mustChangePassword: false } as never;
    next();
  });
  app.use("/api", routes);
  return supertest(app);
};
const owner = requester(), other = requester("p053-other"), admin = requester("p053-admin", "admin");
const counter = requester("p053-counter", "counter"), anonymous = requester("p053-anonymous", null);
const draft = (name: string, extra = {}) => ({ name, type: "included", visibility: "only_me", addedCodes: [A], rules: [], removedCodes: [], ...extra });
const create = async (client: ReturnType<typeof requester>, name: string, extra = {}) => {
  const result = await client.post("/api/bucket-lists").send(draft(name, extra));
  expect(result.status, JSON.stringify(result.body)).toBe(201);
  return result.body;
};
const publicSnapshot = async () => (await pool.query(`
  SELECT
  (SELECT md5(string_agg(row_to_json(p)::text,'|' ORDER BY id)) FROM public.catalog_products p) AS catalogue,
  (SELECT md5(string_agg(row_to_json(p)::text,'|' ORDER BY id)) FROM public.mrp_price_history p) AS mrp,
  (SELECT md5(string_agg(row_to_json(p)::text,'|' ORDER BY id)) FROM public.competitor_prices p) AS competitor
`)).rows[0];
let before: unknown;
beforeAll(async () => {
  expect((await db.execute(sql`SELECT current_schema() AS schema`)).rows[0].schema).toMatch(/^p051_suite_/);
  before = await publicSnapshot();
  const product = (await db.select().from(catalogProductsTable).limit(1))[0]!;
  const price = (await db.select().from(mrpPriceHistoryTable).where(sql`review_status='approved' AND variant='Standard' AND mrp IS NOT NULL`).limit(1))[0]!;
  const competitor = (await db.select().from(competitorPricesTable).limit(1))[0]!;
  for (const [code, mrp, category] of [[A, 100, "P053 Ends"], [B, 200, "P053 Other"]] as const) {
    const { id: _p, ...p } = product;
    await db.insert(catalogProductsTable).values({ ...p, itemCode: code, productName: `P053 ${code}`, division: "CP Fittings / Faucets", category, seriesRange: null, isActive: true, discontinuedFrom: null });
    const { id: _h, ...h } = price;
    await db.insert(mrpPriceHistoryTable).values({ ...h, itemCode: code, mrp, effectiveDate: "2026-01-01", variant: "Standard", reviewStatus: "approved" });
    const { id: _c, ...c } = competitor;
    await db.insert(competitorPricesTable).values({ ...c, competitor: "P053 Fixture", competitorCode: `C-${code}`, price: mrp + 10, matchedPrayagCode: code, effectiveDate: "2026-10-04", matchStatus: "matched", isCurrent: true });
  }
});
afterAll(async () => { expect(await publicSnapshot()).toEqual(before); });

describe("P053 ownership, membership and request-scoped filtering", () => {
  it("keeps private lists private and prevents owner, role and visibility forgery", async () => {
    const list = await create(owner, "Private");
    expect((await other.get(`/api/bucket-lists/${list.id}`)).status).toBe(404);
    expect((await anonymous.get("/api/bucket-lists")).status).toBe(401);
    expect((await owner.post("/api/bucket-lists").send(draft("Forged", { ownerId: "p053-admin" }))).status).toBe(400);
    expect((await owner.post("/api/bucket-lists").send(draft("Not admin", { visibility: "everyone" }))).status).toBe(403);
    const shared = await create(admin, "Shared", { visibility: "everyone" });
    expect((await other.get(`/api/bucket-lists/${shared.id}`)).status).toBe(200);
    expect((await other.patch(`/api/bucket-lists/${shared.id}`).send({ name: "Stolen" })).status).toBe(403);
    expect((await other.delete(`/api/bucket-lists/${shared.id}`)).status).toBe(403);
    expect((await other.post(`/api/bucket-lists/${shared.id}/detach`)).status).toBe(403);
    expect((await counter.post("/api/bucket-lists").send(draft("Counter private"))).status).toBe(201);
  });
  it("rejects same-owner normalised names; permits a personal and HO namesake", async () => {
    const mine = await create(owner, "Same Name");
    const conflict = await owner.post("/api/bucket-lists").send(draft(" same NAME "));
    expect(conflict.status).toBe(409);
    expect(conflict.body.existingList.id).toBe(mine.id);
    expect((await admin.post("/api/bucket-lists").send(draft("Same Name", { visibility: "everyone" }))).status).toBe(201);
    expect((await owner.post("/api/bucket-lists").send(draft("Unknown code", { addedCodes: ["P053-NOT-FOUND"] }))).status).toBe(400);
  });
  it("inherits edits with additions/removals, then explicitly detaches and freezes", async () => {
    const parent = await create(admin, "Original", { visibility: "everyone" });
    const child = await create(owner, "Linked", { parentId: parent.id, addedCodes: [B], removedCodes: [A] });
    expect(child.members.map((m: any) => m.itemCode)).toEqual([B]);
    await admin.patch(`/api/bucket-lists/${parent.id}`).send({ addedCodes: [A, B] }).expect(200);
    expect((await owner.get(`/api/bucket-lists/${child.id}`)).body.members.map((m: any) => m.itemCode)).toEqual([B]);
    const detached = await owner.post(`/api/bucket-lists/${child.id}/detach`).expect(200);
    expect(detached.body.parentId).toBeNull();
    await admin.patch(`/api/bucket-lists/${parent.id}`).send({ addedCodes: [A] }).expect(200);
    expect((await owner.get(`/api/bucket-lists/${child.id}`)).body.members.map((m: any) => m.itemCode)).toEqual([B]);
    expect((await owner.patch(`/api/bucket-lists/${child.id}`).send({ parentId: parent.id })).status).toBe(400);
  });
  it("freezes children before parent deletion or privacy downgrade; clears deleted active preference", async () => {
    const parent = await create(admin, "Delete original", { visibility: "everyone" });
    const child = await create(owner, "Surviving child", { parentId: parent.id, addedCodes: [] });
    await admin.put("/api/bucket-lists/active").send({ listId: parent.id }).expect(200);
    await admin.delete(`/api/bucket-lists/${parent.id}`).expect(200);
    const frozen = (await owner.get(`/api/bucket-lists/${child.id}`)).body;
    expect(frozen.parentId).toBeNull(); expect(frozen.count).toBe(1); expect(frozen.detachedNotice).toContain("deleted");
    expect((await admin.get("/api/bucket-lists/active")).body.list).toBeNull();
    const privateParent = await create(admin, "Private downgrade", { visibility: "everyone" });
    const privateChild = await create(owner, "Privacy child", { parentId: privateParent.id, addedCodes: [] });
    await admin.patch(`/api/bucket-lists/${privateParent.id}`).send({ visibility: "only_me" }).expect(200);
    expect((await owner.get(`/api/bucket-lists/${privateParent.id}`)).status).toBe(404);
    expect((await owner.get(`/api/bucket-lists/${privateChild.id}`)).body.parentId).toBeNull();
  });
  it("keeps zero rules and normalises the actual forty Blaze 62 catalogue rows", async () => {
    const result = await owner.post("/api/bucket-lists/preview").send(draft("Blaze", { addedCodes: [], rules: [{ division: "CP Fittings / Faucets", category: "Blaze 62" }] }));
    expect(result.status).toBe(200); expect(result.body.count).toBe(40);
    const zero = await create(owner, "Zero rule", { addedCodes: [], rules: [{ category: "P053 no such category" }] });
    expect(zero.count).toBe(0); expect(zero.rules).toHaveLength(1);
  });
  it("filters before catalogue pagination, blocks direct details/history, isolates concurrent and anonymous requests", async () => {
    const list = await create(owner, "Active only A");
    await owner.put("/api/bucket-lists/active").send({ listId: list.id }).expect(200);
    const catalogue = await owner.get("/api/catalog/products").query({ pageSize: 1 });
    expect(catalogue.status).toBe(200); expect(catalogue.body.total).toBe(1);
    expect((await owner.get("/api/catalog/products").query({ page: 2, pageSize: 1 })).body.rows).toHaveLength(0);
    for (const path of [`/api/catalog/products/${B}`, `/api/catalog/product?itemCode=${B}`, `/api/price-finder/product/${B}`, `/api/analysis/price-history?itemCode=${B}`]) {
      const response = await owner.get(path);
      expect(response.status, path).toBe(404); expect(response.body.code, path).toBe("BUCKET_FILTERED");
    }
    const [filtered, unfiltered] = await Promise.all([owner.get("/api/catalog/products"), other.get("/api/catalog/products")]);
    expect(filtered.body.total).toBe(1); expect(unfiltered.body.total).toBeGreaterThan(1);
    expect((await anonymous.get("/api/bucket-lists/active")).body.list).toBeNull();
    expect((await anonymous.get("/api/price-finder/search").query({ q: B })).body.results.some((p: any) => p.itemCode === B)).toBe(true);
    expect((await owner.get("/api/bucket-lists/active")).body.list.id).toBe(list.id);
    await owner.put("/api/bucket-lists/active").send({ listId: null }).expect(200);
    expect((await owner.get("/api/catalog/products")).body.total).toBeGreaterThan(1);
  });
  it("removes the whole comparison population and discloses scope in CSV and every workbook sheet", async () => {
    const list = await create(owner, "Export only A");
    await owner.put("/api/bucket-lists/active").send({ listId: list.id }).expect(200);
    const comparison = await owner.get("/api/catalog/comparison");
    expect(comparison.status).toBe(200); expect(JSON.stringify(comparison.body)).not.toContain(B);
    const pf = await owner.get("/api/price-finder/comparison").query({ code: [A, B] });
    expect(pf.status, JSON.stringify(pf.body)).toBe(200);
    expect(JSON.stringify(pf.body)).not.toContain(B);
    for (const path of ["/api/catalog/export", "/api/catalog/comparison/export", "/api/catalog/mapping-review/export", "/api/analysis/export"]) {
      const response = await owner.get(path).query({ format: "csv" });
      expect(response.status, path).toBe(200); expect(response.text.split("\n")[0], path).toContain("Export only A");
    }
    const response = await owner.get("/api/price-finder/comparison/export").query({ code: [A, B] }).buffer(true).parse((res, callback) => {
      const chunks: Buffer[] = [];
      res.on("data", chunk => chunks.push(Buffer.from(chunk)));
      res.on("end", () => callback(null, Buffer.concat(chunks)));
    });
    expect(response.status).toBe(200);
    const workbook = XLSX.read(response.body, { type: "buffer" });
    for (const sheet of workbook.SheetNames) expect(workbook.Sheets[sheet].A1.v).toContain("Export only A");
    await owner.put("/api/bucket-lists/active").send({ listId: null });
  });
  it("archives newly observed rule members; retirement/deletion never drops them silently", async () => {
    const list = await create(owner, "Dynamic archive", { addedCodes: [], rules: [{ category: "P053 Ends" }] });
    const product = (await db.select().from(catalogProductsTable).where(eq(catalogProductsTable.itemCode, A)))[0]!;
    const { id: _id, ...values } = product;
    await db.insert(catalogProductsTable).values({ ...values, itemCode: "P053-NEW" });
    expect((await owner.get(`/api/bucket-lists/${list.id}`)).body.count).toBe(2);
    await db.delete(catalogProductsTable).where(eq(catalogProductsTable.itemCode, "P053-NEW"));
    const archived = (await owner.get(`/api/bucket-lists/${list.id}`)).body;
    expect(archived.count).toBe(2); expect(archived.missingCount).toBe(1);
    const cleared = await owner.patch(`/api/bucket-lists/${list.id}`).send({ removedCodes: ["P053-NEW"] });
    expect(cleared.body.count).toBe(1);
  });
  it("previews a real multipart CSV without saving any bucket changes", async () => {
    const before = (await db.execute(sql`SELECT count(*) AS count FROM bucket_lists`)).rows[0].count;
    const response = await owner.post("/api/bucket-lists/upload-preview")
      .field("draft", JSON.stringify(draft("Unsaved upload", { addedCodes: [] })))
      .attach("file", Buffer.from(`item_code\n${B}\nP 053-A\n${A}\nP053-UNKNOWN\n`), { filename: "codes.csv", contentType: "text/csv" });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body.counts).toEqual({ matched: 1, space_matched: 1, duplicate: 1, not_found: 1, inactive: 0 });
    expect(response.body.rows).toHaveLength(4);
    expect((await db.execute(sql`SELECT count(*) AS count FROM bucket_lists`)).rows[0].count).toBe(before);
  });
  it("filters Analysis aggregates and generator scope metadata at the source", async () => {
    const list = await create(admin, "Analysis only A");
    await admin.put("/api/bucket-lists/active").send({ listId: list.id }).expect(200);
    for (const path of ["/api/analysis/overview", "/api/analysis/by-brand", "/api/analysis/by-category", "/api/analysis/positioning", "/api/analysis/coverage-matrix", "/api/analysis/opportunities", "/api/analysis/mrp-increases", "/api/mrp-generator/scopes"]) {
      const response = await admin.get(path);
      expect(response.status, path + JSON.stringify(response.body)).toBe(200);
      expect(JSON.stringify(response.body), path).not.toContain(B);
      expect(JSON.stringify(response.body), path).not.toContain("P053 Other");
    }
    await admin.put("/api/bucket-lists/active").send({ listId: null }).expect(200);
  });
  it("freezes another user's copy when an owner account is deleted", async () => {
    const account = requester("p053-deleted-account", "admin");
    const parent = await create(account, "Account parent", { visibility: "everyone" });
    const child = await create(owner, "Account surviving child", { parentId: parent.id, addedCodes: [] });
    await account.put("/api/bucket-lists/active").send({ listId: parent.id }).expect(200);
    await db.transaction(tx => deleteBucketDataForAccount("p053-deleted-account", "Administrator", tx));
    expect((await owner.get(`/api/bucket-lists/${child.id}`)).body.parentId).toBeNull();
    expect((await owner.get(`/api/bucket-lists/${child.id}`)).body.count).toBe(1);
    expect((await account.get("/api/bucket-lists/active")).body.list).toBeNull();
  });
});

describe("P053 pure resolution and boundary contracts", () => {
  it("keeps removals last, rules dynamic, zero rules valid and detects cycles", () => {
    const products: any[] = [{ itemCode: A, division: "CP Fittings / Faucets", category: "BLAZE 62", seriesRange: null, isActive: true, discontinuedFrom: null }];
    expect(matchesBucketRule(products[0], { category: "Blaze 62" })).toBe(true);
    const definition = { rules: [{ category: "Blaze 62" }], addedCodes: [B], removedCodes: [A], parentId: null };
    expect([...resolveBucketCodes(definition, new Map(), products)]).toEqual([B]);
    expect(() => resolveBucketCodes({ ...definition, id: "cycle", parentId: "cycle" }, new Map([["cycle", { ...definition, id: "cycle", parentId: "cycle" }]]), products)).toThrow();
  });
  it("reports whitespace matches, duplicates, not-found and inactive rows without dropping input", () => {
    const products: any[] = [{ itemCode: "H5", productName: "End", isActive: true }, { itemCode: "OLD", isActive: false }];
    const result = classifyBucketUpload(["H 5", "H5", "UNKNOWN", "OLD"].map((code, i) => ({ row: i + 2, code })), products, new Set());
    expect(result.rows).toHaveLength(4);
    expect(result.counts).toEqual({ matched: 0, space_matched: 1, duplicate: 1, not_found: 1, inactive: 1 });
    expect(result.addableCodes).toEqual(["H5"]);
  });
  it("keeps L-T, machine APIs and all mutation scopes outside the display filter", () => {
    for (const path of ["/catalog/data-health", "/catalog/mrp-loads/1", "/catalog/new-products/1", "/catalog/import-batches/1", "/catalog/mrp-revisions/1", "/catalog/price-editor/product", "/catalog/name-changes/products", "/admin/mrp-provenance-backfill/preview", "/v1/products", "/catalog/sync/export"]) expect(bucketRouteApplies("GET", path), path).toBe(false);
    expect(bucketRouteApplies("POST", "/catalog/mapping-review/auto-accept")).toBe(false);
    expect(bucketRouteApplies("POST", "/mrp-generator/scenarios/preview")).toBe(true);
    expect(bucketRouteApplies("GET", "/analysis/overview")).toBe(true);
  });
  it("rebuilds immutable run totals from the visible population without changing persisted records", () => {
    const run: any = { modelKind: "competitive", summary: JSON.stringify({ total: 2, suggested: 1, noChange: 1 }), inputSnapshot: "{}" };
    const rows: any[] = [{ itemCode: A, status: "suggested", changePercent: 10, evidence: "{}" }, { itemCode: B, status: "no_change", changePercent: 0, evidence: "{}" }];
    const before = JSON.stringify({ run, rows });
    const summary = withBucketContext({ type: "included", codes: new Set([A]), banner: "Only A" }, () => bucketRunSummary(run, rows));
    expect(summary.total).toBe(1); expect(summary.suggested).toBe(1); expect(summary.noChange).toBe(0);
    expect(JSON.stringify({ run, rows })).toBe(before);
  });
  it("projects frozen P011 portfolio evidence without reevaluating recommendations", () => {
    const products = [A, B].map(itemCode => ({ itemCode, currentMrp: 100, competitors: [], sales: null, margin: null }));
    const policies = products.map(product => ({ ...product, action: "HOLD", band: "F", status: "no_change", suggestedMrp: null, changePercent: 0 }));
    const run: any = { modelKind: "competitive", summary: '{"policyVersion":2,"total":2}', inputSnapshot: JSON.stringify({ products, p011Results: policies }) };
    const rows: any[] = policies.map(policy => ({ ...policy, evidence: "{}" }));
    const before = JSON.stringify(run);
    const summary = withBucketContext({ type: "included", codes: new Set([A]), banner: "Only A" }, () => bucketRunSummary(run, rows));
    expect(summary.actionCounts).toEqual({ HOLD: 1 });
    expect(summary.bandDistribution).toEqual({ F: 1 });
    expect(summary.portfolio.omittedProductCount).toBe(1);
    expect(summary.portfolio.headroom).toEqual([]);
    expect(JSON.stringify(run)).toBe(before);
  });
  it("projects frozen P012 row/tier totals and historical confidence without hidden products", () => {
    const policies = [A, B].map(itemCode => ({ itemCode, matchedRowId: "first", volumeTier: "A", selectedCompetitorPrice: 100, fySalesAmount: 5, status: "suggested" }));
    const rows: any[] = policies.map(policy => ({ ...policy, changePercent: 10, series: "one", evidence: '{"confidence":"STRONG","status":"DUE","typicalRate":2}' }));
    const project = (run: any) => withBucketContext({ type: "included", codes: new Set([A]), banner: "Only A" }, () => bucketRunSummary(run, rows));
    const summary = project({ modelKind: "competitive", summary: '{"policyVersion":3,"rowCounts":{"first":{}}}', inputSnapshot: JSON.stringify({ p012Results: policies }) });
    expect(summary.rowCounts.first).toMatchObject({ scopeMatched: 1, withCompetitorPrice: 1, matchedFySalesValue: 5 });
    expect(summary.tierDistribution).toEqual({ A: 1, B: 0, C: 0, F: 0 });
    const historical = project({ modelKind: "historical", summary: "{}", inputSnapshot: "{}" });
    expect(historical.due).toBe(1); expect(historical.usableSeries).toBe(1);
    expect(historical.confidence.STRONG).toBe(1);
  });
});