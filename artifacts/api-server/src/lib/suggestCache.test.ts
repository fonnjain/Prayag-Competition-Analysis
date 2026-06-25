import { describe, expect, it, beforeEach, vi } from "vitest";
import { buildCandidate, type CatalogCandidate } from "./suggest.js";
import {
  catalogVersion,
  topSuggestionTier,
  resetSuggestionTierCache,
} from "./suggestCache.js";

function candidate(over: Partial<Parameters<typeof buildCandidate>[0]> = {}) {
  return buildCandidate({
    itemCode: "C20",
    productName: "PVC COUPLER 20 mm",
    category: "FITTINGS",
    division: "CPVC",
    size: null,
    currentMrp: 10,
    ...over,
  });
}

const ROW = { category: "FITTINGS", description: "COUPLER 20", size: "20" };

describe("catalogVersion", () => {
  it("is stable for the same catalog and changes when a field changes", () => {
    const a = [candidate()];
    const b = [candidate()];
    expect(catalogVersion(a)).toBe(catalogVersion(b));

    expect(catalogVersion([candidate({ currentMrp: 99 })])).not.toBe(
      catalogVersion(a),
    );
    expect(catalogVersion([candidate({ productName: "PVC ELBOW 20 mm" })])).not.toBe(
      catalogVersion(a),
    );
    expect(catalogVersion([candidate(), candidate({ itemCode: "C25" })])).not.toBe(
      catalogVersion(a),
    );
  });
});

describe("topSuggestionTier caching", () => {
  beforeEach(() => resetSuggestionTierCache());

  it("returns the same tier as a direct top suggestion", () => {
    const candidates: CatalogCandidate[] = [candidate()];
    const version = catalogVersion(candidates);
    const tier = topSuggestionTier(ROW, candidates, version);
    expect(["high", "medium", "low"]).toContain(tier);
  });

  it("serves a cache hit without re-scoring on repeat calls", () => {
    const candidates: CatalogCandidate[] = [candidate()];
    const version = catalogVersion(candidates);
    const first = topSuggestionTier(ROW, candidates, version);

    // A second call with the same version must not touch the candidate array.
    const trap = new Proxy(candidates, {
      get() {
        throw new Error("scored again on a cache hit");
      },
    });
    expect(topSuggestionTier(ROW, trap, version)).toBe(first);
  });

  it("re-scores when the catalog version changes", () => {
    const v1 = [candidate({ currentMrp: 10 })];
    const ver1 = catalogVersion(v1);
    topSuggestionTier(ROW, v1, ver1);

    // Catalog with no matching product → a different version and a fresh score.
    const v2 = [candidate({ itemCode: "X", productName: "TANK 5000 L", currentMrp: 1 })];
    const ver2 = catalogVersion(v2);
    expect(ver2).not.toBe(ver1);
    expect(topSuggestionTier(ROW, v2, ver2)).toBe("none");
  });

  it("returns 'none' when nothing scores above threshold", () => {
    const candidates = [candidate({ productName: "TANK 5000 L", category: "TANKS" })];
    const version = catalogVersion(candidates);
    expect(
      topSuggestionTier(
        { category: "TAPS", description: "ZZZ UNRELATED", size: null },
        candidates,
        version,
      ),
    ).toBe("none");
  });
});
