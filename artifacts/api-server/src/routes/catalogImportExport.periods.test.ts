import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import express from "express";
import supertest from "supertest";
import * as XLSX from "xlsx";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  mrpLoadBatchesTable,
  mrpSourcesTable,
} from "@workspace/db";
import {
  AUTHORITATIVE_MASTER_SHA256,
} from "../lib/authoritativeMrpMaster";
import router, { parseWorkbookBuffer } from "./catalogImportExport";

const RUN = Date.now();
const INTERVENING_HASH = createHash("sha256").update(`intervening-${RUN}`).digest("hex");

const AUTHORITATIVE_MASTER = readFileSync(
  new URL(
    "../../../../attached_assets/Prayag_MRP_Authoritative_01Sep2026_1788147614421.xlsx",
    import.meta.url,
  ),
);
let createdBatchIds: number[] = [];

function datedWorkbookBuffer(): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Cat No.", "Name", "5th Mar, 2026", "01st Sep, 2026"],
      ["PERIOD-TEST", "Period fixture", 100, 120],
    ]),
    "PRICES",
  );
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

function peaWorkbookBuffer(includeExplicitMrp: boolean): Buffer {
  const workbook = XLSX.utils.book_new();
  const headers = [
    "Item Code",
    "Product Name",
    "Pack",
    "Weight (kg)",
    "Quantity",
    "Dimension (mm)",
    ...(includeExplicitMrp ? ["MRP"] : []),
  ];
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      headers,
      ["PEA-64B", "PEA fixture 64B", 8, 0.64, 24, 64, ...(includeExplicitMrp ? [1480] : [])],
      ["PEA-55B", "PEA fixture 55B", 10, 0.55, 20, 55, ...(includeExplicitMrp ? [1320] : [])],
    ]),
    "PRICES",
  );
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

function wrongAuthoritativeWorkbookBuffer(): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet([
      {
        item_code: "WRONG-HASH",
        division: "Hardware",
        series: "Fixture",
        product_name: "Wrong hash fixture",
        size: null,
        mrp: 100,
        effective_date: "2026-09-01",
        mrp_ivory: null,
        mrp_white_with_jet: null,
        mrp_pink_green_blue: null,
      },
    ]),
    "products",
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet([
      {
        item_code: "OLD-FIXTURE",
        discontinued_from: "2026-08-01",
        checked_by: "Fixture",
        status_note: "Fixture",
      },
    ]),
    "discontinued",
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet([{ item_code: "20", status_note: "Invalid Input", "why excluded": "Fixture" }]),
    "excluded_do_not_load",
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet([{ Item: "Source", Detail: "Fixture" }]),
    "notes",
  );
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

afterAll(async () => {
  if (createdBatchIds.length) {
    await db.delete(mrpLoadBatchesTable).where(
      inArray(mrpLoadBatchesTable.id, createdBatchIds),
    );
  }
});

