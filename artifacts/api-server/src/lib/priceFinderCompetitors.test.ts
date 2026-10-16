import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
const state = vi.hoisted(() => ({ database: null as any }));
vi.mock("@workspace/db", async original => {
  const real = await original<typeof import("@workspace/db")>();
  return { ...real, db: new Proxy({}, { get(_o, key) { return state.database[key]; } }) };
});
import { pool } from "@workspace/db";
import { exactQueryCodes, finderAsOf, finderScope, scopedFinderCompetitors } from "./priceFinderCompetitors";
import { withBucketContext } from "./bucketFilter";
const schema = `pf_scope_${randomUUID().replaceAll("-", "")}`;
const connect = () => pool.connect();
let client: Awaited<ReturnType<typeof connect>>;
beforeAll(async () => {
  client = await pool.connect();
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET search_path TO "${schema}"`);
  state.database = drizzle(client);
  // No public fallback, shared catalogue fixtures or price data touched.
  await client.query("CREATE TABLE catalog_products(item_code text,division text,category text,is_active boolean DEFAULT true,discontinued_from date)");
  await client.query("CREATE TABLE competitor_prices(competitor text,matched_prayag_code text,match_status text,price double precision,effective_date date)");
  await client.query("INSERT INTO catalog_products(item_code,division,category) VALUES ('A','Pipes','One'),(' A','PTMT','Two'),('B','Pipes','Other'),('C','Pipes','One')");
  await client.query("INSERT INTO competitor_prices VALUES ('Alpha','A','matched',10,'2026-01-01'),('Alpha','A','matched',11,'2026-02-01'),('Beta',' A','matched',20,'2026-01-01'),('Future','A','matched',22,'2027-01-01'),('Missing','A','matched',NULL,'2026-01-01'),('Wrong','A','unmatched',12,'2026-01-01'),('Orphan','X','matched',1,'2026-01-01')");
});
afterAll(async () => {
  if (client) { await client.query("SET search_path TO public"); await client.query(`DROP SCHEMA "${schema}" CASCADE`); client.release(); }
});
describe("scoped current competitor coverage", () => {
  it("uses exact identifiers, not comma splitting, case folding or trimming", () => {
    expect(exactQueryCodes(["A", " A", "a", "A,B"])).toEqual(["A", " A", "a", "A,B"]);
    expect(() => exactQueryCodes({ bad: "A" })).toThrow();
    expect(() => exactQueryCodes(Array.from({ length: 51 }, (_, i) => `${i}`))).toThrow();
    expect(() => finderScope({ division: ["X"] })).toThrow();
    expect(() => finderAsOf("2026-02-30")).toThrow();
  });
  it("excludes future, null, unmatched and orphan prices and counts products once", async () => {
    const r = await scopedFinderCompetitors(finderScope({ division: "Pipes" }), "2026-10-16");
    expect(r.productsInScope).toBe(3); expect(r.productsWithNoCompetitorPrice).toBe(2);
    expect(r.competitors).toEqual([{ competitor: "Alpha", pricedProducts: 1, coveragePct: 33.33, effectiveDate: "2026-02-01" }]);
  });
  it("scopes category, exact repeated codes and date", async () => {
    const r = await scopedFinderCompetitors(finderScope({ itemCode: [" A"] }), "2026-10-16");
    expect(r.competitors.map(x => x.competitor)).toEqual(["Beta"]);
    expect((await scopedFinderCompetitors(finderScope({ itemCode: "A" }), "2025-12-31")).competitors).toEqual([]);
    expect((await scopedFinderCompetitors(finderScope({ division: "Pipes", category: "Other" }), "2026-10-16")).productsWithNoCompetitorPrice).toBe(1);
  });
  it("honours company/personal composed product restrictions", async () => {
    const r = await withBucketContext({ type: "excluded", codes: new Set(["A"]), banner: "test" },
      () => scopedFinderCompetitors(finderScope({}), "2026-10-16"));
    expect(r.competitors.map(c => c.competitor)).toEqual(["Beta"]);
    expect(r.productsInScope).toBe(3);
  });
});
