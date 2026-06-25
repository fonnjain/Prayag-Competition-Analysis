import { normCode } from "./catalog.js";

// ---------------------------------------------------------------------------
// Basis normalization
//
// competitor_prices.unit is the competitor's price basis:
//   - null / empty            -> already an MRP-comparable figure (use as-is)
//   - "Rate (ex-GST)"         -> ex-GST rate; gross up by 18% GST before
//                                comparing to Prayag MRP
//   - anything else           -> treated as-is (MRP basis)
// All comparisons are against Prayag's current MRP.
// ---------------------------------------------------------------------------
export const GST_MULTIPLIER = 1.18;

export function effectivePrice(unit: string | null, price: number): number {
  if (unit != null && unit.trim() === "Rate (ex-GST)") {
    return price * GST_MULTIPLIER;
  }
  return price;
}

export interface PrayagInfo {
  mrp: number | null;
  division: string | null;
  category: string | null;
  productName: string | null;
  effectiveDate: string | null;
}

// Minimal shape of a competitor_prices row needed for analysis.
export interface CompInput {
  id: number;
  competitor: string;
  unit: string | null;
  price: number;
  matchStatus: string;
  matchConfidence: string | null;
  matchedPrayagCode: string | null;
}

export interface AnalysisRow {
  id: number;
  competitor: string;
  unit: string | null;
  competitorPrice: number;
  competitorEffectivePrice: number;
  matchStatus: string;
  matchConfidence: string | null;
  matched: boolean;
  prayagCode: string | null;
  prayagProductName: string | null;
  prayagMrp: number | null;
  division: string | null;
  category: string | null;
  comparable: boolean;
  priceDiff: number | null;
  priceDiffPct: number | null;
  prayagCheaper: boolean | null;
}

export function buildRow(c: CompInput, maps: Map<string, PrayagInfo>): AnalysisRow {
  const matched = c.matchStatus === "matched";
  // Only hydrate Prayag catalog attributes for confirmed matches. A non-matched
  // row may still carry a stray matchedPrayagCode in the source data; trusting it
  // would leak a division/category/MRP onto a row that should not be compared.
  const key = matched && c.matchedPrayagCode ? normCode(c.matchedPrayagCode) : null;
  const prayag = key ? maps.get(key) : undefined;
  const prayagMrp = prayag?.mrp ?? null;
  const effPrice = effectivePrice(c.unit, c.price);

  // A price gap is only meaningful for a confirmed match where both prices exist.
  const comparable =
    matched && prayagMrp != null && prayagMrp > 0 && c.price != null;

  let priceDiff: number | null = null;
  let priceDiffPct: number | null = null;
  let prayagCheaper: boolean | null = null;
  if (comparable && prayagMrp != null) {
    priceDiff = effPrice - prayagMrp;
    priceDiffPct = (priceDiff / prayagMrp) * 100;
    // Competitor more expensive than Prayag => Prayag cheaper (good).
    prayagCheaper = effPrice > prayagMrp;
  }

  return {
    id: c.id,
    competitor: c.competitor,
    unit: c.unit,
    competitorPrice: c.price,
    competitorEffectivePrice: effPrice,
    matchStatus: c.matchStatus,
    matchConfidence: c.matchConfidence,
    matched,
    prayagCode: c.matchedPrayagCode,
    prayagProductName: prayag?.productName ?? null,
    prayagMrp,
    division: prayag?.division ?? null,
    category: prayag?.category ?? null,
    comparable,
    priceDiff,
    priceDiffPct,
    prayagCheaper,
  };
}

// ---------------------------------------------------------------------------
// Shared filters
// ---------------------------------------------------------------------------
export interface Filters {
  competitors: string[];
  division: string | null;
  category: string | null;
  matchConfidence: string | null;
  matchStatus: string | null;
}

export function strParam(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export function arrParam(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v.filter((x): x is string => typeof x === "string" && x.trim() !== "");
  }
  if (typeof v === "string" && v.trim() !== "") return [v.trim()];
  return [];
}

