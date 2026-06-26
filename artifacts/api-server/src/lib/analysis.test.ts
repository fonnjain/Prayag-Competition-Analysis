import { describe, expect, it } from "vitest";
import {
  effectivePrice,
  buildRow,
  applyFilters,
  parseFilters,
  gapStats,
  confidenceCounts,
  bucketize,
  median,
  mean,
  pct,
  type PrayagInfo,
  type CompInput,
  type AnalysisRow,
} from "./analysis.js";

// These tests lock in the analysis engine's basis-normalization (ex-GST grossing),
// the comparability rule (matched + both prices present), the diff% sign
// convention (positive = Prayag cheaper / good), the shared filter behavior, and
// the aggregation/positioning math.

function prayagMap(entries: Record<string, Partial<PrayagInfo>>): Map<string, PrayagInfo> {
  const m = new Map<string, PrayagInfo>();
  for (const [code, info] of Object.entries(entries)) {
    m.set(code, {
      mrp: info.mrp ?? null,
      division: info.division ?? null,
      category: info.category ?? null,
      productName: info.productName ?? null,
      effectiveDate: info.effectiveDate ?? null,
    });
  }
  return m;
}

let idSeq = 0;
function comp(partial: Partial<CompInput>): CompInput {
  return {
    id: ++idSeq,
    competitor: "Astral",
    unit: null,
    price: 100,
    matchStatus: "matched",
    matchConfidence: "High",
    matchedPrayagCode: "PG1",
    prayagMrpAtCompare: 100,
    ...partial,
  };
}

describe("effectivePrice (basis normalization)", () => {
  it("grosses up ex-GST rates by 18%", () => {
    expect(effectivePrice("Rate (ex-GST)", 100)).toBeCloseTo(118, 5);
  });
  it("treats null/empty unit as MRP-comparable (as-is)", () => {
    expect(effectivePrice(null, 100)).toBe(100);
    expect(effectivePrice("", 100)).toBe(100);
  });
  it("treats any other unit as as-is (MRP basis)", () => {
    expect(effectivePrice("per pc", 100)).toBe(100);
    expect(effectivePrice("per mtr", 250)).toBe(250);
  });
  it("trims whitespace around the ex-GST marker", () => {
    expect(effectivePrice("  Rate (ex-GST)  ", 100)).toBeCloseTo(118, 5);
  });
});

describe("buildRow comparability + diff conventions", () => {
  const maps = prayagMap({ PG1: { mrp: 100, division: "Pipes", category: "SWR" } });

  it("marks a matched row with both prices as comparable", () => {
    const r = buildRow(comp({ price: 120 }), maps);
    expect(r.comparable).toBe(true);
    expect(r.priceDiff).toBe(20);
    expect(r.priceDiffPct).toBeCloseTo(20, 5);
    expect(r.prayagCheaper).toBe(true); // competitor costlier => Prayag cheaper
  });

  it("flags Prayag as costlier when competitor is cheaper", () => {
    const r = buildRow(comp({ price: 80 }), maps);
    expect(r.prayagCheaper).toBe(false);
    expect(r.priceDiff).toBe(-20);
    expect(r.priceDiffPct).toBeCloseTo(-20, 5);
  });

  it("applies ex-GST grossing before comparing", () => {
    // 100 ex-GST -> 118 effective vs 100 MRP => Prayag cheaper by 18%
    const r = buildRow(comp({ price: 100, unit: "Rate (ex-GST)" }), maps);
    expect(r.competitorEffectivePrice).toBeCloseTo(118, 5);
    expect(r.priceDiffPct).toBeCloseTo(18, 5);
    expect(r.prayagCheaper).toBe(true);
  });

  it("is NOT comparable when match_status is not 'matched'", () => {
    const r = buildRow(comp({ matchStatus: "no match (review)" }), maps);
    expect(r.matched).toBe(false);
    expect(r.comparable).toBe(false);
    expect(r.priceDiffPct).toBeNull();
    expect(r.prayagCheaper).toBeNull();
  });

  it("is NOT comparable when the persisted Prayag MRP is missing", () => {
    // Even though the catalog map carries an MRP, a row with no persisted
    // prayagMrpAtCompare is not comparable — the catalog value is never used.
    const r = buildRow(comp({ price: 120, prayagMrpAtCompare: null }), maps);
    expect(r.comparable).toBe(false);
    expect(r.priceDiff).toBeNull();
  });

  it("uses the persisted row MRP for the gap, not the catalog MRP", () => {
    const staleCatalog = prayagMap({
      PG1: { mrp: 999, division: "Pipes", category: "SWR" },
    });
    const r = buildRow(comp({ price: 120, prayagMrpAtCompare: 100 }), staleCatalog);
    expect(r.prayagMrp).toBe(100); // persisted value, not the catalog's 999
    expect(r.priceDiffPct).toBeCloseTo(20, 5);
    expect(r.prayagCheaper).toBe(true);
  });

  it("pulls division/category from the matched catalog entry", () => {
    const r = buildRow(comp({}), maps);
    expect(r.division).toBe("Pipes");
    expect(r.category).toBe("SWR");
  });

  it("does NOT leak catalog attributes onto a non-matched row carrying a stray code", () => {
    const r = buildRow(
      comp({ matchStatus: "no match (review)", matchedPrayagCode: "PG1" }),
      maps,
    );
    expect(r.division).toBeNull();
    expect(r.category).toBeNull();
    expect(r.prayagMrp).toBeNull();
    expect(r.comparable).toBe(false);
  });
});

