import { describe, expect, it } from "vitest";
import { calculateCollectiveMargin, materializeMatchingDecision, matchingPosition } from "./p015";
import type { GeneratorProduct } from "./mrpGenerator";

const product = (code: string, currentMrp: number, prices: number[]): GeneratorProduct => ({
  itemCode: code, productName: code, division: "Compound A | Compound B", category: "CP Fittings",
  currentMrp, currentDate: "2026-09-01",
  competitors: prices.map((price, index) => ({
    competitor: ["Sparsh Pearl", "Ashirvad"][index] ?? `Competitor ${index}`,
    price, effectivePrice: price, effectiveDate: "2026-09-01",
    ageDays: 0, stale: false, matched: true,
  })),
});

describe("P015 matching and collective margin", () => {
  it("uses the selected driver and records leave as reviewed no-change", () => {
    const item = product("A", 100, [90, 110]);
    expect(matchingPosition(100, 90).direction).toBe("above");
    expect(materializeMatchingDecision(item, {
      itemCode: "A", action: "match", driver: "lowest", source: "manual",
    }, ["Sparsh Pearl", "Ashirvad"]).suggestedMrp).toBe(90);
    const leave = materializeMatchingDecision(item, {
      itemCode: "A", action: "leave", source: "manual",
    }, ["Sparsh Pearl"]);
    expect(leave.status).toBe("no_change");
    expect(leave.trace[0]?.reason).toContain("Reviewed");
  });

  it("applies the P015 formula, coverage, exclusions, and value at risk", () => {
    const report = calculateCollectiveMargin([
      {
        itemCode: "A", currentMrp: 100, suggestedMrp: 110,
        sales: { qty: 10, salesAmount: 1_000 },
        margin: { qty: 10, bomValue: 600, avgSale: 80 },
      },
      {
        itemCode: "B", currentMrp: 100, suggestedMrp: 120,
        sales: { qty: null, salesAmount: 500 },
        margin: { qty: 5, bomValue: 250, avgSale: 70 },
      },
    ], { sourcePeriods: { sales: "2026-04..2026-08", margin: "2026-04..2026-06" }, holds: ["PTMT"] });
    expect(report.includedCount).toBe(1);
    expect(report.excludedCount).toBe(1);
    expect(report.current).toBeCloseTo((10 * (80 - 60)) / (10 * 80));
    expect(report.projected).toBeCloseTo((10 * (88 - 60)) / (10 * 88));
    expect(report.deltaPoints).toBeCloseTo((report.projected! - report.current!) * 100);
    expect(report.coverage.numerator).toBe(1_000);
    expect(report.coverage.denominator).toBe(1_500);
    expect(report.valueAtRisk.value).toBe(1_500);
    expect(report.valueAtRisk.unknownCount).toBe(0);
    expect(report.assumptions).toHaveLength(2);
  });

  it("counts rising rows without persisted sales value separately from margin exclusions", () => {
    const report = calculateCollectiveMargin([{
      itemCode: "MISSING-SALES",
      currentMrp: 100,
      suggestedMrp: 110,
      sales: { qty: 10, salesAmount: null },
      margin: { qty: 10, bomValue: 600, avgSale: 80 },
    }]);
    expect(report.valueAtRisk).toEqual({ value: 0, unknownCount: 1 });
    expect(report.includedCount).toBe(1);
  });
});