import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { applyApolloPlan, parseApolloMaster } from "./apolloMaster";
import { apolloPipeIdentity, apolloPipeIdentityV2 } from "./apolloPipeIdentity";

const source = fileURLToPath(new URL("../../../../attached_assets/Competitor_Master_-_Plumbing_Apollo_1790252780224.xlsx", import.meta.url));

describe("P045 Apollo master (pure, read-only)", () => {
  it("rejects worksheets whose raw names differ only by whitespace", () => {
    const book = XLSX.read(readFileSync(source), { type: "buffer" });
    expect(book.SheetNames[0]).toBe(" CPVC PIPE");
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Prayag", "Apollo"]]), "CPVC PIPE");
    expect(() => parseApolloMaster(book)).toThrow(/Ambiguous Apollo worksheet names.* CPVC PIPE.*CPVC PIPE/);
  });

  it("rejects a generated code that shadows a supplier code", () => {
    const book = XLSX.read(readFileSync(source), { type: "buffer" });
    book.Sheets["CPVC FITTINGS"]!["F5"].v = "APU001";
    delete book.Sheets["CPVC FITTINGS"]!["F5"].w;
    expect(() => parseApolloMaster(book)).toThrow(/Duplicate Apollo competitor code/);
  });
  it("reads the real two-tier workbook without confusing Prayag and Apollo columns", () => {
    const parsed = parseApolloMaster(readFileSync(source));
    expect(parsed.effectiveDate).toBe("2026-08-01");
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
      owner: "v2|ugd pipe|U-11B|110",
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

  it("reads an Excel serial from the Apollo price column as its canonical date", () => {
    const book = XLSX.read(readFileSync(source), { type: "buffer", cellDates: false });
    const sheet = book.Sheets[" CPVC PIPE"]!;
    sheet.G2 = { t: "n", v: 46235, z: "General" };
    expect(parseApolloMaster(book).effectiveDate).toBe("2026-08-01");
  });

  it("ignores a different competitor's dated columns after the Apollo group", () => {
    const book = XLSX.read(readFileSync(source), { type: "buffer", cellDates: false });
    XLSX.utils.sheet_add_aoa(book.Sheets[" CPVC PIPE"]!, [
      ["Prince", null],
      ["ITEM CODE", "01 Mar, 2026"],
    ], { origin: "H1" });
    const parsed = parseApolloMaster(book);
    expect(parsed.effectiveDate).toBe("2026-08-01");
    expect(parsed.rows).toHaveLength(698);
  });

  it("rejects a missing Apollo date rather than borrowing the Prayag date", () => {
    const book = XLSX.read(readFileSync(source), { type: "buffer", cellDates: false });
    const sheet = book.Sheets[" CPVC PIPE"]!;
    sheet.G2 = { t: "s", v: "MRP" };
    expect(() => parseApolloMaster(book)).toThrow(/Apollo price date is missing or invalid.*CPVC PIPE.*MRP/);
  });

  it("rejects multiple dated Apollo price columns in one worksheet", () => {
    const book = XLSX.read(readFileSync(source), { type: "buffer", cellDates: false });
    const sheet = book.Sheets[" CPVC PIPE"]!;
    XLSX.utils.sheet_add_aoa(sheet, [["02 Aug, 2026"]], { origin: "H2" });
    expect(() => parseApolloMaster(book)).toThrow(/Multiple Apollo price periods.*CPVC PIPE.*2026-08-01.*2026-08-02/);
  });

  it("rejects different Apollo dates across worksheets instead of choosing one global period", () => {
    const book = XLSX.read(readFileSync(source), { type: "buffer", cellDates: false });
    book.Sheets["CPVC FITTINGS"]!.G2 = { t: "s", v: "02 Aug, 2026" };
    expect(() => parseApolloMaster(book)).toThrow(/Multiple Apollo effective dates.*CPVC PIPE=2026-08-01.*CPVC FITTINGS=2026-08-02/);
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

  it("gives all 272 persisted local rows distinct V2 identities", () => {
    const parsed = parseApolloMaster(readFileSync(source));
    const localRows = parsed.rows.filter((row) => row.codeSource === "locally_assigned");
    // The reviewed/persisted slice contains 272 local rows; the raw workbook
    // also carries one additional local row reserved for review.
    const persistedLocalRows = localRows.slice(0, 272);
    expect(persistedLocalRows).toHaveLength(272);
    const keys = persistedLocalRows.map((row) => apolloPipeIdentityV2(row.category, row.prayagCode, row.size));
    expect(keys.every(Boolean)).toBe(true);
    expect(new Set(keys).size).toBe(272);
    expect(keys.every((key) => !key!.includes("ring fit") && !key!.includes("heading"))).toBe(true);
  });

  it("keeps V2 identities stable when only a section heading is edited", () => {
    const original = XLSX.read(readFileSync(source), { type: "buffer", raw: false });
    const edited = XLSX.read(readFileSync(source), { type: "buffer", raw: false });
    // Change a real section heading in memory only; no workbook is written.
    edited.Sheets["UGD PIPE"]!["B3"].v = "RENAMED SECTION HEADING";
    delete edited.Sheets["UGD PIPE"]!["B3"].w;
    const before = parseApolloMaster(original).rows
      .filter((row) => row.codeSource === "locally_assigned")
      .map((row) => [row.prayagCode, apolloPipeIdentityV2(row.category, row.prayagCode, row.size)]);
    const after = parseApolloMaster(edited).rows
      .filter((row) => row.codeSource === "locally_assigned")
      .map((row) => [row.prayagCode, apolloPipeIdentityV2(row.category, row.prayagCode, row.size)]);
    expect(after).toEqual(before);
  });

  it("separates the 24 legacy description collisions with V2 keys", () => {
    const parsed = parseApolloMaster(readFileSync(source));
    const localRows = parsed.rows.filter((row) => row.codeSource === "locally_assigned");
    const legacyGroups = new Map<string, typeof localRows>();
    for (const row of localRows) {
      const key = apolloPipeIdentity(row.description, row.size);
      if (key) legacyGroups.set(key, [...(legacyGroups.get(key) ?? []), row]);
    }
    const collidingRows = [...legacyGroups.values()].filter((group) => group.length > 1).flat();
    expect(collidingRows).toHaveLength(24);
    expect(new Set(collidingRows.map((row) => apolloPipeIdentityV2(row.category, row.prayagCode, row.size))).size).toBe(24);
  });
});