import { normCode } from "./catalog.js";
import { priceChangePct } from "./priceWindow.js";

// ---------------------------------------------------------------------------
// Basis normalization
//
// Per-row price basis is now stored explicitly in competitor_prices.priceBasis:
//   - 'MRP'      -> price is already MRP-comparable; use as-is
//   - 'Ex-GST'   -> ex-GST; gross up by gstPct% (default 18) before comparing
//   - null/other -> legacy rows; fall back to checking the unit string
//                   ("Rate (ex-GST)" → multiply by GST_MULTIPLIER)
// All comparisons are against the date-resolved, in-force Prayag MRP.
// ---------------------------------------------------------------------------
export const GST_MULTIPLIER = 1.18;

/**
 * The one canonical definition used by the analysis dashboard, the catalog
 * comparison, and the rebuild readback query in reports/mrp-full-rebuild-report.md.
 *
 * Population: latest confirmed-matched, priced competitor revision on or
 * before the requested as-of date for each (competitor, matched Prayag code),
 * joined to an active, non-discontinued Prayag product with an approved,
 * in-force MRP. The match predicate is applied before revision selection; null
 * competitor prices never enter gap stats.
 *
 * Basis: a competitor row marked Ex-GST is grossed up using its gst_pct
 * (18% when absent). MRP rows, and legacy rows without the ex-GST unit marker,
 * are already comparable. The report and UI calculate on unrounded row values,
 * then round only the displayed aggregate to one decimal.
 *
 * Sign: (competitor effective price - Prayag MRP) / Prayag MRP * 100.
 * Positive means Prayag is cheaper; negative means Prayag is costlier.
 */
export const MARKET_GAP_DEFINITION = {
  population:
    "Latest confirmed-matched, priced competitor revisions joined to active Prayag products with approved in-force MRPs.",
  priceBasis:
    "Ex-GST competitor rows are grossed up by gst_pct (default 18%); MRP and other rows are used as listed. Length normalization never changes official aggregates.",
  pricePeriod:
    "Both sides resolve to their latest eligible priced revision on or before one as-of date; future revisions are excluded.",
  signConvention:
    "(competitor effective price - Prayag MRP) / Prayag MRP * 100; positive means Prayag is cheaper.",
} as const;

export function effectivePrice(
  unit: string | null,
  price: number,
  priceBasis?: string | null,
  gstPct?: number | null,
): number {
  // Explicit per-row basis takes priority
  if (priceBasis === "MRP") return price;
  if (priceBasis === "Ex-GST") return price * (1 + (gstPct ?? 18) / 100);
  // Legacy fallback: check unit string for rows imported before price_basis column
  if (unit != null && unit.trim() === "Rate (ex-GST)") {
    return price * GST_MULTIPLIER;
  }
  return price;
}

/** Calculate the canonical market-gap percentage before display rounding. */
export function marketGapPct(
  prayagMrp: number | null,
  competitorEffectivePrice: number | null,
): number | null {
  if (
    prayagMrp == null ||
    prayagMrp <= 0 ||
    competitorEffectivePrice == null
  ) {
    return null;
  }
  return ((competitorEffectivePrice - prayagMrp) / prayagMrp) * 100;
}

/** Positive canonical gap means the competitor costs more, so Prayag is cheaper. */
export function prayagCheaperForGap(gapPct: number | null): boolean | null {
  return gapPct == null ? null : gapPct > 0;
}

export interface PrayagInfo {
  mrp: number | null;
  division: string | null;
  category: string | null;
  productName: string | null;
  effectiveDate: string | null;
  /** Final calendar day before the next revision, or null when open-ended. */
  validTo?: string | null;
  /** Next revision after the resolved asOf date, if any already exists in the DB. */
  upcomingMrp?: number | null;
  upcomingMrpDate?: string | null;
  /** One-decimal current-to-next change; zero is retained for no-change revisions. */
  upcomingChangePct?: number | null;
}

// Minimal shape of a competitor_prices row needed for analysis.
export interface CompInput {
  id: number;
  competitor: string;
  unit: string | null;
  // Null when the competitor's MRP is not yet known for a verified mapping.
  // Such rows are never comparable and are excluded from all gap stats.
  price: number | null;
  matchStatus: string;
  matchConfidence: string | null;
  matchedPrayagCode: string | null;
  // Period-matched Prayag MRP persisted on the row. This — NOT a catalog
  // lookup — is the basis for the competitor gap and the displayed Prayag MRP.
  prayagMrpAtCompare: number | null;
  // Per-row price basis (new columns). Optional for backward compatibility with
  // legacy rows that only have unit.
  priceBasis?: string | null;
  gstPct?: number | null;
  effectiveDate?: string | null;
  validTo?: string | null;
  upcomingPrice?: number | null;
  upcomingEffectiveDate?: string | null;
  upcomingPriceBasis?: string | null;
  upcomingGstPct?: number | null;
  /** A newer unconfirmed competitor mapping for this same quote. */
  newerRevisionEffectiveDate?: string | null;
  newerRevisionReviewStatus?: string | null;
}

