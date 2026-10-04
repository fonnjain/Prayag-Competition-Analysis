import express from "express";
import supertest from "supertest";
import XLSX from "xlsx";
import { afterAll, beforeAll, expect, it } from "vitest";
import { db, pool, catalogProductsTable, mrpPriceHistoryTable, mrpSourcesTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import bucketRouter from "./bucketLists";
import importRouter, { parseWorkbookBuffer } from "./catalogImportExport";
import { bucketFilterMiddleware } from "../lib/bucketFilter";
import { hideExportDisclosures, isExportDisclosureRow } from "../lib/exportDisclosure";
import { normCode } from "../lib/catalog";

const A = "P053-ROUND-A", B = "P053-ROUND-B";
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  (req as any).user = { id: "p053-round-trip-admin", role: "admin", firstName: "Verifier", mustChangePassword: false };
  (req as any).isAuthenticated = () => true;
  next();
});
app.use("/api", bucketRouter);
app.use("/api", bucketFilterMiddleware, importRouter);
const api = supertest(app);
const snapshot = async () => (await pool.query(`SELECT
 (SELECT md5(string_agg(row_to_json(p)::text,'|' ORDER BY id)) FROM public.catalog_products p) AS catalogue,
 (SELECT md5(string_agg(row_to_json(p)::text,'|' ORDER BY id)) FROM public.mrp_price_history p) AS mrp`)).rows[0];
let before: unknown;
beforeAll(async () => {
  expect((await db.execute(sql`SELECT current_schema() AS schema`)).rows[0].schema).toMatch(/^p051_suite_/);
  before = await snapshot();
  const product = (await db.select().from(catalogProductsTable).limit(1))[0]!;
  const price = (await db.select().from(mrpPriceHistoryTable).limit(1))[0]!;
  for (const [code, value] of [[A, 100], [B, 200]] as const) {
    await db.insert(catalogProductsTable).values({ ...product, id: undefined, itemCode: code, productName: "Round trip", isActive: true, discontinuedFrom: null });
    await db.insert(mrpPriceHistoryTable).values({ ...price, id: undefined, itemCode: code, effectiveDate: "2026-01-01", variant: "Standard", mrp: value, netPrice: value, discountPct: 0, isCurrent: true, reviewStatus: "approved" });
  }
  const created = await api.post("/api/bucket-lists").send({ name: "Round trip", type: "included", visibility: "only_me", rules: [], addedCodes: [A], removedCodes: [] });
  expect(created.status).toBe(201);
  expect((await api.put("/api/bucket-lists/active").send({ listId: created.body.id })).status).toBe(200);
});
afterAll(async () => { expect(await snapshot()).toEqual(before); });

for (const format of ["csv", "xlsx"]) for (const scope of ["in-force", "revisions", "history"]) {
  it(`actual ${scope} ${format} export reuploads without disclosure diagnostics`, async () => {
    const exported = await api.get("/api/catalog/export").query({ type: scope === "history" ? "history" : "catalog", scope, asOf: "2026-01-01", format })
      .buffer(true).parse((response, done) => {
        const chunks: Buffer[] = [];
        response.on("data", chunk => chunks.push(Buffer.from(chunk)));
        response.on("end", () => done(null, Buffer.concat(chunks)));
      });
    expect(exported.status).toBe(200);
    const bytes = exported.body as Buffer;
    const book = XLSX.read(bytes, { type: "buffer" });
    expect(XLSX.utils.sheet_to_json<any[]>(book.Sheets[book.SheetNames[0]], { header: 1 })[0][0]).toContain("Round trip");
    const parsed = parseWorkbookBuffer(bytes, new Set([A, B].map(normCode)));
    expect(parsed.rows.map(row => row.itemCode)).toEqual([A]);
    expect(parsed.rows[0].price).toBe(100);
    expect(parsed.hasHeaderPeriods).toBe(false); // Row Effective Date isn't a dated column header.
    expect(parsed.skippedUnparseable).toBe(0);
    const source = (await db.select().from(mrpSourcesTable).limit(1))[0]!;
    const upload = await api.post("/api/catalog/load-mrp").field("sourceId", String(source.id))
      .field("downloadedAt", "2026-10-04").field("effectiveDate", "2026-01-01")
      .attach("file", bytes, `round-trip.${format}`);
    expect(upload.status, JSON.stringify(upload.body)).toBe(200);
    expect(upload.body.status).toBe("pending"); // Never Apply; no prices written.
  });
}
it("real dated price headers still produce their original periods", () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Item Code", "2024-02-15", "2025-02-15"], [A, 100, 120]]), "MASTER");
  const parsed = parseWorkbookBuffer(XLSX.write(book, { type: "buffer", bookType: "xlsx" }), new Set([A].map(normCode)));
  expect(parsed.hasHeaderPeriods).toBe(true);
  expect(parsed.rows.map(row => [row.effectiveDate, row.price])).toEqual([["2024-02-15", 100], ["2025-02-15", 120]]);
});
it("ignores only own single-cell disclosures and preserves source row positions", () => {
  const banner = ["Showing: Round trip — Included · 1 items shown"];
  const rows = [banner, ["Display-only product filter; no source product or price data changed."], [], ["Item Code", "MRP"], [A, 100]];
  const hidden = hideExportDisclosures(rows);
  expect(hidden).toHaveLength(rows.length);
  expect(hidden[4]).toEqual([A, 100]);
  expect(hidden[0]).toEqual([]);
  expect(isExportDisclosureRow(["unexpected note"])).toBe(false);
  expect(isExportDisclosureRow([banner[0], 100])).toBe(false);
});