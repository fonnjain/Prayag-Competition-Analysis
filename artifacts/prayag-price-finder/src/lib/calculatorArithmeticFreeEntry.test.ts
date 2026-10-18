import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveCalculator, summarizeCalculator, calculatorDisclosures, mrpError,
  CALCULATOR_SCOPE_DISCLOSURE, calculatorCompetitorKey,
  type CalculatorBlock, type CalculatorEvidence,
} from "./calculatorState.ts";

const product: CalculatorEvidence = {
  itemCode: "TTS-01", productName: "Catalogue valve", division: "CP", category: "Valves",
  priceBasis: "MRP · NOS", basis: "MRP", unit: "NOS",
  prayag: { price: 92, effectiveDate: "2026-01-01" },
  variants: [{ variant: "Standard", price: 92, effectiveDate: "2026-01-01", basis: "MRP" }],
  competitors: [{ competitor: "Astral", price: 100, effectiveDate: "2026-01-01",
    priceBasis: "MRP · per 3 m", basis: "MRP", unit: "per 3 m", basisMismatch: false }],
};
const block = (): CalculatorBlock => ({
  id: "b", itemCode: "TTS-01", variant: "Standard", discount: "33.33", quantity: "7",
  competitors: [{ id: "c", competitor: "Astral", discount: "0" }],
});

test("edited MRP drives unit-first arithmetic and reverting restores the app value", () => {
  const b = { ...block(), mrp: "93.00" };
  let r = resolveCalculator([b], [product])[0];
  assert.equal(r.our.priceState, "Edited"); assert.equal(r.our.appPrice, 92);
  assert.equal(r.our.netUnit, 62); assert.equal(r.our.total, 434);
  delete b.mrp;
  r = resolveCalculator([b], [product])[0];
  assert.equal(r.our.priceState, "App"); assert.equal(r.our.netUnit, 61.34); assert.equal(r.our.total, 429.38);
});
test("Entered price on a priceless catalogue product preserves its full product metadata", () => {
  const p = { ...product, prayag: { price: null, effectiveDate: null },
    variants: [{ variant: "Standard", price: null, effectiveDate: null, basis: "MRP" }] };
  const r = resolveCalculator([{ ...block(), mrp: "25.50" }], [p])[0];
  assert.equal(r.our.priceState, "Entered"); assert.equal(r.adHocProduct, false);
  assert.equal(r.product?.division, "CP"); assert.equal(r.product?.category, "Valves");
});
test("unknown exact code stays ad-hoc and has no guessed metadata", () => {
  const b = { ...block(), itemCode: "TTS - 01", mrp: "92", adHocProduct: true, description: "Retailer sample" };
  const r = resolveCalculator([b], [product])[0];
  assert.equal(r.product?.itemCode, "TTS - 01"); assert.equal(r.adHocProduct, true);
  assert.equal(r.product?.productName, "Retailer sample"); assert.equal(r.product?.division, null); assert.equal(r.product?.category, null);
  const known = resolveCalculator([{ ...b, itemCode: "TTS-01" }], [product])[0];
  assert.equal(known.adHocProduct, false); assert.equal(known.product?.productName, "Catalogue valve");
});
test("deliberate ad-hoc Astral never borrows the app quote, basis or amber unit warning", () => {
  const b = block(); b.competitors.push({ id: "one", competitor: "Astral", adHoc: true, mrp: "90", discount: "0" });
  const r = resolveCalculator([b], [product])[0];
  assert.equal(r.competitors[0].unitMismatch, true);
  const c = r.competitors[1];
  assert.equal(c.quote, undefined); assert.equal(c.priceState, "Entered");
  assert.equal(c.appPrice, null); assert.equal(c.effectivePrice, 90);
  assert.equal(c.unitNotRecorded, true); assert.equal(c.warnings.length, 0);
  assert.ok(c.notes.includes("price entered by user — basis and unit unverified"));
  assert.notEqual(calculatorCompetitorKey(c), calculatorCompetitorKey(r.competitors[0]));
});
test("summary states, names and denominator include the ad-hoc product without inflating a compared subtotal", () => {
  const b = block(); b.mrp = "93"; b.competitors.push({ id: "one", competitor: "Shop", adHoc: true, mrp: "100", discount: "0" });
  const a: CalculatorBlock = { ...block(), id: "a", itemCode: "Hand typed", adHocProduct: true,
    description: "One-off", mrp: "50", discount: "0", quantity: "1", competitors: [] };
  const s = summarizeCalculator(resolveCalculator([b, a], [product]));
  assert.deepEqual(s.priceCounts, { App: 1, Edited: 1, Entered: 2 });
  assert.equal(s.assertedPrices, 3); assert.equal(s.products, 2); assert.equal(s.adHocProducts, 1);
  assert.deepEqual(s.adHocCompetitors, ["Shop"]);
  const astral = s.brands.find(b => b.brand === "Astral")!;
  assert.equal(astral.compared, 1); assert.equal(astral.products, 2); assert.equal(astral.adHocProducts, 1);
  assert.equal(astral.ourValue, 434); assert.equal(s.ourValue, 484);
});
test("MRPs require a positive decimal, without an arbitrary upper price cap", () => {
  for (const bad of ["", "0", "-1", "1.123", "NaN", "Infinity", "1e3"]) assert.ok(mrpError(bad), bad);
  for (const good of ["0.01", "28.00", "10000000.99"]) assert.equal(mrpError(good), null);
});
test("disclosures replace the old bucket claim, rather than silently dropping the disclosure", () => {
  const s = summarizeCalculator(resolveCalculator([block()], [product]));
  const d = calculatorDisclosures(s, "2026-10-18", ["Old bucket-only claim"]);
  assert.ok(d.includes(CALCULATOR_SCOPE_DISCLOSURE));
  assert.ok(!d.includes("Old bucket-only claim"));
  assert.ok(d.includes("Prices resolved as of 18-10-2026."));
});
