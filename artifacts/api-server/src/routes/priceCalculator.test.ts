import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import express from "express";
import supertest from "supertest";
import * as XLSX from "xlsx";
const state = vi.hoisted(() => ({ database: null as any }));
vi.mock("@workspace/db", async original => {
  const real = await original<typeof import("@workspace/db")>();
  return { ...real, db: new Proxy({}, { get(_o, key) { return state.database[key]; } }) };
});
import { pool } from "@workspace/db";
import router from "./priceCalculator";
import { withBucketContext, bucketRouteApplies } from "../lib/bucketFilter";
import { readFinderEvidence } from "../lib/priceFinderEvidence";
import { CALCULATOR_SCOPE_DISCLOSURE } from "@workspace/formatting";
const schema = `pf_calc_${randomUUID().replaceAll("-", "")}`;
const connect = () => pool.connect();
let client: Awaited<ReturnType<typeof connect>>;
beforeAll(async () => {
  client = await connect();
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET search_path TO "${schema}"`);
  state.database = drizzle(client);
  // Minimal disposable models; search_path contains NO public fallback.
  await client.query("CREATE TABLE catalog_products(item_code text,product_name text,division text,category text,uom text,is_active boolean,discontinued_from date)");
  await client.query("CREATE TABLE mrp_price_history(id serial,item_code text,variant text,mrp double precision,review_status text,effective_date date,price_basis text DEFAULT 'MRP')");
  await client.query("CREATE TABLE competitor_prices(id serial,competitor text,matched_prayag_code text,match_status text,price double precision,effective_date date,price_basis text,gst_pct double precision,unit text)");
  await client.query("CREATE TABLE discount_settings(scope text,discount_pct double precision)");
  await client.query("INSERT INTO catalog_products VALUES ('A','Alpha pipe','Pipes','PPR','NOS',true,NULL),(' A','Spaced code','Pipes','PPR','NOS',true,NULL),('B','Unpriced competitor','PTMT','Tap','NOS',true,NULL),('C','Discontinued','Pipes','PPR','NOS',true,'2026-06-01')");
  await client.query("INSERT INTO mrp_price_history(item_code,variant,mrp,review_status,effective_date) VALUES ('A','Standard',92,'approved','2026-01-01'),('A','Standard',99,'pending','2026-02-01'),('A','Standard',100,'approved','2026-09-01'),('A','Standard',200,'approved','2027-01-01'),('A','Ivory',110,'approved','2026-01-01'),(' A','Standard',10,'approved','2026-01-01'),('B','Standard',50,'approved','2026-01-01'),('C','Standard',20,'approved','2026-01-01')");
  await client.query("INSERT INTO competitor_prices(competitor,matched_prayag_code,match_status,price,effective_date,price_basis,gst_pct,unit) VALUES ('Brand','A','matched',91,'2026-01-01','MRP',NULL,'NOS'),('Brand','A','matched',101,'2026-09-01','MRP',NULL,'NOS'),('Taxed','A','matched',100,'2026-01-01','Ex-GST',18,NULL),('Future','A','matched',400,'2027-01-01','MRP',NULL,'NOS'),('Missing','A','matched',NULL,'2026-01-01','MRP',NULL,'NOS'),('Wrong','A','unmatched',1,'2026-01-01','MRP',NULL,'NOS')");
  await client.query("INSERT INTO discount_settings VALUES ('Our',20),('Brand',18)");
  await client.query("INSERT INTO catalog_products VALUES ('P','Catalogue without a price','Pipes','PPR','NOS',false,NULL),('TTS-01','Exact code','CP','Valve','NOS',true,NULL)");
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
  a.use(router); return a;
}
const requestBlock = (code = "A") => ({
  id: "b", itemCode: code, variant: "Standard", discount: "20", quantity: "7",
  competitors: [{ id: "c", competitor: "Brand", discount: "18" }],
});
describe("public read-only calculator endpoints", () => {
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
  it("exports exactly two sheets and one detail row per selected competitor, with unit-first values and disclosures", async () => {
    const b = requestBlock(); b.discount = "33.33";
    b.competitors.push({ id: "taxed", competitor: "Taxed", discount: "0" });
    const res = await supertest(app()).post("/price-finder/calculator/export").send({ asOf: "2026-05-01", blocks: [b] })
      .buffer(true).parse((r, cb) => { const chunks: Buffer[] = []; r.on("data", c => chunks.push(c)); r.on("end", () => cb(null, Buffer.concat(chunks))); });
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toContain("prayag-price-calculator-2026-05-01.xlsx");
    const book = XLSX.read(res.body);
    expect(book.SheetNames).toEqual(["Calculator detail", "Summary"]);
    const detail = XLSX.utils.sheet_to_json<any[]>(book.Sheets["Calculator detail"], { header: 1 });
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
    const rows = XLSX.utils.sheet_to_json<any[]>(book.Sheets["Calculator detail"], { header: 1 });
    const summary = XLSX.utils.sheet_to_json<any[]>(book.Sheets.Summary, { header: 1 });
    expect(rows[0][0]).toContain("6 hand-entered or edited prices");
    expect(summary[0][0]).toEqual(rows[0][0]); expect(rows[0][0]).toContain("unverified");
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
    expect(summary.flat()).toContain("Our overridden app value");
  });
  it("rejects invalid asserted MRPs and missing ad-hoc descriptions without numeric caps", async () => {
    for (const mrp of ["", "0", "-1", "2.001", "Infinity", "abc"]) {
      expect((await exportBook([{ ...requestBlock(), mrp }])).status, mrp).toBe(400);
    }
    expect((await exportBook([{ ...requestBlock(), mrp: "1000000.25" }])).status).toBe(200);
    expect((await exportBook([{ ...requestBlock("unknown"), mrp: "25", adHocProduct: true }])).status).toBe(400);
    const fake = await exportBook([{ ...requestBlock("TTS-01"), mrp: "25", adHocProduct: true, description: "Incorrect supplied metadata" }]);
    const rows = XLSX.utils.sheet_to_json<any[]>(XLSX.read(fake.body).Sheets["Calculator detail"], { header: 1 });
    expect(rows.find(r => r[0] === "TTS-01")?.[1]).toBe("Exact code");
    expect(rows.find(r => r[0] === "TTS-01")?.[30]).toBe("No");
  });
  it("a complete calculator free-entry session leaves all stored source rows and brand spellings byte-identical", async () => {
    const snapshot = async () => {
      const result: Record<string, string> = {};
      for (const table of ["catalog_products", "competitor_prices", "mrp_price_history", "discount_settings"]) {
        result[table] = (await client.query(`SELECT coalesce(json_agg(row_to_json(t) ORDER BY row_to_json(t)::text),'[]')::text AS bytes FROM ${table} t`)).rows[0].bytes;
      }
      // This app has no competitor master: DISTINCT price-row text is its stored brand vocabulary.
      result.brandVocabulary = JSON.stringify((await client.query("SELECT DISTINCT competitor FROM competitor_prices ORDER BY competitor")).rows);
      return result;
    };
    const before = await snapshot();
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
    expect(await snapshot()).toEqual(before);
  });
});

function exportBook(blocks: unknown[]) {
  return supertest(app(undefined, true)).post("/price-finder/calculator/export")
    .send({ asOf: "2026-05-01", blocks }).buffer(true)
    .parse((r, cb) => { const chunks: Buffer[] = []; r.on("data", c => chunks.push(c)); r.on("end", () => cb(null, Buffer.concat(chunks))); });
}
