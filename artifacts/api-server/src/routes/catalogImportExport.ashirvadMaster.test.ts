import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { parseAshirvadCompetitorMaster } from "./catalogImportExport";

const masterPath = fileURLToPath(
  new URL(
    "../../../../attached_assets/Ashirvad_Competitor_Mapping_1788855202719.xlsx",
    import.meta.url,
  ),
);

function source() {
  const buffer = readFileSync(masterPath);
  return { buffer, workbook: XLSX.read(buffer, { type: "buffer" }) };
}

function catalogMap(workbook: XLSX.WorkBook): Map<string, string> {
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
    workbook.Sheets.competitor_mapping!,
    { defval: null },
  );
  return new Map(
    rows.map((row) => {
      const code = String(row.prayag_code);
      return [code.replace(/\s+/g, "").toUpperCase(), code];
    }),
  );
}

describe("trusted Ashirvad competitor master", () => {
  it("accepts exactly 669 direct mappings without reading review-only Prayag values", () => {
    const { buffer, workbook } = source();
    const master = parseAshirvadCompetitorMaster(buffer, workbook, catalogMap(workbook));

    expect(master).toHaveLength(669);
    expect(new Set(master?.map((row) => row.prayagCode))).toHaveLength(669);
    expect(new Set(master?.map((row) => row.competitorCode))).toHaveLength(669);
    expect(master?.every((row) => row.price > 0)).toBe(true);
    expect(master?.[0]).not.toHaveProperty("prayagMrpReference");
    expect(master?.[0]).not.toHaveProperty("gapPct");
  });

  it("fails closed when even one byte changes", () => {
    const { buffer, workbook } = source();
    const changed = Buffer.from(buffer);
    changed[changed.length - 1] = changed[changed.length - 1]! ^ 1;
    expect(() => parseAshirvadCompetitorMaster(changed, workbook, catalogMap(workbook))).toThrow(
      /checksum/i,
    );
  });

  it("fails closed when a Prayag mapping is not catalogued", () => {
    const { buffer, workbook } = source();
    const map = catalogMap(workbook);
    map.delete("PS-1");
    expect(() => parseAshirvadCompetitorMaster(buffer, workbook, map)).toThrow(/unknown Prayag/i);
  });
});