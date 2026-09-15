import { describe, expect, it } from "vitest";
import { buildGstSanityWarning } from "./importBatches.js";

describe("PDF import GST baseline", () => {
  it("warns when a new Ex-GST basis shifts the prior MRP baseline by over ten points", () => {
    const warning = buildGstSanityWarning(2, 20, "MRP", "Ex-GST");
    expect(warning).toMatchObject({
      previousMedianGap: 2,
      currentMedianGap: 20,
      shiftPoints: 18,
      previousBasis: "MRP",
      currentBasis: "Ex-GST",
    });
  });

  it("does not warn for a comparable gap", () => {
    expect(buildGstSanityWarning(2, 12, "MRP", "Ex-GST")).toBeNull();
  });
});