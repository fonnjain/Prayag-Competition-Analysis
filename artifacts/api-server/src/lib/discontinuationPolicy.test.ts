import { describe, expect, it } from "vitest";
import { deriveConfirmedDiscontinuations } from "./discontinuationPolicy.js";

describe("deriveConfirmedDiscontinuations", () => {
  it("keeps a shared code live when any range occurrence has a live price", () => {
    const result = deriveConfirmedDiscontinuations([
      { itemCode: "BD-40", discontinuedFrom: "2026-08-01", isRemoved: true },
      { itemCode: "BD-40", discontinuedFrom: null, isRemoved: false },
      { itemCode: "6103-S", discontinuedFrom: "2026-08-01", isRemoved: true },
    ]);

    expect(result).toEqual([
      { itemCode: "6103-S", discontinuedFrom: "2026-08-01" },
    ]);
  });

  it("uses the first date when every occurrence is removed", () => {
    const rows = [
      { itemCode: "RET-1", discontinuedFrom: "2026-09-01", isRemoved: true },
      { itemCode: "RET-1", discontinuedFrom: "2026-08-01", isRemoved: true },
    ];

    expect(deriveConfirmedDiscontinuations(rows)).toEqual([
      { itemCode: "RET-1", discontinuedFrom: "2026-08-01" },
    ]);
    expect(deriveConfirmedDiscontinuations(rows)).toEqual(
      deriveConfirmedDiscontinuations(rows),
    );
  });
});