export interface AnalysisRow {
  id: number;
  competitor: string;
  unit: string | null;
  competitorPrice: number | null;
  competitorEffectivePrice: number | null;
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
  /** Effective date of the Prayag MRP used for this row's comparison (YYYY-MM-DD), or null. */
  prayagEffectiveDate: string | null;
  /** First Prayag MRP revision dated after the resolved asOf date, or null if none. */
  upcomingPrayagMrp: number | null;
  upcomingPrayagMrpDate: string | null;
  prayagValidTo: string | null;
  upcomingPrayagChangePct: number | null;
  competitorEffectiveDate: string | null;
  competitorValidTo: string | null;
  upcomingCompetitorPrice: number | null;
  upcomingCompetitorEffectivePrice: number | null;
  upcomingCompetitorPriceDate: string | null;
  upcomingCompetitorChangePct: number | null;
  /** True when the official gap still uses this confirmed quote. */
  newerRevisionAwaitingReview: boolean;
  newerRevisionEffectiveDate: string | null;
  newerRevisionReviewStatus: string | null;
}

// ---------------------------------------------------------------------------
// Comparison mode (MRP-to-MRP vs Net-to-Net)
//
// MRP-to-MRP (default, legacy behavior): compare Prayag MRP against the
// competitor's (basis-normalized) MRP directly.
// Net-to-Net: apply a per-scope discount to each side first, then compare:
//   prayag_net     = prayagMrp     * (1 - prayagDiscount/100)
//   competitor_net = compEffective * (1 - compDiscount/100)
// The gap is computed on the net values. The discounts are read live from the
// discount_settings table and never baked into stored prices.
// ---------------------------------------------------------------------------
export type CompareMode = "mrp" | "net";

export const DEFAULT_PRAYAG_DISCOUNT = 5;
export const DEFAULT_COMPETITOR_DISCOUNT = 40;

export interface BuildRowOpts {
  mode: CompareMode;
  // Prayag's own discount, percent (0-100).
  prayagDiscount: number;
  // Resolve a competitor's discount percent by brand name.
  discountFor: (competitor: string) => number;
}