export function parseFilters(query: Record<string, unknown>): Filters {
  return {
    competitors: arrParam(query.competitor),
    division: strParam(query.division),
    category: strParam(query.category),
    matchConfidence: strParam(query.matchConfidence),
    matchStatus: strParam(query.matchStatus),
  };
}

export function applyFilters(rows: AnalysisRow[], f: Filters): AnalysisRow[] {
  const compSet = f.competitors.length ? new Set(f.competitors) : null;
  return rows.filter((r) => {
    if (compSet && !compSet.has(r.competitor)) return false;
    if (f.division && r.division !== f.division) return false;
    if (f.category && r.category !== f.category) return false;
    if (f.matchConfidence && r.matchConfidence !== f.matchConfidence) return false;
    if (f.matchStatus && r.matchStatus !== f.matchStatus) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Aggregation helpers
// ---------------------------------------------------------------------------
export function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return round1(sum / values.length);
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const m =
    sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
  return round1(m);
}

export function pct(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return round1((numerator / denominator) * 100);
}

export interface GapStats {
  comparableSkus: number;
  prayagCheaperCount: number;
  prayagCostlierCount: number;
  prayagCheaperPct: number | null;
  avgPriceDiffPct: number | null;
  medianPriceDiffPct: number | null;
}

export function gapStats(rows: AnalysisRow[]): GapStats {
  const comparable = rows.filter((r) => r.comparable);
  const diffs = comparable
    .map((r) => r.priceDiffPct)
    .filter((v): v is number => v != null);
  const cheaper = comparable.filter((r) => r.prayagCheaper === true).length;
  return {
    comparableSkus: comparable.length,
    prayagCheaperCount: cheaper,
    prayagCostlierCount: comparable.length - cheaper,
    prayagCheaperPct: pct(cheaper, comparable.length),
    avgPriceDiffPct: mean(diffs),
    medianPriceDiffPct: median(diffs),
  };
}

export function confidenceCounts(rows: AnalysisRow[]) {
  let high = 0;
  let medium = 0;
  let low = 0;
  let none = 0;
  for (const r of rows) {
    switch (r.matchConfidence) {
      case "High":
        high++;
        break;
      case "Medium":
        medium++;
        break;
      case "Low":
        low++;
        break;
      default:
        none++;
    }
  }
  return { high, medium, low, none };
}

// ---------------------------------------------------------------------------
// Positioning histogram
// ---------------------------------------------------------------------------
export interface PositioningBucketDef {
  label: string;
  min: number | null;
  max: number | null;
  side: string;
}

export const POSITIONING_BUCKETS: PositioningBucketDef[] = [
  { label: "Prayag >20% costlier", min: null, max: -20, side: "costlier" },
  { label: "10-20% costlier", min: -20, max: -10, side: "costlier" },
  { label: "2-10% costlier", min: -10, max: -2, side: "costlier" },
  { label: "Within +/-2%", min: -2, max: 2, side: "parity" },
  { label: "2-10% cheaper", min: 2, max: 10, side: "cheaper" },
  { label: "10-20% cheaper", min: 10, max: 20, side: "cheaper" },
  { label: "Prayag >20% cheaper", min: 20, max: null, side: "cheaper" },
];

export function bucketize(diffs: number[]) {
  return POSITIONING_BUCKETS.map((b) => {
    const count = diffs.filter((d) => {
      const aboveMin = b.min == null || d >= b.min;
      const belowMax = b.max == null || d < b.max;
      return aboveMin && belowMax;
    }).length;
    return { ...b, count };
  });
}

export function toOpportunityItem(r: AnalysisRow) {
  return {
    id: r.id,
    competitor: r.competitor,
    prayagCode: r.prayagCode,
    prayagProductName: r.prayagProductName,
    division: r.division,
    category: r.category,
    prayagMrp: r.prayagMrp,
    competitorPrice: r.competitorPrice,
    competitorEffectivePrice: round1(r.competitorEffectivePrice),
    unit: r.unit,
    priceDiff: round1(r.priceDiff!),
    priceDiffPct: round1(r.priceDiffPct!),
  };
}
