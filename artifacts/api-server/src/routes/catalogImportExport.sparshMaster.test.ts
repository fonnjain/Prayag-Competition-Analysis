import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import {
  parseSparshCompetitorMaster,
  resolveSparshEffectiveDates,
} from "./catalogImportExport";

const masterPath = fileURLToPath(
  new URL(
    "../../../../attached_assets/Sparsh_Competitor_Master_Clean_1787823376637.xlsx",
    import.meta.url,
  ),
);

function workbook(): XLSX.WorkBook {
  return XLSX.readFile(masterPath, { cellDates: true });
}

function catalogMap(): Map<string, string> {
  const sheet = workbook().Sheets.competitor_mapping!;
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
  return new Map(
    rows.map((row) => {
      const code = String(row.prayag_code);
      return [code.replace(/\s+/g, "").toUpperCase(), code];
    }),
  );
}

describe("authoritative Sparsh competitor master", () => {
  it("reads the two verified periods as 150 direct mappings", () => {
    const master = parseSparshCompetitorMaster(workbook(), catalogMap());

    expect(master?.rows).toHaveLength(150);
    expect(master?.periods.map((period) => period.sourceEffectiveDate)).toEqual([
      "2024-04-01",
      "2026-07-01",
    ]);
    expect(master?.rows.every((row) => row.competitorCode.length > 0)).toBe(true);
    expect(master?.rows.find((row) => row.competitorCode === "WMP-188")).toMatchObject({
      prayagCode: "361",
      prices: { "2024-04-01": 468, "2026-07-01": 462 },
    });
    expect(master?.rows.find((row) => row.competitorCode === "WMP-189")).toMatchObject({
      prayagCode: "362",
      prices: { "2024-04-01": 592, "2026-07-01": 592 },
    });
  });

  it("allows an administrator to move a detected September period to 1 July", () => {
    const master = parseSparshCompetitorMaster(workbook(), catalogMap());
    expect(master).not.toBeNull();

    const legacyPeriods = master!.periods.map((period) =>
      period.key === "vol_6_2"
        ? { ...period, sourceEffectiveDate: "2026-09-01" }
        : period,
    );
    expect(
      resolveSparshEffectiveDates(legacyPeriods, ["2024-04-01", "2026-07-01"]),
    ).toEqual(["2024-04-01", "2026-07-01"]);
  });

  it("rejects date overrides that merge two source periods", () => {
    const master = parseSparshCompetitorMaster(workbook(), catalogMap());
    expect(master).not.toBeNull();

    expect(() =>
      resolveSparshEffectiveDates(master!.periods, ["2026-07-01", "2026-07-01"]),
    ).toThrow(/distinct/i);
  });

  it("fails closed when a master mapping is absent from the official catalog", () => {
    const map = catalogMap();
    map.delete("361");

    expect(() => parseSparshCompetitorMaster(workbook(), map)).toThrow(
      /not in the official catalog/i,
    );
  });
});