export function buildRow(
  c: CompInput,
  maps: Map<string, PrayagInfo>,
  opts?: BuildRowOpts,
): AnalysisRow {
  const mode: CompareMode = opts?.mode ?? "mrp";
  const matched = c.matchStatus === "matched";
  // Only hydrate Prayag catalog attributes for confirmed matches. A non-matched
  // row may still carry a stray matchedPrayagCode in the source data; trusting it
  // would leak a division/category/MRP onto a row that should not be compared.
  const key = matched && c.matchedPrayagCode ? normCode(c.matchedPrayagCode) : null;
  const prayag = key ? maps.get(key) : undefined;
  // The displayed price, validity window, and gap must all use the same
  // date-resolved active catalog revision. prayagMrpAtCompare remains an audit
  // snapshot only; using it here can pair a current label with a stale gap.
  const prayagMrp = matched ? (prayag?.mrp ?? null) : null;
  // Use per-row priceBasis/gstPct if available, otherwise fall back to unit string.
  const effPrice =
    c.price != null
      ? effectivePrice(c.unit, c.price, c.priceBasis, c.gstPct)
      : null;
  const upcomingEffPrice =
    c.upcomingPrice != null
      ? effectivePrice(
          c.unit,
          c.upcomingPrice,
          c.upcomingPriceBasis,
          c.upcomingGstPct,
        )
      : null;

  // Resolve the two prices that drive the comparison. In MRP mode these are the
  // raw MRP / effective figures; in Net mode they are discounted nets.
  let prayagBasis = prayagMrp;
  let competitorBasis = effPrice;
  let upcomingCompetitorBasis = upcomingEffPrice;
  if (mode === "net" && prayagMrp != null) {
    const prayagDisc = opts?.prayagDiscount ?? DEFAULT_PRAYAG_DISCOUNT;
    const compDisc = opts?.discountFor
      ? opts.discountFor(c.competitor)
      : DEFAULT_COMPETITOR_DISCOUNT;
    prayagBasis = prayagMrp * (1 - prayagDisc / 100);
    competitorBasis = effPrice != null ? effPrice * (1 - compDisc / 100) : null;
    upcomingCompetitorBasis =
      upcomingEffPrice != null ? upcomingEffPrice * (1 - compDisc / 100) : null;
  }

  // A price gap is only meaningful for a confirmed match where both prices exist.
  const comparable =
    matched && prayagBasis != null && prayagBasis > 0 && competitorBasis != null;

  const priceDiff =
    comparable && prayagBasis != null && competitorBasis != null
      ? competitorBasis - prayagBasis
      : null;
  const priceDiffPct = marketGapPct(prayagBasis, competitorBasis);
  const prayagCheaper = prayagCheaperForGap(priceDiffPct);

  return {
    id: c.id,
    competitor: c.competitor,
    unit: c.unit,
    competitorPrice: c.price,
    // In net mode these carry the discounted net values so every downstream
    // consumer (gapStats, opportunities, export) reflects the active mode.
    competitorEffectivePrice: competitorBasis,
    matchStatus: c.matchStatus,
    matchConfidence: c.matchConfidence,
    matched,
    prayagCode: c.matchedPrayagCode,
    prayagProductName: prayag?.productName ?? null,
    prayagMrp: matched ? prayagBasis : null,
    division: prayag?.division ?? null,
    category: prayag?.category ?? null,
    comparable,
    priceDiff,
    priceDiffPct,
    prayagCheaper,
    // Pass through the next revision from the same date-resolved catalog map.
    prayagEffectiveDate: matched ? (prayag?.effectiveDate ?? null) : null,
    upcomingPrayagMrp: matched ? (prayag?.upcomingMrp ?? null) : null,
    upcomingPrayagMrpDate: matched ? (prayag?.upcomingMrpDate ?? null) : null,
    prayagValidTo: matched ? (prayag?.validTo ?? null) : null,
    upcomingPrayagChangePct: matched
      ? (prayag?.upcomingChangePct ?? null)
      : null,
    competitorEffectiveDate: c.effectiveDate ?? null,
    competitorValidTo: c.validTo ?? null,
    upcomingCompetitorPrice: c.upcomingPrice ?? null,
    upcomingCompetitorEffectivePrice: upcomingCompetitorBasis,
    upcomingCompetitorPriceDate: c.upcomingEffectiveDate ?? null,
    upcomingCompetitorChangePct: priceChangePct(
      competitorBasis,
      upcomingCompetitorBasis,
    ),
    newerRevisionAwaitingReview:
      c.newerRevisionEffectiveDate != null &&
      c.newerRevisionReviewStatus != null,
    newerRevisionEffectiveDate: c.newerRevisionEffectiveDate ?? null,
    newerRevisionReviewStatus: c.newerRevisionReviewStatus ?? null,
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

// ---------------------------------------------------------------------------
// Competitor period date resolution
// ---------------------------------------------------------------------------

/**
 * Given a set of competitor rows (already pre-filtered to effective_date ≤ the
 * requested period by the SQL query), returns the latest effective_date present
 * in those rows — i.e. the "most recent competitor upload that contributed to
 * this view".  Returns null when no row carries a dated effective_date.
 *
 * Exported for unit testing; not part of the public HTTP surface.
 */
export function resolveCompetitorPeriodDate(
  rows: Array<{ effectiveDate?: string | null }>,
): string | null {
  let result: string | null = null;
  for (const r of rows) {
    const d = r.effectiveDate ?? null;
    if (d && (!result || d > result)) result = d;
  }
  return result;
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
    competitorEffectivePrice:
      r.competitorEffectivePrice == null ? null : round1(r.competitorEffectivePrice),
    unit: r.unit,
    priceDiff: round1(r.priceDiff!),
    priceDiffPct: round1(r.priceDiffPct!),
    upcomingPrayagMrp: r.upcomingPrayagMrp,
    upcomingPrayagMrpDate: r.upcomingPrayagMrpDate,
    prayagEffectiveDate: r.prayagEffectiveDate,
    prayagValidTo: r.prayagValidTo,
    upcomingPrayagChangePct: r.upcomingPrayagChangePct,
    competitorEffectiveDate: r.competitorEffectiveDate,
    competitorValidTo: r.competitorValidTo,
    upcomingCompetitorPrice: r.upcomingCompetitorPrice,
    upcomingCompetitorEffectivePrice:
      r.upcomingCompetitorEffectivePrice == null
        ? null
        : round1(r.upcomingCompetitorEffectivePrice),
    upcomingCompetitorPriceDate: r.upcomingCompetitorPriceDate,
    upcomingCompetitorChangePct: r.upcomingCompetitorChangePct,
    newerRevisionAwaitingReview: r.newerRevisionAwaitingReview,
    newerRevisionEffectiveDate: r.newerRevisionEffectiveDate,
    newerRevisionReviewStatus: r.newerRevisionReviewStatus,
  };
}
