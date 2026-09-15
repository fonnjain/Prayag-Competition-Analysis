import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import {
  parsePrinceCompetitorMaster,
  PRINCE_EFFECTIVE_DATE,
  PRINCE_MASTER_ROW_COUNT,
  PRINCE_MASTER_SHA256,
} from "./princeMaster.js";

const workbookPath = fileURLToPath(new URL(
  "../../../../attached_assets/Competitor_Master_-_Plumbing_(1)_1789458928829.xlsx",
  import.meta.url,
));
const unmatchedCodes = [
  "C133", "PMR-8", "PMR-9", "U-11CS", "U-13CS",
  "U-14CS", "U-15CS", "U-16CS", "U-13BS", "U-14BS",
];

function source() {
  const buffer = readFileSync(workbookPath);
  return { buffer, workbook: XLSX.read(buffer, { type: "buffer", cellDates: true }) };
}

// The production canonical map comes from catalog_products. For this
// artifact-level test, bootstrap every workbook Prayag code and explicitly
// remove the ten audited unmatched codes.
function canonicalMap(workbook: XLSX.WorkBook): Map<string, string> {
  const buffer = readFileSync(workbookPath);
  const parsed = parsePrinceCompetitorMaster(buffer, workbook, new Map());
  return new Map(
    parsed.rows
      .filter((row) => !unmatchedCodes.includes(row.prayagCode))
      .map((row) => [row.prayagCode.replace(/\s+/g, "").toUpperCase(), row.prayagCode]),
  );
}

describe("trusted Prince workbook parser", () => {
  it("accepts only the approved source and parses exactly 813 dated rows", () => {
    const { buffer, workbook } = source();
    const result = parsePrinceCompetitorMaster(buffer, workbook, canonicalMap(workbook));

    expect(result.sourceSha256).toBe(PRINCE_MASTER_SHA256);
    expect(result.effectiveDate).toBe(PRINCE_EFFECTIVE_DATE);
    expect(result.rows).toHaveLength(PRINCE_MASTER_ROW_COUNT);
    expect(result.catalogMatchedRows).toHaveLength(803);
    expect(result.unmatchedRows).toHaveLength(10);
    expect(result.unmatchedCodes).toEqual([...unmatchedCodes].sort());
  });

  it("preserves every sheet's mapping count and per-sheet layouts", () => {
    const { buffer, workbook } = source();
    const result = parsePrinceCompetitorMaster(buffer, workbook, canonicalMap(workbook));
    const counts: Record<string, number> = {};
    for (const row of result.rows) counts[row.sheet] = (counts[row.sheet] ?? 0) + 1;
    expect(counts).toEqual({
      "CPVC PIPE": 40,
      "CPVC FITTINGS": 172,
      "UPVC PIPE": 52,
      "UPVC FITTINGS": 169,
      "AGRI PIPE": 90,
      "AGRI FITTINGS": 29,
      "AGRI SMART Fittings": 9,
      "SWR PIPE": 125,
      "SWR FITTINGS": 96,
      "CASING PIPE": 17,
      "UGD PIPE": 14,
    });
  });

  it("uses dated piece prices for Casing/UGD and never per-metre values", () => {
    const { buffer, workbook } = source();
    const result = parsePrinceCompetitorMaster(buffer, workbook, canonicalMap(workbook));
    expect(result.rows.find((row) => row.prayagCode === "PMR-1")).toMatchObject({
      prayagPrice: 928,
      princePriceBasis: "piece",
      lengthMeters: 3,
    });
    expect(result.rows.find((row) => row.prayagCode === "PMR-1")!.price).toBeCloseTo(743.85, 2);
    expect(result.rows.filter((row) => row.sheet === "UGD PIPE").every((row) =>
      row.princePriceBasis === "piece" && row.lengthMeters === 6,
    )).toBe(true);
  });

  it("retains source order for every duplicate Prince code identity", () => {
    const { buffer, workbook } = source();
    const rows = parsePrinceCompetitorMaster(buffer, workbook, canonicalMap(workbook)).rows;
    const assignments = (code: string) => rows
      .filter((row) => row.princeCode === code)
      .map((row) => [row.prayagCode, row.price, row.sourceRow]);
    expect(assignments("SIM200032")).toEqual([
      ["A-86B", 1265, 79],
      ["A-86A", 759, 122],
    ]);
    expect(assignments("SIM100150")).toEqual([
      ["A-414", 30, 20],
      ["A-464", 30, 51],
    ]);
    expect(assignments("SIM103500")).toEqual([
      ["5711S", 83, 204],
      ["5712S", 83, 210],
    ]);
    expect(assignments("SIM103501")).toEqual([
      ["5111S", 155, 206],
      ["5112S", 155, 212],
    ]);
  });

  it("fails closed on a changed source byte", () => {
    const { buffer, workbook } = source();
    const changed = Buffer.from(buffer);
    changed[changed.length - 1] = changed[changed.length - 1]! ^ 1;
    expect(() => parsePrinceCompetitorMaster(changed, workbook, canonicalMap(workbook))).toThrow(/checksum/i);
  });
});