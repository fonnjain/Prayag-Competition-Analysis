import { describe, expect, it } from "vitest";
import { mergeHybridItems } from "./pdfHybrid.js";

const item = (mrp: number, page: number) => ({
  cat_no: "SIM100001",
  variant: null,
  mrp,
  product_name: "Example",
  page,
  discoveryPasses: [1],
  adjudicated: false,
});

describe("hybrid PDF merge", () => {
  it("passes explicit text and vision occurrences through without overwriting", () => {
    const result = mergeHybridItems([item(100, 3)], [item(100, 8)]);
    expect(result.conflicts).toHaveLength(0);
    expect(result.items.map((row) => row.page)).toEqual([3, 8]);
  });

  it("records same-code occurrence price conflicts for review", () => {
    const result = mergeHybridItems([item(100, 3)], [item(120, 8)]);
    expect(result.items).toHaveLength(2);
    expect(result.conflicts).toEqual([{
      code: "SIM100001",
      occurrence: 0,
      values: [100, 120],
      pages: [3, 8],
    }]);
  });
});