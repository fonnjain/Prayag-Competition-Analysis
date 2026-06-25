import { describe, expect, it } from "vitest";
import {
  detectBrand,
  normCode,
  parseSheet,
  type PrayagPrices,
} from "./import-parse.js";

// These tests lock in the competitor-sheet import heuristics so a regression in
// code-column overlap detection, brand/basis auto-detection, or matched/unmatched
// counting can't silently break the upload flow reviewers depend on.

function codes(...c: string[]): Set<string> {
  return new Set(c.map((x) => normCode(x)));
}

function prayag(
  entries: Record<string, { net: number | null; mrp: number | null }>,
): Map<string, PrayagPrices> {
  const m = new Map<string, PrayagPrices>();
  for (const [code, p] of Object.entries(entries)) m.set(normCode(code), p);
  return m;
}

describe("detectBrand", () => {
  it("matches a known brand mentioned in the filename", () => {
    expect(detectBrand("", "Finolex price list.xlsx")).toBe("Finolex");
  });

  it("matches a known brand mentioned in the sheet header text", () => {
    expect(detectBrand("Astral Pipes Rate Card", "upload.csv")).toBe("Astral");
  });

  it("matches a multi-word brand case-insensitively", () => {
    expect(detectBrand("", "WATER TEC 2026.xlsx")).toBe("Water Tec");
  });

  it("falls back to a cleaned filename base when no brand is known", () => {
    expect(detectBrand("", "ABC_Polymers-list.xlsx")).toBe("ABC Polymers list");
  });

  it("returns Unknown when there is nothing to go on", () => {
    expect(detectBrand("", ".xlsx")).toBe("Unknown");
  });

  it("prefers the first listed known brand when several appear", () => {
    // KNOWN_BRANDS order: Finolex precedes Supreme.
    expect(detectBrand("Supreme vs Finolex", "x.csv")).toBe("Finolex");
  });
});

describe("parseSheet: code-column overlap detection", () => {
  it("picks the column with the most overlap against known codes", () => {
    const known = codes("A1", "A2", "A3");
    const map = prayag({ A1: { net: 100, mrp: 120 }, A2: { net: 100, mrp: 120 }, A3: { net: 100, mrp: 120 } });
    // Column 0 holds serial numbers, column 1 holds real codes, column 2 is net price.
    const grid: unknown[][] = [
      ["SR", "Item Code", "Net Rate"],
      [1, "A1", 90],
      [2, "A2", 95],
      [3, "A3", 88],
    ];
    const out = parseSheet(grid, known, map);
    expect(out.rows.map((r) => r.itemCode)).toEqual(["A1", "A2", "A3"]);
    expect(out.unmatched).toBe(0);
  });

  it("ignores a decoy numeric column that happens to collide and uses the real code column", () => {
    const known = codes("1001", "1002", "1003");
    const map = prayag({
      "1001": { net: 50, mrp: 60 },
      "1002": { net: 50, mrp: 60 },
      "1003": { net: 50, mrp: 60 },
    });
    // Column 0 = code, column 1 = a "price" column that never collides with codes.
    const grid: unknown[][] = [
      ["Code", "Net Price"],
      ["1001", 50],
      ["1002", 52],
      ["1003", 48],
    ];
    const out = parseSheet(grid, known, map);
    expect(out.rows.map((r) => r.itemCode)).toEqual(["1001", "1002", "1003"]);
  });

  it("returns nothing when no column overlaps the known catalog", () => {
    const known = codes("X1", "X2");
    const map = prayag({ X1: { net: 1, mrp: 2 }, X2: { net: 1, mrp: 2 } });
    const grid: unknown[][] = [
      ["Code", "Price"],
      ["Z9", 10],
      ["Z8", 11],
    ];
    const out = parseSheet(grid, known, map);
    expect(out.rows).toEqual([]);
    expect(out.unmatched).toBe(0);
  });

  it("normalizes whitespace and case so spaced/lowercase codes still match", () => {
    const known = codes("AB12");
    const map = prayag({ AB12: { net: 10, mrp: 12 } });
    const grid: unknown[][] = [
      ["Code", "Net"],
      [" ab 12 ", 9],
    ];
    const out = parseSheet(grid, known, map);
    expect(out.rows.map((r) => r.itemCode)).toEqual(["AB12"]);
  });
});

