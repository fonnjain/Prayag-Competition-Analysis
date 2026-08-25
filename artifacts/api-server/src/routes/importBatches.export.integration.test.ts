/**
 * Integration coverage for the review workbook's staging-only New Products
 * sheet. These rows are not committed to competitor_prices, so the export is
 * the review team's portable record before an import batch leaves the queue.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import supertest from "supertest";
import * as XLSX from "xlsx";
import { eq } from "drizzle-orm";
import {
  db,
  importBatchesTable,
  competitorPriceStagingTable,
} from "@workspace/db";
import importBatchesRouter from "./importBatches.js";

const app = express();
app.use(express.json());
app.use(importBatchesRouter);
const request = supertest(app);

let competitor: string;
let batchId: number;
let sequence = 0;

beforeEach(() => {
  sequence += 1;
  competitor = `__test_export_${Date.now()}_${sequence}__`;
  batchId = 0;
});

afterEach(async () => {
  if (!batchId) return;
  await db.delete(competitorPriceStagingTable)
    .where(eq(competitorPriceStagingTable.batchId, batchId));
  await db.delete(importBatchesTable)
    .where(eq(importBatchesTable.id, batchId));
});

describe("review export", () => {
  it("includes staging-only new products and team review columns in a dedicated sheet", async () => {
    const [batch] = await db.insert(importBatchesTable).values({
      competitor: "Sparsh Pearl",
      effectiveDate: "2026-09-01",
      sourceFileName: "sparsh-test.pdf",
      priceBasis: "MRP",
      status: "pending",
      extractionModel: "claude-test",
    }).returning({ id: importBatchesTable.id });
    batchId = batch!.id;

    const newProduct = (code: string, name: string, page: number, mrp = 1642) => ({
      batchId,
      competitor: "Sparsh Pearl",
      competitorCodeMaster: null,
      competitorCodeCatalogue: code,
      matchedPrayagCode: null,
      description: null,
      catalogueDescription: name,
      variant: null,
      oldMrp: null,
      newMrp: mrp,
      increasePct: null,
      prayagMrpCurrent: null,
      gapPct: null,
      page,
      matchMethod: null,
      status: "new_product" as const,
      reviewReason: null,
    });
    await db.insert(competitorPriceStagingTable).values([
      newProduct("RPS-2287", "Center Hole Basin Mixer", 27),
      newProduct("ED-950", "Bib Cock", 64),
      newProduct("RS-111", "Mini Swan Neck", 25),
      newProduct("EVA-111", "Bib Cock", 38),
      newProduct("REG-771", "Angle Cock", 35),
      newProduct("TS-107", "Extension Nipple", 19),
      newProduct("BCC-301", "Bib Cock", 70),
    ]);

    const response = await request
      .get(`/catalog/import-batches/${batchId}/export`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      });

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );

    const workbook = XLSX.read(response.body as Buffer, { type: "buffer" });
    expect(workbook.SheetNames).toEqual(["Review", "New Products"]);

    const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(
      workbook.Sheets["New Products"]!,
      { header: 1, defval: null },
    );
    expect(rows[0]).toEqual([
      "Sparsh Pearl Code",
      "Product Name (Extracted)",
      "MRP",
      "Catalogue Page",
      "Sparsh Pearl Series",
      "Equivalent Prayag Series",
      "Does an equivalent exist",
      "Prayag Cat No.",
      "Notes",
    ]);
    expect(rows[1]).toEqual([
      "RPS-2287",
      "Center Hole Basin Mixer",
      1642,
      27,
      "Royal Plus",
      "Vitro",
      "",
      "",
      "",
    ]);

    const byCode = new Map(rows.slice(1).map((row) => [row[0], row]));
    expect([
      ["ED-950", byCode.get("ED-950")?.[4], byCode.get("ED-950")?.[5]],
      ["RS-111", byCode.get("RS-111")?.[4], byCode.get("RS-111")?.[5]],
      ["RPS-2287", byCode.get("RPS-2287")?.[4], byCode.get("RPS-2287")?.[5]],
      ["EVA-111", byCode.get("EVA-111")?.[4], byCode.get("EVA-111")?.[5]],
      ["REG-771", byCode.get("REG-771")?.[4], byCode.get("REG-771")?.[5]],
      ["TS-107", byCode.get("TS-107")?.[4], byCode.get("TS-107")?.[5]],
      ["BCC-301", byCode.get("BCC-301")?.[4], byCode.get("BCC-301")?.[5]],
    ]).toEqual([
      ["ED-950", "Edge", "Quadra"],
      ["RS-111", "Royal", "Diamond"],
      ["RPS-2287", "Royal Plus", "Vitro"],
      ["EVA-111", "Eva", "Cobra"],
      ["REG-771", "Regal", "Black Pearl"],
      ["TS-107", "Standard (Quarter Turn)", "STANDARD"],
      ["BCC-301", "Roman / allied", "Roman / allied"],
    ]);
  });
});