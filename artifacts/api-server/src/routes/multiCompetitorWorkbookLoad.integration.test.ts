import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import supertest from "supertest";
import * as XLSX from "xlsx";
import { drizzle } from "drizzle-orm/node-postgres";
import { db, pool } from "@workspace/db";
import * as tables from "@workspace/db";
import router from "./multiCompetitorWorkbookLoad";
import { parseMultiCompetitorWorkbook } from "../lib/multiCompetitorWorkbook";

// All writes, audit records and sequences belong to this disposable schema.
// No fixtures or price mutations can reach the accepted development catalogue.
const schema = `multi_workbook_test_${process.pid}_${Date.now()}`;
const connectClient = () => pool.connect();
let client: Awaited<ReturnType<typeof connectClient>>;
const spies: ReturnType<typeof vi.spyOn>[] = [];
const names = ["catalog_products", "mrp_sources", "mrp_load_batches", "competitor_prices", "mrp_price_history"];
const source = readFileSync(fileURLToPath(new URL(
  "../../../../attached_assets/Competitor_Master_Plumbing_Astral_FOR_UPLOAD_10Oct2026_1791607212492.xlsx", import.meta.url)));
const parsed = parseMultiCompetitorWorkbook(source, ["Astral", "Jindal"]);
const products = [...new Map(parsed.rows.filter(r => r.prayagCode !== "C133")
  .map(r => [r.prayagCode, {code: r.prayagCode, category: r.sheet.trim()}])).values()];
function api(role = "admin", actor = "loader-admin-a", authenticated = true, temporary = false) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.isAuthenticated = (() => authenticated) as never;
    req.user = authenticated ? {id: actor, role, mustChangePassword: temporary} as never : undefined;
    req.log = {warn() {}, error() {}} as never;
    next();
  });
  app.use("/api", router);
  return supertest(app);
}
const base = "/api/catalog/workbook-loads";
const preview = (buffer = source, brands = ["Astral", "Jindal"]) =>
  api().post(`${base}/preview`).field("brands", JSON.stringify(brands)).attach("file", buffer, "any-name.xlsx");
const apply = (id: number, fp: string, buffer = source) =>
  api().post(`${base}/${id}/apply`).field("contentFingerprint", fp).attach("file", buffer, "reattached.xlsx");
