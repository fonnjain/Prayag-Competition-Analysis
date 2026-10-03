import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import supertest from "supertest";
import * as XLSX from "xlsx";
import { eq, inArray } from "drizzle-orm";
import {
  catalogProductsTable,
  competitorPriceStagingTable,
  db,
  importBatchesTable,
  mrpHistoryProvenanceEventsTable,
  mrpLoadBatchesTable,
  mrpPendingBatchesTable,
  mrpPriceHistoryTable,
} from "@workspace/db";
import router, { applyP019PrinceRematch, parseNewProductsWorkbook } from "./catalogImportExport";

const RUN = Date.now();
const NEW_CODE = `__P019_NEW_${RUN}__`;
const EXISTING_CODE = `__P019_EXISTING_${RUN}__`;
const FILE = `p019-new-products-${RUN}.xlsx`;
const EFFECTIVE_DATE = "2026-08-10";
const app = express();
app.use(express.json());
app.use(router);
const request = supertest(app);

function workbookBuffer(rows: unknown[][], headers = ["item_code", "division", "series", "product_name", "size", "mrp", "effective_date"]) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([headers, ...rows]), "Sheet1");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([]), "Sheet6");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

describe("P019 new-products upload", () => {
  let pendingId = 0;
  const pendingIds: number[] = [];
  let loadBatchId = 0;
  let importBatchId = 0;
  const stagingIds: number[] = [];
  let p019CodesAvailable = false;

  beforeAll(async () => {
    await db.insert(catalogProductsTable).values({
      itemCode: EXISTING_CODE,
      productName: "Existing P019 fixture",
      division: "P019 test",
    });
    const exactCodes = ["U-11CS", "U-13CS", "U-14CS", "U-15CS", "U-16CS", "U-13BS", "U-14BS"];
    const existingExact = await db.select({ itemCode: catalogProductsTable.itemCode })
      .from(catalogProductsTable).where(inArray(catalogProductsTable.itemCode, exactCodes));
    p019CodesAvailable = existingExact.length === 0;
  });

  afterAll(async () => {
    await db.delete(competitorPriceStagingTable).where(inArray(competitorPriceStagingTable.id, stagingIds));
    if (importBatchId) await db.delete(importBatchesTable).where(eq(importBatchesTable.id, importBatchId));
    if (pendingIds.length) await db.delete(mrpPendingBatchesTable).where(inArray(mrpPendingBatchesTable.id, pendingIds));
    if (loadBatchId) {
      await db.delete(mrpHistoryProvenanceEventsTable).where(eq(mrpHistoryProvenanceEventsTable.loadBatchId, loadBatchId));
      await db.delete(mrpPriceHistoryTable).where(eq(mrpPriceHistoryTable.loadBatchId, loadBatchId));
      await db.delete(mrpLoadBatchesTable).where(eq(mrpLoadBatchesTable.id, loadBatchId));
    }
    await db.delete(mrpPriceHistoryTable).where(inArray(mrpPriceHistoryTable.itemCode, [NEW_CODE]));
    await db.delete(catalogProductsTable).where(inArray(catalogProductsTable.itemCode, [NEW_CODE, EXISTING_CODE]));
  });

  it("parses supplied-style headers, requires all columns, and preserves decimal MRPs", () => {
    const parsed = parseNewProductsWorkbook(workbookBuffer([
      ["U-DEC", "Pipes & Fittings", "UGD Pipe", "Decimal fixture", "", "2,987.50", EFFECTIVE_DATE],
    ]));
    expect(parsed.rows[0]).toMatchObject({ itemCode: "U-DEC", mrp: 2987.5, effectiveDate: EFFECTIVE_DATE });
    expect(() => parseNewProductsWorkbook(workbookBuffer([
      ["U-BAD", "Pipes & Fittings", "UGD Pipe", "Missing size header", "100", EFFECTIVE_DATE],
    ], ["item_code", "division", "series", "product_name", "mrp", "effective_date"]))).toThrow(/must contain/i);
  });

  it("previews counts, rejects existing codes, and applies only accepted rows", async () => {
    const response = await request.post("/catalog/new-products/preview")
      .field("reason", "P019 integration fixture")
      .attach("file", workbookBuffer([
        [NEW_CODE, "Pipes & Fittings", "UGD Pipe", "New fixture", "", 1234, EFFECTIVE_DATE],
        [EXISTING_CODE, "Pipes & Fittings", "UGD Pipe", "Must reject", "", 9999, EFFECTIVE_DATE],
      ]), { filename: FILE });
    expect(response.status).toBe(200);
    pendingId = response.body.batchId;
    pendingIds.push(pendingId);
    expect(response.body.preview).toMatchObject({
      fileName: FILE,
      willCreateCount: 1,
      rejectedCount: 1,
      catalogBefore: expect.any(Number),
      catalogAfter: expect.any(Number),
      immediateCount: 1,
    });
    expect(response.body.preview.willCreate[0]).toMatchObject({ itemCode: NEW_CODE, seriesRange: null });
    expect(response.body.preview.rangeWarnings.length).toBeGreaterThan(0);
    expect(response.body.preview.rejectedRows[0].reason).toMatch(/MRP revision upload/i);
    expect(response.body.preview.periods[0]).toMatchObject({
      effectiveDate: EFFECTIVE_DATE,
      isExisting: expect.any(Boolean),
      existingCount: expect.any(Number),
      createCount: 1,
      afterCount: expect.any(Number),
      isImmediate: true,
    });
    const apply = await request.post(`/catalog/new-products/${pendingId}/apply`)
      .send({ rowsToCreate: 1 });
    expect(apply.status).toBe(200);
    expect(apply.body.result).toMatchObject({ createdCount: 1, catalogBefore: expect.any(Number), catalogAfter: expect.any(Number) });
    loadBatchId = apply.body.result.loadBatchId;
    const [product] = await db.select().from(catalogProductsTable).where(eq(catalogProductsTable.itemCode, NEW_CODE));
    const [history] = await db.select().from(mrpPriceHistoryTable).where(eq(mrpPriceHistoryTable.itemCode, NEW_CODE));
    expect(product).toMatchObject({ itemCode: NEW_CODE, seriesRange: null });
    expect(history).toMatchObject({ itemCode: NEW_CODE, mrp: 1234, variant: "Standard", loadBatchId });
    expect(history?.loadBatchId).toBeTruthy();
  });

  it("requires a reason, positive batch ids, and rejects re-apply", async () => {
    const missingReason = await request.post("/catalog/new-products/preview")
      .attach("file", workbookBuffer([[`__P019_REASON_${RUN}__`, "D", "S", "N", "", 1, EFFECTIVE_DATE]]), { filename: "reason.xlsx" });
    expect(missingReason.status).toBe(400);
    expect((await request.get("/catalog/new-products/0")).status).toBe(400);
    expect((await request.post("/catalog/new-products/0/apply").send({ rowsToCreate: 0 })).status).toBe(400);
    expect((await request.post(`/catalog/new-products/${pendingId}/apply`).send({ rowsToCreate: 1 })).status).toBe(409);
  });

  it("does not apply an expired preview or partially write after a race", async () => {
    const raceCode = `__P019_RACE_${RUN}__`;
    const response = await request.post("/catalog/new-products/preview")
      .field("reason", "P019 race fixture")
      .attach("file", workbookBuffer([[raceCode, "Pipes & Fittings", "UGD Pipe", "Race fixture", "", 77, EFFECTIVE_DATE]]), { filename: "race.xlsx" });
    expect(response.status).toBe(200);
    const racePendingId = response.body.batchId as number;
    pendingIds.push(racePendingId);
    await db.insert(catalogProductsTable).values({ itemCode: raceCode, productName: "Inserted after preview", division: "P019 test" });
    const applied = await request.post(`/catalog/new-products/${racePendingId}/apply`).send({ rowsToCreate: 1 });
    expect(applied.status).toBe(409);
    expect((await db.select().from(mrpPriceHistoryTable).where(eq(mrpPriceHistoryTable.itemCode, raceCode)))).toHaveLength(0);
    await db.delete(catalogProductsTable).where(eq(catalogProductsTable.itemCode, raceCode));

    const expiredCode = `__P019_EXPIRED_${RUN}__`;
    const expired = await request.post("/catalog/new-products/preview")
      .field("reason", "P019 expired fixture")
      .attach("file", workbookBuffer([[expiredCode, "Pipes & Fittings", "UGD Pipe", "Expired fixture", "", 88, EFFECTIVE_DATE]]), { filename: "expired.xlsx" });
    expect(expired.status).toBe(200);
    const expiredPendingId = expired.body.batchId as number;
    pendingIds.push(expiredPendingId);
    await db.update(mrpPendingBatchesTable).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(mrpPendingBatchesTable.id, expiredPendingId));
    expect((await request.post(`/catalog/new-products/${expiredPendingId}/apply`).send({ rowsToCreate: 1 })).status).toBe(409);
  });

  it("rematches exactly seven Prince staging rows and leaves three open plus Sparsh unchanged", async () => {
    if (!p019CodesAvailable) return;
    const mappings: Array<[string, string]> = [
      ["SIM200965", "U-11CS"], ["SIM200960", "U-13CS"], ["SIM200961", "U-14CS"],
      ["SIM200962", "U-15CS"], ["SIM200963", "U-16CS"], ["SIM200955", "U-13BS"], ["SIM200956", "U-14BS"],
    ];
    const open = [["IT101915", "C133"], ["SIM200923", "PMR-8"], ["SIM200928", "PMR-9"]];
    const codes = [...mappings.map(([, code]) => code)];
    await db.insert(catalogProductsTable).values(codes.map((itemCode) => ({ itemCode, productName: itemCode, division: "Pipes & Fittings" })));
    const fixtureLoad = await db.insert(mrpLoadBatchesTable).values({
      sourceId: (await db.select({ sourceId: mrpLoadBatchesTable.sourceId }).from(mrpLoadBatchesTable).limit(1))[0]?.sourceId ?? 1,
      fileName: `p019-rematch-${RUN}.xlsx`, fileSha256: `p019-rematch-${RUN}`, fileSizeBytes: 1, downloadedAt: EFFECTIVE_DATE, rowCount: 7,
    }).returning({ id: mrpLoadBatchesTable.id });
    const rematchLoadId = fixtureLoad[0]!.id;
    await db.insert(mrpPriceHistoryTable).values(codes.map((itemCode) => ({
      itemCode, mrp: 1000, priceBasis: "MRP", effectiveDate: EFFECTIVE_DATE, loadDate: EFFECTIVE_DATE, reviewStatus: "approved", loadBatchId: rematchLoadId, variant: "Standard",
    })));
    const fixtureBatch = await db.insert(importBatchesTable).values({
      competitor: "Prince", effectiveDate: EFFECTIVE_DATE, sourceFileName: `p019-rematch-${RUN}.pdf`, priceBasis: "MRP",
      status: "approved", rowCounts: JSON.stringify({ ok: 0, needs_review: 10, not_found: 0, new_products: 0 }),
    }).returning({ id: importBatchesTable.id });
    importBatchId = fixtureBatch[0]!.id;
    const rows = [...mappings, ...open.map(([code, prayag]) => [code, prayag] as [string, string]), ["SIM200965", "U-11CS"]].map(([competitor, prayag], index) => ({
      batchId: importBatchId, competitor: index === 10 ? "Sparsh Pearl" : "Prince", competitorCodeMaster: competitor,
      matchedPrayagCode: null, status: "needs_review", reviewReason: "No verified Prayag product match.", newMrp: 950,
    }));
    const inserted = await db.insert(competitorPriceStagingTable).values(rows).returning({ id: competitorPriceStagingTable.id });
    stagingIds.push(...inserted.map((row) => row.id));
    const result = await db.transaction((tx) => applyP019PrinceRematch(tx, codes.map((itemCode) => ({
      itemCode, division: "Pipes & Fittings", series: "UGD Pipe", productName: itemCode, size: null, mrp: 1000, effectiveDate: EFFECTIVE_DATE, row: 1,
    })), "2026-08-10"));
    expect(result.movedCount).toBe(7);
    expect(result.byCompetitor.Prince).toHaveLength(7);
    const changed = await db.select().from(competitorPriceStagingTable).where(inArray(competitorPriceStagingTable.id, stagingIds));
    expect(changed.filter((row) => row.competitor === "Prince" && row.status === "ok")).toHaveLength(7);
    expect(changed.filter((row) => row.competitor === "Prince" && row.status === "needs_review")).toHaveLength(3);
    expect(changed.find((row) => row.competitor === "Sparsh Pearl")?.status).toBe("needs_review");
    await db.delete(mrpPriceHistoryTable).where(eq(mrpPriceHistoryTable.loadBatchId, rematchLoadId));
    await db.delete(mrpLoadBatchesTable).where(eq(mrpLoadBatchesTable.id, rematchLoadId));
    await db.delete(catalogProductsTable).where(inArray(catalogProductsTable.itemCode, codes));
  });
});