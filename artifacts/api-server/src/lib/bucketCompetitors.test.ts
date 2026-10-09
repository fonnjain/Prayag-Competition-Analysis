import { describe, expect, it } from "vitest";
import { compileCompetitorRules, competitorAllowed, competitorImpact, competitorOptions, resolveCompetitorRules, hasProductDefinition } from "./bucketCompetitors";
import { matchesBucketRule, resolveBucketCodes, type BucketProduct } from "./bucketMembership";
import { bucketCodeAllowed, bucketExportRows, withBucketContext } from "./bucketFilter";
import { resolveStoredCompetitorName } from "./competitorLoadName";
import { projectCompetitorEvidence, projectFrozenResult } from "./bucketGeneratorEvidence";

// In-memory fixtures only: no catalogue, price, brand, mapping or user inserts.
const product = (itemCode: string, division: string, category: string): BucketProduct => ({
  itemCode, division, category, productName: itemCode, seriesRange: null, isActive: true, discontinuedFrom: null,
});
const catalogue = [product("1", "Pipes & Fittings", "CPVC Pipe"), product("2", "PTMT", "BLAZE 62"), product("3", "Pipes & Fittings", "SWR Pipe")];
const quotes = [
  { id: 1, competitor: "Apollo", matchedPrayagCode: "1", price: 100 },
  { id: 2, competitor: "Prince", matchedPrayagCode: "1", price: 120 },
  { id: 3, competitor: "Sparsh Pearl", matchedPrayagCode: "2", price: 80 },
  { id: 4, competitor: "Apollo", matchedPrayagCode: "3", price: 200 },
];
describe("P053 competitor display rules — no source writes", () => {
  it("computes newly lost-last-quote products, not already-uncovered products", () => {
    const rules = [{ competitor: "Apollo", scope: "everywhere" as const }];
    expect(competitorImpact("excluded", rules, [...catalogue, product("4", "PTMT", "No prices")], quotes))
      .toEqual({ competitorPriceCount: 2, noCompetitorPriceCount: 1 });
    expect(competitorImpact("excluded", [{ competitor: "Sparsh Pearl", scope: "everywhere" }], catalogue, quotes).noCompetitorPriceCount).toBe(1);
  });
  it("does not count already product-excluded rows or double-count overlapping rules", () => {
    const rules = [{ competitor: "Apollo", scope: "everywhere" as const }, { competitor: "Apollo", scope: "division" as const, divisions: ["Pipes & Fittings"] }];
    expect(competitorImpact("excluded", rules, catalogue, quotes, code => code !== "3"))
      .toEqual({ competitorPriceCount: 1, noCompetitorPriceCount: 0 });
  });
  it("supports divisions, normalized categories and additive rules", () => {
    const clauses = compileCompetitorRules([
      { competitor: "Apollo", scope: "division", divisions: ["Pipes & Fittings"] },
      { competitor: "Sparsh Pearl", scope: "category", categories: ["Blaze 62"] },
    ], catalogue);
    expect(competitorAllowed("excluded", clauses, "Apollo", "1")).toBe(false);
    expect(competitorAllowed("excluded", clauses, "Apollo", "2")).toBe(true);
    expect(competitorAllowed("excluded", clauses, "Sparsh Pearl", "2")).toBe(false);
    expect(competitorAllowed("excluded", clauses, "Prince", "1")).toBe(true);
  });
  it("never uses retired aliases to match a different active category", () => {
    const old = { ...product(" 2 ", "Pipes & Fittings", "CPVC Pipe"), isActive: false };
    const clauses = compileCompetitorRules([{ competitor: "Sparsh Pearl", scope: "category", categories: ["CPVC Pipe"] }], [...catalogue, old]);
    expect(competitorAllowed("excluded", clauses, "Sparsh Pearl", "2")).toBe(true);
  });
  it("inverts competitor Included scope, while no competitor rule permits all brands", () => {
    expect(competitorAllowed("included", [], "Apollo", "1")).toBe(true);
    const rules = [{ competitor: "Prince", scope: "division" as const, divisions: ["Pipes & Fittings"] }];
    expect(competitorAllowed("included", compileCompetitorRules(rules, catalogue), "Prince", "1")).toBe(true);
    expect(competitorAllowed("included", compileCompetitorRules(rules, catalogue), "Apollo", "1")).toBe(false);
  });
  it("competitor-only lists select no products and bypass product membership", () => {
    const rule = { competitor: "Apollo", scope: "everywhere" as const };
    expect(matchesBucketRule(catalogue[0], rule)).toBe(false);
    expect(resolveBucketCodes({ parentId: null, rules: [rule], addedCodes: [], removedCodes: [] }, new Map(), catalogue).size).toBe(0);
    withBucketContext({ type: "included", codes: new Set(), banner: "test", productFilterApplied: false }, () => expect(bucketCodeAllowed("1")).toBe(true));
  });
  it("inherits competitor rules without duplicating product membership", () => {
    const parent = { id: "parent", parentId: null, rules: [{ competitor: "Apollo", scope: "everywhere" as const }], addedCodes: [], removedCodes: [] };
    expect(resolveCompetitorRules({ parentId: parent.id, rules: [{ competitor: "Prince", scope: "category", categories: ["CPVC Pipe"] }], addedCodes: [], removedCodes: [] }, new Map([[parent.id, parent]]))).toHaveLength(2);
  });
  it("preserves an empty frozen product whitelist instead of turning it into all products", () => {
    const definition = { parentId: null, rules: [{ competitor: "Apollo", scope: "everywhere" as const, retainProductFilter: true }], addedCodes: [], removedCodes: [] };
    expect(hasProductDefinition(definition, new Map())).toBe(true);
    withBucketContext({ type: "included", codes: new Set(), productFilterApplied: true, banner: "test" }, () => expect(bucketCodeAllowed("1")).toBe(false));
  });
  it("offers each brand only its own priced divisions/categories", () => {
    const options = competitorOptions(["Apollo", "Sparsh Pearl"], catalogue, quotes);
    expect(options[0].divisions).toEqual([{ value: "Pipes & Fittings", count: 2 }]);
    expect(options[1].divisions).toEqual([{ value: "PTMT", count: 1 }]);
    expect(options[1].categories).toEqual([{ value: "BLAZE 62", count: 1 }]);
  });
  it("discloses the loss count and never emits its line at zero", () => {
    for (const count of [0, 1]) withBucketContext({ type: "excluded", codes: new Set(), banner: "Apollo excluded everywhere", noCompetitorPriceCount: count }, () => {
      const rows = bucketExportRows([["item_code"], ["1"]]);
      expect(rows.flat().join(" ").includes("products have no competitor price under this filter")).toBe(count > 0);
    });
  });
  it("reuses P051 stored spellings, explicitly covers Ashirwad, and does not fuzzy-merge new brands", () => {
    const names = ["Ashirvad", "Sparsh Pearl", "Apollo", "Prince"];
    expect(resolveStoredCompetitorName("  ASHIRVAD  ", names).competitor).toBe("Ashirvad");
    expect(resolveStoredCompetitorName("Ashirwad", names)).toMatchObject({ competitor: "Ashirvad", reusedStoredSpelling: true });
    expect(resolveStoredCompetitorName("sparsh-pearl", names).message).toContain("Sparsh Pearl");
    expect(resolveStoredCompetitorName("Astral", names).competitor).toBe("Astral");
    expect(resolveStoredCompetitorName("Jindal", names).competitor).toBe("Jindal");
  });
  it("projects frozen competitor evidence without rewriting or repricing the original", () => {
    const original = { selectedCompetitor: "Apollo", selectedCompetitorPrice: 100, competitorValues: quotes.slice(0, 2), candidateMrp: 130 };
    const saved = JSON.stringify(original);
    withBucketContext({ type: "excluded", codes: new Set(), banner: "test", clauses: [{ competitor: "Apollo", codes: null }] }, () => {
      const projected = projectCompetitorEvidence(original, "1");
      expect(projected.selectedCompetitorPrice).toBeNull();
      expect(projected.competitorValues.map((r: any) => r.competitor)).toEqual(["Prince"]);
      const row = projectFrozenResult({ itemCode: "1", evidence: saved, competitorValues: JSON.stringify(original.competitorValues) });
      expect(JSON.parse(row.competitorValues).map((r: any) => r.competitor)).toEqual(["Prince"]);
      expect(JSON.stringify(original)).toBe(saved);
    });
  });
});
