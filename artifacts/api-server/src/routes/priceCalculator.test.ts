import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import express from "express";
import supertest from "supertest";
import * as XLSX from "xlsx";
import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import reference from "../lib/fixtures/calculatorReference.json";
const state = vi.hoisted(() => ({ database: null as any }));
vi.mock("@workspace/db", async original => {
  const real = await original<typeof import("@workspace/db")>();
  return { ...real, db: new Proxy({}, { get(_o, key) { return state.database[key]; } }) };
});
import { pool } from "@workspace/db";
import router from "./priceCalculator";
import finderRouter from "./priceFinder";
import analysisRouter from "./analysis";
import { withBucketContext, bucketRouteApplies } from "../lib/bucketFilter";
import { readFinderEvidence } from "../lib/priceFinderEvidence";
import { scopedFinderCompetitors } from "../lib/priceFinderCompetitors";
import { CALCULATOR_SCOPE_DISCLOSURE, calculatorAssertedBanner } from "@workspace/formatting";
const schema = `pf_calc_${randomUUID().replaceAll("-", "")}`;
const connect = () => pool.connect();
let client: Awaited<ReturnType<typeof connect>>;
beforeAll(async () => {
  client = await connect();
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET search_path TO "${schema}"`);
  state.database = drizzle(client);
  // Minimal disposable models; search_path contains NO public fallback.
  await client.query("CREATE TABLE catalog_products(item_code text,product_name text,division text,category text,uom text,is_active boolean,discontinued_from date,size text)");
  await client.query("CREATE TABLE mrp_price_history(id serial,item_code text,variant text,mrp double precision,review_status text,effective_date date,price_basis text DEFAULT 'MRP')");
  await client.query("CREATE TABLE competitor_prices(id serial,competitor text,matched_prayag_code text,match_status text,price double precision,effective_date date,price_basis text,gst_pct double precision,unit text)");
  await client.query("CREATE TABLE discount_settings(scope text,discount_pct double precision)");
  await client.query("INSERT INTO catalog_products VALUES ('A','Alpha pipe','Pipes','PPR','NOS',true,NULL),(' A','Spaced code','Pipes','PPR','NOS',true,NULL),('B','Unpriced competitor','PTMT','Tap','NOS',true,NULL),('C','Discontinued','Pipes','PPR','NOS',true,'2026-06-01')");
  await client.query("INSERT INTO mrp_price_history(item_code,variant,mrp,review_status,effective_date) VALUES ('A','Standard',92,'approved','2026-01-01'),('A','Standard',99,'pending','2026-02-01'),('A','Standard',100,'approved','2026-09-01'),('A','Standard',200,'approved','2027-01-01'),('A','Ivory',110,'approved','2026-01-01'),(' A','Standard',10,'approved','2026-01-01'),('B','Standard',50,'approved','2026-01-01'),('C','Standard',20,'approved','2026-01-01')");
  await client.query("INSERT INTO competitor_prices(competitor,matched_prayag_code,match_status,price,effective_date,price_basis,gst_pct,unit) VALUES ('Brand','A','matched',91,'2026-01-01','MRP',NULL,'NOS'),('Brand','A','matched',101,'2026-09-01','MRP',NULL,'NOS'),('Taxed','A','matched',100,'2026-01-01','Ex-GST',18,NULL),('Future','A','matched',400,'2027-01-01','MRP',NULL,'NOS'),('Missing','A','matched',NULL,'2026-01-01','MRP',NULL,'NOS'),('Wrong','A','unmatched',1,'2026-01-01','MRP',NULL,'NOS')");
  await client.query("INSERT INTO discount_settings VALUES ('Our',20),('Brand',18)");
  await client.query("INSERT INTO catalog_products VALUES ('P','Catalogue without a price','Pipes','PPR','NOS',false,NULL),('TTS-01','Exact code','CP','Valve','NOS',true,NULL)");
  // Search-only fixtures in this disposable schema, never the real catalogue.
  await client.query(`INSERT INTO catalog_products(item_code,product_name,division,category,uom,is_active)
    SELECT 'PS-'||n,'Pipe','Pipes','CPVC','NOS',true FROM generate_series(1,320) n`);
  await client.query(`INSERT INTO catalog_products(item_code,product_name,division,category,uom,is_active)
    VALUES ('3272','Collapsible Waste Pipe','PTMT','Waste','NOS',true),
           ('CPS-15','Concealed Stop Cock','CP','Allied','NOS',true)`);
  await client.query(`INSERT INTO mrp_price_history(item_code,variant,mrp,review_status,effective_date)
    SELECT item_code,'Standard',10,'approved','2026-01-01' FROM catalog_products
    WHERE item_code LIKE 'PS-%' OR item_code IN ('3272','CPS-15')`);
});
afterAll(async () => {
  if (client) { await client.query("SET search_path TO public"); await client.query(`DROP SCHEMA "${schema}" CASCADE`); client.release(); }
});
function app(role?: "admin" | "user", scope = false) {
  const a = express(); a.use(express.json());
  a.use((req, _res, next) => {
    // Unit-test identity only, never a production authentication shortcut.
    if (role) req.user = { id: "unit", role, mustChangePassword: false } as Express.User;
    req.isAuthenticated = (() => !!role) as typeof req.isAuthenticated;
    if (scope) withBucketContext({ type: "excluded", codes: new Set([" A"]), banner: "Company test", clauses: [
      { competitor: "Brand", codes: null },
    ], noCompetitorPriceCount: 1 }, () => next()); else next();
  });
  a.use(router); a.use(finderRouter); a.use(analysisRouter); return a;
}
const requestBlock = (code = "A") => ({
  id: "b", itemCode: code, variant: "Standard", discount: "20", quantity: "7",
  competitors: [{ id: "c", competitor: "Brand", discount: "18" }],
});
describe("public read-only calculator endpoints", () => {
  it("ranks PS-prefix codes first (class property, not specific code positions)", async () => {
    const r = await supertest(app()).get("/price-finder/calculator/search").query({ q: "PS", asOf: "2026-05-01" });
    expect(r.status).toBe(200);
    expect(r.body.results).toHaveLength(300);
    expect(r.body.totalCount).toBe(322);
    expect(r.body.results[0].itemCode.startsWith("PS")).toBe(true);
    expect(r.body.results.slice(0,10).every((p: any) => p.itemCode.startsWith("PS"))).toBe(true);
    // Including the tails proves ALL prefix matches outrank substring matches.
    const candidates = (await client.query("SELECT item_code,product_name,division,category,size FROM catalog_products WHERE item_code LIKE 'PS-%' OR item_code IN ('3272','CPS-15')")).rows;
    const { rankProductSearchRows } = await import("@workspace/formatting");
    const ranked = rankProductSearchRows(candidates, ["PS"]);
    expect(ranked.slice(0,320).every(p => p.item_code.startsWith("PS"))).toBe(true);
    expect(ranked.slice(320).map(p => p.item_code).sort()).toEqual(["3272", "CPS-15"]);
  });
  it("both actual handlers use identical ranking for the same eligible candidate set", async () => {
    const calc = await supertest(app()).get("/price-finder/calculator/search").query({ q: "PS", limit: 300, asOf: "2026-05-01" });
    const finder = await supertest(app()).get("/price-finder/search").query({ filters: "PS", limit: 300, asOf: "2026-05-01" });
    expect(calc.status).toBe(200); expect(finder.status).toBe(200);
    expect(finder.body.totalCount).toBe(322);
    expect(calc.body.results.map((p: any) => p.itemCode)).toEqual(finder.body.results.map((p: any) => p.itemCode));
  });
  it("search remains unbucketed for admin and anonymous; Finder still enforces the same exclusion", async () => {
    const params = { q: " A", limit: 300, asOf: "2026-05-01" };
    const anonymous = await supertest(app()).get("/price-finder/calculator/search").query(params);
    const scoped = await supertest(app("admin",true)).get("/price-finder/calculator/search").query(params);
    expect(scoped.body).toEqual(anonymous.body);
    expect(scoped.body.results.some((p: any) => p.itemCode === " A")).toBe(true);
    const finder = await supertest(app("admin",true)).get("/price-finder/search").query({ filters: "Spaced code", asOf: "2026-05-01" });
    expect(finder.status).toBe(200);
    expect(finder.body.results).toEqual([]);
  });
  it("reports the real pre-cap total and shares field selection beyond code/name", async () => {
    const capped = await supertest(app()).get("/price-finder/calculator/search").query({ q: "PS", limit: 2 });
    expect(capped.body.results).toHaveLength(2);
    expect(capped.body.totalCount).toBe(322);
    const category = await supertest(app()).get("/price-finder/calculator/search").query({ q: "CPVC", limit: 1 });
    expect(category.body.totalCount).toBe(320);
    expect(category.body.results).toHaveLength(1);
  });
  it("browse selection on another row cannot affect an identical subsequent direct search", async () => {
    const params = { q: "PS", limit: 300, asOf: "2026-05-01" };
    const before = await supertest(app()).get("/price-finder/calculator/search").query(params);
    await supertest(app()).get("/price-finder/calculator/search").query({ division: "PTMT", category: "Waste", limit: 300 });
    const after = await supertest(app()).get("/price-finder/calculator/search").query(params);
    expect(after.body).toEqual(before.body);
  });
  it("resolves dates, approved Standard and variant prices, current competitors and tax evidence in batch", async () => {
    const r = await supertest(app()).get("/price-finder/calculator/rows").query({ code: ["A", " A", "B"], asOf: "2026-05-01" });
    expect(r.status).toBe(200); expect(r.body.rows).toHaveLength(3);
    const p = r.body.rows.find((r: any) => r.itemCode === "A");
    expect(p.prayag.price).toBe(92); expect(p.variants.find((v: any) => v.variant === "Ivory").price).toBe(110);
    expect(p.competitors.map((v: any) => v.competitor)).toEqual(["Brand", "Taxed"]);
    expect(p.competitors[1].price).toBe(118); expect(p.competitors[1].basisMismatch).toBe(true);
    const later = await supertest(app()).get("/price-finder/calculator/rows").query({ code: "A", asOf: "2026-10-16" });
    expect(later.body.rows[0].prayag.price).toBe(100); expect(later.body.rows[0].competitors[0].price).toBe(101);
    const old = await supertest(app()).get("/price-finder/calculator/rows").query({ code: "C", asOf: "2026-05-01" });
    expect(old.body.rows).toHaveLength(1);
    const gone = await supertest(app()).get("/price-finder/calculator/rows").query({ code: "C", asOf: "2026-10-16" });
    expect(gone.body.unavailableCodes).toEqual([]);
    expect(gone.body.rows[0]).toMatchObject({ itemCode: "C", productName: "Discontinued", prayag: { price: null } });
  });
  it("compares stored price bases separately from units and reports misplaced unit metadata", async () => {
    await client.query("BEGIN");
    try {
      await client.query("UPDATE competitor_prices SET unit='MRP' WHERE competitor='Brand'");
      const get = () => supertest(app()).get("/price-finder/calculator/rows").query({ code: "A", asOf: "2026-05-01" });
      let r = await get(), p = r.body.rows[0], q = p.competitors[0];
      expect(p.basis).toBe("MRP"); expect(p.unit).toBe("NOS");
      expect(q.basisMismatch).toBe(false); expect(q.unitMismatch).toBe(false);
      expect(q.unitNotRecorded).toBe(true); expect(q.unitNote).toBe("Competitor unit not recorded.");
      await client.query("UPDATE mrp_price_history SET price_basis='Net' WHERE item_code='A' AND variant='Standard'");
      r = await get(); p = r.body.rows[0]; q = p.competitors[0];
      expect(p.basis).toBe("Net"); expect(q.basisMismatch).toBe(true); expect(q.unitMismatch).toBe(false);
      await client.query("UPDATE competitor_prices SET price_basis='Net',unit='each' WHERE competitor='Brand'");
      r = await get(); q = r.body.rows[0].competitors[0];
      expect(q.basisMismatch).toBe(false); expect(q.unitMismatch).toBe(false);
    } finally { await client.query("ROLLBACK"); }
  });
  it("rejects 51 raw codes, invalid dates and nested shapes", async () => {
    expect((await supertest(app()).get("/price-finder/calculator/rows").query({ code: Array(51).fill("A") })).status).toBe(400);
    expect((await supertest(app()).get("/price-finder/calculator/rows").query({ code: "A", asOf: "2026-02-30" })).status).toBe(400);
    expect((await supertest(app()).get("/price-finder/calculator/rows?code[bad]=A")).status).toBe(400);
  });
  it("anonymous defaults are 401; both signed-in roles read existing defaults without seeding", async () => {
    expect((await supertest(app()).get("/price-finder/discount-defaults")).status).toBe(401);
    for (const role of ["user", "admin"] as const) {
      const r = await supertest(app(role)).get("/price-finder/discount-defaults");
      expect(r.status).toBe(200); expect(r.body).toHaveLength(2);
    }
    expect((await client.query("SELECT count(*)::int AS n FROM discount_settings")).rows[0].n).toBe(2);
  });
  it("calculator alone ignores composed product/quote restrictions; Price Finder retains them", async () => {
    expect(bucketRouteApplies("POST", "/price-finder/calculator/export")).toBe(false);
    expect(bucketRouteApplies("GET", "/price-finder/calculator/rows")).toBe(false);
    expect(bucketRouteApplies("GET", "/price-finder/calculator/search")).toBe(false);
    expect(bucketRouteApplies("GET", "/price-finder/search")).toBe(true);
    expect(bucketRouteApplies("GET", "/price-finder/competitors")).toBe(true);
    expect(bucketRouteApplies("GET", "/analysis/overview")).toBe(true);
    const r = await supertest(app(undefined, true)).get("/price-finder/calculator/rows").query({ code: ["A", " A"], asOf: "2026-05-01" });
    expect(r.body.rows.map((p: any) => p.itemCode).sort()).toEqual([" A", "A"]);
    expect(r.body.rows.find((p: any) => p.itemCode === "A").competitors.map((c: any) => c.competitor)).toEqual(["Brand", "Taxed"]);
    expect(r.body.scopeDisclosure).toEqual([CALCULATOR_SCOPE_DISCLOSURE]);
    const scoped = await withBucketContext({ type: "excluded", codes: new Set([" A"]), banner: "Company test",
      clauses: [{ competitor: "Brand", codes: null }] }, () => readFinderEvidence(["A", " A"], "2026-05-01"));
    expect(scoped.products.map(p => p.item_code)).toEqual(["A"]);
    expect(scoped.competitors.map(c => c.competitor)).toEqual(["Taxed"]);
  });
  it("exports three sheets and one Data row per selected competitor, with unchanged unit-first values and disclosures", async () => {
    const b = requestBlock(); b.discount = "33.33";
    b.competitors.push({ id: "taxed", competitor: "Taxed", discount: "0" });
    const res = await supertest(app()).post("/price-finder/calculator/export").send({ asOf: "2026-05-01", blocks: [b] })
      .buffer(true).parse((r, cb) => { const chunks: Buffer[] = []; r.on("data", c => chunks.push(c)); r.on("end", () => cb(null, Buffer.concat(chunks))); });
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toContain("prayag-price-calculator-2026-05-01.xlsx");
    const book = XLSX.read(res.body);
    expect(book.SheetNames).toEqual(["Comparison", "Summary", "Data"]);
    const detail = XLSX.utils.sheet_to_json<any[]>(book.Sheets.Data, { header: 1 });
    const header = detail.findIndex(row => row[0] === "Code"), first = detail[header + 1], second = detail[header + 2];
    expect(first[9]).toBe(61.34); expect(first[11]).toBe(429.38);
    expect(first[16]).toBe(74.62); expect(first[17]).toBe(522.34);
    expect(first[26]).toBe("App"); expect(first[28]).toBe("App");
    expect(detail[0][0]).not.toContain("unverified");
    expect(XLSX.utils.sheet_to_json<any[]>(book.Sheets.Summary, { header: 1 }).flat()).toContain("Prices resolved as of 01-05-2026.");
    expect(second[22]).toBe("Price basis differs: ours MRP; competitor Ex-GST.");
    expect(second[25]).toBe("Competitor unit not recorded.");
    expect(XLSX.utils.sheet_to_json<any[]>(book.Sheets.Summary, { header: 1 }).flat())
      .toContain("1 rows have a different or unconfirmed price basis — see the warning marks.");
    expect(XLSX.utils.sheet_to_json<any[]>(book.Sheets.Summary, { header: 1 }).flat())
      .toContain("1 rows: unit not recorded (information only).");
  });
  it("export re-resolves prices and omits unavailable evidence instead of trusting client totals", async () => {
    const bad = { ...requestBlock(), ourPrice: 1 };
    expect((await supertest(app()).post("/price-finder/calculator/export").send({ asOf: "2026-05-01", blocks: [bad] })).status).toBe(400);
    const dup = requestBlock(); dup.competitors.push({ id: "x", competitor: "Brand", discount: "0" });
    expect((await supertest(app()).post("/price-finder/calculator/export").send({ asOf: "2026-05-01", blocks: [dup] })).status).toBe(400);
    const invalid = requestBlock(); invalid.quantity = "0";
    expect((await supertest(app()).post("/price-finder/calculator/export").send({ asOf: "2026-05-01", blocks: [invalid] })).status).toBe(400);
  });
  it("searches full catalogue and exact codes without trim, case-fold or punctuation fallback", async () => {
    const search = (q: string) => supertest(app(undefined, true)).get("/price-finder/calculator/search")
      .query({ q, asOf: "2026-05-01" });
    expect((await search(" A")).body.exactProduct.itemCode).toBe(" A");
    expect((await search("TTS - 01")).body.exactProduct).toBe(null);
    // Seeing a near-match in the picker is not acceptance of that identity.
    const unresolved = await supertest(app()).get("/price-finder/calculator/rows")
      .query({ code: "TTS - 01", asOf: "2026-05-01" }).expect(200);
    expect(unresolved.body.rows).toEqual([]);
    expect(unresolved.body.catalogueCodes).toEqual([]);
    expect(unresolved.body.unavailableCodes).toEqual(["TTS - 01"]);
    const accepted = await supertest(app()).get("/price-finder/calculator/rows")
      .query({ code: "TTS-01", asOf: "2026-05-01" }).expect(200);
    expect(accepted.body.rows[0].itemCode).toBe("TTS-01");
    expect((await search("tts-01")).body.exactProduct).toBe(null);
    expect((await search("TTS-01 ")).body.exactProduct).toBe(null);
    const p = (await search("P")).body.exactProduct;
    expect(p).toMatchObject({ itemCode: "P", productName: "Catalogue without a price", division: "Pipes", category: "PPR" });
    const inactive = await supertest(app()).get("/price-finder/calculator/rows").query({ code: "P", asOf: "2026-05-01" });
    expect(inactive.body.rows[0]).toMatchObject({ itemCode: "P", productName: "Catalogue without a price", division: "Pipes",
      category: "PPR", prayag: { price: null }, variants: [{ variant: "Standard", price: null }] });
    const browse = await supertest(app(undefined, true)).get("/price-finder/calculator/search")
      .query({ division: "Pipes", category: "PPR", asOf: "2026-05-01" });
    expect(browse.body.results.map((p: any) => p.itemCode)).toContain(" A");
    const known = await supertest(app(undefined, true)).get("/price-finder/calculator/competitors").query({ asOf: "2026-05-01" });
    expect(known.body.competitors.map((c: any) => c.competitor)).toContain("Brand");
    expect((await supertest(app()).get("/price-finder/calculator/search?q[x]=A")).status).toBe(400);
  });
  it("exports Edited, Entered and App provenance, originals, flags and both unverified banners", async () => {
    const blocks = [
      { ...requestBlock(), mrp: "28.00", competitors: [
        { id: "c", competitor: "Brand", discount: "0", mrp: "30.25" },
        { id: "oneoff", competitor: "Brand", adHoc: true, mrp: "29", discount: "0" },
      ] },
      { ...requestBlock("P"), id: "p", mrp: "12.50", competitors: [] },
      { ...requestBlock("TTS - 01"), id: "adhoc", mrp: "92", adHocProduct: true,
        description: "Retailer sample", competitors: [{ id: "new", competitor: "Shop brand", adHoc: true, mrp: "100", discount: "0" }] },
      { ...requestBlock("A"), id: "app", competitors: [] },
    ];
    const result = await exportBook(blocks);
    expect(result.status).toBe(200);
    const book = XLSX.read(result.body);
    const rows = XLSX.utils.sheet_to_json<any[]>(book.Sheets.Data, { header: 1 });
    const summary = XLSX.utils.sheet_to_json<any[]>(book.Sheets.Summary, { header: 1 });
    const comparison = XLSX.utils.sheet_to_json<any[]>(book.Sheets.Comparison, { header: 1 });
    expect(comparison[2][0]).toContain("6 hand-entered or edited prices");
    expect(summary[2][0]).toEqual(comparison[2][0]); expect(comparison[2][0]).toContain("unverified");
    for (const sheet of [comparison, summary]) {
      expect(sheet.flat().filter(value => value === CALCULATOR_SCOPE_DISCLOSURE)).toHaveLength(1);
      expect(sheet.flat()).not.toContain("Company test");
    }
    const start = rows.findIndex(r => r[0] === "Code");
    const data = rows.slice(start + 1);
    expect(data[0][26]).toBe("Edited"); expect(data[0][27]).toBe(92);
    expect(data[0][28]).toBe("Edited"); expect(data[0][29]).toBe(91);
    expect(data[1][28]).toBe("Entered"); expect(data[1][31]).toBe("Yes");
    expect(data[1][22]).toBe(""); expect(data[1][25]).toContain("price entered by user — basis and unit unverified");
    expect(data[2].slice(0, 4)).toEqual(["P", "Catalogue without a price", "Pipes", "PPR"]);
    expect(data[2][26]).toBe("Entered"); expect(data[2][30]).toBe("No");
    expect(data[3][0]).toBe("TTS - 01"); expect(data[3][2] ?? "").toBe(""); expect(data[3][3] ?? "").toBe("");
    expect(data[3][30]).toBe("Yes");
    expect(data[4][26]).toBe("App");
    expect(summary.flat()).toContain("compared on 1 of 4 products, 1 of which were hand-entered (Ad-hoc)");
    expect(rows[0]).toContain("Our overridden app value");
    expect(summary.flat()).not.toContain("Our overridden app value");
  });
  it("rejects invalid asserted MRPs and missing ad-hoc descriptions without numeric caps", async () => {
    for (const mrp of ["", "0", "-1", "2.001", "Infinity", "abc"]) {
      expect((await exportBook([{ ...requestBlock(), mrp }])).status, mrp).toBe(400);
    }
    expect((await exportBook([{ ...requestBlock(), mrp: "1000000.25" }])).status).toBe(200);
    expect((await exportBook([{ ...requestBlock("unknown"), mrp: "25", adHocProduct: true }])).status).toBe(400);
    const fake = await exportBook([{ ...requestBlock("TTS-01"), mrp: "25", adHocProduct: true, description: "Incorrect supplied metadata" }]);
    const rows = XLSX.utils.sheet_to_json<any[]>(XLSX.read(fake.body).Sheets.Data, { header: 1 });
    expect(rows.find(r => r[0] === "TTS-01")?.[1]).toBe("Exact code");
    expect(rows.find(r => r[0] === "TTS-01")?.[30]).toBe("No");
  });
  it("a complete free-entry session leaves four stored tables, brand vocabulary, coverage and analytics byte-identical", async () => {
    const sha256 = (bytes: string) => createHash("sha256").update(bytes).digest("hex");
    const snapshot = async () => {
      const result: Record<string, string> = {};
      for (const table of ["catalog_products", "competitor_prices", "mrp_price_history", "discount_settings"]) {
        result[table] = (await client.query(`SELECT coalesce(json_agg(row_to_json(t) ORDER BY row_to_json(t)::text COLLATE "C"),'[]')::text AS bytes FROM ${table} t`)).rows[0].bytes;
      }
      // This app has no competitor master: DISTINCT price-row text is its stored brand vocabulary.
      result.brandVocabulary = JSON.stringify((await client.query('SELECT competitor FROM (SELECT DISTINCT competitor FROM competitor_prices) brands ORDER BY competitor COLLATE "C"')).rows);
      return result;
    };
    const aggregatePaths = [
      "/analysis/overview", "/analysis/by-brand", "/analysis/by-category",
      "/analysis/positioning", "/analysis/coverage-matrix", "/analysis/opportunities",
    ];
    const aggregateSnapshot = async () => {
      const result: Record<string, string> = {
        finderCoverage: JSON.stringify(await scopedFinderCompetitors({ itemCodes: [], division: null, category: null }, "2026-05-01")),
      };
      for (const path of aggregatePaths) {
        // Use the real pricing-analytics routes, fixed date and MRP mode.
        // Net-mode default seeding is unrelated to calculator persistence.
        const response = await supertest(app()).get(path)
          .query({ effectivePeriod: "2026-05-01", mode: "mrp" }).expect(200);
        result[path] = response.text;
      }
      return result;
    };
    const beforeAt = new Date().toISOString();
    const before = await snapshot();
    const aggregatesBefore = await aggregateSnapshot();
    // Nonempty official outputs prevent a vacuous unchanged-[] assertion.
    expect(JSON.parse(aggregatesBefore.finderCoverage).competitors.length).toBeGreaterThan(0);
    expect(JSON.parse(aggregatesBefore["/analysis/overview"]).comparableSkus).toBeGreaterThan(0);
    await supertest(app()).get("/price-finder/calculator/search").query({ q: "TTS - 01", asOf: "2026-05-01" }).expect(200);
    await supertest(app()).get("/price-finder/calculator/competitors").expect(200);
    await supertest(app()).get("/price-finder/calculator/rows").query({ code: ["A", "P"], asOf: "2026-05-01" }).expect(200);
    const result = await exportBook([
      { ...requestBlock(), mrp: "28", competitors: [
        { id: "c", competitor: "Brand", discount: "2", mrp: "32" },
        { id: "oneoff", competitor: "Retailer brand", adHoc: true, discount: "0", mrp: "29" },
      ] },
      { ...requestBlock("not recorded"), id: "adhoc", adHocProduct: true, description: "Retailer's sample", mrp: "92",
        competitors: [{ id: "one", competitor: "Other typed brand", adHoc: true, mrp: "95", discount: "0" }] },
      { ...requestBlock("P"), id: "priced", mrp: "100", competitors: [] },
    ]);
    expect(result.status).toBe(200);
    // The new document format is the same read-only transport, including when
    // the session contains local products, brands and edited source MRPs.
    const pdfResult = await supertest(app(undefined, true)).post("/price-finder/calculator/export")
      .send({ asOf: "2026-05-01", format: "pdf", blocks: [
        { ...requestBlock(), mrp: "88", competitors: [{ id: "local", competitor: "PDF-only brand", adHoc: true, mrp: "80", discount: "0" }] },
        { ...requestBlock("PDF-only product"), adHocProduct: true, description: "Local PDF quote", mrp: "20", competitors: [] },
      ] });
    expect(pdfResult.status).toBe(200);
    const aggregatesAfter = await aggregateSnapshot();
    const after = await snapshot(), afterAt = new Date().toISOString();
    expect(after).toEqual(before); // Full serialized row bytes, not just counts/hashes.
    expect(aggregatesAfter).toEqual(aggregatesBefore); // Official output bytes, not basket totals.
    const storedBrands = JSON.parse(after.brandVocabulary).map((r: { competitor: string }) => r.competitor);
    for (const brand of ["Retailer brand", "Other typed brand"]) expect(storedBrands).not.toContain(brand);
    const hashes = (a: Record<string, string>, b: Record<string, string>) => Object.fromEntries(
      Object.keys(a).map(key => [key, { before: sha256(a[key]), after: sha256(b[key]), byteIdentical: a[key] === b[key] }]));
    const report = {
      environment: "disposable private test schema; no public data writes",
      beforeAt, afterAt, algorithm: "SHA-256 over deterministic full-row JSON bytes",
      separateBrandMasterTable: null, brandAuthorityTable: "competitor_prices",
      storedTablesAndVocabulary: hashes(before, after), pricingAggregates: hashes(aggregatesBefore, aggregatesAfter),
    };
    console.info("CALCULATOR_NO_WRITE_PROOF", JSON.stringify(report));
    const reportPath = process.env.CALCULATOR_NO_WRITE_REPORT_PATH;
    if (reportPath) {
      await mkdir(dirname(reportPath), { recursive: true });
      await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
    }
  });
  it("matches every reference Data field, styled sheets, sign colours and one-page text PDF", async () => {
    // Source facts and expected output are captured independently from the supplied
    // 23 October reference, not recalculated using the formatter under test.
    for (const code of ["PS-1", "PS-2"]) {
      const r = reference.find(row => row[0] === code)!;
      await client.query("INSERT INTO catalog_products(item_code,product_name,division,category,uom,is_active) VALUES ($1,$2,$3,$4,'NOS',true)", r.slice(0, 4));
      await client.query("INSERT INTO mrp_price_history(item_code,variant,mrp,review_status,effective_date) VALUES ($1,'Standard',$2,'approved',$3)", [code, r[6], r[7]]);
    }
    for (const r of reference.slice(1).filter(r => r[31] === "No")) {
      const unit = r[12] === "Astral" ? "per 3-m pipe" : "MRP";
      await client.query("INSERT INTO competitor_prices(competitor,matched_prayag_code,match_status,price,effective_date,price_basis,unit) VALUES ($1,$2,'matched',$3,$4,'MRP',$5)", [r[12], r[0], r[13], r[14], unit]);
    }
    const blocks = ["PS-1", "PS-2"].map(code => ({
      id: code, itemCode: code, variant: "Standard", discount: "40", quantity: "10",
      competitors: reference.slice(1).filter(r => r[0] === code).map(r => ({
        id: String(r[12]), competitor: String(r[12]), discount: "40",
        ...(r[31] === "Yes" ? { mrp: String(r[13]), adHoc: true } : {}),
      })),
    }));
    const request = (format = "xlsx", input = blocks) => supertest(app()).post("/price-finder/calculator/export")
      .send({ asOf: "2026-10-23", blocks: input, format }).buffer(true)
      .parse((r, cb) => { const chunks: Buffer[] = []; r.on("data", c => chunks.push(c)); r.on("end", () => cb(null, Buffer.concat(chunks))); });
    const output = await request(); expect(output.status).toBe(200);
    const book = new ExcelJS.Workbook(); await book.xlsx.load(output.body);
    expect(book.worksheets.map(s => s.name)).toEqual(["Comparison", "Summary", "Data"]);
    const data = book.getWorksheet("Data")!, comparison = book.getWorksheet("Comparison")!, summary = book.getWorksheet("Summary")!;
    expect(data.columnCount).toBe(32); expect(comparison.columnCount).toBe(10);
    for (const sheet of book.worksheets) for (const col of sheet.columns) expect(col.width).toBeGreaterThan(0);
    for (const sheet of [comparison, data]) {
      const view = sheet.views[0] as ExcelJS.WorksheetViewFrozen;
      expect(view.state).toBe("frozen"); expect(sheet.views[0].showGridLines).toBe(false);
      const cell = sheet.getRow(view.ySplit!).getCell(1);
      expect(cell.font.bold).toBe(true); expect(cell.font.color?.argb).toMatch(/FFFFFF$/);
      expect(cell.fill.type).toBe("pattern");
    }
    expect(data.autoFilter).toBeTruthy();
    expect(comparison.pageSetup.orientation).toBe("landscape");
    expect(comparison.pageSetup.fitToWidth).toBe(1);
    expect(comparison.pageSetup.printTitlesRow).toBe("5:5");
    reference.forEach((expected, ri) => expected.forEach((value, ci) => {
      const actual = data.getCell(ri + 1, ci + 1).value ?? null;
      if (typeof value === "number") expect(actual, `${ri}:${ci}`).toBeCloseTo(value, 12);
      else expect(actual === "" ? null : actual, `${ri}:${ci}`).toBe(value);
    }));
    const ours = comparison.getRows(1, comparison.rowCount)!.filter(r => r.getCell(8).value === "OUR PRICE");
    const ourTotal = comparison.getRows(1, comparison.rowCount)!.find(r => r.getCell(1).value === "OUR TOTAL")!;
    expect(ourTotal.getCell(7).value).toBe(3636);
    expect(ours.reduce((n, r) => n + Number(r.getCell(7).value), 0)).toBe(ourTotal.getCell(7).value);
    for (const d of reference.slice(1)) {
      const line = comparison.getRows(1, comparison.rowCount)!.find(r => r.getCell(2).value === `${d[12]}${d[31] === "Yes" ? " (one-off)" : ""}` && r.getCell(3).value === d[13])!;
      expect(line.getCell(8).value).toBeCloseTo(Number(d[19]), 12);
      expect(line.getCell(8).font.color?.argb).toMatch(/216542$/);
      expect(line.getCell(9).value).toBe(d[28]);
    }
    expect(data.getCell("G2").numFmt).toBe("[$₹-en-IN]##,##,##0.00");
    expect(data.getCell("T2").numFmt).toBe("0.0%");
    expect(summary.getRows(1, summary.rowCount)!.some(r => r.values?.toString().includes("provenance"))).toBe(false);
    const summaryRows = summary.getRows(1, summary.rowCount)!;
    for (const [label, value] of [
      ["App prices", 6], ["Edited prices", 0], ["Entered prices", 1], ["Ad-hoc products", 0],
      ["Ad-hoc competitors", 1], ["Products compared", 2], ["Total quantity", 20], ["Our total value", 3636],
    ]) expect(summaryRows.find(r => r.getCell(1).value === label)?.getCell(2).value).toBe(value);
    for (const [name, compared, ourSubtotal, theirSubtotal, difference, cheaper] of [
      ["abc (Ad-hoc)", 1, 1422, 1500, .0548523206751055, 1],
      ["Apollo", 2, 3636, 4032, .108910891089109, 2],
      ["Ashirvad", 1, 2214, 2988, .349593495934959, 1],
      ["Astral", 1, 1422, 2016, .417721518987342, 1],
    ] as const) {
      const r = summaryRows.find(r => r.getCell(1).value === name)!;
      expect(r.getCell(2).value).toBe(`${compared} / 2`);
      expect(r.getCell(3).value).toBe(ourSubtotal); expect(r.getCell(4).value).toBe(theirSubtotal);
      expect(r.getCell(5).value).toBeCloseTo(difference, 12);
      expect(r.getCell(6).value).toBe(cheaper); expect(r.getCell(7).value).toBe(0); expect(r.getCell(8).value).toBe(0);
      expect(summary.getRow(r.number + 1).getCell(1).value).toBe(`compared on ${compared} of 2 products, 0 of which were hand-entered (Ad-hoc)`);
    }
    expect((summaryRows.find(r => r.getCell(1).value === "PS-1")!.values as unknown[]).slice(4, 10)).toEqual([10, 1422, 1500, 1674, "—", 2016]);
    expect((summaryRows.find(r => r.getCell(1).value === "PS-2")!.values as unknown[]).slice(4, 10)).toEqual([10, 2214, "—", 2358, 2988, "—"]);
    const below = structuredClone(blocks);
    below[0].competitors[1].mrp = "100";
    const lowerOutput = await request("xlsx", below);
    const lower = new ExcelJS.Workbook(); await lower.xlsx.load(lowerOutput.body);
    const lowerRow = lower.getWorksheet("Comparison")!.getRows(1, 20)!.find(r => r.getCell(2).value === "abc (one-off)")!;
    expect(Number(lowerRow.getCell(8).value)).toBeLessThan(0);
    expect(lowerRow.getCell(8).font.color?.argb).toMatch(/B42332$/);
    const document = await request("pdf"); expect(document.status).toBe(200);
    expect(document.headers["content-type"]).toContain("application/pdf");
    expect((await PDFDocument.load(document.body)).getPageCount()).toBe(1);
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = getDocument({ data: new Uint8Array(document.body), useSystemFonts: false });
    const pdf = await task.promise;
    const content = (await (await pdf.getPage(1)).getTextContent()).items.map(i => "str" in i ? i.str : "").join(" ");
    for (const present of ["PS-1", "PS-2", "3,636.00", "Apollo", "Ashirvad", "Astral", "Entered", "App", "per 3-m pipe", "This figure is unverified"]) expect(content).toContain(present);
    for (const absent of ["http", "calc=", "%7B", "Log out", "Pricing workspace"]) expect(content).not.toContain(absent);
    expect(calculatorAssertedBanner(1)).toContain("price. This figure is");
    expect(calculatorAssertedBanner(2)).toContain("prices. These figures are");
    expect(content).toContain("1 row has a different recorded unit");
    // Pagination uses measured whole product blocks, not CSS hints. Repeating
    // this exact basket forces several pages; no code/header is orphaned.
    const long = Array.from({ length: 10 }, (_, i) => ({ ...blocks[0], id: `copy-${i}`, description: `copy-${i}` }));
    const multipage = await request("pdf", long);
    expect(multipage.status).toBe(200);
    const moreTask = getDocument({ data: new Uint8Array(multipage.body), useSystemFonts: false });
    const more = await moreTask.promise;
    expect(more.numPages).toBeGreaterThan(1);
    let productBlocks = 0;
    for (let p = 1; p <= more.numPages; p++) {
      const pageText = (await (await more.getPage(p)).getTextContent()).items.map(i => "str" in i ? i.str : "").join(" ");
      const starts = pageText.match(/PS-1 ·/g)?.length ?? 0;
      const tails = pageText.match(/Units differ: competitor per 3-m pipe; ours NOS./g)?.length ?? 0;
      expect(tails).toBe(starts);
      productBlocks += starts;
    }
    expect(productBlocks).toBe(10); await moreTask.destroy();
    const dir = process.env.CALCULATOR_DOCUMENT_REPORT_DIR;
    if (dir) {
      await mkdir(dir, { recursive: true });
      await writeFile(`${dir}/comparison.xlsx`, output.body);
      await writeFile(`${dir}/comparison.pdf`, document.body);
    }
    await task.destroy();
  });
});

function exportBook(blocks: unknown[]) {
  return supertest(app(undefined, true)).post("/price-finder/calculator/export")
    .send({ asOf: "2026-05-01", blocks }).buffer(true)
    .parse((r, cb) => { const chunks: Buffer[] = []; r.on("data", c => chunks.push(c)); r.on("end", () => cb(null, Buffer.concat(chunks))); });
}
