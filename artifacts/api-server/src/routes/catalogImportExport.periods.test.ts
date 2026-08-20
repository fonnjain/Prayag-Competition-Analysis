import { createHash } from "node:crypto";
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

afterAll(async () => {
  if (createdBatchIds.length) {
    await db.delete(mrpLoadBatchesTable).where(
      inArray(mrpLoadBatchesTable.id, createdBatchIds),
    );
  }
});

describe("MRP loader period and duplicate safeguards", () => {
  it("uses source header periods rather than a supplied or current date", () => {
    const parsed = parseWorkbookBuffer(datedWorkbookBuffer(), new Set(["PERIOD-TEST"]));
    expect(parsed.hasHeaderPeriods).toBe(true);
    expect([...new Set(parsed.rows.map((row) => row.effectiveDate))].sort()).toEqual([
      "2026-03-05",
      "2026-09-01",
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