import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { parsePrinceCompetitorMaster } from "./princeMaster.js";
import {
  extractPrinceTextPdf,
  reconcilePrincePdf,
} from "./princeTextPdfExtractor.js";

const pdfPath = fileURLToPath(new URL(
  "../../../../attached_assets/Prince_Pipes_-_Pan_India_-_Pricelist_1789458928833.pdf",
  import.meta.url,
));
const workbookPath = fileURLToPath(new URL(
  "../../../../attached_assets/Competitor_Master_-_Plumbing_(1)_1789458928829.xlsx",
  import.meta.url,
));
const princePdf = readFileSync(pdfPath);
const extractedPrince = extractPrinceTextPdf(princePdf);

describe("Prince text-native PDF extraction", () => {
  it("uses pdftotext positional extraction and preserves occurrence/unique counts", () => {
    const result = extractedPrince;
    expect(result.items).toHaveLength(4306);
    expect(new Set(result.items.map((item) => item.cat_no)).size).toBe(4275);
    expect(result.items.every((item) => item.page > 0 && item.sourceTokens.length > 0)).toBe(true);
  });

  it("segments page 6 side-by-side families by position", () => {
    const items = extractedPrince.items.filter((item) => item.page === 6);
    expect(items.length).toBeGreaterThan(20);
    expect(new Set(items.map((item) => item.product_name).filter(Boolean)).size).toBeGreaterThan(2);
    expect(items.some((item) => item.product_name.includes("WITH SOCKET"))).toBe(true);
    expect(items.some((item) => item.product_name.includes("FABRICATED"))).toBe(true);
  });

  it("emits one priced row per non-dash page-22 code with shared metre rate", () => {
    const items = extractedPrince.items
      .filter((item) => item.page === 22 && item.cat_no === "SIM201337");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      variant: "3 m",
      mrp: 354,
      piecePrice: 354,
      ratePerMetre: 118,
      unit: "per_metre",
      lengthMeters: 3,
      lengthMetres: 3,
    });
    const rowCodes = extractedPrince.items
      .filter((item) => item.page === 22)
      .map((item) => item.cat_no);
    expect(rowCodes).not.toContain("-");
    expect(rowCodes).toContain("SIM201413");
    expect(rowCodes).toContain("SIM201399");
  });

  it("keeps locked page-local groups and x-column evidence", () => {
    for (const page of [7, 13, 15, 18, 39, 40, 41, 58, 74, 75, 88, 89]) {
      const pageItems = extractedPrince.items.filter((item) => item.page === page);
      expect(pageItems.length, `page ${page} should contain priced rows`).toBeGreaterThan(0);
      expect(pageItems.every((item) => item.sourceTokens.length > 0 && item.xMin >= 0)).toBe(true);
    }
    expect(extractedPrince.items.find((item) => item.cat_no === "SIM100817")).toMatchObject({ piecePrice: 23 });
    expect(extractedPrince.items.find((item) => item.cat_no === "SIM103377")).toMatchObject({ piecePrice: 109 });
    expect(extractedPrince.items.find((item) => item.cat_no === "SIM202974")).toMatchObject({
      ratePerMetre: 1050,
      piecePrice: 6300,
      lengthMeters: 6,
    });
    expect(extractedPrince.items.find((item) => item.cat_no === "SIM200860")).toMatchObject({
      ratePerMetre: 247.95,
      piecePrice: 743.85,
      lengthMeters: 3,
    });
    expect(extractedPrince.items.find((item) => item.cat_no === "SIM200558")).toMatchObject({
      ratePerMetre: 178.75,
      piecePrice: 536.25,
      lengthMeters: 3,
    });
  });

  it("reconciles all 813 workbook rows without price differences", () => {
    const workbook = readFileSync(workbookPath);
    const parsed = XLSX.read(workbook, { type: "buffer", cellDates: true });
    const master = parsePrinceCompetitorMaster(workbook, parsed, new Map());
    const reconciliation = reconcilePrincePdf(extractedPrince.items, master.rows);

    expect(master.rows.every((row) =>
      reconciliation.missingCodes.includes(row.princeCode) === false,
    )).toBe(true);
    expect(master.rows).toHaveLength(813);
    expect(reconciliation.matched).toBe(809);
    expect(reconciliation.comparisons).toHaveLength(813);
    expect(reconciliation.missingCodes).toHaveLength(0);
    expect(reconciliation.unpricedCodes).toHaveLength(0);
    expect(reconciliation.differences).toHaveLength(0);
    expect(reconciliation.newCodes).toHaveLength(3466);
  });

  it("detects a deliberately altered workbook price", () => {
    const workbook = readFileSync(workbookPath);
    const parsed = XLSX.read(workbook, { type: "buffer", cellDates: true });
    const master = parsePrinceCompetitorMaster(workbook, parsed, new Map());
    const altered = master.rows.map((row) => row.princeCode === master.rows[0]!.princeCode
      ? { ...row, price: row.price + 1 }
      : row);
    const reconciliation = reconcilePrincePdf(extractedPrince.items, altered);
    expect(reconciliation.comparisons).toHaveLength(813);
    expect(reconciliation.differences).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: master.rows[0]!.princeCode,
        workbook: altered[0]!.price,
      }),
    ]));
  });
});