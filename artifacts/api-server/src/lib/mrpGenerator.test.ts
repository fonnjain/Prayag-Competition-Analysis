import { describe, expect, it } from "vitest";
import {
  DEFAULT_P011_POLICY,
  computeP011Bands,
  evaluateP011Portfolio,
  evaluateP011Product,
  evaluateP011Scenario,
  evaluateProduct,
  inputFingerprint,
  matchesScope,
  validateP011Policy,
  type GeneratorProduct,
} from "./mrpGenerator";
import { hasHeldMarginCoverage } from "./salesApi";

const product = {
  itemCode: "151",
  productName: "Ball Cock 15mm",
  division: "CP Fittings",
  seriesRange: "Ball Cock",
  category: "Valves",
  currentMrp: 336,
  currentDate: "2026-07-01",
  currentRowId: 10,
  competitors: [
    { competitor: "Sparsh Pearl", price: 350, effectivePrice: 350, effectiveDate: "2026-07-01", ageDays: 0, stale: false, matched: true },
  ],
};

describe("Stage 1 MRP generator", () => {
  it("excludes a competitive rule when its required competitor is absent", () => {
    const result = evaluateProduct({ ...product, competitors: [] }, [
      { type: "percent_below", competitor: "Ashirvad", percent: 5 },
    ]);
    expect(result.status).toBe("excluded");
    expect(result.suggestedMrp).toBeNull();
    expect(result.exclusions[0]).toContain("Required competitor price is missing");
    expect(result.trace[0]?.outcome).toBe("blocked");
  });

  it("excludes a product with no approved Standard Prayag MRP even when competitor data exists", () => {
    const result = evaluateProduct({ ...product, currentMrp: null }, [
      { type: "match", competitor: "Sparsh Pearl" },
    ]);
    expect(result.status).toBe("excluded");
    expect(result.suggestedMrp).toBeNull();
    expect(result.exclusions).toContain("Current approved Standard Prayag MRP is missing.");
  });

  it("preserves ordered conflict trace and records the binding limit", () => {
    const result = evaluateProduct(product, [
      { type: "match", competitor: "Sparsh Pearl" },
      { type: "max_increase", percent: 1 },
      { type: "rounding", unit: 5, direction: "nearest" },
    ]);
    expect(result.competitiveTarget).toBe(350);
    expect(result.suggestedMrp).toBe(339.36);
    expect(result.bindingConstraint).toContain("Maximum increase");
    expect(result.trace.map((item) => item.outcome)).toEqual(["fired", "fired", "blocked"]);
    expect(result.trace[2]?.after).toBe(339.36);
  });

  it("keeps a cap active when a later competitive rule raises the target", () => {
    const result = evaluateProduct(product, [
      { type: "max_increase", percent: 1 },
      { type: "match", competitor: "Sparsh Pearl" },
      { type: "rounding", unit: 5, direction: "up" },
    ]);
    expect(result.suggestedMrp).toBe(339.36);
    expect(result.trace.map((item) => item.outcome)).toEqual(["skipped", "blocked", "blocked"]);
    expect(result.trace[1]?.after).toBe(339.36);
  });

  it("intersects repeated increase limits and keeps the strictest binding", () => {
    const result = evaluateProduct(product, [
      { type: "match", competitor: "Sparsh Pearl" },
      { type: "max_increase", percent: 5 },
      { type: "max_increase", percent: 1 },
      { type: "max_increase", percent: 4 },
      { type: "rounding", unit: 5, direction: "up" },
    ]);
    expect(result.suggestedMrp).toBe(339.36);
    expect(result.bindingConstraint).toBe("Maximum increase 1%");
  });

  it("intersects repeated decrease limits and keeps the strictest binding", () => {
    const result = evaluateProduct({
      ...product,
      competitors: [{ ...product.competitors[0]!, effectivePrice: 200, price: 200 }],
    }, [
      { type: "match", competitor: "Sparsh Pearl" },
      { type: "max_decrease", percent: 5 },
      { type: "max_decrease", percent: 10 },
      { type: "max_decrease", percent: 2 },
      { type: "rounding", unit: 5, direction: "down" },
    ]);
    expect(result.suggestedMrp).toBe(329.28);
    expect(result.bindingConstraint).toBe("Maximum decrease 2%");
  });

  it("is deterministic for identical inputs and makes missing Sales rules explicit", () => {
    const rules = [
      { type: "margin_floor", percent: 45 },
      { type: "volume_tier", tier: "top" },
      { type: "match", competitor: "Sparsh Pearl" },
    ];
    const a = evaluateProduct(product, rules);
    const b = evaluateProduct(product, rules);
    expect(a).toEqual(b);
    expect(a.trace.slice(0, 2).map((item) => item.outcome)).toEqual(["blocked", "blocked"]);
    expect(inputFingerprint(a)).toBe(inputFingerprint(b));
  });

  it("supports scope dimensions and explicit product codes", () => {
    expect(matchesScope(product, { division: "CP Fittings", explicitCodes: ["151"] })).toBe(true);
    expect(matchesScope(product, { category: "Sanitaryware" })).toBe(false);
    expect(matchesScope(product, { competitorMapped: true })).toBe(true);
  });

  it("carries the visible stale flag from a dated competitor input", () => {
    const result = evaluateProduct({
      ...product,
      competitors: [{ ...product.competitors[0]!, effectiveDate: "2025-03-01", ageDays: 548, stale: true }],
    }, [{ type: "match", competitor: "Sparsh Pearl" }]);
    expect(result.competitorValues[0]?.stale).toBe(true);
  });

  it("uses unit BOM for margin-floor MRP and does not multiply by quantity", () => {
    const result = evaluateProduct({
      ...product,
      currentMrp: 50,
      margin: {
        grossMarginPct: 0.2,
        bomValue: 1000,
        unitBomValue: 100,
        qtyUnknown: false,
        discountFrac: 0,
      },
    }, [{ type: "margin_floor", categoryFloors: { "C P": 50 } }]);
    expect(result.suggestedMrp).toBe(200);
    expect(result.suggestedMrp).not.toBe(2000);
  });

  it("excludes a margin-floor product when quantity is unusable", () => {
    const result = evaluateProduct({
      ...product,
      margin: { grossMarginPct: 0.2, bomValue: 1000, unitBomValue: null, qtyUnknown: true },
    }, [{ type: "margin_floor", categoryFloors: { "C P": 50 } }]);
    expect(result.status).toBe("excluded");
    expect(result.exclusions.join(" ")).toContain("unit BOM evidence or usable quantity is missing");
  });

  it("only treats explicitly scoped PTMT H1 coverage as a PTMT hold", () => {
    expect(hasHeldMarginCoverage({ held: ["H1 hold"] }, "CP Fittings")).toBe(false);
    expect(hasHeldMarginCoverage({ held: ["PTMT H1 hold"] }, "CP Fittings")).toBe(false);
    expect(hasHeldMarginCoverage({ held: ["PTMT H1 hold"] }, "PTMT")).toBe(true);
  });
});