describe("parseSheet: matched / unmatched counting", () => {
  it("counts matched rows in rows[] and non-catalog codes as unmatched", () => {
    const known = codes("A1", "A2");
    const map = prayag({ A1: { net: 100, mrp: 120 }, A2: { net: 100, mrp: 120 } });
    const grid: unknown[][] = [
      ["Code", "Net Rate"],
      ["A1", 90],
      ["A2", 95],
      ["A9", 99], // present in code column but not in catalog -> unmatched
    ];
    const out = parseSheet(grid, known, map);
    expect(out.rows).toHaveLength(2);
    expect(out.unmatched).toBe(1);
  });

  it("skips rows with no usable price instead of counting them as unmatched", () => {
    const known = codes("A1", "A2");
    const map = prayag({ A1: { net: 100, mrp: 120 }, A2: { net: 100, mrp: 120 } });
    const grid: unknown[][] = [
      ["Code", "Net Rate"],
      ["A1", 90],
      ["A2", 0], // non-positive price -> skipped, not unmatched
      ["A2", "n/a"], // non-numeric -> skipped, not unmatched
    ];
    const out = parseSheet(grid, known, map);
    expect(out.rows.map((r) => r.itemCode)).toEqual(["A1"]);
    expect(out.unmatched).toBe(0);
  });
});

describe("parseSheet: basis auto-detection from headers", () => {
  it("detects net basis from a net/rate header", () => {
    const known = codes("A1", "A2");
    const map = prayag({ A1: { net: 90, mrp: 150 }, A2: { net: 95, mrp: 150 } });
    const grid: unknown[][] = [
      ["Code", "Dealer Rate"],
      ["A1", 90],
      ["A2", 95],
    ];
    expect(parseSheet(grid, known, map).basis).toBe("net");
  });

  it("detects mrp basis when the only priced column is an MRP/list header", () => {
    const known = codes("A1", "A2");
    const map = prayag({ A1: { net: 90, mrp: 150 }, A2: { net: 95, mrp: 150 } });
    const grid: unknown[][] = [
      ["Code", "List MRP"],
      ["A1", 150],
      ["A2", 152],
    ];
    expect(parseSheet(grid, known, map).basis).toBe("mrp");
  });

  it("prefers the net column when both net and mrp headers exist", () => {
    const known = codes("A1", "A2");
    const map = prayag({ A1: { net: 90, mrp: 150 }, A2: { net: 95, mrp: 150 } });
    const grid: unknown[][] = [
      ["Code", "MRP", "Net Rate"],
      ["A1", 150, 90],
      ["A2", 152, 95],
    ];
    const out = parseSheet(grid, known, map);
    expect(out.basis).toBe("net");
    // compPrice comes from the net column; compMrp captured from the mrp column.
    expect(out.rows[0]).toMatchObject({ compPrice: 90, compMrp: 150 });
  });
});

describe("parseSheet: basis inference from value magnitude (generic header)", () => {
  it("infers mrp when a generic price column's values track Prayag MRP", () => {
    const known = codes("A1", "A2", "A3");
    const map = prayag({
      A1: { net: 90, mrp: 150 },
      A2: { net: 95, mrp: 155 },
      A3: { net: 100, mrp: 160 },
    });
    const grid: unknown[][] = [
      ["Code", "Price"],
      ["A1", 150],
      ["A2", 156],
      ["A3", 159],
    ];
    expect(parseSheet(grid, known, map).basis).toBe("mrp");
  });

  it("infers net when a generic price column's values track Prayag net", () => {
    const known = codes("A1", "A2", "A3");
    const map = prayag({
      A1: { net: 90, mrp: 150 },
      A2: { net: 95, mrp: 155 },
      A3: { net: 100, mrp: 160 },
    });
    const grid: unknown[][] = [
      ["Code", "Price"],
      ["A1", 91],
      ["A2", 96],
      ["A3", 99],
    ];
    expect(parseSheet(grid, known, map).basis).toBe("net");
  });
});
