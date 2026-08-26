import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PRICE_FINDER_SELECTION_LIMIT,
  selectedCodesFromParams,
  toggleSelectedCode,
  writeSelectedCodes,
} from "./selectionState.ts";

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