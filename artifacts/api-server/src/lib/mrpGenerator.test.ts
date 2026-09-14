import { describe, expect, it } from "vitest";
import { evaluateProduct, inputFingerprint, matchesScope } from "./mrpGenerator";

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
});