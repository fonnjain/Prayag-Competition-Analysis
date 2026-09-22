import { describe, expect, it } from "vitest";
import { isCompleteP024Preview, parseNameChangesWorkbook, previewFor, type NameChangeRow } from "./catalogNameChanges";

describe("P024 catalogue name changes", () => {
  it("rejects a workbook whose checksum is not the approved source", () => {
    expect(() => parseNameChangesWorkbook(Buffer.from("not the approved workbook"))).toThrow(/SHA-256 mismatch/);
  });

  it("accepts only the exact 155-row provenance count", () => {
    expect(isCompleteP024Preview(155)).toBe(true);
    expect(isCompleteP024Preview(154)).toBe(false);
    expect(isCompleteP024Preview(156)).toBe(false);
  });

  it("reports old-name drift without permitting price, competitor, or creation writes", () => {
    const rows: NameChangeRow[] = [{
      itemCode: "HD110D",
      division: "Pipes & Fittings",
      series: "HDPE Pipe",
      oldName: "old",
      newName: "new",
      changeType: "SDR_RESPEC",
      mrpUnchanged: 677.9,
      note: "test",
    }];
    const preview = previewFor(rows, [{
      itemCode: "HD110D",
      division: "Pipes & Fittings",
      seriesRange: "HDPE Pipe",
      productName: "different current name",
      isActive: true,
      discontinuedFrom: null,
    }] as any);
    expect(preview.oldNameMismatched).toBe(1);
    expect(preview.wouldUpdate).toBe(0);
    expect(preview.priceRowsToWrite).toBe(0);
    expect(preview.competitorRowsToTouch).toBe(0);
    expect(preview.productsToCreate).toBe(0);
  });

  it("classifies discontinued products as ineligible and never as update candidates", () => {
    const preview = previewFor([{
      itemCode: "HD110D", division: "Pipes & Fittings", series: "HDPE Pipe",
      oldName: "old", newName: "new", changeType: "SDR_RESPEC", mrpUnchanged: 1, note: "",
    }], [{
      itemCode: "HD110D", division: "Pipes & Fittings", seriesRange: "HDPE Pipe",
      productName: "old", isActive: true, discontinuedFrom: "2026-01-01",
    }] as any);
    expect(preview.eligibleRows).toBe(0);
    expect(preview.wouldUpdate).toBe(0);
    expect(preview.mismatched[0]?.reasons).toContain("discontinued/inactive product");
  });
});