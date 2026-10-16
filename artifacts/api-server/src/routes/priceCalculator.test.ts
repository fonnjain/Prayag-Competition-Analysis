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
    expect(gone.body.unavailableCodes).toEqual(["C"]);
  });
  it("compares stored price bases separately from units and reports misplaced unit metadata", async () => {
    await client.query("BEGIN");
    try {
      await client.query("UPDATE competitor_prices SET unit='MRP' WHERE competitor='Brand'");
      const get = () => supertest(app()).get("/price-finder/calculator/rows").query({ code: "A", asOf: "2026-05-01" });
      let r = await get(), p = r.body.rows[0], q = p.competitors[0];
      expect(p.basis).toBe("MRP"); expect(p.unit).toBe("NOS");
      expect(q.basisMismatch).toBe(false); expect(q.unitMismatch).toBe(true);
      expect(q.unitWarning).toContain('competitor unit field contains price basis "MRP"');
      await client.query("UPDATE mrp_price_history SET price_basis='Net' WHERE item_code='A' AND variant='Standard'");
      r = await get(); p = r.body.rows[0]; q = p.competitors[0];
      expect(p.basis).toBe("Net"); expect(q.basisMismatch).toBe(true); expect(q.unitMismatch).toBe(true);
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
  it("composed product/quote restrictions apply to both rows and POST export and disclose lost coverage", async () => {
    expect(bucketRouteApplies("POST", "/price-finder/calculator/export")).toBe(true);
    const r = await supertest(app(undefined, true)).get("/price-finder/calculator/rows").query({ code: ["A", " A"], asOf: "2026-05-01" });
    expect(r.body.rows.map((p: any) => p.itemCode)).toEqual(["A"]);
    expect(r.body.rows[0].competitors.map((c: any) => c.competitor)).toEqual(["Taxed"]);
    expect(r.body.scopeDisclosure).toContain("1 products have no competitor price under this filter");
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
    expect(detail).toHaveLength(3); expect(detail[1][9]).toBe(61.34); expect(detail[1][11]).toBe(429.38);
    expect(detail[1][16]).toBe(74.62); expect(detail[1][17]).toBe(522.34);
    expect(XLSX.utils.sheet_to_json<any[]>(book.Sheets.Summary, { header: 1 }).flat()).toContain("Prices resolved as of 01-05-2026.");
    expect(detail[2][22]).toBe("Price basis differs: ours MRP; competitor Ex-GST. Unit not recorded: ours NOS; competitor not recorded.");
    expect(XLSX.utils.sheet_to_json<any[]>(book.Sheets.Summary, { header: 1 }).flat())
      .toContain("1 rows have a different or unconfirmed price basis — see the warning marks.");
    expect(XLSX.utils.sheet_to_json<any[]>(book.Sheets.Summary, { header: 1 }).flat())
      .toContain("1 rows have missing, malformed or unconfirmed unit evidence — see the warning marks.");
  });
  it("export re-resolves prices and omits unavailable evidence instead of trusting client totals", async () => {
    const bad = { ...requestBlock(), ourPrice: 1 };
    expect((await supertest(app()).post("/price-finder/calculator/export").send({ asOf: "2026-05-01", blocks: [bad] })).status).toBe(400);
    const dup = requestBlock(); dup.competitors.push({ id: "x", competitor: "Brand", discount: "0" });
    expect((await supertest(app()).post("/price-finder/calculator/export").send({ asOf: "2026-05-01", blocks: [dup] })).status).toBe(400);
    const invalid = requestBlock(); invalid.quantity = "0";
    expect((await supertest(app()).post("/price-finder/calculator/export").send({ asOf: "2026-05-01", blocks: [invalid] })).status).toBe(400);
  });
});
