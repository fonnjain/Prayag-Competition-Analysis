import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { divisionPreview, validateDivisionRows, parseDivisionMapping, type DivisionRow, type DivisionProduct } from "./divisionMapping";
import { PRODUCT_DIVISIONS, OFFICIAL_MRP_SOURCES, assertSingleProductDivision, sourceDivisionForProduct, MRP_FILENAME_DIVISIONS } from "./mrpProvenance";
import { normCode } from "./catalog";
import { normCode as importCode } from "./import-parse";
import { codeKey } from "./multiCompetitorWorkbook";
import { normalizePrinceCode } from "./princeMaster";

const product = (itemCode: string, division = "PTMT & Plastic Fittings"): DivisionProduct => ({ itemCode, division, productName: itemCode, category: "Keep", seriesRange: "Keep" });
const row = (itemCode: string): DivisionRow => ({ itemCode, proposedDivision: "Sink", confidence: "HIGH", basis: "Reviewed business decision", itemType: "SINK" });
describe("exact-code division remediation", () => {
  it("keeps case, punctuation and every space significant across identity helpers", () => {
    for (const key of [normCode, importCode, codeKey, normalizePrinceCode]) {
      for (const [a, b] of [["TTS-01", "TTS - 01"], ["322K", "322 K"], ["DB-02L", "DB-02 L"], ["EP-GANESHA", "EP-Ganesha"], [" A", "A"]]) expect(key(a)).not.toBe(key(b));
    }
  });
  it("never claims a normalized counterpart, creates products or acts on EXCLUDE", () => {
    const rows = validateDivisionRows([row("TTS-01"), { ...row("X"), confidence: "EXCLUDE", proposedDivision: "EXCLUDE - not a catalogue product" }]);
    const p = divisionPreview(rows, [product("TTS - 01"), product("X")]);
    expect(p.changes).toEqual([]); expect(p.missing.map(p => p.itemCode)).toEqual(["TTS - 01"]);
    expect(p.excluded[0]).toMatchObject({ present: true, action: "None" }); expect(p.productsCreated).toBe(0);
  });
  it("rejects duplicate exact codes and unsupported/composite proposals", () => {
    expect(() => validateDivisionRows([row("A"), row("A")])).toThrow("duplicate");
    expect(() => validateDivisionRows([{ ...row("A"), proposedDivision: "CP | PTMT" }])).toThrow("Invalid division");
  });
  it("binds preview to names, category, exact code and division, not prices", () => {
    const a = divisionPreview([row("A")], [product("A")]);
    expect(a.catalogueFingerprint).not.toBe(divisionPreview([row("A")], [{ ...product("A"), category: "Changed" }]).catalogueFingerprint);
    expect(a.payloadFingerprint).not.toBe(divisionPreview([{ ...row("A"), basis: "Changed" }], [product("A")]).payloadFingerprint);
    expect(a).toMatchObject({ pricesRead: 0, pricesWritten: 0 });
  });
  it("separates seven product divisions from six MRP sources, including Hardware", () => {
    expect(PRODUCT_DIVISIONS).toHaveLength(7); expect(OFFICIAL_MRP_SOURCES).toHaveLength(6);
    expect(sourceDivisionForProduct("Sink")).toBe("PTMT & Plastic Fittings");
    expect(MRP_FILENAME_DIVISIONS.find(r => r.pattern.test("Hardware 2026.xlsx"))?.division).toBe("Hardware");
    expect(MRP_FILENAME_DIVISIONS.some(r => r.pattern.test("Sink 2026.xlsx"))).toBe(false);
  });
  it("refuses a composite before loader inserts and names both code and value", () => {
    expect(() => assertSingleProductDivision("501N", "Ceramic Sanitaryware | PTMT & Plastic Fittings")).toThrow(/501N.*Ceramic Sanitaryware \| PTMT/);
    expect(() => assertSingleProductDivision("501N", "PTMT & Plastic Fittings")).not.toThrow();
  });
  it("accepts only reviewed v3 bytes and explicitly omits the spaced TTS codes", () => {
    const file = readFileSync(new URL("../../../../attached_assets/Division_Mapping_from_ERP_RateList_v3_1792137797792.xlsx", import.meta.url));
    const rows = parseDivisionMapping(file);
    expect(rows).toHaveLength(10579);
    expect(rows.filter(r => r.confidence === "EXCLUDE")).toHaveLength(28);
    expect(rows.some(r => r.itemCode === "TTS - 01")).toBe(false);
    expect(rows.some(r => r.confidence === "VARIANT MATCH")).toBe(false);
    const changed = Buffer.from(file); changed[0] = 0;
    expect(() => parseDivisionMapping(changed)).toThrow("reviewed v3");
  });
});
