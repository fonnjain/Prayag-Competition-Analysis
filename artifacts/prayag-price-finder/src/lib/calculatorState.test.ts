import assert from "node:assert/strict";
import test from "node:test";
import {
  calculatorRow, calculatorPosition, discountError, quantityError,
  resolveCalculator, summarizeCalculator, calculatorDisclosures, bestCalculatorCompetitor,
  encodeCalculator, decodeCalculator, type CalculatorBlock, type CalculatorEvidence,
  isCalculatorDate,
  compareCalculatorMetadata,
} from "./calculatorState.ts";
const block = (id: string, code: string, brand: string | null = "Alpha"): CalculatorBlock => ({
  id, itemCode: code, variant: "Standard", discount: "20", quantity: "7",
  competitors: brand ? [{ id: `${id}-c`, competitor: brand, discount: "18" }] : [],
});
const evidence = (code: string, brands = ["Alpha"]): CalculatorEvidence => ({
  itemCode: code, productName: code, division: "Pipes", category: "Pipe", priceBasis: "MRP",
  prayag: { price: 92, effectiveDate: "2026-01-01" },
  variants: [{ variant: "Standard", price: 92, effectiveDate: "2026-01-01" }, { variant: "Ivory", price: 100, effectiveDate: "2026-01-01" }],
  competitors: brands.map(competitor => ({ competitor, price: 91, effectiveDate: "2026-01-01", priceBasis: "MRP", basisMismatch: false })),
});
test("incomplete native date-entry values are not resolvable dates", () => {
  for (const d of ["", "202610-10-16", "2026-02-30", "0000-01-01", "2026-1-01"]) assert.equal(isCalculatorDate(d), false);
  assert.equal(isCalculatorDate("2026-10-15"), true);
  assert.equal(isCalculatorDate("2026-10-16"), true);
});
test("basis and unit are independent fields; display strings never determine equivalence", () => {
  const ours = { basis: "MRP", unit: "NOS" };
  const same = compareCalculatorMetadata(ours, { basis: " mrp ", unit: " each " });
  assert.equal(same.basisMismatch, false); assert.equal(same.unitMismatch, false);
  const basisOnly = compareCalculatorMetadata(ours, { basis: "Ex-GST", unit: "NOS" });
  assert.equal(basisOnly.basisMismatch, true); assert.equal(basisOnly.unitMismatch, false);
  const net = compareCalculatorMetadata({ basis: "Net", unit: "PCS" }, { basis: "Net", unit: "each" });
  assert.equal(net.basisMismatch, false); assert.equal(net.unitMismatch, false);
});
test("a basis token in a unit field is neutral not-recorded information, not a mismatch", () => {
  const check = compareCalculatorMetadata({ basis: "MRP", unit: "NOS" }, { basis: "MRP", unit: "MRP" });
  assert.equal(check.basisMismatch, false); assert.equal(check.unitMismatch, false);
  assert.equal(check.unitNotRecorded, true); assert.equal(check.unitNote, "Competitor unit not recorded.");
  assert.equal(check.unitWarning, null);
  const bothMalformed = compareCalculatorMetadata({ basis: "MRP", unit: "MRP" }, { basis: "MRP", unit: "MRP" });
  assert.equal(bothMalformed.unitMismatch, false); assert.equal(bothMalformed.unitNotRecorded, true);
});
test("missing or basis-token units are neutral; recorded pipe lengths versus NOS are amber", () => {
  for (const unit of [null, "", "MRP", "Rate (ex-GST)", "Verify"]) {
    const check = compareCalculatorMetadata({ basis: "MRP", unit: "NOS" }, { basis: "MRP", unit });
    assert.equal(check.basisMismatch, false); assert.equal(check.unitMismatch, false);
    assert.equal(check.unitStatus, "not-recorded"); assert.equal(check.unitNotRecorded, true);
  }
  for (const unit of ["per 3-m pipe", "per 6-m pipe", " per 3 m "]) {
    const check = compareCalculatorMetadata({ basis: "MRP", unit: "NOS" }, { basis: "MRP", unit });
    assert.equal(check.basisMismatch, false); assert.equal(check.unitMismatch, true);
    assert.equal(check.unitStatus, "differs"); assert.equal(check.unitNotRecorded, false);
    assert.ok(check.unitWarning!.includes(unit));
  }
  const noBasis = compareCalculatorMetadata({ basis: "Verify", unit: "NOS" }, { basis: "Verify", unit: "each" });
  assert.equal(noBasis.basisMismatch, true); assert.equal(noBasis.unitMismatch, false);
});
test("unit notes do not inflate amber counts or warnings; differing units remain verbatim", () => {
  const ev = evidence("A"); ev.basis = "MRP"; ev.unit = "NOS";
  Object.assign(ev.competitors[0], { basis: "MRP", unit: "MRP" });
  const rows = resolveCalculator([block("a", "A")], [ev]), s = summarizeCalculator(rows);
  assert.equal(s.unitNotRecordedRows, 1); assert.equal(s.unitMismatchRows, 0);
  assert.deepEqual(rows[0].competitors[0].warnings, []);
  assert.deepEqual(rows[0].competitors[0].notes, ["Competitor unit not recorded."]);
  assert.ok(calculatorDisclosures(s, "2026-10-16", []).some(d => d.includes("information only")));
  ev.competitors[0].unit = "per 3 m";
  const differing = resolveCalculator([block("a", "A")], [ev]);
  assert.equal(summarizeCalculator(differing).unitMismatchRows, 1);
  assert.equal(differing[0].competitors[0].quote!.unit, "per 3 m");
  assert.deepEqual(differing[0].competitors[0].notes, []);
});
test("variant evidence warnings remain separate from price-basis and unit checks", () => {
  const ev = evidence("A"); ev.basis = "MRP"; ev.unit = "NOS";
  Object.assign(ev.competitors[0], { basis: "MRP", unit: "each" });
  const b = block("a", "A"); b.variant = "Ivory";
  const rows = resolveCalculator([b], [ev]), c = rows[0].competitors[0];
  assert.equal(c.basisMismatch, false); assert.equal(c.unitMismatch, false); assert.equal(c.variantMismatch, true);
  const s = summarizeCalculator(rows);
  assert.equal(s.basisMismatchRows, 0); assert.equal(s.unitMismatchRows, 0); assert.equal(s.variantMismatchRows, 1);
  assert.match(calculatorDisclosures(s, "2026-10-16", []).join(" "), /colour variant/);
  ev.variants[1].basis = "Net";
  assert.equal(resolveCalculator([b], [ev])[0].competitors[0].basisMismatch, true);
  assert.equal(resolveCalculator([b], [ev])[0].ourPriceBasis, "Net · NOS");
});
test("invoice arithmetic rounds the discounted unit first, not the extended line", () => {
  assert.equal(calculatorRow(92, "20", "1").netUnit, 73.60);
  assert.equal(calculatorRow(92, "20", "7").total, 515.20);
  const r = calculatorRow(92, "33.33", "7");
  assert.equal(r.netUnit, 61.34); assert.equal(r.total, 429.38); assert.notEqual(r.total, 429.35);
  assert.equal(calculatorRow(1.005, "0", "1").netUnit, 1.01);
});
test("competitor difference sign and 1.4% above-us example", () => {
  const comp = calculatorRow(91, "18", "7");
  assert.equal(comp.netUnit, 74.62); assert.equal(comp.total, 522.34);
  assert.equal(calculatorPosition(73.60, comp.netUnit).label, "1.4% above us");
  assert.equal(calculatorPosition(74.62, 73.60).direction, "below");
  assert.equal(calculatorPosition(73.60, 73.60).label, "At par");
});
test("discount/quantity guardrails reject invalid values without silently coercing", () => {
  for (const d of ["", "-1", "100.01", "20.001", "NaN", "1e1"]) assert.ok(discountError(d));
  for (const q of ["", "0", "-2", "1.5", "Infinity", "1e3"]) assert.ok(quantityError(q));
  assert.equal(discountError("100"), null); assert.equal(calculatorRow(92, "100", "7").total, 0);
  assert.equal(calculatorRow(null, "0", "7").total, null);
  assert.equal(calculatorRow(92, "101", "7").netUnit, null);
});
test("zero denominators never yield Infinity or NaN", () => {
  const p = calculatorPosition(0, 10);
  assert.equal(p.diffPct, null); assert.equal(p.diffUnit, 10);
  assert.ok(!p.label.includes("Infinity")); assert.ok(!p.label.includes("NaN"));
});
test("changing our quantity automatically changes every competitor's quantity", () => {
  const b = block("mirror", "A");
  assert.equal(resolveCalculator([b], [evidence("A")])[0].competitors[0].quantity, 7);
  b.quantity = "3";
  const r = resolveCalculator([b], [evidence("A")])[0];
  assert.equal(r.our.total, 220.80);
  assert.equal(r.competitors[0].quantity, 3); assert.equal(r.competitors[0].total, 223.86);
});
test("variants use their own price, never Standard when selected evidence is missing", () => {
  const b = block("1", "A"); b.variant = "Ivory";
  assert.equal(resolveCalculator([b], [evidence("A")])[0].our.netUnit, 80);
  b.variant = "Absent";
  assert.equal(resolveCalculator([b], [evidence("A")])[0].our.netUnit, null);
});
test("summary compares each brand only on the same product subset", () => {
  const rows = resolveCalculator([block("1", "A"), block("2", "B", null), block("3", "C")],
    [evidence("A"), evidence("B", []), evidence("C", [])]);
  const s = summarizeCalculator(rows);
  assert.equal(s.products, 3); assert.equal(s.ourValue, 1545.60); assert.equal(s.totalQuantity, 21);
  assert.equal(s.brands[0].compared, 1); assert.equal(s.brands[0].ourValue, 515.20);
  assert.equal(s.brands[0].competitorValue, 522.34); assert.equal(s.brands[0].cheaper, 1);
  assert.equal(s.noCompetitorSelected, 1); assert.equal(s.noCompetitorRecorded, 2);
  assert.equal(rows[2].competitors[0].total, null);
});
test("a wholly missing competitor never becomes a zero-valued tie", () => {
  const rows = resolveCalculator([block("1", "A")], [evidence("A", [])]);
  const brand = summarizeCalculator(rows).brands[0];
  assert.equal(brand.compared, 0); assert.equal(brand.competitorValue, null);
  assert.equal(brand.ourValue, null); assert.equal(brand.position.direction, "missing");
});
test("filtered-out quotes are not falsely disclosed as never recorded", () => {
  const ev = { ...evidence("A", []), hasRecordedCompetitorPrice: true };
  const s = summarizeCalculator(resolveCalculator([block("1", "A")], [ev]));
  assert.equal(s.noCompetitorRecorded, 0);
  assert.equal(s.ourValue, 515.20);
});
test("best competitor uses selected usable totals, basis warnings are counted", () => {
  const ev = evidence("A", ["Alpha", "Beta"]); ev.competitors[1].price = 80; ev.competitors[1].basisMismatch = true;
  const b = block("1", "A"); b.competitors.push({ id: "2", competitor: "Beta", discount: "0" });
  const rows = resolveCalculator([b], [ev]);
  assert.equal(bestCalculatorCompetitor(rows[0])?.brand, "Alpha");
  const s = summarizeCalculator(rows);
  assert.equal(s.basisMismatchRows, 1);
  const d = calculatorDisclosures(s, "2026-10-16", ["Bucket lists: none applied."]);
  assert.ok(d.includes("Prices resolved as of 16-10-2026."));
  assert.ok(d.some(s => s.includes("different or unconfirmed price basis")));
  assert.ok(!d.some(s => s.startsWith("0 products")));
});
test("share round-trip preserves exact codes, variants, decimals, quantities, competitors and date", () => {
  const b = block("1", " A,%+"); b.variant = "Ivory"; b.discount = "33.33";
  const state = { asOf: "2026-10-16", blocks: [b] };
  const params = new URLSearchParams({ calc: encodeCalculator(state)! });
  assert.deepEqual(decodeCalculator(new URLSearchParams(params.toString()).get("calc")), state);
  assert.equal(encodeCalculator({ ...state, blocks: Array.from({ length: 50 }, (_, i) => ({ ...b, id: String(i) })) }), null);
  assert.equal(decodeCalculator('{"asOf":"2026-02-30","blocks":[]}'), null);
  assert.equal(decodeCalculator("broken"), null);
});
