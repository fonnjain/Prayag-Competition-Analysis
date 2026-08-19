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
  resolveCompetitorPeriodDate,
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

  it("uses the resolved catalog MRP even when the audit snapshot is missing", () => {
    const r = buildRow(comp({ price: 120, prayagMrpAtCompare: null }), maps);
    expect(r.comparable).toBe(true);
    expect(r.priceDiff).toBe(20);
  });

  it("uses the resolved catalog MRP for both the displayed value and gap", () => {
    const currentCatalog = prayagMap({
      PG1: { mrp: 999, division: "Pipes", category: "SWR" },
    });
    const r = buildRow(comp({ price: 120, prayagMrpAtCompare: 100 }), currentCatalog);
    expect(r.prayagMrp).toBe(999);
    expect(r.priceDiffPct).toBeCloseTo(-87.988, 3);
    expect(r.prayagCheaper).toBe(false);
  });

  it("pulls division/category from the matched catalog entry", () => {
    const r = buildRow(comp({}), maps);
    expect(r.division).toBe("Pipes");
    expect(r.category).toBe("SWR");
  });

  it("is NOT comparable when the competitor price is null (verified mapping, MRP pending)", () => {
    const r = buildRow(comp({ price: null }), maps);
    expect(r.matched).toBe(true);
    expect(r.comparable).toBe(false);
    expect(r.competitorPrice).toBeNull();
    expect(r.competitorEffectivePrice).toBeNull();
    expect(r.priceDiff).toBeNull();
    expect(r.priceDiffPct).toBeNull();
    expect(r.prayagCheaper).toBeNull();
    // The row still hydrates Prayag attributes for display/grouping.
    expect(r.prayagMrp).toBe(100);
    expect(r.division).toBe("Pipes");
  });

  it("keeps a null-price row non-comparable in Net-to-Net mode too", () => {
    const r = buildRow(comp({ price: null, prayagMrpAtCompare: 100 }), maps, {
      mode: "net" as const,
      prayagDiscount: 5,
      discountFor: () => 40,
    });
    expect(r.comparable).toBe(false);
    expect(r.competitorEffectivePrice).toBeNull();
    expect(r.priceDiffPct).toBeNull();
    // Prayag's own net basis is still reported for display.
    expect(r.prayagMrp).toBeCloseTo(95, 5);
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

describe("buildRow Net-to-Net mode", () => {
  const netOpts = (prayagDiscount = 5, compDiscount = 40) => ({
    mode: "net" as const,
    prayagDiscount,
    discountFor: () => compDiscount,
  });

  it("computes the net gap from per-side discounts (docx spot check)", () => {
    // comp MRP 149, prayag MRP 78, prayag 5% / comp 40%:
    //   prayag_net = 78*0.95 = 74.1 ; comp_net = 149*0.6 = 89.4
    //   gap% = (89.4-74.1)/74.1*100 = +20.6%
    const maps = prayagMap({ PG1: { mrp: 78 } });
    const r = buildRow(
      comp({ price: 149, prayagMrpAtCompare: 78 }),
      maps,
      netOpts(5, 40),
    );
    expect(r.prayagMrp).toBeCloseTo(74.1, 5);
    expect(r.competitorEffectivePrice).toBeCloseTo(89.4, 5);
    expect(r.priceDiffPct).toBeCloseTo(20.6, 1);
    expect(r.prayagCheaper).toBe(true);
  });

  it("MRP mode on the same inputs stays at the undiscounted gap", () => {
    const maps = prayagMap({ PG1: { mrp: 78 } });
    const r = buildRow(comp({ price: 149, prayagMrpAtCompare: 78 }), maps);
    expect(r.prayagMrp).toBe(78);
    expect(r.priceDiffPct).toBeCloseTo(91.0, 1);
  });

  it("can flip the sign vs MRP mode when the competitor discount is deep", () => {
    // Equal MRPs (100 vs 100): MRP gap = 0. With prayag 5% / comp 40%,
    // prayag_net=95, comp_net=60 => comp cheaper => Prayag costlier.
    const maps = prayagMap({ PG1: { mrp: 100 } });
    const r = buildRow(comp({ price: 100, prayagMrpAtCompare: 100 }), maps, netOpts(5, 40));
    expect(r.priceDiffPct).toBeCloseTo(-36.8, 1);
    expect(r.prayagCheaper).toBe(false);
  });

  it("applies ex-GST grossing before the competitor discount", () => {
    // comp 100 ex-GST -> 118 effective, then *0.6 = 70.8 net.
    const maps = prayagMap({ PG1: { mrp: 100 } });
    const r = buildRow(
      comp({ price: 100, unit: "Rate (ex-GST)", prayagMrpAtCompare: 100 }),
      maps,
      netOpts(5, 40),
    );
    expect(r.competitorEffectivePrice).toBeCloseTo(70.8, 5);
    expect(r.prayagMrp).toBeCloseTo(95, 5);
  });

  it("resolves competitor discounts per brand", () => {
    const maps = prayagMap({ PG1: { mrp: 100 } });
    const discountFor = (c: string) => (c === "Astral" ? 40 : 10);
    const r = buildRow(comp({ competitor: "Astral", price: 100, prayagMrpAtCompare: 100 }), maps, {
      mode: "net",
      prayagDiscount: 5,
      discountFor,
    });
    // comp_net = 100*0.6 = 60 (Astral 40%), prayag_net = 95
    expect(r.competitorEffectivePrice).toBeCloseTo(60, 5);
  });

  it("uses the resolved MRP in net mode when the audit snapshot is missing", () => {
    const maps = prayagMap({ PG1: { mrp: 100 } });
    const r = buildRow(comp({ price: 120, prayagMrpAtCompare: null }), maps, netOpts());
    expect(r.comparable).toBe(true);
    expect(r.prayagMrp).toBeCloseTo(95, 5);
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

// ---------------------------------------------------------------------------
// resolveCompetitorPeriodDate
//
// These tests cover the date-chip logic end-to-end without needing a database:
// the SQL in getCompetitorRowsForPeriod pre-filters to effective_date ≤ the
// requested period; resolveCompetitorPeriodDate then picks the MAX of whatever
// rows come back.  To simulate a period switch, the test simply varies which
// rows are passed in — exactly as the SQL would return different subsets for
// different period arguments.
// ---------------------------------------------------------------------------
describe("resolveCompetitorPeriodDate", () => {
  it("returns null when the row list is empty (no competitor data at all)", () => {
    expect(resolveCompetitorPeriodDate([])).toBeNull();
  });

  it("returns null when all rows have null effective dates", () => {
    expect(
      resolveCompetitorPeriodDate([
        { effectiveDate: null },
        { effectiveDate: null },
      ]),
    ).toBeNull();
  });

  it("returns the single date when only one row is present", () => {
    expect(resolveCompetitorPeriodDate([{ effectiveDate: "2024-06-01" }])).toBe(
      "2024-06-01",
    );
  });

  it('returns the most recent date — simulates "Latest (auto)" where all rows are returned', () => {
    // Scenario: no period filter → SQL returns rows from all uploads.
    // The chip should reflect the very latest competitor upload date.
    const rows = [
      { effectiveDate: "2024-01-15" },
      { effectiveDate: "2024-06-01" }, // latest
      { effectiveDate: "2024-03-20" },
    ];
    expect(resolveCompetitorPeriodDate(rows)).toBe("2024-06-01");
  });

  it("returns an older date when the SQL has pre-filtered to a past period", () => {
    // Scenario: user selects period "2024-03-31".
    // The SQL (effective_date <= '2024-03-31') excludes the Jun upload.
    // Only the Jan and Mar rows are passed in; chip must show "2024-03-20".
    const rowsForPastPeriod = [
      { effectiveDate: "2024-01-15" },
      { effectiveDate: "2024-03-20" }, // latest within the past period
    ];
    expect(resolveCompetitorPeriodDate(rowsForPastPeriod)).toBe("2024-03-20");
  });

  it("switching from a past period to an earlier past period returns the correct older date", () => {
    // Simulates two consecutive period selections:
    //   Period A → "2024-03-31" → chip = "2024-03-20"
    //   Period B → "2024-01-31" → chip = "2024-01-15"
    const rowsForPeriodA = [
      { effectiveDate: "2024-01-15" },
      { effectiveDate: "2024-03-20" },
    ];
    const rowsForPeriodB = [
      { effectiveDate: "2024-01-15" }, // only Jan survives this filter
    ];
    expect(resolveCompetitorPeriodDate(rowsForPeriodA)).toBe("2024-03-20");
    expect(resolveCompetitorPeriodDate(rowsForPeriodB)).toBe("2024-01-15");
  });

  it("ignores rows with null effective dates when dated rows are also present", () => {
    const rows = [
      { effectiveDate: null },
      { effectiveDate: "2024-04-01" },
      { effectiveDate: null },
    ];
    expect(resolveCompetitorPeriodDate(rows)).toBe("2024-04-01");
  });

  it("handles rows that only carry effectiveDate as undefined (legacy shape)", () => {
    // Some callers pass plain objects without the property at all.
    const rows = [{} as { effectiveDate?: string | null }, { effectiveDate: "2024-05-10" }];
    expect(resolveCompetitorPeriodDate(rows)).toBe("2024-05-10");
  });

  it("returns null when selected period predates all competitor imports — triggers the no-data chip", () => {
    // Scenario: all competitor imports happened in 2024, but the user selects a
    // period of "2023-12-31".  The SQL WHERE effective_date <= '2023-12-31'
    // returns zero rows.  resolveCompetitorPeriodDate([]) must return null so
    // the UI can display "No competitor data for this period" instead of going blank.
    expect(resolveCompetitorPeriodDate([])).toBeNull();

    // Also cover the edge case where the period filter returns rows but every
    // row pre-dates any named effective_date (legacy import with no date column).
    const legacyRows = [
      { effectiveDate: undefined as string | undefined },
      { effectiveDate: null },
    ];
    expect(resolveCompetitorPeriodDate(legacyRows)).toBeNull();
  });
});
