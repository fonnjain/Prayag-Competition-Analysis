import { createHash } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import express from "express";
import supertest from "supertest";
import * as XLSX from "xlsx";
import AdmZip from "adm-zip";
import { eq, inArray } from "drizzle-orm";
import {
  catalogProductsTable,
  db,
  mrpHistoryProvenanceEventsTable,
  mrpLoadBatchesTable,
  mrpPriceHistoryTable,
  mrpSourcesTable,
} from "@workspace/db";
import router, { parseWorkbookBuffer } from "./catalogImportExport";

const RUN = Date.now();
const INTERVENING_HASH = createHash("sha256").update(`intervening-${RUN}`).digest("hex");

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

function genericWorkbookBuffer(itemCode: string, includeExplicitMrp: boolean): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Item Code", "Product Name", includeExplicitMrp ? "MRP" : "Quantity"],
      [itemCode, `Fixture ${RUN}`, includeExplicitMrp ? 1234 : 24],
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
      .field("downloadedAt", "2026-08-31")
      .attach("file", wrongAuthoritativeWorkbookBuffer(), {
        filename: "Prayag_MRP_Authoritative_01Sep2026.xlsx",
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/checksum mismatch/i);
  });

  it("rejects an impossible competitor workbook effective date before parsing it", async () => {
    const app = express();
    app.use(express.json());
    app.use(router);

    const response = await supertest(app)
      .post("/catalog/load-competitor")
      .field("competitor", "Invalid date fixture")
      .field("effectiveDate", "2026-02-30")
      .attach("file", Buffer.from("Code,Description,MRP\nFIX-1,Fixture,100\n"), {
        filename: "fixture.csv",
        contentType: "text/csv",
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/valid calendar date/i);
  });

  it("uses source header periods rather than a supplied or current date", () => {
    const parsed = parseWorkbookBuffer(datedWorkbookBuffer(), new Set(["PERIOD-TEST"]));
    expect(parsed.hasHeaderPeriods).toBe(true);
    expect([...new Set(parsed.rows.map((row) => row.effectiveDate))].sort()).toEqual([
      "2026-03-05",
      "2026-09-01",
    ]);
  });

  it("rejects PEA-style pack, weight, quantity, and dimension columns as prices", () => {
    const parsed = parseWorkbookBuffer(
      peaWorkbookBuffer(false),
      new Set(["PEA-64B", "PEA-55B"]),
    );

    expect(parsed.rows).toEqual([]);
    expect(parsed.priceColHeader).toBe("");
    expect(parsed.warnings).toEqual([
      expect.stringMatching(/explicit MRP, price, Net, or rate column/i),
    ]);
    expect(parsed.warnings[0]).toMatch(/pack, weight, quantity, or dimension columns/i);
    expect(parsed.skippedRows).toEqual([
      expect.objectContaining({
        rawCode: "PEA-64B",
        reason: expect.stringMatching(/left unpriced for review/i),
      }),
      expect.objectContaining({
        rawCode: "PEA-55B",
        reason: expect.stringMatching(/left unpriced for review/i),
      }),
    ]);
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

  it("removes the provenance batch when a generic spreadsheet has no price rows", async () => {
    const source = await db
      .select({ id: mrpSourcesTable.id })
      .from(mrpSourcesTable)
      .limit(1);
    const sourceId = source[0]?.id;
    expect(sourceId).toBeTruthy();

    const fixture = genericWorkbookBuffer(`REJECTED-${RUN}`, false);
    const fixtureHash = createHash("sha256").update(fixture).digest("hex");
    const before = await db
      .select({ id: mrpLoadBatchesTable.id })
      .from(mrpLoadBatchesTable)
      .where(eq(mrpLoadBatchesTable.fileSha256, fixtureHash));

    const app = express();
    app.use(express.json());
    app.use(router);
    const response = await supertest(app)
      .post("/catalog/load-mrp")
      .field("sourceId", String(sourceId))
      .field("downloadedAt", "2026-08-31")
      .field("effectiveDate", "2026-08-31")
      .attach("file", fixture, {
        filename: `rejected-${RUN}.xlsx`,
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });

    const after = await db
      .select({ id: mrpLoadBatchesTable.id })
      .from(mrpLoadBatchesTable)
      .where(eq(mrpLoadBatchesTable.fileSha256, fixtureHash));

    expect(response.status).toBe(200);
    expect(response.body.results.newHistoryRows).toBe(0);
    expect(after).toEqual(before);
  });

  it("removes the provenance batch when a ZIP has no supported spreadsheet entries", async () => {
    const source = await db
      .select({ id: mrpSourcesTable.id })
      .from(mrpSourcesTable)
      .limit(1);
    const sourceId = source[0]?.id;
    expect(sourceId).toBeTruthy();

    const zip = new AdmZip();
    zip.addFile("notes.txt", Buffer.from(`No spreadsheets ${RUN}`));
    const fixture = zip.toBuffer();
    const fixtureHash = createHash("sha256").update(fixture).digest("hex");
    const before = await db
      .select({ id: mrpLoadBatchesTable.id })
      .from(mrpLoadBatchesTable)
      .where(eq(mrpLoadBatchesTable.fileSha256, fixtureHash));

    const app = express();
    app.use(express.json());
    app.use(router);
    const response = await supertest(app)
      .post("/catalog/load-mrp")
      .field("sourceId", String(sourceId))
      .field("downloadedAt", "2026-08-31")
      .field("effectiveDate", "2026-08-31")
      .attach("file", fixture, {
        filename: `unsupported-${RUN}.zip`,
        contentType: "application/zip",
      });

    const after = await db
      .select({ id: mrpLoadBatchesTable.id })
      .from(mrpLoadBatchesTable)
      .where(eq(mrpLoadBatchesTable.fileSha256, fixtureHash));

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/contains no/i);
    expect(after).toEqual(before);
  });

  it("removes the provenance batch when a supported ZIP entry cannot be parsed", async () => {
    const source = await db
      .select({ id: mrpSourcesTable.id })
      .from(mrpSourcesTable)
      .limit(1);
    const sourceId = source[0]?.id;
    expect(sourceId).toBeTruthy();

    const zip = new AdmZip();
    zip.addFile("broken.xlsx", Buffer.from("PK\u0003\u0004broken"));
    const fixture = zip.toBuffer();
    const fixtureHash = createHash("sha256").update(fixture).digest("hex");
    const before = await db
      .select({ id: mrpLoadBatchesTable.id })
      .from(mrpLoadBatchesTable)
      .where(eq(mrpLoadBatchesTable.fileSha256, fixtureHash));

    const app = express();
    app.use(express.json());
    app.use(router);
    const response = await supertest(app)
      .post("/catalog/load-mrp")
      .field("sourceId", String(sourceId))
      .field("downloadedAt", "2026-08-31")
      .field("effectiveDate", "2026-08-31")
      .attach("file", fixture, {
        filename: `malformed-${RUN}.zip`,
        contentType: "application/zip",
      });

    const after = await db
      .select({ id: mrpLoadBatchesTable.id })
      .from(mrpLoadBatchesTable)
      .where(eq(mrpLoadBatchesTable.fileSha256, fixtureHash));

    expect(response.status).toBe(500);
    expect(after).toEqual(before);
  });

  it("keeps a mixed ZIP batch when one entry is valid and another is rejected", async () => {
    const [source, product] = await Promise.all([
      db.select({ id: mrpSourcesTable.id }).from(mrpSourcesTable).limit(1),
      db.select({ itemCode: catalogProductsTable.itemCode }).from(catalogProductsTable).limit(1),
    ]);
    const sourceId = source[0]?.id;
    const itemCode = product[0]?.itemCode;
    expect(sourceId).toBeTruthy();
    expect(itemCode).toBeTruthy();

    const zip = new AdmZip();
    zip.addFile("valid.xlsx", genericWorkbookBuffer(itemCode!, true));
    zip.addFile("rejected.xlsx", genericWorkbookBuffer(`REJECTED-ZIP-${RUN}`, false));
    const fixture = zip.toBuffer();
    const fixtureHash = createHash("sha256").update(fixture).digest("hex");
    const effectiveDate = `${2100 + (RUN % 7000)}-12-31`;

    const app = express();
    app.use(express.json());
    app.use(router);

    let batchIds: number[] = [];
    try {
      const response = await supertest(app)
        .post("/catalog/load-mrp")
        .field("sourceId", String(sourceId))
        .field("downloadedAt", "2026-08-31")
        .field("effectiveDate", effectiveDate)
        .attach("file", fixture, {
          filename: `mixed-${RUN}.zip`,
          contentType: "application/zip",
        });

      const batches = await db
        .select({ id: mrpLoadBatchesTable.id, rowCount: mrpLoadBatchesTable.rowCount })
        .from(mrpLoadBatchesTable)
        .where(eq(mrpLoadBatchesTable.fileSha256, fixtureHash));
      batchIds = batches.map((batch) => batch.id);

      expect(response.status).toBe(200);
      expect(response.body.results.newHistoryRows).toBe(1);
      expect(response.body.results.files).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ file: "valid.xlsx", newHistoryRows: 1 }),
          expect.objectContaining({ file: "rejected.xlsx", newHistoryRows: 0 }),
        ]),
      );
      expect(batches).toEqual([expect.objectContaining({ rowCount: 1 })]);
    } finally {
      if (batchIds.length > 0) {
        await db
          .delete(mrpHistoryProvenanceEventsTable)
          .where(inArray(mrpHistoryProvenanceEventsTable.loadBatchId, batchIds));
        await db
          .delete(mrpPriceHistoryTable)
          .where(inArray(mrpPriceHistoryTable.loadBatchId, batchIds));
        await db
          .delete(mrpLoadBatchesTable)
          .where(inArray(mrpLoadBatchesTable.id, batchIds));
      }
    }
  });

  it("finds a matching batch even when another batch was loaded later", async () => {
    const fixture = datedWorkbookBuffer();
    const fixtureHash = createHash("sha256").update(fixture).digest("hex");
    const source = await db
      .select({ id: mrpSourcesTable.id })
      .from(mrpSourcesTable)
      .where(eq(mrpSourcesTable.division, "PTMT & Plastic Fittings"))
      .limit(1);

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

    expect(response.status).toBe(409);
    expect(response.body.duplicate.matches).toEqual(
      expect.arrayContaining([expect.objectContaining({ loadBatchId: first[0]!.id })]),
    );
  });
});
