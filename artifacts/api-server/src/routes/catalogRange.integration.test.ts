import { readFileSync } from "node:fs";
import express from "express";
import supertest from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { db, pool, catalogProductsTable, locallyAddedSeriesTable } from "@workspace/db";
import { RANGE_DIVISIONS, supportsCatalogRange, masterClassification } from "@workspace/formatting";
import routes from "./index";
import { AUTHORITATIVE_MASTER_SHA256, loadAuthoritativeMaster, parseAuthoritativeMasterBuffer, planAuthoritativeClassifications, type ParsedAuthoritativeMaster } from "../lib/authoritativeMrpMaster";
import { parseNewProductsWorkbook } from "./catalogImportExport";
import * as XLSX from "xlsx";

// Real SQL and route handlers, but exclusively empty disposable tables.
// Own sequences prevent even a cancelled run from advancing public sequences.
const schema = `range_test_${process.pid}_${Date.now()}`;
let client: any;
const spies: Array<{ mockRestore(): void }> = [];
const pipeDivision = "Pipes & Fittings";
const cpDivision = RANGE_DIVISIONS[0];
const hidden = "Keep EXACT Legacy Range";
function asRole(role: "admin" | "user") {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.isAuthenticated = (() => true) as never;
    req.user = { id: "range-fixture", email: "range-fixture@example.test", role, mustChangePassword: false };
    next();
  });
  app.use(routes);
  return supertest(app);
}
const admin = asRole("admin");