describe("applyFilters (shared filters)", () => {
  const maps = prayagMap({
    PG1: { mrp: 100, division: "Pipes", category: "SWR" },
    PG2: { mrp: 200, division: "Hardware", category: "Hinges" },
  });
  const rows: AnalysisRow[] = [
    buildRow(comp({ competitor: "Astral", matchedPrayagCode: "PG1", matchConfidence: "High" }), maps),
    buildRow(comp({ competitor: "Prince", matchedPrayagCode: "PG2", matchConfidence: "Low" }), maps),
    buildRow(comp({ competitor: "Astral", matchedPrayagCode: "PG2", matchConfidence: "Medium" }), maps),
  ];

  it("filters by a repeatable competitor array", () => {
    const out = applyFilters(rows, parseFilters({ competitor: ["Astral"] }));
    expect(out).toHaveLength(2);
    expect(out.every((r) => r.competitor === "Astral")).toBe(true);
  });

  it("accepts a single competitor passed as a string", () => {
    const out = applyFilters(rows, parseFilters({ competitor: "Prince" }));
    expect(out).toHaveLength(1);
    expect(out[0]!.competitor).toBe("Prince");
  });

  it("filters by division and confidence together", () => {
    const out = applyFilters(rows, parseFilters({ division: "Hardware", matchConfidence: "Low" }));
    expect(out).toHaveLength(1);
    expect(out[0]!.competitor).toBe("Prince");
  });

  it("returns all rows when no filters are set", () => {
    expect(applyFilters(rows, parseFilters({}))).toHaveLength(3);
  });
});

describe("aggregation helpers", () => {
  it("computes mean/median/pct with 1-decimal rounding", () => {
    expect(mean([10, 20, 30])).toBe(20);
    expect(median([10, 20, 30, 40])).toBe(25);
    expect(median([5, 1, 3])).toBe(3);
    expect(pct(1, 3)).toBe(33.3);
  });

  it("returns null for empty inputs / zero denominators", () => {
    expect(mean([])).toBeNull();
    expect(median([])).toBeNull();
    expect(pct(1, 0)).toBeNull();
  });

  it("gapStats counts cheaper vs costlier and ignores non-comparable rows", () => {
    const maps = prayagMap({ PG1: { mrp: 100 } });
    const rows = [
      buildRow(comp({ price: 120, matchedPrayagCode: "PG1" }), maps), // cheaper
      buildRow(comp({ price: 150, matchedPrayagCode: "PG1" }), maps), // cheaper
      buildRow(comp({ price: 80, matchedPrayagCode: "PG1" }), maps), // costlier
      buildRow(comp({ price: 90, matchStatus: "no match (review)" }), maps), // excluded
    ];
    const g = gapStats(rows);
    expect(g.comparableSkus).toBe(3);
    expect(g.prayagCheaperCount).toBe(2);
    expect(g.prayagCostlierCount).toBe(1);
    expect(g.prayagCheaperPct).toBeCloseTo(66.7, 1);
  });

  it("confidenceCounts buckets High/Medium/Low and treats null as none", () => {
    const maps = prayagMap({ PG1: { mrp: 100 } });
    const rows = [
      buildRow(comp({ matchConfidence: "High" }), maps),
      buildRow(comp({ matchConfidence: "Medium" }), maps),
      buildRow(comp({ matchConfidence: "Low" }), maps),
      buildRow(comp({ matchConfidence: null }), maps),
    ];
    expect(confidenceCounts(rows)).toEqual({ high: 1, medium: 1, low: 1, none: 1 });
  });
});

describe("positioning bucketize", () => {
  it("places diffs into the correct sign-aware buckets", () => {
    // one in each bucket: <-20, -15, -5, 0, 5, 15, 25
    const buckets = bucketize([-25, -15, -5, 0, 5, 15, 25]);
    expect(buckets.map((b) => b.count)).toEqual([1, 1, 1, 1, 1, 1, 1]);
  });

  it("labels positive buckets as cheaper (good) and negative as costlier", () => {
    const buckets = bucketize([]);
    const cheaper = buckets.filter((b) => b.side === "cheaper");
    const costlier = buckets.filter((b) => b.side === "costlier");
    expect(cheaper).toHaveLength(3);
    expect(costlier).toHaveLength(3);
  });

  it("treats the exact +/-2 boundary as parity-inclusive on the low edge", () => {
    // -2 falls in [-2,2) parity; 2 falls in [2,10) cheaper
    const buckets = bucketize([-2, 2]);
    const parity = buckets.find((b) => b.side === "parity")!;
    const firstCheaper = buckets.find((b) => b.label === "2-10% cheaper")!;
    expect(parity.count).toBe(1);
    expect(firstCheaper.count).toBe(1);
  });
});
