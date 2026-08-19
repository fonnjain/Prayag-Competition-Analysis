import assert from "node:assert/strict";
import { test } from "node:test";
import { getPriceFinderSearchDisplay } from "./priceFinderSearchState.ts";

test("an unmatched next chip keeps prior products and count visible", () => {
  const priorResult = {
    itemCode: "BIB-COCK",
    productName: "Bib Cock",
    division: "Faucets",
    category: "Bib Cocks",
    currentMrp: 540,
    currentEffectiveDate: "2026-08-01",
    currentValidTo: null,
    upcomingMrp: null,
    upcomingEffectiveDate: null,
    upcomingChangePct: null,
    hasCompetitorData: false,
  };

  const display = getPriceFinderSearchDisplay({
    results: [priorResult],
    totalCount: 1,
    filterSuggestions: [],
    unmatchedFilters: ["misheard term"],
  });

  assert.equal(display.totalCount, 1);
  assert.deepEqual(display.results, [priorResult]);
  assert.equal(display.unmatchedFilter, "misheard term");
});

test("an unmatched first chip has no prior products to retain", () => {
  const display = getPriceFinderSearchDisplay({
    results: [],
    totalCount: 0,
    filterSuggestions: [],
    unmatchedFilters: ["misheard term"],
  });

  assert.equal(display.totalCount, 0);
  assert.deepEqual(display.results, []);
  assert.equal(display.unmatchedFilter, "misheard term");
});