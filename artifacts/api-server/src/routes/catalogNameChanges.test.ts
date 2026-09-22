import { describe, expect, it } from "vitest";
import { isCompleteP026Preview, MANUAL_SOURCE, parseLogicalNameChangeRows, parseNameChangesWorkbook, previewFor, singleInput, SOURCE, type NameChangeRow } from "./catalogNameChanges";

describe("P026r2 catalogue name changes", () => {
  it("rejects a workbook whose checksum is not the approved source", () => {
    expect(() => parseNameChangesWorkbook(Buffer.from("not the approved workbook"))).toThrow(/SHA-256 mismatch/);
  });

  it("accepts only the exact 155-row provenance count", () => {
    expect(isCompleteP026Preview(155)).toBe(true);
    expect(isCompleteP026Preview(154)).toBe(false);
    expect(isCompleteP026Preview(156)).toBe(false);
  });

  it("constructs logical rows from names only, excluding stray price and context fields", () => {
    expect(parseLogicalNameChangeRows([{
      item_code: "PMC-1", old_name: "Old", new_name: "New", mrp: 752,
      effective_date: "2026-09-01", division: "ignored", series: "ignored",
    }])).toEqual([{ itemCode: "PMC-1", oldName: "Old", newName: "New" }]);
  });

  it("uses distinct durable source identities for bulk and manual edits", () => {
    expect(SOURCE.division).not.toBe(MANUAL_SOURCE.division);
    expect(SOURCE.sheetId).not.toBe(MANUAL_SOURCE.sheetId);
  });

  it("rejects unknown and forbidden JSON fields and trims valid input", () => {
    expect(() => singleInput({ itemCode: "P", oldName: "old", newName: "new", reason: "x", mrp: 1 })).toThrow(/Forbidden/);
    expect(() => singleInput({ itemCode: "P", oldName: "old", newName: "new", reason: "x", effective_date: "2026-01-01" })).toThrow(/Forbidden/);
    expect(() => singleInput({ itemCode: "P", oldName: "old", newName: "new", reason: "x", extra: true })).toThrow(/unknown/);
    expect(singleInput({ itemCode: "P", oldName: "old", newName: " new ", reason: "x" }).trimmed).toBe(true);
  });

  it("reports old-name drift without permitting price, competitor, or creation writes", () => {
    const rows: NameChangeRow[] = [{
      itemCode: "HD110D",
      oldName: "old",
      newName: "new",
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
       itemCode: "HD110D",
       oldName: "old", newName: "new",
    }], [{
      itemCode: "HD110D", division: "Pipes & Fittings", seriesRange: "HDPE Pipe",
      productName: "old", isActive: true, discontinuedFrom: "2026-01-01",
    }] as any);
    expect(preview.eligibleRows).toBe(0);
    expect(preview.wouldUpdate).toBe(0);
    expect(preview.mismatched[0]?.reasons).toContain("discontinued/inactive product");
  });

  it("allows a future scheduled withdrawal in bulk while excluding inactive products", () => {
    const future = new Date(Date.now() + 86400000 * 30).toISOString().slice(0, 10);
    expect(previewFor([{ itemCode: "F", oldName: "old", newName: "new" }], [{
      itemCode: "F", productName: "old", isActive: true, discontinuedFrom: future,
    }] as any).wouldUpdate).toBe(1);
    expect(previewFor([{ itemCode: "I", oldName: "old", newName: "new" }], [{
      itemCode: "I", productName: "old", isActive: false, discontinuedFrom: null,
    }] as any).wouldUpdate).toBe(0);
  });
});