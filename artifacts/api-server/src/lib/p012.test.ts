import { describe, expect, it } from "vitest";
import {
  DEFAULT_P012_SCENARIO,
  evaluateP012Product,
  evaluateP012Scenario,
  promoteP012ToAdvanced,
  convertAdvancedToP012,
  type GeneratorProduct,
  type P012SimplePolicy,
} from "./mrpGenerator";

const product = (
  itemCode: string,
  currentMrp: number,
  division: string,
  competitors: Array<[string, number]>,
): GeneratorProduct => ({
  itemCode, productName: itemCode, division, category: division, currentMrp,
  currentDate: "2026-01-01",
  competitors: competitors.map(([competitor, price]) => ({
    competitor, price, effectivePrice: price, effectiveDate: "2026-01-01",
    ageDays: 0, stale: false, matched: true,
  })),
});

describe("P012 Simple table", () => {
  it("ships a canonical default and keeps the first matching row", () => {
    expect(DEFAULT_P012_SCENARIO.name).toBe("Match competition, stay below");
    const policy: P012SimplePolicy = {
      ...DEFAULT_P012_SCENARIO.policy,
      rows: [
        { id: "division", order: 1, label: "Division", competitor: { mode: "lowest" }, appliesTo: { type: "division", value: "PTMT" }, target: { mode: "match" }, maxIncrease: 15, maxDecrease: 5 },
        { id: "all", order: 2, label: "All", competitor: { mode: "nearest" }, appliesTo: { type: "all" }, target: { mode: "below", percent: 5 }, catchAll: true },
      ],
    };
    const result = evaluateP012Product(product("A", 100, "PTMT", [["High", 200], ["Low", 120]]), policy);
    expect(result.matchedRowId).toBe("division");
    expect(result.selectedCompetitor).toBe("Low");
    expect(result.suggestedMrp).toBe(115);
  });

  it("does not fall through when a named competitor has no price", () => {
    const result = evaluateP012Product(product("A", 100, "PTMT", [["Other", 200]]), {
      ...DEFAULT_P012_SCENARIO.policy,
      rows: [
        { id: "named", order: 1, label: "Named", competitor: { mode: "named", name: "Missing" }, appliesTo: { type: "division", value: "PTMT" }, target: { mode: "match" } },
        { id: "catch", order: 2, label: "Catch", competitor: { mode: "lowest" }, appliesTo: { type: "all" }, target: { mode: "below", percent: 5 }, catchAll: true },
      ],
    });
    expect(result.matchedRowId).toBe("named");
    expect(result.selectedCompetitorPrice).toBeNull();
    expect(result.suggestedMrp).toBe(100);
  });

  it("reports reach, fallthrough, row evidence and optional modes without exclusions", () => {
    const evaluation = evaluateP012Scenario([
      product("A", 100, "PTMT", [["Comp", 120]]),
      product("B", 100, "OTHER", []),
    ], {
      ...DEFAULT_P012_SCENARIO.policy,
      marginEnabled: false,
      volumeEnabled: false,
      rows: [{ id: "ptmt", order: 1, label: "PTMT", competitor: { mode: "nearest" }, appliesTo: { type: "division", value: "PTMT" }, target: { mode: "below", percent: 5 } }],
    });
    expect(evaluation.summary.rowCounts.ptmt).toEqual({
      scopeMatched: 1, withCompetitorPrice: 1, wouldChange: 1, matchedFySalesValue: 0,
      tierDistribution: { A: 0, B: 0, C: 0, F: 0 },
    });
    expect(evaluation.summary.fallthroughUntouched).toBe(1);
    expect(evaluation.warnings[0]).toContain("No catch-all");
    expect(evaluation.results.every((result) => result.exclusions.length === 0)).toBe(true);
  });

  it("applies usable margin floors without violating movement caps or rounding", () => {
    const marginProduct = {
      ...product("M", 100, "PTMT", [["Comp", 200]]),
      sales: { salesAmount: 1000, qty: 2, qtyUnknown: false },
      margin: { grossMarginPct: 0.4, qty: 2, unitBomValue: 50, discountFrac: 0.1, qtyUnknown: false },
    };
    const policy = {
      ...DEFAULT_P012_SCENARIO.policy,
      marginEnabled: true,
      rounding: { unit: 1, direction: "nearest" as const },
      rows: [{ ...DEFAULT_P012_SCENARIO.policy.rows[0]!, maxIncrease: 100 }],
    };
    expect(evaluateP012Product(marginProduct, policy).suggestedMrp).toBe(190);
    const floorBound = evaluateP012Product({
      ...marginProduct,
      competitors: marginProduct.competitors.map((competitor) => ({ ...competitor, effectivePrice: 160, price: 160 })),
    }, policy);
    expect(floorBound.suggestedMrp).toBe(159);
    const blocked = evaluateP012Product(marginProduct, {
      ...policy,
      rows: [{ ...policy.rows[0]!, maxIncrease: 10 }],
    });
    expect(blocked.status).toBe("no_change");
    expect(blocked.bindingConstraint).toContain("margin floor");
    expect(blocked.exclusions[0]).toContain("conflicts");
  });

  it("assigns volume A/B/C/F tiers and weighted row summaries without changing targets", () => {
    const products = [
      { ...product("A", 100, "PTMT", [["Comp", 110]]), sales: { salesAmount: 80, qty: 1, qtyUnknown: false } },
      { ...product("B", 100, "PTMT", [["Comp", 110]]), sales: { salesAmount: 15, qty: 1, qtyUnknown: false } },
      { ...product("C", 100, "PTMT", [["Comp", 110]]), sales: { salesAmount: 5, qty: 1, qtyUnknown: false } },
      product("F", 100, "PTMT", [["Comp", 110]]),
    ];
    const evaluation = evaluateP012Scenario(products, {
      ...DEFAULT_P012_SCENARIO.policy,
      volumeEnabled: true,
    });
    expect(evaluation.results.map((result) => result.volumeTier)).toEqual(["A", "B", "C", "F"]);
    expect(evaluation.summary.tierDistribution).toEqual({ A: 1, B: 1, C: 1, F: 1 });
    expect(evaluation.summary.rowCounts["default-nearest-below"]?.matchedFySalesValue).toBe(100);
  });

  it("promotes rows losslessly and refuses unrelated Advanced rules", () => {
    const advanced = promoteP012ToAdvanced(DEFAULT_P012_SCENARIO.policy);
    const back = convertAdvancedToP012(advanced);
    expect("policy" in back && back.policy.rows[0]?.id).toBe("default-nearest-below");
    const editedAdvanced = {
      ...advanced,
      simpleRows: advanced.simpleRows.map((row) => ({ ...row, label: "edited" })),
    };
    expect(convertAdvancedToP012(editedAdvanced)).toEqual({
      reasons: ["Advanced policy simple representation has been edited and is no longer lossless."],
    });
    expect(convertAdvancedToP012({ rules: [{ type: "portfolio_constraint" }] })).toEqual({
      reasons: ["Advanced policy contains rules that cannot be represented by an ordered simple table."],
    });
  });
});