async function protectedState() {
  const r = await client.query(`SELECT
    (SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM competitor_prices c WHERE competitor IN ('Apollo','Ashirvad','Prince','Sparsh Pearl')) AS protected,
    (SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM catalog_products p) AS catalogue,
    (SELECT jsonb_agg(to_jsonb(h) ORDER BY id) FROM mrp_price_history h) AS mrp`);
  return r.rows[0];
}
beforeAll(async () => {
  client = await connectClient();
  expect((await client.query("SELECT current_database() AS name")).rows[0].name).toMatch(/^heliumdb(?:_test)?$/);
  await client.query(`CREATE SCHEMA ${schema}`);
  for (const name of names) {
    await client.query(`CREATE TABLE ${schema}.${name} (LIKE public.${name} INCLUDING ALL)`);
    await client.query(`CREATE SEQUENCE ${schema}.${name}_private_id`);
    await client.query(`ALTER TABLE ${schema}.${name} ALTER COLUMN id SET DEFAULT nextval('${schema}.${name}_private_id')`);
  }
  await client.query(`SET search_path TO ${schema}`);
  const isolated = drizzle(client, {schema: tables});
  for (const method of ["execute", "transaction", "select", "insert", "update", "delete"] as const) {
    spies.push(vi.spyOn(db, method).mockImplementation((isolated[method] as any).bind(isolated)));
  }
}, 30000);
beforeEach(async () => {
  for (const name of [...names].reverse()) await client.query(`TRUNCATE ${name}`);
  await client.query(`INSERT INTO catalog_products (item_code,product_name,category,is_active)
    SELECT code,'Disposable fixture '||code,category,true FROM jsonb_to_recordset($1::jsonb) r(code text,category text)`, [JSON.stringify(products)]);
  const s = await client.query(`INSERT INTO mrp_sources(division,sheet_id,sheet_url,source_kind) VALUES('Fixture','fixture','internal://fixture','competitor') RETURNING id`);
  const b = await client.query(`INSERT INTO mrp_load_batches(source_id,loaded_by,row_count) VALUES($1,'fixture',4) RETURNING id`, [s.rows[0].id]);
  await client.query(`INSERT INTO competitor_prices(competitor,price,unit,competitor_code,effective_date,matched_prayag_code,match_status,load_batch_id)
    SELECT competitor,99,'each','FIX-1','2026-01-01','PRIVATE-PROTECTED','matched',$1
    FROM unnest(ARRAY['Apollo','Ashirvad','Prince','Sparsh Pearl']) competitor`, [b.rows[0].id]);
}, 30000);
afterAll(async () => {
  spies.reverse().forEach(s => s.mockRestore());
  if (client) {await client.query("SET search_path TO public"); await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); client.release();}
  await pool.end();
});
describe("App multi-competitor multi-period workbook loader", () => {
  it("uses P048 on inspection, preview, history, apply and undo", async () => {
    for (const caller of [api("user"), api("sales"), api("admin", "temp-admin", true, true), api("admin", "missing", false)]) {
      for (const path of [base, `${base}/1`]) expect((await caller.get(path)).status).toBeGreaterThanOrEqual(400);
      for (const path of [`${base}/inspect`, `${base}/preview`, `${base}/1/apply`, `${base}/1/undo`]) {
        expect((await caller.post(path).send({reason: "not permitted"})).status).toBeGreaterThanOrEqual(400);
      }
    }
    expect((await client.query("SELECT count(*)::int AS n FROM mrp_load_batches")).rows[0].n).toBe(1);
  });
  it("previews 985/182, applies one provenance-linked batch, and another admin undoes it", async () => {
    const before = await protectedState();
    const p = await preview();
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    expect(p.body.summary).toMatchObject({eligible: 1167, inserted: 1167, unchanged: 0, conflicts: 0});
    expect(p.body.summary.periods.map((x: any) => x.rows)).toEqual([887, 98, 47, 68, 67]);
    expect(p.body.refused.some((x: any) => x.prayagCode === "C133" && x.reason === "Not in destination catalogue")).toBe(true);
    expect((await protectedState())).toEqual(before);
    const a = await apply(p.body.id, p.body.contentFingerprint);
    expect(a.status).toBe(200);
    expect(a.body.status).toBe("applied");
    const count = (await client.query(`SELECT count(*)::int AS n,count(*) FILTER(WHERE load_batch_id=$1)::int AS linked FROM competitor_prices
      WHERE competitor IN ('Astral','Jindal')`, [a.body.id])).rows[0];
    expect(count).toEqual({n: 1167, linked: 1167});
    expect((await protectedState())).toEqual(before);
    expect((await apply(p.body.id, p.body.contentFingerprint)).status).toBe(409);
    const undo = await api("admin", "loader-admin-b").post(`${base}/${p.body.id}/undo`).send({reason: "Verify one-action undo"});
    expect(undo.status).toBe(200);
    expect(undo.body.status).toBe("undone");
    expect((await client.query("SELECT count(*)::int n FROM competitor_prices WHERE competitor IN ('Astral','Jindal')")).rows[0].n).toBe(0);
    expect((await protectedState())).toEqual(before);
    expect((await api().get(base)).body.batches[0].status).toBe("undone");
    expect((await api().post(`${base}/${p.body.id}/undo`).send({reason: "Replay"})).status).toBe(409);
  });
  it("refuses a changed file, even when only an unselected competitor changed", async () => {
    const p = await preview();
    const wb = XLSX.read(source);
    wb.Sheets["CPVC FITTINGS"]!.G4!.v = 999;
    const changed = XLSX.write(wb, {type: "buffer", bookType: "xlsx"});
    expect((await apply(p.body.id, p.body.contentFingerprint, changed)).status).toBe(409);
    expect((await client.query("SELECT count(*)::int n FROM competitor_prices WHERE competitor='Astral'")).rows[0].n).toBe(0);
    expect((await api().get(`${base}/${p.body.id}`)).body.status).toBe("preview");
  });
  it("refuses protected brands and forged caller scope at the server", async () => {
    for (const b of ["Apollo", "Ashirwad", "Ashirvad", "PRINCE", "Sparsh Pearl"]) expect((await preview(source, ["Astral", b])).status).toBe(422);
    const p = await preview(source, ["Astral"]);
    const a = await api().post(`${base}/${p.body.id}/apply`).field("brands", '["Apollo"]')
      .field("contentFingerprint", p.body.contentFingerprint).attach("file", source, "same.xlsx");
    expect(a.status).toBe(200);
    expect((await client.query("SELECT DISTINCT competitor FROM competitor_prices WHERE load_batch_id=$1", [p.body.id])).rows).toEqual([{competitor: "Astral"}]);
  });
  it("refuses undo after a later price change instead of losing that work", async () => {
    const p = await preview();
    expect((await apply(p.body.id, p.body.contentFingerprint)).status).toBe(200);
    await client.query("UPDATE competitor_prices SET price=price+1 WHERE id=(SELECT min(id) FROM competitor_prices WHERE load_batch_id=$1)", [p.body.id]);
    expect((await api().post(`${base}/${p.body.id}/undo`).send({reason: "Must refuse"})).status).toBe(409);
    expect((await client.query("SELECT count(*)::int n FROM competitor_prices WHERE load_batch_id=$1", [p.body.id])).rows[0].n).toBe(1167);
  });
  it("uses the destination catalogue, including C133 when actually present", async () => {
    await client.query("INSERT INTO catalog_products(item_code,product_name,category) VALUES('C133','Destination-only fitting','CPVC FITTINGS')");
    const p = await preview();
    expect(p.status).toBe(201);
    expect(p.body.summary.eligible).toBe(1168);
    expect(p.body.summary.periods.map((x: any) => x.rows)).toEqual([888, 98, 47, 68, 67]);
  });
  it("refuses stale previews if catalogue identity changed", async () => {
    const p = await preview();
    await client.query("UPDATE catalog_products SET product_name=product_name||' changed' WHERE item_code='P20G02'");
    expect((await apply(p.body.id, p.body.contentFingerprint)).status).toBe(409);
  });
  it("does not rewrite unchanged rows or create unprovenanced duplicate prices", async () => {
    const p = await preview();
    expect((await apply(p.body.id, p.body.contentFingerprint)).status).toBe(200);
    const p2 = await preview();
    expect(p2.status).toBe(201);
    expect(p2.body.summary).toMatchObject({eligible: 1167, inserted: 0, unchanged: 1167, conflicts: 0});
    expect((await apply(p2.body.id, p2.body.contentFingerprint)).status).toBe(409);
    expect((await client.query("SELECT count(*)::int n FROM competitor_prices WHERE competitor IN ('Astral','Jindal')")).rows[0].n).toBe(1167);
  });
  it("rolls back prices and current flags if the final audit write fails", async () => {
    const p = await preview();
    const before = await protectedState();
    await client.query(`CREATE FUNCTION fail_workbook_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.row_count>0 THEN RAISE EXCEPTION 'Disposable final-audit failure'; END IF; RETURN NEW; END $$`);
    await client.query("CREATE TRIGGER fail_workbook_audit BEFORE UPDATE ON mrp_load_batches FOR EACH ROW EXECUTE FUNCTION fail_workbook_audit()");
    try {
      expect((await apply(p.body.id, p.body.contentFingerprint)).status).toBe(500);
      expect((await api().get(`${base}/${p.body.id}`)).body.status).toBe("preview");
      expect((await client.query("SELECT count(*)::int n FROM competitor_prices WHERE competitor IN ('Astral','Jindal')")).rows[0].n).toBe(0);
      expect(await protectedState()).toEqual(before);
    } finally {
      await client.query("DROP TRIGGER fail_workbook_audit ON mrp_load_batches");
      await client.query("DROP FUNCTION fail_workbook_audit()");
    }
  });
  it("restores earlier current flags when undoing a later period", async () => {
    const p = await preview(source, ["Astral"]);
    expect((await apply(p.body.id, p.body.contentFingerprint)).status).toBe(200);
    const before = (await client.query("SELECT to_jsonb(c) AS row FROM competitor_prices c WHERE competitor='Astral' ORDER BY id")).rows;
    const wb = XLSX.read(source, {cellDates: true});
    // One selected group with the same identities but a later independent date.
    wb.Sheets["CPVC FITTINGS"]!.M2!.v = new Date("2026-06-01T00:00:00Z");
    const later = XLSX.write(wb, {type: "buffer", bookType: "xlsx"});
    const p2 = await preview(later, ["Astral"]);
    expect(p2.status, JSON.stringify(p2.body)).toBe(201);
    expect(p2.body.summary.inserted).toBeGreaterThan(0);
    expect((await apply(p2.body.id, p2.body.contentFingerprint, later)).status).toBe(200);
    expect((await api("admin", "loader-admin-b").post(`${base}/${p2.body.id}/undo`).send({reason: "Restore earlier flags"})).status).toBe(200);
    expect((await client.query("SELECT to_jsonb(c) AS row FROM competitor_prices c WHERE competitor='Astral' ORDER BY id")).rows).toEqual(before);
  });
  it("loads and undoes unrelated future brands and periods through the same route", async () => {
    await client.query("INSERT INTO catalog_products(item_code,product_name,category) VALUES('ZZ1','Private generic fitting','HARDWARE FITTINGS')");
    const before = await protectedState();
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
      ["Prayag", null, "Gamma's", null, null, "Omega", null],
      ["ITEM CODE", "MRP", "ITEM CODE", new Date("2026-01-01T00:00:00Z"), new Date("2026-02-01T00:00:00Z"), "ITEM CODE", new Date("2026-05-01T00:00:00Z")],
      ["ZZ1", 15, "G-1", 10, 11, "O-1", 12],
    ]), "HARDWARE FITTINGS");
    const generic = XLSX.write(wb, {type: "buffer", bookType: "xlsx"});
    const p = await preview(generic, ["Gamma's", "Omega"]);
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    expect(p.body.summary.eligible).toBe(3);
    expect((await apply(p.body.id, p.body.contentFingerprint, generic)).status).toBe(200);
    expect((await client.query("SELECT competitor,count(*)::int n FROM competitor_prices WHERE load_batch_id=$1 GROUP BY competitor ORDER BY competitor", [p.body.id])).rows)
      .toEqual([{competitor: "Gamma's", n: 2}, {competitor: "Omega", n: 1}]);
    expect((await api("admin", "loader-admin-b").post(`${base}/${p.body.id}/undo`).send({reason: "Generic loader rollback"})).status).toBe(200);
    expect(await protectedState()).toEqual(before);
  });
  it("prefers exact codes and does not let unrelated normalized collisions block preview", async () => {
    await client.query(`INSERT INTO catalog_products(item_code,product_name,category) VALUES
      ('PW71','Distinct unspaced code','SWR PIPE'),('UN RELATED','Private unrelated code','TEST'),
      ('UNRELATED','Another private unrelated code','TEST')`);
    const p = await preview();
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    expect(p.body.summary.eligible).toBe(1167);
    const applied = await apply(p.body.id, p.body.contentFingerprint);
    expect(applied.status).toBe(200);
    expect((await client.query("SELECT matched_prayag_code FROM competitor_prices WHERE competitor='Astral' AND competitor_code='M341110307'")).rows[0].matched_prayag_code).toBe("PW 71");
  });
});