beforeAll(async () => {
  client = await pool.connect();
  await client.query(`CREATE SCHEMA ${schema}`);
  const tables = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rows;
  for (const { tablename } of tables) {
    await client.query(`CREATE TABLE ${schema}."${tablename}" (LIKE public."${tablename}" INCLUDING ALL)`);
  }
  const serials = (await client.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND column_default LIKE 'nextval(%'")).rows;
  for (const { table_name, column_name } of serials) {
    const sequence = `${table_name}_${column_name}_fixture_seq`;
    await client.query(`CREATE SEQUENCE ${schema}."${sequence}"`);
    await client.query(`ALTER TABLE ${schema}."${table_name}" ALTER COLUMN "${column_name}" SET DEFAULT nextval('${schema}."${sequence}"')`);
  }
  await client.query(`SET search_path TO ${schema}, public`);
  const isolated = drizzle(client);
  for (const method of ["select", "insert", "update", "delete", "execute", "transaction"] as const) {
    spies.push(vi.spyOn(db, method).mockImplementation((isolated[method] as any).bind(isolated)));
  }
  await db.insert(catalogProductsTable).values([
    ...RANGE_DIVISIONS.map((division, index) => ({ itemCode: `CP-FIX-${index}`, division, category: "Real Category", seriesRange: "Existing Range", productName: "CP fixture" })),
    { itemCode: "P049-PIPE-01", division: pipeDivision, category: "Pipes", seriesRange: hidden, productName: "Pipe fixture" },
    ...["PS1106", "PS1606", "PS5157", "PS5163", "PS5171", "PS5657", "PS5763", "PS7506"].map(itemCode => ({ itemCode, division: pipeDivision, productName: "Removal fixture" })),
  ]);
}, 60_000);

afterAll(async () => {
  spies.reverse().forEach(spy => spy.mockRestore());
  if (client) {
    await client.query("SET search_path TO public");
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    client.release();
  }
});

describe("approved optional Range and hidden-field safety", () => {
  it("accepts exactly the three stored division values, without aliases", () => {
    expect(RANGE_DIVISIONS).toEqual(["CP Fittings / Faucets", "CP (QUAA / FERN)", "PTMT & Plastic Fittings"]);
    for (const division of RANGE_DIVISIONS) expect(supportsCatalogRange(division)).toBe(true);
    for (const division of [pipeDivision, "PTMT", "QUAA & FERN", "Sink", "Sanitaryware", "Ceramic Sanitaryware", "Hardware", "Test", "CP Fittings / Faucets | Ceramic Sanitaryware"]) {
      expect(supportsCatalogRange(division)).toBe(false);
    }
  });

  it("creates a pipe with no Range through preview and apply", async () => {
    const data = { itemCode: "P049-PIPE-02", division: pipeDivision, category: "Pipes", productName: "New pipe fixture", series: "", mrp: 123.45, effectiveDate: "2026-08-01", reason: "Fixture creation", unusualCodeConfirmed: true };
    const preview = await admin.post("/catalog/price-editor/new-product/preview").send(data);
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    const applied = await admin.post("/catalog/price-editor/new-product/apply").send({ ...data, token: preview.body.token });
    expect(applied.status, JSON.stringify(applied.body)).toBe(200);
    const [created] = await db.select().from(catalogProductsTable).where(eq(catalogProductsTable.itemCode, data.itemCode));
    expect(created.seriesRange).toBeNull();
    expect(created.category).toBe("Pipes");
  });

  it("permits an approved CP product with an empty optional Range", async () => {
    const response = await admin.post("/catalog/price-editor/new-product/preview").send({ itemCode: "CP-FIX-NEW", division: cpDivision, category: "Real Category", productName: "CP without Range", series: "", mrp: 55, effectiveDate: "2026-08-01", reason: "Optional Range fixture" });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
  });

  it("price-editing a pipe leaves its hidden Range and Category byte-for-byte unchanged", async () => {
    const before = (await db.select().from(catalogProductsTable).where(eq(catalogProductsTable.itemCode, "P049-PIPE-01")))[0];
    const response = await admin.post("/catalog/price-editor/save").send({ itemCode: before.itemCode, series: "Prayag MRP", value: 91, effectiveDate: "2026-08-01", remarks: "Hidden-field fixture" });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const after = (await db.select().from(catalogProductsTable).where(eq(catalogProductsTable.itemCode, before.itemCode)))[0];
    expect(after.seriesRange).toBe(hidden);
    expect(after.category).toBe(before.category);
  });

  it("Add Range remains admin-only, scoped, reasoned, audited, stored as typed, and empty", async () => {
    const body = { division: cpDivision, name: "Typed  Range", reason: "Explicit fixture reason" };
    expect((await asRole("user").post("/catalog/price-editor/series").send(body)).status).toBe(403);
    expect((await admin.post("/catalog/price-editor/series").send({ ...body, division: pipeDivision })).status).toBe(400);
    expect((await admin.post("/catalog/price-editor/series").send({ ...body, reason: "" })).status).toBe(400);
    const created = await admin.post("/catalog/price-editor/series").send(body);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({ name: body.name, reason: body.reason, actor: "range-fixture@example.test" });
    expect(created.body.createdAt).toBeTruthy();
    const duplicate = await admin.post("/catalog/price-editor/series").send({ ...body, name: "typed range" });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.existingValue).toBe(body.name);
    expect((await db.select().from(catalogProductsTable)).some(product => product.seriesRange === body.name)).toBe(false);
    expect((await db.select().from(locallyAddedSeriesTable)).some(option => option.name === body.name)).toBe(true);
  });

  it("accepts optional upload Range only in the approved divisions and reports other supplied values", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["Item Code", "Division", "Range", "Product", "Size", "MRP", "Effective Date"],
      ["UP-CP", cpDivision, "Real Range", "CP fixture", "", 10, "2026-08-01"],
      ["UP-PIPE", pipeDivision, "Supplied Legacy", "Pipe fixture", "", 20, "2026-08-01"],
    ]), "products");
    const parsed = parseNewProductsWorkbook(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
    expect(parsed.rows[0].seriesRange).toBe("Real Range");
    expect(parsed.rows[1].seriesRange).toBeNull();
    expect(parsed.rangeWarnings).toHaveLength(1);
    expect(parsed.rangeWarnings[0].itemCode).toBe("UP-PIPE");
  });

  it("accepts the current master parser and refuses only genuinely new CP rows without Category", async () => {
    const buffer = readFileSync("../../attached_assets/Prayag_MRP_Authoritative_v2_01Sep2026_1788783858192.xlsx");
    const parsed = parseAuthoritativeMasterBuffer(buffer);
    expect(parsed.productRows).toHaveLength(6106);
    const plan = planAuthoritativeClassifications(parsed.productRows, parsed.productRows.map(row => ({
      itemCode: row.itemCode, division: row.division, category: "Existing Category", seriesRange: row.series,
    })));
    expect(plan.rejectedRows).toEqual([]);
    expect(plan.counts.existingProducts).toBe(6106);
    const newCP = planAuthoritativeClassifications([{ ...parsed.productRows[0]!, itemCode: "NO-CATEGORY", division: cpDivision, category: null }], []);
    expect(newCP.rejectedRows[0]?.reason).toBe("new CP/PTMT product needs a category: create it in the product editor");
  });

  it("existing master products are prices only, preserving Category, division and hidden Range", async () => {
    expect(masterClassification({ itemCode: "CP", division: cpDivision, category: "Category column", series: "Range column" })).toEqual({ category: "Category column", seriesRange: "Range column" });
    const rows = [
      { itemCode: "CP-FIX-0", division: cpDivision, category: "New Genuine Category", series: "New Genuine Range", productName: "CP fixture", size: null, mrp: 45, effectiveDate: "2026-08-01", variant: "Standard" as const },
      { itemCode: "P049-PIPE-01", division: pipeDivision, category: "Genuine Pipe Category", series: "Ignored source Range", productName: "Pipe fixture", size: null, mrp: 91, effectiveDate: "2026-08-01", variant: "Standard" as const },
    ];
    const parsed: ParsedAuthoritativeMaster = { fileName: "classification-fixture.xlsx", fileSha256: AUTHORITATIVE_MASTER_SHA256, loadReason: "Disposable fixture", dataFlag: "fixture", productRows: rows, priceRows: rows, discontinuedRows: [], excludedRows: 0, invalidExcludedCodes: [], periodCounts: {}, periodDivisionCounts: {}, variantCounts: { Standard: 2, Ivory: 0, "White with Jet": 0, "Pink / Green / Blue": 0 }, preservedNameDisagreements: [] };
    await loadAuthoritativeMaster({ parsed, downloadedAt: "2026-10-03", loadedBy: "fixture" });
    const products = await db.select().from(catalogProductsTable);
    expect(products.find(p => p.itemCode === "CP-FIX-0")).toMatchObject({ division: cpDivision, category: "Real Category", seriesRange: "Existing Range" });
    expect(products.find(p => p.itemCode === "P049-PIPE-01")).toMatchObject({ division: pipeDivision, category: "Pipes", seriesRange: hidden });
  });

  it("applies a new pipe with series as Category and skips a new CP, in the disposable schema only", async () => {
    await db.insert(catalogProductsTable).values({ itemCode: "Step3-Camel", division: pipeDivision, category: "Stored Category", seriesRange: hidden, productName: "Existing mixed-case fixture" });
    const rows = [
      { itemCode: "STEP3-NEW-PIPE", division: pipeDivision, category: null, series: "HDPE Pipe", productName: "New pipe fixture", size: null, mrp: 77, effectiveDate: "2026-08-01", variant: "Standard" as const },
      { itemCode: "STEP3-NEW-CP", division: cpDivision, category: null, series: "Blaze 62", productName: "Refused CP fixture", size: null, mrp: 99, effectiveDate: "2026-08-01", variant: "Standard" as const },
      { itemCode: "STEP3-CAMEL", division: pipeDivision, category: null, series: "File Category", productName: "Changed name must not write", size: null, mrp: 66, effectiveDate: "2026-08-01", variant: "Standard" as const },
    ];
    const parsed: ParsedAuthoritativeMaster = { fileName: "step3-fixture.xlsx", fileSha256: "step3-disposable-only", loadReason: "Disposable fixture", dataFlag: "fixture", productRows: rows, priceRows: [...rows, { ...rows[1]!, variant: "Ivory", mrp: 150 }], discontinuedRows: [], excludedRows: 0, invalidExcludedCodes: [], periodCounts: {}, periodDivisionCounts: {}, variantCounts: { Standard: 3, Ivory: 1, "White with Jet": 0, "Pink / Green / Blue": 0 }, preservedNameDisagreements: [] };
    const result = await loadAuthoritativeMaster({ parsed, downloadedAt: "2026-10-03", loadedBy: "fixture" });
    expect(result.duplicate).toBe(false);
    if (result.duplicate) throw new Error("Unexpected fixture duplicate");
    expect(result.priceRows).toBe(2);
    expect(result.variantCounts).toEqual({ Standard: 2, Ivory: 0, "White with Jet": 0, "Pink / Green / Blue": 0 });
    expect(result.periodCounts).toEqual({ "2026-08-01": 2 });
    expect(result.rejectedRows).toHaveLength(1);
    const [pipe] = await db.select().from(catalogProductsTable).where(eq(catalogProductsTable.itemCode, "STEP3-NEW-PIPE"));
    expect(pipe).toMatchObject({ category: "HDPE Pipe", seriesRange: null });
    expect(await db.select().from(catalogProductsTable).where(eq(catalogProductsTable.itemCode, "STEP3-NEW-CP"))).toEqual([]);
    const cpPrices = await client.query("SELECT count(*)::int n FROM mrp_price_history WHERE item_code='STEP3-NEW-CP'");
    expect(cpPrices.rows[0].n).toBe(0);
    const camelPrices = await client.query("SELECT item_code, mrp FROM mrp_price_history WHERE UPPER(item_code)='STEP3-CAMEL'");
    expect(camelPrices.rows).toEqual([{ item_code: "Step3-Camel", mrp: 66 }]);
    const [camel] = await db.select().from(catalogProductsTable).where(eq(catalogProductsTable.itemCode, "Step3-Camel"));
    expect(camel).toMatchObject({ category: "Stored Category", seriesRange: hidden, productName: "Existing mixed-case fixture" });
  });
});