describe("P011 policy engine", () => {
  const soldProduct = (itemCode: string, salesAmount: number): GeneratorProduct => ({
    itemCode, productName: itemCode, division: "PTMT", category: "PTMT",
    currentMrp: 100, currentDate: "2026-07-01", competitors: [], sales: {
      salesAmount, qty: 10, qtyUnknown: false, fySalesExists: true,
    },
  });

  it("rejects inclusive category floors and floor-plus-uplift at 100%", () => {
    expect(() => validateP011Policy({
      ...DEFAULT_P011_POLICY,
      categoryFloors: { ...DEFAULT_P011_POLICY.categoryFloors, PTMT: 100 },
    })).toThrow(/below 100/);
    expect(() => validateP011Policy({
      ...DEFAULT_P011_POLICY,
      categoryFloors: { ...DEFAULT_P011_POLICY.categoryFloors, PTMT: 90 },
      marginTargetUpliftPoints: 10,
    })).toThrow(/remain below 100/);
  });

  it("turns non-finite product evidence into an explicit safe result", () => {
    const invalidCurrent = evaluateP011Product({
      ...soldProduct("INVALID-CURRENT", 100),
      currentMrp: Number.NaN,
    }, "A");
    const invalidCompetitor = evaluateP011Product({
      ...soldProduct("INVALID-COMPETITOR", 100),
      competitors: [{ competitor: "Comp", price: Number.NaN, effectivePrice: Number.POSITIVE_INFINITY,
        effectiveDate: "2026-07-01", ageDays: 0, stale: false, matched: true }],
    }, "A");
    const invalidMargin = evaluateP011Product({
      ...soldProduct("INVALID-MARGIN", 100),
      margin: { grossMarginPct: Number.NaN, unitBomValue: 70, qtyUnknown: false, discountFrac: 0 },
    }, "A");
    for (const result of [invalidCurrent, invalidCompetitor, invalidMargin]) {
      expect(["excluded", "no_change"]).toContain(result.status);
      expect(["EXCLUDED", "REVIEW"]).toContain(result.action);
      expect(result.suggestedMrp).toBeNull();
      expect(JSON.stringify(result)).not.toMatch(/NaN|Infinity/);
    }
    expect(invalidCurrent.action).toBe("EXCLUDED");
    expect(invalidCompetitor.action).toBe("REVIEW");
    expect(invalidMargin.action).toBe("REVIEW");
  });

  it("creates A-E by cumulative taxable value and keeps no-sales catalogue items in F", () => {
    // The first 546 codes are exactly 80% of taxable FY value. Equal-value
    // ties use item code, so this fixture also protects the stable boundary.
    const products = [
      ...Array.from({ length: 546 }, (_, index) => soldProduct(`H${String(index + 1).padStart(4, "0")}`, 1)),
      ...Array.from({ length: 273 }, (_, index) => soldProduct(`T${String(index + 1).padStart(4, "0")}`, 0.5)),
      soldProduct("NO-SALES", 0),
    ];
    const bands = computeP011Bands(products);
    const total = products.reduce((sum, item) => sum + (item.sales?.salesAmount ?? 0), 0);
    const first546 = products.slice(0, 546).reduce((sum, item) => sum + (item.sales?.salesAmount ?? 0), 0);
    expect(first546 / total).toBeCloseTo(0.8, 12);
    expect(bands.get("H0001")).toBe("A");
    expect(bands.get("H0546")).toBe("B");
    expect(bands.get("T0001")).toBe("C");
    expect([...bands.values()].filter((band) => band === "A")).toHaveLength(341);
    expect([...bands.values()].filter((band) => band === "B")).toHaveLength(205);
    expect([...bands.values()].filter((band) => band === "C")).toHaveLength(204);
    expect([...bands.values()].filter((band) => band === "D")).toHaveLength(55);
    expect([...bands.values()].filter((band) => band === "E")).toHaveLength(14);
    expect([...bands.entries()].filter(([, band]) => band === "A")
      .reduce((sum, [code]) => sum + products.find((item) => item.itemCode === code)!.sales!.salesAmount, 0)).toBe(341);
    expect([...bands.entries()].filter(([, band]) => band === "B")
      .reduce((sum, [code]) => sum + products.find((item) => item.itemCode === code)!.sales!.salesAmount, 0)).toBe(205);
    // Equal taxable-value ties are resolved by item code, not input order.
    const shuffled = [...products].reverse();
    expect(computeP011Bands(shuffled).get("H0001")).toBe("A");
    expect(computeP011Bands(shuffled).get("H0546")).toBe("B");
    expect(bands.get("NO-SALES")).toBe("F");
  });

  it("applies the nine grouped head/middle/tail position cells", () => {
    const expected: Array<[string, Array<"A" | "B" | "C" | "D" | "E">, string, string]> = [
      ["head", ["A", "B"], "well_below", "CAPTURE"], ["head", ["A", "B"], "parity", "HOLD"], ["head", ["A", "B"], "above", "DEFEND"],
      ["middle", ["C"], "well_below", "CAPTURE"], ["middle", ["C"], "parity", "HOLD"], ["middle", ["C"], "above", "REVIEW"],
      ["tail", ["D", "E"], "well_below", "CAPTURE"], ["tail", ["D", "E"], "parity", "HOLD"], ["tail", ["D", "E"], "above", "LEAVE_ALONE"],
    ];
    for (const [group, bands, position, action] of expected) {
      const competitorPrice = position === "well_below" ? 120 : position === "parity" ? 105 : 95;
      for (const representative of bands) {
        const result = evaluateP011Product({
          ...soldProduct(`${group}-${representative}-${position}`, 100),
          competitors: [{ competitor: "Comp", price: competitorPrice, effectivePrice: competitorPrice,
            effectiveDate: "2026-07-01", ageDays: 0, stale: false, matched: true }],
        }, representative);
        expect(result.action).toBe(action);
      }
    }
  });

  it("selects nearest, lowest, and named competitors without stale substitution", () => {
    const base = {
      ...soldProduct("SELECT", 100),
      competitors: [
        { competitor: "Near", price: 108, effectivePrice: 108, effectiveDate: "2026-07-01", ageDays: 0, stale: false, matched: true },
        { competitor: "Low", price: 70, effectivePrice: 70, effectiveDate: "2026-07-01", ageDays: 0, stale: false, matched: true },
        { competitor: "Named", price: 140, effectivePrice: 140, effectiveDate: "2026-07-01", ageDays: 0, stale: false, matched: true },
      ],
    };
    expect(evaluateP011Product(base, "A", { ...DEFAULT_P011_POLICY, competitor: { mode: "nearest", named: null, staleAfterDays: 365, excludeStale: true } }).selectedCompetitor).toBe("Near");
    expect(evaluateP011Product(base, "A", { ...DEFAULT_P011_POLICY, competitor: { mode: "lowest", named: null, staleAfterDays: 365, excludeStale: true } }).selectedCompetitor).toBe("Low");
    expect(evaluateP011Product(base, "A", { ...DEFAULT_P011_POLICY, competitor: { mode: "named", named: "Named", staleAfterDays: 365, excludeStale: true } }).selectedCompetitor).toBe("Named");
    const staleNamed = evaluateP011Product({
      ...soldProduct("STALE", 100),
      competitors: [{ competitor: "Named", price: 200, effectivePrice: 200,
        effectiveDate: "2025-01-01", ageDays: 400, stale: false, matched: true }],
    }, "A", { ...DEFAULT_P011_POLICY, competitor: { mode: "named", named: "Named", staleAfterDays: 365, excludeStale: true } });
    expect(staleNamed.action).toBe("EXCLUDED");
    expect(staleNamed.exclusions.join(" ")).toContain("Margin-only fallback");
  });

  it("supports margin-only fallback separately from missing-margin exclusion", () => {
    const fallback = evaluateP011Product({
      ...soldProduct("MARGIN-ONLY", 100),
      margin: { grossMarginPct: 0.2, unitBomValue: 70, qtyUnknown: false, discountFrac: 0.1 },
    }, "A", { ...DEFAULT_P011_POLICY, categoryFloors: { PTMT: 30 }, marginTargetUpliftPoints: 5 });
    expect(fallback.action).toBe("MARGIN_ONLY");
    expect(fallback.suggestedMrp).toBe(115);
    expect(fallback.competitiveTarget).toBeCloseTo(70 / (1 - 0.35) / (1 - 0.1), 8);
    expect(fallback.escalation).toBe(true);
    expect(fallback.bindingConstraints).toContain("maximum increase 15%");
    expect(fallback.escalationReason).toContain("margin floor");
    const missing = evaluateP011Product(soldProduct("MARGIN-MISSING", 100), "A");
    expect(missing.action).toBe("EXCLUDED");
    expect(missing.exclusions.join(" ")).toContain("usable quantity, unit BOM cost, and discount");
  });

  it("holds small MRP, preserves caps and rounding, and persists floor binding", () => {
    const small = evaluateP011Product({
      ...soldProduct("SMALL", 100), currentMrp: 49,
      competitors: [{ competitor: "Comp", price: 200, effectivePrice: 200, effectiveDate: "2026-07-01", ageDays: 0, stale: false, matched: true }],
    }, "A");
    expect(small.action).toBe("HOLD");
    expect(small.suggestedMrp).toBeNull();
    const increase = evaluateP011Product({
      ...soldProduct("CAP-INCREASE", 100),
      competitors: [{ competitor: "Comp", price: 200, effectivePrice: 200, effectiveDate: "2026-07-01", ageDays: 0, stale: false, matched: true }],
    }, "A", { ...DEFAULT_P011_POLICY, maxIncreasePercent: 10 });
    expect(increase.suggestedMrp).toBe(110);
    expect(increase.competitiveTarget).toBe(130);
    expect(increase.bindingConstraints).toContain("maximum increase 10%");
    const decrease = evaluateP011Product({
      ...soldProduct("CAP-DECREASE", 100),
      competitors: [{ competitor: "Comp", price: 90, effectivePrice: 90, effectiveDate: "2026-07-01", ageDays: 0, stale: false, matched: true }],
    }, "A", { ...DEFAULT_P011_POLICY, maxDecreasePercent: 5 });
    expect(decrease.suggestedMrp).toBe(95);
    expect(decrease.bindingConstraints).toContain("maximum decrease 5%");
    const rounded = evaluateP011Product({
      ...soldProduct("ROUND", 100), currentMrp: 101,
      competitors: [{ competitor: "Comp", price: 150, effectivePrice: 150, effectiveDate: "2026-07-01", ageDays: 0, stale: false, matched: true }],
    }, "A");
    expect(rounded.suggestedMrp).toBe(116);
  });

  it("holds a defend result at the category floor with a complete escalation sentence", () => {
    const result = evaluateP011Product({
      ...soldProduct("FLOOR", 100),
      currentMrp: 300,
      competitors: [{ competitor: "Comp", price: 100, effectivePrice: 100,
        effectiveDate: "2026-07-01", ageDays: 0, stale: false, matched: true }],
      margin: { grossMarginPct: 0.2, unitBomValue: 100, qtyUnknown: false, discountFrac: 0 },
    }, "A");
    expect(result.action).toBe("DEFEND");
    expect(result.competitiveTarget).toBe(98);
    expect(result.suggestedMrp).toBeGreaterThanOrEqual(result.marginFloorEvidence!.minimumMrp!);
    expect(result.escalation).toBe(true);
    expect(result.escalationReason).toContain("Comp");
    expect(result.escalationReason).toContain("2%");
    expect(result.escalationReason).toContain("65%");
    expect(result.escalationReason).toContain("₹");
    expect(result.bindingConstraints?.some((constraint) => constraint.startsWith("category margin floor"))).toBe(true);
    expect(result.suggestedMrp! % 1).toBe(0);
  });

  it("escalates an infeasible DEFEND floor/cap intersection without suggesting an invalid MRP", () => {
    const result = evaluateP011Product({
      ...soldProduct("INFEASIBLE-DEFEND", 100),
      currentMrp: 200,
      competitors: [{ competitor: "Comp", price: 100, effectivePrice: 100,
        effectiveDate: "2026-07-01", ageDays: 0, stale: false, matched: true }],
      margin: { grossMarginPct: 0.2, unitBomValue: 100, qtyUnknown: false, discountFrac: 0 },
    }, "A");
    expect(result.action).toBe("REVIEW");
    expect(result.competitiveTarget).toBe(98);
    expect(result.status).toBe("no_change");
    expect(result.suggestedMrp).toBeNull();
    expect(result.escalation).toBe(true);
    expect(result.bindingConstraints).toEqual(expect.arrayContaining([
      expect.stringContaining("category margin floor"),
      expect.stringContaining("maximum increase 15%"),
    ]));
    expect(result.escalationReason).toContain("No feasible automatic DEFEND price");
    expect(result.escalationReason).toContain("both");
    expect(result.escalationReason).toContain("₹230");
    expect(result.marginFloorEvidence?.minimumMrp).toBeCloseTo(285.714, 2);
    expect(result.trace.at(-1)?.outcome).toBe("blocked");
  });

  it("reports met and unmet portfolio targets, ranked headroom, and omissions", () => {
    const capture = {
      ...soldProduct("HEADROOM", 100),
      competitors: [{ competitor: "Comp", price: 200, effectivePrice: 200, effectiveDate: "2026-07-01", ageDays: 0, stale: false, matched: true }],
      margin: { grossMarginPct: 0.5, saleValue: 1000, unitBomValue: 50, qtyUnknown: false, discountFrac: 0 },
    };
    const hold = {
      ...soldProduct("HOLD", 50),
      competitors: [{ competitor: "Comp", price: 105, effectivePrice: 105, effectiveDate: "2026-07-01", ageDays: 0, stale: false, matched: true }],
      margin: { grossMarginPct: 0.5, saleValue: 1000, unitBomValue: 50, qtyUnknown: false, discountFrac: 0 },
    };
    const evaluated = [evaluateP011Product(capture, "A"), evaluateP011Product(hold, "C")];
    const met = evaluateP011Portfolio([capture, hold], evaluated, { ...DEFAULT_P011_POLICY, portfolio: { mode: "improve_by_points", points: 1 } });
    expect(met.currentGrossMargin).toBeCloseTo(0.5, 8);
    expect(met.proposedGrossMargin).toBeGreaterThan(met.currentGrossMargin!);
    expect(met.deltaPoints).toBeGreaterThan(0);
    expect(met.targetGrossMargin).toBeCloseTo(0.51, 8);
    expect(met.targetMet).toBe(true);
    expect(met.actionValueImpacts.CAPTURE.count).toBe(1);
    expect(met.actionValueImpacts.CAPTURE.grossContributionDelta).toBeGreaterThan(0);
    expect(met.actionValueImpacts.CAPTURE.grossContributionDelta).not.toBe(
      (evaluated[0]!.suggestedMrp ?? capture.currentMrp)! - capture.currentMrp!,
    );
    const unmet = evaluateP011Portfolio([
      capture,
      hold,
      { ...soldProduct("NO-QTY", 25), sales: { salesAmount: 25, qty: null, qtyUnknown: true, fySalesExists: true }, margin: hold.margin },
      { ...soldProduct("NO-COST", 10), margin: { ...hold.margin, unitBomValue: null } },
      soldProduct("NO-SALES", 0),
    ], [...evaluated,
      evaluateP011Product(soldProduct("NO-QTY", 25), "A"),
      evaluateP011Product(soldProduct("NO-COST", 10), "A"),
      evaluateP011Product(soldProduct("NO-SALES", 0), "F"),
    ], { ...DEFAULT_P011_POLICY, maxIncreasePercent: 100, portfolio: { mode: "improve_by_points", points: 20 } });
    expect(unmet.targetMet).toBe(false);
    expect(unmet.shortfallPoints).toBeGreaterThan(0);
    expect(unmet.headroom[0]?.itemCode).toBe("HEADROOM");
    expect(unmet.headroom[0]?.additionalGrossContribution).toBeGreaterThan(0);
    expect(unmet.headroom[0]?.additionalRealizedSaleValue).toBeGreaterThan(0);
    expect(unmet.omittedByReason["missing usable quantity"]?.count).toBe(1);
    expect(unmet.omittedByReason["missing unit BOM cost"]?.count).toBe(1);
    expect(unmet.omittedByReason["band F/no FY sales"]?.count).toBe(1);
    expect(unmet.coveredSalesValue).toBe(150);
  });

  it("returns explicit F results and repeats deterministically", () => {
    const products = [soldProduct("A", 80), soldProduct("B", 20), soldProduct("F", 0)];
    const first = evaluateP011Scenario(products, DEFAULT_P011_POLICY);
    const second = evaluateP011Scenario(products, DEFAULT_P011_POLICY);
    expect(first.results.find((result) => result.itemCode === "F")).toEqual(expect.objectContaining({
      band: "F", action: "EXCLUDED", status: "excluded",
    }));
    expect(first.results.find((result) => result.itemCode === "F")!.exclusions.join(" ")).toContain("band F");
    expect(first).toEqual(second);
    expect(inputFingerprint({ products, policy: DEFAULT_P011_POLICY, output: first })).toBe(
      inputFingerprint({ products, policy: DEFAULT_P011_POLICY, output: second }),
    );
  });
});