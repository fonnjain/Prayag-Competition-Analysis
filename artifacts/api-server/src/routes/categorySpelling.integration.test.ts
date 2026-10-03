import { describe, expect, it } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import express from "express";
import supertest from "supertest";
import * as XLSX from "xlsx";
import { eq } from "drizzle-orm";
import { db, catalogProductsTable, mrpSourcesTable, mrpLoadBatchesTable, locallyAddedCategoriesTable } from "@workspace/db";
import routes from "./index";
import { persistParsedRows, divisionFromFilename } from "./catalogImportExport";
import { normalizeVocabularyKey } from "../lib/priceEditorVocabulary";
import { createCatalogSyncBundleFromData, exportCatalogSyncBundle, getCatalogSyncSnapshot,
  applyCatalogSyncBundle, previewCatalogSyncCategories } from "../lib/catalogSync";

const api = (role: "admin" | "user" = "admin") => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.isAuthenticated = (() => true) as never;
    req.user = { id: "p051-private-fixture", email: "fixture@example.test", role, mustChangePassword: false } as never;
    req.log = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} } as never;
    next();
  });
  app.use("/api", routes);
  return supertest(app);
};
let sequence = 0;
async function fixture(kind: string) {
  const code = `P051-${++sequence}`;
  const filename = "P051 fixture CP.xlsx";
  const division = divisionFromFilename(filename)!;
  const base = `Fixture Category ${sequence}`;
  const category = kind === "new" ? `Novel Category ${sequence}` : base.toUpperCase().replace(/ /g, "-");
  await db.insert(catalogProductsTable).values([
    { itemCode: `${code}-OLD1`, productName: "Original", division, category: base, seriesRange: null },
    ...(kind === "two" ? [
      { itemCode: `${code}-OLD2`, productName: "Original2", division, category: base, seriesRange: null },
      { itemCode: `${code}-OLD3`, productName: "Original3", division, category, seriesRange: null },
    ] : []),
  ]);
  return { code, division, category, expected: kind === "new" ? category : base, filename, kind };
}
const read = async (code: string) => (await db.select().from(catalogProductsTable).where(eq(catalogProductsTable.itemCode, code)))[0]!;
describe.each(["matched", "new", "two"])("private SQL write integration: %s", kind => {
  it("generic importer writes the selected spelling; never backfills existing Category/division", async () => {
    const f = await fixture(kind);
    const [source] = await db.insert(mrpSourcesTable).values({ division: `Private provenance ${f.code}`, sheetId: f.code, sheetUrl: "internal://fixture", sourceKind: "test" }).returning();
    const [batch] = await db.insert(mrpLoadBatchesTable).values({ sourceId: source!.id, fileName: f.filename,
      fileSha256: f.code, fileSizeBytes: 1, downloadedAt: "2026-10-01", rowCount: 1 }).returning();
    await persistParsedRows([{ itemCode: f.code, productName: "New Product", category: f.category, price: 100, variant: "Standard" }],
      [], f.filename, "2026-10-01", new Set(), new Map(), "MRP", "Code", "MRP", 0, [], f.code, batch!.id);
    expect((await read(f.code)).category).toBe(f.expected);
    const nullCode = `${f.code}-NULL`;
    await db.insert(catalogProductsTable).values({ itemCode: nullCode, productName: "Existing null classification", division: null, category: null });
    await persistParsedRows([{ itemCode: nullCode, productName: "Replacement", category: f.category, price: 100, variant: "Standard" }],
      [], f.filename, "2026-10-01", new Set([nullCode]), new Map([[nullCode, nullCode]]), "MRP", "Code", "MRP", 0, [], f.code, batch!.id);
    expect(await read(nullCode)).toMatchObject({ category: null, division: null, seriesRange: null });
  });
  it("bulk preview and normal admin apply agree on spelling, candidates and counts", async () => {
    const f = await fixture(kind);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["item_code", "division", "category", "product_name", "size", "mrp", "effective_date"],
      [f.code, f.division, f.category, "Private Fixture", "15 mm", 100, "2026-10-01"],
    ]), "Products");
    const file = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const preview = await api().post("/api/catalog/new-products/preview").field("reason", "Private guard verification").attach("file", file, "p051-fixture.xlsx");
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    const fixtureDir = resolve("../../reports/p051-part-1/browser-fixtures");
    mkdirSync(fixtureDir, { recursive: true });
    writeFileSync(resolve(fixtureDir, `${kind}.json`), JSON.stringify(preview.body, null, 2));
    const decision = preview.body.preview.categorySpellings[0];
    expect(decision.inputCategory).toBe(f.category);
    expect(decision.selectedCategory).toBe(f.expected);
    expect(decision.status).toBe(kind === "new" ? "new" : "matched existing spelling");
    if (kind === "two") expect(decision.candidates.map((row: { activeProducts: number }) => row.activeProducts)).toEqual([2, 1]);
    const denied = await api("user").post(`/api/catalog/new-products/${preview.body.batchId}/apply`).send({});
    expect(denied.status).toBe(403);
    const p = preview.body.preview;
    const applied = await api().post(`/api/catalog/new-products/${preview.body.batchId}/apply`)
      .send({ rowsToCreate: p.rowsToCreate, willCreateCount: p.willCreateCount, immediatePriceChanges: p.immediatePriceChangeCount, reason: "Private guard verification" });
    expect(applied.status, JSON.stringify(applied.body)).toBe(200);
    expect((await read(f.code)).category).toBe(f.expected);
  });
  it("single editor persists exactly the spelling approved in preview", async () => {
    const f = await fixture(kind);
    if (kind === "new") await db.insert(locallyAddedCategoriesTable).values({
      division: f.division, divisionKey: normalizeVocabularyKey(f.division), name: f.category,
      normalizedKey: normalizeVocabularyKey(f.category), actor: "private-fixture", reason: "normal admin approval",
    });
    const body = { itemCode: f.code, productName: "Private Single Fixture", division: f.division, category: f.category,
      series: "", size: "15 mm", mrp: 100, effectiveDate: "2026-10-01", reason: "Private guard verification" };
    const preview = await api().post("/api/catalog/price-editor/new-product/preview").send(body);
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body.categorySpellings[0].selectedCategory).toBe(f.expected);
    const saved = await api().post("/api/catalog/price-editor/new-product/apply")
      .send({ ...body, token: preview.body.token, unusualCodeConfirmed: true });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect((await read(f.code)).category).toBe(f.expected);
  });
  it("sync applies guarded new rows while preserving existing classification", async () => {
    const f = await fixture(kind);
    const bundle = await exportCatalogSyncBundle();
    const old = bundle.data.catalogProducts.find(row => row.itemCode === `${f.code}-OLD1`)!;
    old.division = "Wrong"; old.category = "Wrong"; old.seriesRange = "Wrong";
    const max = Math.max(...bundle.data.catalogProducts.map(row => Number(row.id)));
    const original = await read(`${f.code}-OLD1`);
    bundle.data.catalogProducts.push({ ...bundle.data.catalogProducts.find(row => row.itemCode === `${f.code}-OLD1`)!,
      id: max + 1, itemCode: f.code, division: f.division, category: f.category, seriesRange: null });
    const incoming = createCatalogSyncBundleFromData(bundle.data);
    const preview = await previewCatalogSyncCategories(incoming);
    expect(preview.categorySpellings.find(row => row.itemCode === f.code)!.selectedCategory).toBe(f.expected);
    const current = await getCatalogSyncSnapshot();
    await applyCatalogSyncBundle(incoming, "private-fixture@example.test", current.checksum);
    expect((await read(f.code)).category).toBe(f.expected);
    expect(await read(`${f.code}-OLD1`)).toMatchObject({ division: original.division, category: original.category, seriesRange: original.seriesRange });
  });
});