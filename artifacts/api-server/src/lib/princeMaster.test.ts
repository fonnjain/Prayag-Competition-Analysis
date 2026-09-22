import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import {
  isPrinceCompetitorMasterWorkbook,
  parsePrinceCompetitorMaster,
  PRINCE_EFFECTIVE_DATE,
  PRINCE_MASTER_SHA256,
  PRINCE_CONTENT_FINGERPRINT,
  normalizePrinceCode,
} from "./princeMaster.js";

const workbookPath = fileURLToPath(new URL(
  "../../../../attached_assets/Competitor_Master_-_Plumbing_Prince_1790080853652.xlsx",
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
       .map((row) => [normalizePrinceCode(row.prayagCode), row.prayagCode]),
  );
}

describe("trusted Prince workbook parser", () => {
  it("gates parsed content and returns 811 loadable rows", () => {
    const { buffer, workbook } = source();
    const result = parsePrinceCompetitorMaster(buffer, workbook, canonicalMap(workbook));

    expect(result.sourceSha256).toBe(PRINCE_MASTER_SHA256);
    expect(result.effectiveDate).toBe(PRINCE_EFFECTIVE_DATE);
    expect(result.sourceSha256).toBe(PRINCE_MASTER_SHA256);
    expect(result.contentFingerprint).toBe(PRINCE_CONTENT_FINGERPRINT);
    expect(result.rows).toHaveLength(811);
    expect(result.catalogMatchedRows).toHaveLength(801);
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
      "AGRI PIPE": 88,
      "AGRI FITTINGS": 29,
      "AGRI SMART Fittings": 9,
      "SWR PIPE": 125,
      "SWR FITTINGS": 96,
      "CASING PIPE": 17,
      "UGD PIPE": 14,
    });
    expect(result.worksheetDiagnostics.find((row) => row.sheet === "AGRI PIPE")?.princePriced).toBe(90);
    expect(result.rejectedRows.filter((row) => row.princeCode === "SIM200032")).toHaveLength(2);
  });

  it("uses dated piece prices for Casing/UGD and never per-metre values", () => {
    const { buffer, workbook } = source();
    const result = parsePrinceCompetitorMaster(buffer, workbook, canonicalMap(workbook));
    expect(result.rows.find((row) => row.prayagCode === "PMR-1")).toMatchObject({
      prayagPrice: null,
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
    const parsed = parsePrinceCompetitorMaster(buffer, workbook, canonicalMap(workbook));
    const rows = parsed.rows;
    const assignments = (code: string) => rows
      .filter((row) => row.princeCode === code)
      .map((row) => [row.prayagCode, row.price, row.sourceRow]);
    expect(assignments("SIM200032")).toEqual([]);
    expect(parsed.rejectedRows.filter((row) => row.princeCode === "SIM200032")).toHaveLength(2);
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

  it("retains content identity when source bytes differ", () => {
    const { buffer, workbook } = source();
    const changed = Buffer.from(buffer);
    changed[changed.length - 1] = changed[changed.length - 1]! ^ 1;
    const result = parsePrinceCompetitorMaster(changed, workbook, canonicalMap(workbook));
    expect(result.contentFingerprint).toBe(PRINCE_CONTENT_FINGERPRINT);
    expect(result.sourceSha256).not.toBe(PRINCE_MASTER_SHA256);
  });

  it("fails closed for incomplete or extended Prince-like workbooks", () => {
    const { workbook } = source();
    const missing = { ...workbook, SheetNames: workbook.SheetNames.slice(1) };
    expect(() => isPrinceCompetitorMasterWorkbook(missing)).toThrow(/incomplete/i);
    const extended = { ...workbook, SheetNames: [...workbook.SheetNames, "UNEXPECTED PRINCE DATA"] };
    expect(() => isPrinceCompetitorMasterWorkbook(extended)).toThrow(/unexpected worksheets/i);
  });
});