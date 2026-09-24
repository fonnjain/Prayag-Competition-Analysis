import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { applyApolloPlan, parseApolloMaster } from "./apolloMaster";

const source = fileURLToPath(new URL("../../../../attached_assets/Competitor_Master_-_Plumbing_Apollo_1790252780224.xlsx", import.meta.url));

describe("P045 Apollo master (pure, read-only)", () => {
  it("rejects a generated code that shadows a supplier code", () => {
    const book = XLSX.read(readFileSync(source), { type: "buffer" });
    book.Sheets["CPVC FITTINGS"]!["F5"].v = "APU001";
    delete book.Sheets["CPVC FITTINGS"]!["F5"].w;
    expect(() => parseApolloMaster(book)).toThrow(/Duplicate Apollo competitor code/);
  });
  it("reads the real two-tier workbook without confusing Prayag and Apollo columns", () => {
    const parsed = parseApolloMaster(readFileSync(source));
    expect(parsed.rows).toHaveLength(698);
    expect(parsed.pipeCount).toBe(273);
    expect(parsed.fittingCount).toBe(425);
    expect(parsed.unpriced).toHaveLength(81);
    expect(parsed.coverageGaps).toMatchObject({
      "CPVC PIPE": 4, "SWR PIPE": 56, "PPR PIPE": 16, "CASING PIPE": 4, "UGD PIPE": 1,
    });
    expect(parsed.rows.find(r => r.prayagCode === "PU-1")).toMatchObject({
      competitorCode: "APU001", price: 324,
    });
    expect(parsed.rows.find(r => r.prayagCode === "U-11C")).toMatchObject({
      competitorCode: "APUGD001", price: 2022,
    });
    expect(parsed.renames).toHaveLength(10);
    expect(parsed.reservations).toEqual([
      expect.objectContaining({
        code: "APUGD007",
        owner: "ugd ugd pipe 6 m ring fit sn 8 ring fit sn 4|110",
        sourceSheet: "UGD PIPE",
        sourceRow: 13,
      }),
    ]);
    expect(parsed.renames).toEqual(expect.arrayContaining([
      expect.objectContaining({ oldCode: "APU001", newCode: "APUGD001" }),
      expect.objectContaining({ oldCode: "APU010", newCode: "APUGD010" }),
    ]));
    expect(parsed.unpriced.every(r => !parsed.rows.some(x => x.competitorCode === r.generatedCode && x.sheet === r.sheet))).toBe(true);
    expect(parsed.conflicts.some(c => c.competitorCode === "PPRMB0204XX20MM")).toBe(true);
  });

  it("applies the same parsed file idempotently in memory (0 -> N -> N)", () => {
    const parsed = parseApolloMaster(readFileSync(source));
    const state = { rows: [] as typeof parsed.rows };
    const first = applyApolloPlan(state, parsed);
    const count = state.rows.length;
    const second = applyApolloPlan(state, parsed);
    expect(first.created).toBe(count);
    expect(first.updated).toBe(0);
    expect(second.created).toBe(0);
    expect(second.updated).toBe(0);
    expect(state.rows).toHaveLength(count);
  });
});