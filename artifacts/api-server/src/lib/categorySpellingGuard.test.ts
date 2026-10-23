import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { planCategorySpellings, planNewProductCategories, assertCategorySpellingPreview,
  assertCategorySpellingPlan, assertExactCategoryRestoration } from "./categorySpellingGuard";
import { planAuthoritativeClassifications, type AuthoritativePriceRow } from "./authoritativeMrpMaster";

const stored = [
  { itemCode: "A", division: "Fixtures", category: "Shower Fittings", isActive: true, seriesRange: "Original" },
  { itemCode: "B", division: "Fixtures", category: "Shower Fittings", isActive: true },
  { itemCode: "C", division: "Fixtures", category: "Shower Fittings", isActive: false },
  { itemCode: "D", division: "Fixtures", category: "SHOWER-FITTING", isActive: true },
  { itemCode: "E", division: "Other", category: "shower fitting", isActive: true },
];
const incoming = (category: string) => ({ itemCode: "NEW", division: "Fixtures", category, seriesRange: null });
const writers = ["authoritative master", "generic importer", "bulk new-products", "single editor", "sync", "seed/reset"];
describe.each(writers)("%s spelling contract", writer => {
  const plan = (category: string, rows = stored) => {
    if (writer === "authoritative master") {
      const result = planAuthoritativeClassifications([{ ...incoming(category), series: category, productName: "Fixture",
        size: null, mrp: 100, effectiveDate: "2026-10-01", variant: "Standard" } as AuthoritativePriceRow],
        rows.map(row => ({ ...row, seriesRange: row.seriesRange ?? null })));
      return { rows: result.newProducts, categorySpellings: result.categorySpellings, categorySpellingFingerprint: result.categorySpellingFingerprint };
    }
    if (writer === "sync" || writer === "seed/reset") return planNewProductCategories([incoming(category)], rows);
    return planCategorySpellings([incoming(category)], rows);
  };
  it("matched: writes stored spelling and shows input and output", () => {
    const result = plan("  shower fittings  ", [stored[0]!]);
    expect(result.rows[0]!.category).toBe("Shower Fittings");
    expect(result.categorySpellings[0]).toMatchObject({ status: "matched existing spelling",
      inputCategory: writer === "authoritative master" ? "shower fittings" : "  shower fittings  ", selectedCategory: "Shower Fittings", candidates: [{ category: "Shower Fittings", activeProducts: 1 }] });
  });
  it("new: marks a genuinely new category for normal admin approval", () => {
    const result = plan("Drain Accessories");
    expect(result.rows[0]!.category).toBe("Drain Accessories");
    expect(result.categorySpellings[0]).toMatchObject({ status: "new", candidates: [] });
    expect(result.categorySpellings[0]!.selectionReason).toContain("administrator approval");
  });
  it("two existing: more active wins even when input exactly matches the less-used spelling", () => {
    const result = plan("SHOWER-FITTING");
    expect(result.rows[0]!.category).toBe("Shower Fittings");
    expect(result.categorySpellings[0]!.candidates).toEqual([
      { category: "Shower Fittings", activeProducts: 2 }, { category: "SHOWER-FITTING", activeProducts: 1 },
    ]);
  });
});
describe.each(["fixed correction", "correction undo", "deletion undo"])("%s immutable-value guard", () => {
  it("matched: detects a different spelling, rejects, and never rewrites the snapshot", () => {
    const row = incoming("shower fitting");
    expect(() => assertExactCategoryRestoration([row], [stored[0]!])).toThrow("Snapshot was not rewritten");
    expect(row.category).toBe("shower fitting");
    expect(assertExactCategoryRestoration([incoming("Shower Fittings")], [stored[0]!]).categorySpellings[0]!.status).toBe("matched existing spelling");
  });
  it("new: exact signed text can pass the existing admin-controlled workflow", () => {
    expect(assertExactCategoryRestoration([incoming("New Signed Category")], stored).categorySpellings[0]!.status).toBe("new");
  });
  it("two existing: canonical snapshot passes, less-used snapshot stops with every count", () => {
    expect(assertExactCategoryRestoration([incoming("Shower Fittings")], stored).categorySpellings[0]!.candidates).toHaveLength(2);
    expect(() => assertExactCategoryRestoration([incoming("SHOWER-FITTING")], stored)).toThrow('"activeProducts":2');
  });
});
it("exact division, not normalised division, defines the matching boundary", () => {
  const result = planCategorySpellings([{ ...incoming("shower fitting"), division: "FIXTURES" }], stored);
  expect(result.categorySpellings[0]!.status).toBe("new");
});
it("ties stop; changed counts or spellings invalidate a pending approval", () => {
  const preview = planCategorySpellings([incoming("shower fittings")], stored);
  expect(() => assertCategorySpellingPreview(preview.categorySpellingFingerprint,
    planCategorySpellings([incoming("shower fittings")], stored.slice(1)))).toThrow("ambiguous");
  expect(() => assertCategorySpellingPreview(undefined, preview)).toThrow("Preview again");
  expect(() => assertCategorySpellingPlan(planCategorySpellings([incoming("shower fittings")], [stored[0]!, stored[3]!]))).toThrow("ambiguous");
});
it("P049 preserves existing Category, Range and division including nulls for an exact item code", () => {
  const current = { itemCode: "OLD", division: null, category: null, seriesRange: null, isActive: false };
  const result = planNewProductCategories([{ itemCode: "OLD", division: "Wrong", category: "Wrong", seriesRange: "Wrong", isActive: true }], [current]);
  expect(result.rows[0]).toMatchObject({ division: null, category: null, seriesRange: null, isActive: false });
  expect(result.categorySpellings).toEqual([]);
});
it("same-batch equivalent new categories use the first approved spelling", () => {
  const result = planCategorySpellings([incoming("Drain Fittings"), { ...incoming("DRAIN-FITTING"), itemCode: "NEW2" }], []);
  expect(result.rows.map(row => row.category)).toEqual(["Drain Fittings", "Drain Fittings"]);
  expect(result.categorySpellings.every(row => row.status === "new")).toBe(true);
});
it("exact legacy item codes remain distinct; unmatched spelling never inherits classification", () => {
  const current = [
    { itemCode: "Ab", division: "One", category: "First", seriesRange: "First Range" },
    { itemCode: "AB", division: "Two", category: "Second", seriesRange: "Second Range" },
  ];
  const result = planNewProductCategories(current.map(row => ({ ...row, category: "Wrong", division: "Wrong" })), current);
  expect(result.rows).toEqual(current);
  const unmatched = { ...current[0]!, itemCode: "a b" };
  expect(planNewProductCategories([unmatched], current).rows[0]).toEqual(unmatched);
});
it.each(["apply", "undo"])("signed %s locks correction then vocabulary once, in consistent order", action => {
  const importer = readFileSync(new URL("../routes/catalogImportExport.ts", import.meta.url), "utf8");
  const marker = `router.post("/catalog/ugd-classification/:correctionKey/${action}"`;
  const handler = importer.slice(importer.indexOf(marker)).split("\nrouter.post(")[0]!;
  const correctionLock = handler.indexOf("pg_advisory_xact_lock(929007)");
  const vocabularyLock = handler.indexOf("await lockCategorySpellings(tx)");
  expect(correctionLock).toBeGreaterThan(-1);
  expect(vocabularyLock).toBeGreaterThan(correctionLock);
  expect(handler.match(/await lockCategorySpellings\(tx\)/g)).toHaveLength(1);
});
it("all Part 0 audited application paths are guarded or explicitly retired", () => {
  const source = (file: string) => readFileSync(resolve("../..", file), "utf8");
  expect(source("artifacts/api-server/src/lib/authoritativeMrpMaster.ts")).toContain("planCategorySpellings(");
  const importer = source("artifacts/api-server/src/routes/catalogImportExport.ts");
  expect(importer).toContain("assertCategorySpellingPreview(");
  expect(importer).not.toContain("backfillMap");
  expect(importer.match(/assertExactCategoryRestoration\(/g)).toHaveLength(3);
  expect(source("artifacts/api-server/src/routes/priceEditor.ts")).toContain("categoryPlan.rows[0]!.category");
  for (const name of ["catalogSync", "catalogSeed"]) expect(source(`artifacts/api-server/src/lib/${name}.ts`)).toContain("planNewProductCategories(");
  expect(source("artifacts/api-server/src/routes/productLifecycle.ts")).toContain("assertExactCategoryRestoration(");
  for (const name of [".local/reload-verified.mjs", ".local/erase_and_load_sparsh.py"])
    expect(source(name)).toContain("Unsupported");
});