import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  detectGroupedCompetitorBrands,
  validateGenericWorkbookDate,
} from "./competitorWorkbookSafety";

describe("competitor workbook brand/date safety", () => {
  it("detects grouped multi-brand headings for fail-closed staging", () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      [null, null, "Prayag", null, "Apollo", null, "Prince"],
      [null, null, "Item Code", "MRP", "Item Code", "01 Aug 2026", "Item Code"],
      ["row"],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, "CPVC PIPE");

    expect(detectGroupedCompetitorBrands(workbook)).toEqual(["apollo", "prayag", "prince"]);
  });

  it("recognizes a single vendor group beside Prayag reference columns", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["Prayag", null, "Apollo"],
      ["Item Code", "MRP", "Item Code"],
    ]), "CPVC PIPE");

    expect(detectGroupedCompetitorBrands(workbook)).toEqual(["apollo", "prayag"]);
  });

  it("does not classify an ordinary single-brand sheet as grouped", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["Prayag Code", "Description", "MRP", "Effective Date"],
      ["P-100", "Fixture", 150, "2026-08-01"],
    ]), "Prices");

    expect(detectGroupedCompetitorBrands(workbook)).toEqual([]);
  });

  it("rejects flat brand-qualified price headers rather than using the first numeric price", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["Prayag Code", "Apollo Price", "Prince Price", "Apollo Date", "Prince Date"],
      ["P-100", 150, 120, "2026-08-01", "2026-03-01"],
    ]), "Prices");
    expect(detectGroupedCompetitorBrands(workbook)).toEqual(["apollo", "prince"]);
  });

  it("accepts only an exact source-date match and reports both dates", () => {
    expect(validateGenericWorkbookDate(["2026-08-01", "2026-08-01"], "2026-08-01"))
      .toBe("2026-08-01");
    expect(() => validateGenericWorkbookDate(["2026-03-01"], "2026-08-01"))
      .toThrow("Selected effective date 2026-08-01 does not match the competitor date in the workbook 2026-03-01");
    expect(() => validateGenericWorkbookDate(["2026-03-01", "2026-08-01"], "2026-08-01"))
      .toThrow("Workbook contains multiple competitor effective dates (2026-03-01, 2026-08-01)");
  });

  it("preserves the established operator-date contract for undated single-brand sheets", () => {
    expect(validateGenericWorkbookDate([null, undefined], "2099-12-31")).toBeNull();
  });
});