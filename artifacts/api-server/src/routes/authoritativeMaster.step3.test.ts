import { describe, expect, it } from "vitest";
import { planAuthoritativeClassifications, type AuthoritativePriceRow, type ParsedAuthoritativeMaster } from "../lib/authoritativeMrpMaster";
import { pendingAuthoritativePreview } from "./catalogImportExport";

const row = (changes: Partial<AuthoritativePriceRow> = {}): AuthoritativePriceRow => ({
  itemCode: "FIX-PIPE", division: "Pipes & Fittings", series: "HDPE Pipe",
  category: null, productName: "Fixture", size: null, mrp: 100,
  effectiveDate: "2026-08-01", variant: "Standard", ...changes,
});
const parsed = (rows: AuthoritativePriceRow[], prices = rows): ParsedAuthoritativeMaster => ({
  fileName: "disposable.xlsx", fileSha256: "fixture", loadReason: "fixture", dataFlag: "fixture",
  productRows: rows, priceRows: prices, discontinuedRows: [], excludedRows: 0,
  invalidExcludedCodes: [], periodCounts: {}, periodDivisionCounts: {},
  variantCounts: { Standard: rows.length, Ivory: 0, "White with Jet": 0, "Pink / Green / Blue": 0 },
  preservedNameDisagreements: [],
});

describe("P049 Step 3 price-only classification planning", () => {
  it("accepts an existing product with no Category in the master", () => {
    const plan = planAuthoritativeClassifications([row()], [{ itemCode: "FIX-PIPE", division: "Pipes & Fittings", category: "Stored", seriesRange: "Hidden" }]);
    expect(plan.counts).toEqual({ existingProducts: 1, newNonRangeProducts: 0, refusedNewRangeProducts: 0 });
    expect(plan.rejectedRows).toEqual([]);
    expect(plan.newProducts).toEqual([]);
  });
  it("shows every represented classification difference and both exact values without blocking prices", () => {
    const preview = pendingAuthoritativePreview(parsed([row()]), [{
      itemCode: "FIX-PIPE", productName: "Stored", discontinuedFrom: null,
      division: "Hardware", category: "Stored Category", seriesRange: "Keep EXACT",
    }], []);
    expect(preview.canApply).toBe(true);
    expect(preview.classificationDifferences).toEqual([{
      itemCode: "FIX-PIPE", message: "classification differs — not changed",
      differingFields: ["division", "category"],
      stored: { division: "Hardware", category: "Stored Category", seriesRange: "Keep EXACT" },
      file: { division: "Pipes & Fittings", category: "HDPE Pipe", seriesRange: null, categoryProvided: true, rangeProvided: false },
    }]);
  });
  it("derives a new pipe Category from master series and omits Range", () => {
    expect(planAuthoritativeClassifications([row()], []).newProducts).toEqual([{ itemCode: "FIX-PIPE", category: "HDPE Pipe" }]);
  });
  it("refuses a new CP product with the required editor message, including its colour prices", () => {
    const cp = row({ itemCode: "FIX-CP", division: "CP Fittings / Faucets", series: "Blaze 62" });
    const preview = pendingAuthoritativePreview(parsed([cp], [cp, { ...cp, variant: "Ivory" }]), [], []);
    expect(preview.rejectedRows[0]?.reason).toBe("new CP/PTMT product needs a category: create it in the product editor");
    expect(preview.rowsToWrite).toBe(0);
    expect(preview.periods).toEqual([]);
    expect(preview.newProducts).toEqual([]);
    expect(preview.canApply).toBe(false);
  });
  it("does not compare absent Category or hidden Range as though they were blank file values", () => {
    const cp = row({ division: "CP Fittings / Faucets", series: "Blaze 62" });
    const cpPlan = planAuthoritativeClassifications([cp], [{ itemCode: cp.itemCode, division: cp.division, category: "Real Category", seriesRange: cp.series }]);
    expect(cpPlan.classificationDifferences).toEqual([]);
    const pipePlan = planAuthoritativeClassifications([row()], [{ itemCode: "FIX-PIPE", division: "Pipes & Fittings", category: "HDPE Pipe", seriesRange: "Hidden must stay" }]);
    expect(pipePlan.classificationDifferences).toEqual([]);
  });
  it("lists existing CP Range differences while preserving lifecycle status", () => {
    const cp = row({ division: "CP Fittings / Faucets", series: "Blaze 62" });
    const preview = pendingAuthoritativePreview(parsed([cp]), [{ itemCode: cp.itemCode, division: cp.division, category: "Category", seriesRange: "Stored Range", productName: "Stored", discontinuedFrom: "2026-07-01" }], []);
    expect(preview.classificationDifferences[0]?.differingFields).toEqual(["series_range"]);
    expect(preview.discontinuations).toEqual({ total: 0, immediate: 0, future: 0 });
    expect(preview.rejectedRows).toEqual([]);
  });
  it("admits a new pipe while holding only the new CP row in a mixed master", () => {
    const preview = pendingAuthoritativePreview(parsed([row(), row({ itemCode: "FIX-CP", division: "PTMT & Plastic Fittings", series: "Accessories" })]), [], []);
    expect(preview.rowsToWrite).toBe(1);
    expect(preview.classificationCounts).toEqual({ existingProducts: 0, newNonRangeProducts: 1, refusedNewRangeProducts: 1 });
    expect(preview.newProducts.map(row => row.itemCode)).toEqual(["FIX-PIPE"]);
  });
});