describe("MRP loader period and duplicate safeguards", () => {
  it("rejects an authoritative-shaped workbook when its checksum is wrong", async () => {
    const app = express();
    app.use(express.json());
    app.use(router);
    const response = await supertest(app)
      .post("/catalog/load-mrp")
      .field("sourceId", String(sourceId))
      .field("downloadedAt", "2026-08-19")
      .attach("file", fixture, {
        filename: `duplicate-first-${RUN}.xlsx`,
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });

    const after = await db
      .select({ id: mrpLoadBatchesTable.id })
      .from(mrpLoadBatchesTable)
      .where(
        eq(
          mrpLoadBatchesTable.fileSha256,
          AUTHORITATIVE_MASTER_SHA256,
        ),
      );

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/checksum mismatch/i);
  });

  it("cannot bypass the authoritative duplicate guard by renaming the master to .xls", async () => {
    const app = express();
    app.use(express.json());
    app.use(router);
    const response = await supertest(app)
      .post("/catalog/load-mrp")
      .field("sourceId", String(sourceId))
      .field("downloadedAt", "2026-08-19")
      .attach("file", fixture, {
        filename: `duplicate-first-${RUN}.xlsx`,
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });

    const after = await db
      .select({ id: mrpLoadBatchesTable.id })
      .from(mrpLoadBatchesTable)
      .where(
        eq(
          mrpLoadBatchesTable.fileSha256,
          AUTHORITATIVE_MASTER_SHA256,
        ),
      );

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/valid calendar date/i);
  });

  it("uses source header periods rather than a supplied or current date", () => {
    const parsed = parseWorkbookBuffer(
      peaWorkbookBuffer(true),
      new Set(["PEA-64B", "PEA-55B"]),
    );

    expect(parsed.rows).toEqual([]);
    expect(parsed.priceColHeader).toBe("");
    expect(parsed.warnings).toEqual([
      expect.stringMatching(/explicit MRP, price, Net, or rate column/i),
    ]);
    expect(parsed.warnings[0]).toMatch(/pack, weight, quantity, or dimension columns/i);
  });

  it("uses an explicit MRP column for PEA-style rows instead of nearby measurements", () => {
    const parsed = parseWorkbookBuffer(
      peaWorkbookBuffer(true),
      new Set(["PEA-64B", "PEA-55B"]),
    );

    expect(parsed.rows).toEqual([]);
    expect(parsed.priceColHeader).toBe("");
    expect(parsed.warnings).toEqual([
      expect.stringMatching(/explicit MRP, price, Net, or rate column/i),
    ]);
    expect(parsed.warnings[0]).toMatch(/pack, weight, quantity, or dimension columns/i);
  });

  it("uses an explicit MRP column for PEA-style rows instead of nearby measurements", () => {
    const parsed = parseWorkbookBuffer(
      peaWorkbookBuffer(true),
      new Set(["PEA-64B", "PEA-55B"]),
    );

    expect(parsed.priceColHeader).toBe("MRP");
    expect(parsed.warnings).toEqual([]);
    expect(
      parsed.rows.map((row) => ({ itemCode: row.itemCode, mrp: row.price })),
    ).toEqual([
      { itemCode: "PEA-64B", mrp: 1480 },
      { itemCode: "PEA-55B", mrp: 1320 },
    ]);
  });

  it("finds a matching batch even when another batch was loaded later", async () => {
    const fixture = datedWorkbookBuffer();
    const fixtureHash = createHash("sha256").update(fixture).digest("hex");
    const source = await db
      .select({ id: mrpSourcesTable.id })
      .from(mrpSourcesTable)
      .where(eq(mrpSourcesTable.division, "PTMT & Plastic Fittings"))
      .limit(1);

    const before = await db
      .select({ id: mrpLoadBatchesTable.id })
      .from(mrpLoadBatchesTable)
      .where(
        eq(
          mrpLoadBatchesTable.fileSha256,
          AUTHORITATIVE_MASTER_SHA256,
        ),
      );
    const sourceId = source[0]?.id;
    expect(sourceId).toBeTruthy();
    const first = await db.insert(mrpLoadBatchesTable).values({
      sourceId: sourceId!,
      fileName: `duplicate-first-${RUN}.xlsx`,
      fileSha256: fixtureHash,
      fileSizeBytes: fixture.length,
      downloadedAt: "2026-08-19",
      rowCount: 0,
    }).returning({ id: mrpLoadBatchesTable.id });
    const intervening = await db.insert(mrpLoadBatchesTable).values({
      sourceId: sourceId!,
      fileName: `duplicate-intervening-${RUN}.xlsx`,
      fileSha256: INTERVENING_HASH,
      fileSizeBytes: 0,
      downloadedAt: "2026-08-19",
      rowCount: 0,
    }).returning({ id: mrpLoadBatchesTable.id });
    createdBatchIds = [first[0]!.id, intervening[0]!.id];
    const app = express();
    app.use(express.json());
    app.use(router);
    const response = await supertest(app)
      .post("/catalog/load-mrp")
      .field("sourceId", String(sourceId))
      .field("downloadedAt", "2026-08-19")
      .attach("file", fixture, {
        filename: `duplicate-first-${RUN}.xlsx`,
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });

    const after = await db
      .select({ id: mrpLoadBatchesTable.id })
      .from(mrpLoadBatchesTable)
      .where(
        eq(
          mrpLoadBatchesTable.fileSha256,
          AUTHORITATIVE_MASTER_SHA256,
        ),
      );
    expect(response.status).toBe(409);
    expect(response.body.duplicate.matches).toEqual(
      expect.arrayContaining([expect.objectContaining({ loadBatchId: first[0]!.id })]),
    );
  });
});
