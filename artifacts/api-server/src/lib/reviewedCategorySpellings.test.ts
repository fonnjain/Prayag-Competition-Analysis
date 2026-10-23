import { describe, expect, it } from "vitest";
import { reviewedCategoryGroups, reviewedCategorySpelling } from "./reviewedCategorySpellings";
import { planCategorySpellings, planNewProductCategories, assertExactCategoryRestoration } from "./categorySpellingGuard";
import { planAuthoritativeClassifications, type AuthoritativePriceRow } from "./authoritativeMrpMaster";

describe("reviewed category cleanup write boundary", () => {
  it("contains exactly twenty case-only decisions and one explicit descriptor correction", () => {
    expect(reviewedCategoryGroups).toHaveLength(21);
    expect(reviewedCategoryGroups.filter(group => group.keep.toLowerCase() === group.remove.toLowerCase())).toHaveLength(20);
  });
  for (const group of reviewedCategoryGroups) {
    for (const division of group.divisions) {
      it(`${division}: new products use ${group.keep}; existing classifications remain exact`, () => {
        const input = { itemCode: "TTS - 01", division, category: group.remove,
          seriesRange: "Original Range", productName: "Original name" };
        const stored = [{ itemCode: "CANONICAL", division, category: group.keep, isActive: true }];
        const plan = planCategorySpellings([input], stored);
        expect(plan.rows[0]).toEqual({ ...input, category: group.keep });
        expect(plan.categorySpellings[0]).toMatchObject({ inputCategory: group.remove, selectedCategory: group.keep });
        expect(reviewedCategorySpelling("Other", group.remove)).toBeUndefined();
        const master = planAuthoritativeClassifications([{
          ...input, series: group.remove, size: null, mrp: 100,
          effectiveDate: "2026-10-23", variant: "Standard",
          ...(division === "CP Fittings / Faucets" || division === "PTMT & Plastic Fittings"
            ? { category: group.remove } : {}),
        } as AuthoritativePriceRow], stored.map(row => ({ ...row, seriesRange: null })));
        expect(master.newProducts[0]?.category).toBe(group.keep);
        expect(master.newProducts[0]?.itemCode).toBe("TTS - 01");
        const existing = { ...input, category: group.remove, isActive: false };
        expect(planNewProductCategories([input], [...stored, existing]).rows[0]).toEqual({
          ...input, category: group.remove, isActive: false,
        });
        const replay = planAuthoritativeClassifications([{
          ...input, series: group.remove, size: null, mrp: 100,
          effectiveDate: "2026-10-23", variant: "Standard",
        } as AuthoritativePriceRow], [{ ...existing, category: group.keep }]);
        expect(replay.newProducts).toHaveLength(0);
        expect(replay.counts.existingProducts).toBe(1);
      });
    }
  }
  it("uses the reviewed spelling even when the first new row is upper case and no stored candidate exists", () => {
    expect(planCategorySpellings([{ division: "Pipes & Fittings", category: "SWR PIPE" }], []).rows[0]?.category).toBe("SWR Pipe");
  });
  it("does not equate an unaccepted near-match item code", () => {
    const rows = planNewProductCategories([{ itemCode: "TTS - 01", division: "Pipes & Fittings", category: "SWR PIPE" }],
      [{ itemCode: "TTS-01", division: "Hardware", category: "Different" }]).rows;
    expect(rows[0]).toMatchObject({ itemCode: "TTS - 01", division: "Pipes & Fittings", category: "SWR Pipe" });
  });
  it("does not silently rewrite a signed inverse snapshot", () => {
    const inverse = [{ division: "Sink", category: "800 Series 304 Super Steel (0.75)" }];
    expect(() => assertExactCategoryRestoration(inverse, [{
      division: "Sink", category: "800 Series 304 Super Steel (0.75 Mm)", isActive: true,
    }])).toThrow(/Exact restoration stopped/);
    expect(inverse[0]?.category).toBe("800 Series 304 Super Steel (0.75)");
  });
  it("retains unrelated category spelling, punctuation and divisions exactly", () => {
    expect(planCategorySpellings([{ division: "Elsewhere", category: "ASPIRE 52" }], []).rows[0]?.category).toBe("ASPIRE 52");
    expect(reviewedCategorySpelling("Sink", "800 Series 304 Super Steel (0.85)")).toBeUndefined();
  });
});
