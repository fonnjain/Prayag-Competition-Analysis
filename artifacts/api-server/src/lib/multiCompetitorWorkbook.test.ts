import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { assertWorkbookScope, parseMultiCompetitorWorkbook } from "./multiCompetitorWorkbook";

const original = readFileSync(fileURLToPath(new URL(
  "../../../../attached_assets/Competitor_Master_Plumbing_Astral_FOR_UPLOAD_10Oct2026_1791607212492.xlsx", import.meta.url)));

export function unrelatedBrandWorkbook() {
  const wb = XLSX.utils.book_new();
  for (const [name, dates, prices] of [
    ["COPPER FITTINGS", [new Date("2026-01-01Z"), new Date("2026-02-01Z")], [10, 12]],
    ["TEST PIPE", [new Date("2026-03-01Z")], [30]],
  ] as const) {
    const ws = XLSX.utils.aoa_to_sheet([
      [null, null, "Prayag", null, "CopperCo", null, null, "DeltaCo", null],
      [null, "Size", "ITEM CODE", "MRP", "ITEM CODE", ...dates, ...(dates.length === 1 ? [null] : []), "ITEM CODE", new Date("2026-04-01Z")],
      [null, name.endsWith("PIPE") ? "6 MTR" : "Fittings", null],
      [null, "20 mm", name.endsWith("PIPE") ? "TEST-P" : "TEST-F", 20, "C-01", ...prices, ...(dates.length === 1 ? [null] : []), "D-01", 22],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  return XLSX.write(wb, {type: "buffer", bookType: "xlsx"}) as Buffer;
}
describe("General grouped multi-competitor workbook parser", () => {
  it("reads the approved file's own raw dated columns and exact pipe lengths", () => {
    const p = parseMultiCompetitorWorkbook(original, ["Astral", "Jindal"]);
    expect(p.blockers).toEqual([]);
    expect(p.sheets).toHaveLength(14);
    expect(p.rows.filter(r => r.competitor === "Astral")).toHaveLength(986); // C133 belongs to destination eligibility.
    expect(p.rows.filter(r => r.competitor === "Jindal")).toHaveLength(182);
    expect(p.rows.find(r => r.prayagCode === "P20G02")).toMatchObject({price: 259, unit: "per 3-m pipe", effectiveDate: "2026-09-16"});
    expect(p.rows.find(r => r.prayagCode === "U-11C")).toMatchObject({price: 3378, unit: "per 6-m pipe", effectiveDate: "2026-05-01"});
    expect(p.rows.find(r => r.prayagCode === "PW 75")).toMatchObject({unit: "per 0.61-m pipe"});
    expect(p.rows.find(r => r.prayagCode === "C133")).toMatchObject({price: 756});
  });
  it("is general: different brands, sheets, units and independent dates work", () => {
    const p = parseMultiCompetitorWorkbook(unrelatedBrandWorkbook(), ["CopperCo", "DeltaCo"]);
    expect(p.blockers).toEqual([]);
    expect(p.rows).toHaveLength(5);
    expect(new Set(p.rows.map(r => r.effectiveDate))).toEqual(new Set(["2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01"]));
    expect(p.rows.find(r => r.prayagCode === "TEST-P")).toMatchObject({unit: "per 6-m pipe"});
  });
  it("forbids every protected brand, aliases, casing and spacing server-side", () => {
    for (const b of ["Apollo", "APOLLO", "Ashirvad", "Ashirwad", "Prince", "  Sparsh   Pearl  "]) {
      expect(() => assertWorkbookScope([b])).toThrow("cannot modify");
    }
    expect(() => parseMultiCompetitorWorkbook(original, ["Astral", "NotInFile"])).toThrow("not in this workbook");
  });
  it("reuses normalized stored spelling; never creates a second brand spelling", () => {
    const p = parseMultiCompetitorWorkbook(unrelatedBrandWorkbook(), ["CopperCo"], ["COPPERCO"]);
    expect(p.rows.every(r => r.competitor === "COPPERCO")).toBe(true);
    expect(p.nameResolutions).toEqual([{requested: "CopperCo", stored: "COPPERCO"}]);
  });
  it("fingerprints other-brand content too, without importing it", () => {
    const a = parseMultiCompetitorWorkbook(original, ["Astral"]);
    const wb = XLSX.read(original);
    wb.Sheets["CPVC FITTINGS"]!.G4!.v = 999999;
    const b = parseMultiCompetitorWorkbook(XLSX.write(wb, {type: "buffer", bookType: "xlsx"}), ["Astral"]);
    expect(b.contentFingerprint).not.toBe(a.contentFingerprint);
    expect(b.rows).toEqual(a.rows);
  });
});
