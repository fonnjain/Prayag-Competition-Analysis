import { readFileSync } from "node:fs";
import express from "express";
import supertest from "supertest";
import * as XLSX from "xlsx";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  competitorPriceStagingTable,
  db,
  importBatchesTable,
} from "@workspace/db";
import importBatchesRouter from "./importBatches.js";
import {
  parsePrinceCompetitorMaster,
  PRINCE_COMPETITOR,
  PRINCE_EFFECTIVE_DATE,
} from "../lib/princeMaster.js";

const app = express();
app.use(express.json());
app.use(importBatchesRouter);
const request = supertest(app);
const pdfPath = new URL(
  "../../../../attached_assets/Prince_Pipes_-_Pan_India_-_Pricelist_1789458928833.pdf",
  import.meta.url,
);
const workbookPath = new URL(
  "../../../../attached_assets/Competitor_Master_-_Plumbing_(1)_1789458928829.xlsx",
  import.meta.url,
);
let restoreExecute: (() => void) | undefined;

describe("Prince PDF upload idempotency", () => {
  beforeAll(async () => {
    const buffer = readFileSync(workbookPath);
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
    const preliminary = parsePrinceCompetitorMaster(buffer, workbook, new Map());
    const unmatched = new Set([
      "C133", "PMR-8", "PMR-9", "U-11CS", "U-13CS",
      "U-14CS", "U-15CS", "U-16CS", "U-13BS", "U-14BS",
    ]);
    const canonical = new Map(preliminary.rows.map((row) => [
      row.prayagCode.replace(/\s+/g, "").toUpperCase(),
      row.prayagCode,
    ] as [string, string]).filter(([, code]) => !unmatched.has(code)));
    const master = parsePrinceCompetitorMaster(buffer, workbook, canonical);
    const fixtureTargets = master.catalogMatchedRows.map((row) => ({
      competitor_code: row.princeCode,
      matched_prayag_code: row.canonicalPrayagCode!,
      category: row.category,
      description: null,
      size: row.lengthMeters ? `${row.lengthMeters} m` : null,
      price: row.price,
    }));
    expect(fixtureTargets).toHaveLength(803);
    const realExecute = db.execute.bind(db);
    const executeSpy = vi.spyOn(db, "execute").mockImplementation((query: any) => {
      const sqlText = JSON.stringify(query?.queryChunks ?? query).toLowerCase();
      if (sqlText.includes("competitor_prices")) return { rows: fixtureTargets } as any;
      return realExecute(query);
    });
    restoreExecute = () => executeSpy.mockRestore();
  });

  afterAll(async () => {
    restoreExecute?.();
  });

  it("returns the existing batch for competitor + SHA + effective date and preserves mapping identities", async () => {
    const pdf = readFileSync(pdfPath);
    const upload = () => request
      .post("/catalog/import-batches")
      .field("competitor", PRINCE_COMPETITOR)
      .field("effectiveDate", PRINCE_EFFECTIVE_DATE)
      .attach("file", pdf, { filename: "prince.pdf", contentType: "application/pdf" });

    let batchId: number | undefined;
    try {
      const first = await upload();
      expect([200, 201]).toContain(first.status);
      batchId = first.body.batchId;
      if (typeof batchId !== "number") throw new Error("Prince import did not return a batch id.");
      const createdBatchId = batchId;
      expect(first.body.reconciliation).toBeDefined();
      expect(first.body.reconciliation.comparisons.length).toBe(803);
      expect(first.body.reconciliation.differences).toHaveLength(0);
      expect(first.body.rowCounts.mappedStagingIdentities).toBe(803);
      expect(first.body.fileSha256).toBeTruthy();

      const staged = await db.select({
        prince: competitorPriceStagingTable.competitorCodeMaster,
        prayag: competitorPriceStagingTable.matchedPrayagCode,
        variant: competitorPriceStagingTable.variant,
        price: competitorPriceStagingTable.newMrp,
      }).from(competitorPriceStagingTable)
        .where(eq(competitorPriceStagingTable.batchId, createdBatchId));
      expect(staged.filter((row) => row.prayag != null)).toHaveLength(803);
      const duplicateAssignments: Record<string, Array<[string, number]>> = {
        SIM200032: [["A-86B", 1265], ["A-86A", 759]],
        SIM100150: [["A-414", 30], ["A-464", 30]],
        SIM103500: [["5711S", 83], ["5712S", 83]],
        SIM103501: [["5111S", 155], ["5112S", 155]],
      };
      for (const [code, expected] of Object.entries(duplicateAssignments)) {
        expect(staged.filter((row) => row.prince === code)).toHaveLength(2);
        expect(staged.filter((row) => row.prince === code)
          .map((row) => row.prayag)
          .sort()).toEqual(expected.map(([prayag]) => prayag).sort());
      }
      expect(staged.filter((row) => row.prince === "SIM200032")
        .map((row) => [row.prayag, row.price, row.variant])
        .sort()).toEqual([
          ["A-86A", 759, "3 m"],
          ["A-86B", 1265, "5 m"],
        ]);

      const second = await upload();
      expect(second.status).toBe(200);
      expect(second.body.idempotent).toBe(true);
      expect(second.body.batchId).toBe(first.body.batchId);
    } finally {
      if (batchId != null) {
        await db.delete(competitorPriceStagingTable).where(eq(competitorPriceStagingTable.batchId, batchId));
        await db.delete(importBatchesTable).where(eq(importBatchesTable.id, batchId));
      }
    }
  }, 180_000);
});