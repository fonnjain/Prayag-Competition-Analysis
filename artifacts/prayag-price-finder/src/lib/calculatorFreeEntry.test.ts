import assert from "node:assert/strict";
import test from "node:test";
import {
  encodeCalculator, decodeCalculator, setBlockProduct, setBlockVariant, setCompetitor, clearCompetitorPrice,
  competitorIdentity, type CalculatorBlock,
} from "./calculatorState.ts";

const base = (): CalculatorBlock => ({
  id: "b1", itemCode: "TTS-01", variant: "Ivory", discount: "10", quantity: "2", mrp: "28.00",
  competitors: [
    { id: "c1", competitor: "Astral", discount: "5", mrp: "30" },
    { id: "c2", competitor: "Astral", discount: "5", adHoc: true, mrp: "31.5" },
  ],
});
const roundTrip = (blocks: CalculatorBlock[]) => decodeCalculator(encodeCalculator({ asOf: "2026-10-18", blocks }));

test("old links without free-entry fields still decode", () => {
  const old = JSON.stringify({ asOf: "2026-10-01", blocks: [{ id: "a", itemCode: "X1", variant: "Standard", discount: "0", quantity: "1", competitors: [{ id: "c", competitor: "Alpha", discount: "0" }] }] });
  const s = decodeCalculator(old)!;
  assert.equal(s.blocks[0].mrp, undefined);
  assert.equal(s.blocks[0].competitors[0].adHoc, undefined);
});

test("exact code text, raw override strings and ad-hoc flags survive a link verbatim", () => {
  const adhoc: CalculatorBlock = { id: "b2", itemCode: " TTS - 01 ", variant: "Standard", discount: "0", quantity: "1", adHocProduct: true, description: "Shop sample", mrp: "", competitors: [] };
  const s = roundTrip([base(), adhoc])!;
  assert.equal(s.blocks[0].mrp, "28.00");
  assert.equal(s.blocks[0].competitors[1].mrp, "31.5");
  assert.equal(s.blocks[0].competitors[1].adHoc, true);
  assert.equal(s.blocks[1].itemCode, " TTS - 01 ");
  assert.equal(s.blocks[1].mrp, "");
  assert.equal(s.blocks[1].description, "Shop sample");
});

test("deliberate ad-hoc Astral is distinct from recorded Astral; true duplicates are rejected", () => {
  assert.notEqual(competitorIdentity({ competitor: "Astral" }), competitorIdentity({ competitor: "Astral", adHoc: true }));
  assert.ok(roundTrip([base()]));
  const dup = base();
  dup.competitors[1] = { ...dup.competitors[1], adHoc: undefined };
  assert.equal(roundTrip([dup]), null);
});

test("malformed free-entry fields are rejected", () => {
  for (const patch of [{ mrp: 28 }, { adHocProduct: "yes" }, { adHocProduct: true, description: "" }, { description: 5 }]) {
    assert.equal(roundTrip([{ ...base(), ...(patch as object) } as CalculatorBlock]), null);
  }
  const b = base();
  b.competitors[0] = { ...b.competitors[0], mrp: 30 as unknown as string };
  assert.equal(roundTrip([b]), null);
  const n = base();
  n.competitors[0] = { id: "c1", competitor: null, discount: "0", adHoc: true };
  assert.equal(roundTrip([n]), null);
});

test("variant, product and competitor switches clear stale overrides", () => {
  const v = setBlockVariant(base(), "Standard");
  assert.equal("mrp" in v, false);
  assert.equal("mrp" in v.competitors[0], false);
  assert.equal(v.competitors[1].mrp, "", "ad-hoc competitor price stays required, not carried over");
  const p = setBlockProduct(base(), { itemCode: "NEW", adHoc: true, description: "Typed in shop" });
  assert.deepEqual([p.itemCode, p.adHocProduct, p.description, p.mrp, p.variant, p.competitors.length], ["NEW", true, "Typed in shop", "", "Standard", 0]);
  const k = setBlockProduct(p, { itemCode: "TTS-01", adHoc: false });
  assert.equal("adHocProduct" in k || "description" in k || "mrp" in k, false);
  const known = setCompetitor(base().competitors[1], "Supreme", false);
  assert.equal("adHoc" in known || "mrp" in known, false);
  const one = setCompetitor(base().competitors[0], "Jindal Pipes", true);
  assert.deepEqual([one.competitor, one.adHoc, one.mrp], ["Jindal Pipes", true, ""]);
  assert.equal("mrp" in clearCompetitorPrice(base().competitors[0]), false);
});
