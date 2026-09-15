import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PRICE_FINDER_SELECTION_LIMIT,
  selectedCodesFromParams,
  toggleSelectedCode,
  writeSelectedCodes,
} from "./selectionState.ts";
import {
  comparisonStateFromParams,
  localPriceFinderUrl,
  normalizePriceFinderParams,
  updateComparisonParams,
} from "./priceFinderRouteState.ts";

test("selection query state keeps unique codes and caps a shared URL at 50", () => {
  const params = new URLSearchParams();
  for (let index = 0; index < 55; index++) params.append("code", `P-${index}`);
  params.append("code", "P-1");

  const codes = selectedCodesFromParams(params);
  assert.equal(codes.length, PRICE_FINDER_SELECTION_LIMIT);
  assert.equal(codes[1], "P-1");
});

test("toggling selection preserves unrelated query parameters and reports the limit", () => {
  const current = Array.from({ length: PRICE_FINDER_SELECTION_LIMIT }, (_, index) => `P-${index}`);
  const limited = toggleSelectedCode(current, "P-new");
  assert.equal(limited.ok, false);
  assert.deepEqual(limited.codes, current);

  const removed = toggleSelectedCode(current, "P-2");
  assert.equal(removed.ok, true);
  assert.equal(removed.codes.includes("P-2"), false);

  const params = writeSelectedCodes(new URLSearchParams("filter=ball"), removed.codes);
  assert.equal(params.get("filter"), "ball");
  assert.equal(params.getAll("code").length, PRICE_FINDER_SELECTION_LIMIT - 1);
});

test("comparison URLs normalize duplicate, blank, excessive, and unsupported values", () => {
  const params = new URLSearchParams("code=A&code=&code=A&filter=basin&competitor=Unknown&asOf=2026-02-30&extra=x");
  for (let index = 0; index < 55; index++) params.append("code", `P-${index}`);

  const normalized = normalizePriceFinderParams(params, "comparison");
  assert.equal(normalized.getAll("code").length, PRICE_FINDER_SELECTION_LIMIT);
  assert.deepEqual(normalized.getAll("competitor"), ["Sparsh Pearl"]);
  assert.equal(normalized.get("asOf"), null);
  assert.equal(normalized.get("extra"), null);
  assert.equal(localPriceFinderUrl("/comparison", normalized).startsWith("/comparison?"), true);
});

test("comparison changes and back-to-search preserve selection and search context", () => {
  const initial = new URLSearchParams("code=A&code=B&filter=basin&competitor=Vectus&asOf=2026-08-29");
  const changed = updateComparisonParams(initial, ["Sparsh Pearl", "Vectus"], "2026-08-28");
  const state = comparisonStateFromParams(changed);

  assert.deepEqual(changed.getAll("code"), ["A", "B"]);
  assert.deepEqual(changed.getAll("filter"), ["basin"]);
  assert.deepEqual(state.competitors, ["Sparsh Pearl", "Vectus"]);
  assert.equal(state.asOf, "2026-08-28");

  const search = normalizePriceFinderParams(changed, "search");
  assert.deepEqual(search.getAll("code"), ["A", "B"]);
  assert.equal(search.get("filter"), "basin");
  assert.deepEqual(search.getAll("competitor"), ["Sparsh Pearl", "Vectus"]);
  assert.equal(search.get("asOf"), "2026-08-28");
});

test("comparison route state preserves Prince alongside existing competitors", () => {
  const state = comparisonStateFromParams(new URLSearchParams(
    "competitor=Sparsh%20Pearl&competitor=Ashirvad&competitor=Prince&competitor=Vectus",
  ));
  assert.deepEqual(state.competitors, ["Sparsh Pearl", "Ashirvad", "Prince", "Vectus"]);
});