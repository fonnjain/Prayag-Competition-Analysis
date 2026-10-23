import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SearchResultsNotice } from "./searchResultsNotice.ts";
import { CALCULATOR_MIN_QUERY_LENGTH, calculatorExactLookupSettled, calculatorSearchReady } from "./calculatorSearchPolicy.ts";
import { CALCULATOR_SEARCH_LIMIT, productSearchResultNotice } from "../../../../lib/formatting/src/productSearch.ts";

const source = (path: string) => readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");
test("both handlers import one shared ranking implementation; neither defines scoring/ordering", () => {
  for (const handler of ["priceCalculator", "priceFinder"]) {
    const text = source(`artifacts/api-server/src/routes/${handler}.ts`);
    assert.match(text, /import[\s\S]*?rankProductSearchRows[\s\S]*?from "@workspace\/formatting"/);
    assert.match(text, /rankProductSearchRows\(/);
    assert.doesNotMatch(text, /function (?:searchScore|productSearchScore|rankProductSearchRows)|score:.*reduce|code\.startsWith/);
    assert.match(text, /productSearchCondition/);
  }
});

test("server total disclosure is wired into the rendered dropdown, with no lower client cap", () => {
  assert.equal(CALCULATOR_SEARCH_LIMIT, 300);
  const picker = source("artifacts/prayag-price-finder/src/components/calculator/ProductPicker.tsx");
  const dropdown = source("artifacts/prayag-price-finder/src/components/ui/searchable-select.tsx");
  assert.match(picker, /productSearchResultNotice\(search\.data\.results\.length, search\.data\.totalCount\)/);
  assert.match(picker, /renderLimit=\{CALCULATOR_SEARCH_LIMIT\}/);
  assert.match(dropdown, /<SearchResultsNotice text=\{resultsNotice\}/);
  assert.ok(dropdown.indexOf("<SearchResultsNotice") < dropdown.indexOf("<CommandList"));
  assert.equal(productSearchResultNotice(300, 701), "Showing the first 300 of 701 matching products — refine your search.");
});

test("renders the capped-query disclosure with the server total, not the old 200-option client cap", () => {
  const text = productSearchResultNotice(300, 4533);
  const html = renderToStaticMarkup(createElement(SearchResultsNotice, { text, testId: "search-total" }));
  assert.match(html, /role="status"/);
  assert.match(html, /Showing the first 300 of 4533 matching products — refine your search\./);
  assert.doesNotMatch(html, /first 200|of 300 matching/);
});

test("each row owns picker state; direct search never carries browse division/category", () => {
  const picker = source("artifacts/prayag-price-finder/src/components/calculator/ProductPicker.tsx");
  const basket = source("artifacts/prayag-price-finder/src/pages/calculator.tsx");
  assert.match(picker, /const \[division, setDivision\] = useState/);
  assert.match(picker, /const \[category, setCategory\] = useState/);
  assert.match(picker, /const \[rawQuery, setRawQuery\] = useState/);
  assert.match(picker, /const search = useCalculatorSearch\(\{ q: query, limit: CALCULATOR_SEARCH_LIMIT, asOf: asOfParam \}/);
  assert.match(basket, /key=\{block\.id\}/);
  // Near matches are offered explicitly; they never establish exact identity.
  assert.match(picker, /exact\.data\?\.exactProduct \?\? null/);
  assert.match(picker, /onChange=\{\(next\) => next != null && onChange/);
});

test("two-character admission rejects broad one-character/blank searches without rewriting exact code strings", () => {
  assert.equal(CALCULATOR_MIN_QUERY_LENGTH, 2);
  for (const q of ["", "1", "P", " ", "  "]) assert.equal(calculatorSearchReady(q), false, q);
  for (const q of ["PS", "32", " A", "A ", "TTS - 01"]) assert.equal(calculatorSearchReady(q), true, q);
  const picker = source("artifacts/prayag-price-finder/src/components/calculator/ProductPicker.tsx");
  assert.match(picker, /mode === "direct" && directSearchReady/);
  assert.match(picker, /calculatorSearchReady\(rawQuery\) && calculatorSearchReady\(query\)/);
  assert.match(picker, /directSearchReady \? search\.data\?\.results \?\? \[\] : \[\]/);
  assert.match(picker, /resultsNotice=\{directSearchReady && search\.data/);
  assert.match(picker, /mode === "exact" && exactSearchReady/);
});

test("a short exact entry settles as a local ad-hoc candidate, never stale server evidence", () => {
  assert.equal(calculatorExactLookupSettled("X", "", false, false), false);
  assert.equal(calculatorExactLookupSettled("", "", false, false), false);
  assert.equal(calculatorExactLookupSettled("X", "X", false, false), true);
  assert.equal(calculatorExactLookupSettled("PS", "PS", false, false), false);
  assert.equal(calculatorExactLookupSettled("PS", "PS", true, true), false);
  assert.equal(calculatorExactLookupSettled("PS", "PS", true, false), true);
  const picker = source("artifacts/prayag-price-finder/src/components/calculator/ProductPicker.tsx");
  assert.match(picker, /const exactProduct = exactSettled && exactSearchReady \?/);
  assert.match(picker, /const nearMatches = exactSettled && exactSearchReady && !exactProduct/);
});
