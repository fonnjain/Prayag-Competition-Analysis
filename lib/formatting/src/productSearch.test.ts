import assert from "node:assert/strict";
import test from "node:test";
import {
  rankProductSearchRows, productSearchScore, productSearchVariants,
  PRODUCT_SEARCH_FIELDS, productSearchResultNotice, type ProductSearchRow,
} from "./productSearch.ts";

const row = (item_code: string, product_name = "Pipe", division = "Pipes", category = "CPVC", size: string | null = null): ProductSearchRow =>
  ({ item_code, product_name, division, category, size });

test("PS: every first-ten result is a code prefix; no name/code-substring match outranks any prefix", () => {
  const candidates = [
    row("3272", "Collapsible Waste Pipe"), row("CPS-15", "Concealed Stop Cock"),
    ...Array.from({ length: 114 }, (_, i) => row(`PS-${i + 1}`)),
  ];
  const ranked = rankProductSearchRows(candidates, ["PS"]);
  assert.ok(ranked[0].item_code.startsWith("PS"));
  assert.ok(ranked.slice(0,10).every(r => r.item_code.startsWith("PS")));
  assert.ok(ranked.slice(0,114).every(r => r.item_code.startsWith("PS")));
  assert.ok(ranked.slice(114).every(r => !r.item_code.startsWith("PS")));
});

test("existing Finder normalisation and voice/synonym variants are preserved", () => {
  assert.equal(productSearchScore(row("TTS-01"), "TTS - 01"), 1000);
  assert.ok(productSearchVariants("find one twenty one").includes("121"));
  assert.ok(productSearchVariants("tap").includes("cock"));
  assert.ok(productSearchVariants("ptmt").includes("ptmt & plastic fittings"));
  assert.ok(productSearchVariants("ss").includes("stainless steel"));
  assert.ok(productSearchVariants("half inch").includes('½"'));
  assert.ok(productSearchVariants("three quarter").includes("0.75 inch"));
  assert.deepEqual(PRODUCT_SEARCH_FIELDS, ["item_code", "product_name", "division", "category", "size"]);
});

test("numeric-aware tie order, multiple filters, positive-score filtering and caller order are preserved", () => {
  const candidates = [row("Q10", "Valve"), row("Q2", "Valve"), row("X", "Other", "", ""), row("W", "Other", "", "", "Valve")];
  assert.deepEqual(rankProductSearchRows(candidates, ["Valve"]).map(r => r.item_code), ["Q2", "Q10", "W"]);
  assert.deepEqual(rankProductSearchRows(candidates, []).map(r => r.item_code), candidates.map(r => r.item_code));
  assert.equal(productSearchScore(row("Z", "", "Valves", "", null), "Valve"), 550);
});

test("disclosure uses server total rather than rendered/received count", () => {
  assert.equal(productSearchResultNotice(300, 401), "Showing the first 300 of 401 matching products — refine your search.");
  assert.equal(productSearchResultNotice(147,147), "Showing all 147 matching products.");
  assert.equal(productSearchResultNotice(0,0), "Showing all 0 matching products.");
});
