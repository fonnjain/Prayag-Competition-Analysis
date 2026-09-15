/**
 * P014 historical MRP model.
 *
 * This is deliberately a series model.  Product observations are only used
 * to form the distribution for a dated series revision; no product-level
 * regression or extrapolation is performed.
 */

export type HistoricalPriceRow = {
  id: number;
  itemCode: string;
  mrp: number | null;
  effectiveDate: string;
  reviewStatus?: string | null;
  variant?: string | null;
};

export type HistoricalProduct = {
  itemCode: string;
  productName?: string | null;
  division?: string | null;
  category?: string | null;
  seriesRange?: string | null;
  currentMrp?: number | null;
  currentDate?: string | null;
  currentRowId?: number | null;
};

export type HistoricalConfidence = "STRONG" | "MODERATE" | "WEAK" | "NONE";
export type HistoricalSeriesStatus = "DUE" | "OVERDUE" | "NOT_DUE" | "PATTERN_NOT_USABLE";
export type HistoricalProductEvidence = {
  lastRevisionDate: string | null;
  monthsSinceLast: number | null;
  nextExpectedDate: string | null;
  due: boolean;
  overdue: boolean;
  status: HistoricalSeriesStatus;
  reason: string | null;
};
export type HistoricalSeriesEvidence = Omit<HistoricalSeriesAnalysis, "eventDistributions">;

export type HistoricalSeriesAnalysis = {
  series: string;
  productCount: number;
  revisionCount: number;
  revisionDates: string[];
  eventDistributions: Array<{
    date: string;
    productCount: number;
    rates: number[];
    typicalRate: number | null;
    p10Rate: number | null;
    p90Rate: number | null;
  }>;
  cadenceMonths: number | null;
  cadenceIntervals: number[];
  typicalRate: number | null;
  p10Rate: number | null;
  p90Rate: number | null;
  spreadPoints: number | null;
  uniform: boolean;
  usable: boolean;
  confidence: HistoricalConfidence;
  lastRevisionDate: string | null;
  monthsSinceLast: number | null;
  status: HistoricalSeriesStatus;
  due: boolean;
  overdue: boolean;
  nextExpectedDate: string | null;
  reason: string | null;
};

export type HistoricalProductResult = HistoricalProduct & {
  currentMrp: number | null;
  currentDate: string | null;
  currentRowId: number | null;
  series: string;
  suggestedMrp: number | null;
  status: "suggested" | "no_change" | "excluded";
  reason: string;
  due: boolean;
  overdue: boolean;
  seriesRate: number | null;
  confidence: HistoricalConfidence;
  evidence: {
    series: string;
    revisionDates: string[];
    eventDistributions: HistoricalSeriesAnalysis["eventDistributions"];
    cadenceMonths: number | null;
    typicalRate: number | null;
    p10Rate: number | null;
    p90Rate: number | null;
    spreadPoints: number | null;
    confidence: HistoricalConfidence;
    status: HistoricalSeriesStatus;
    monthsSinceLast: number | null;
    nextExpectedDate: string | null;
    product: HistoricalProductEvidence;
    seriesAnalysis: HistoricalSeriesEvidence;
  };
};

export type HistoricalEvaluation = {
  products: HistoricalProductResult[];
  series: HistoricalSeriesAnalysis[];
  summary: {
    total: number;
    suggested: number;
    due: number;
    overdue: number;
    usableSeries: number;
    unusableSeries: number;
    confidence: Record<HistoricalConfidence, number>;
  };
};

const DAY = 86_400_000;
const MONTH = 30.4375;

function quantile(values: number[], fraction: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower);
}

function median(values: number[]): number | null {
  return quantile(values, 0.5);
}

function monthsBetween(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY / MONTH;
}

export function addMonths(date: string, months: number): string {
  const source = new Date(`${date}T00:00:00Z`);
  const whole = Math.round(months);
  const originalDay = source.getUTCDate();
  const target = new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth() + whole, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(originalDay, lastDay));
  return target.toISOString().slice(0, 10);
}

function roundCurrency(value: number): number {
  // Existing generator semantics use a one-rupee, nearest lattice.
  return Math.round(value);
}

function canonicalHistory(rows: HistoricalPriceRow[], asOf: string): HistoricalPriceRow[] {
  const eligible = rows.filter((row) =>
    row.effectiveDate <= asOf &&
    (row.reviewStatus == null || row.reviewStatus === "approved") &&
    (row.variant == null || row.variant === "Standard") &&
    Number.isFinite(row.mrp),
  );
  const byKey = new Map<string, HistoricalPriceRow>();
  for (const row of eligible) {
    const key = `${row.itemCode}\u0000${row.effectiveDate}`;
    const previous = byKey.get(key);
    if (!previous || row.id > previous.id) byKey.set(key, row);
  }
  return [...byKey.values()].sort((a, b) =>
    a.itemCode.localeCompare(b.itemCode) ||
    a.effectiveDate.localeCompare(b.effectiveDate) ||
    a.id - b.id,
  );
}

function seriesName(product: HistoricalProduct): string {
  return product.seriesRange?.trim() || "(Unassigned series)";
}

/**
 * Compute P014 using approved Standard rows. Boundary policy is explicit:
 * spread < 1.5 points is uniform; 1.5 <= spread <= 4 is WEAK; spread > 4
 * is NONE. Revision dates are all distinct positive-increase event dates, but
 * the current house rate is sampled only from the latest such event. A
 * cadence is consistent when every observed interval is within one month of
 * its median. A series needs at least five products changed in its latest
 * event and two revision dates to be usable.
 */
export function evaluateHistoricalMrp(
  products: HistoricalProduct[],
  history: HistoricalPriceRow[],
  asOf: string,
): HistoricalEvaluation {
  const canonical = canonicalHistory(history, asOf);
  const byCode = new Map<string, HistoricalPriceRow[]>();
  for (const row of canonical) {
    const rows = byCode.get(row.itemCode) ?? [];
    rows.push(row);
    byCode.set(row.itemCode, rows);
  }
  const allProducts = products.map((product) => {
    const rows = byCode.get(product.itemCode) ?? [];
    const current = rows.at(-1);
    return {
      ...product,
      currentMrp: product.currentMrp ?? (current?.mrp ?? null),
      currentDate: product.currentDate ?? (current?.effectiveDate ?? null),
      currentRowId: product.currentRowId ?? (current?.id ?? null),
    };
  });
  const groups = new Map<string, HistoricalProduct[]>();
  for (const product of allProducts) {
    const list = groups.get(seriesName(product)) ?? [];
    list.push(product);
    groups.set(seriesName(product), list);
  }
  const positiveEventsByCode = new Map<string, Array<{ date: string; rate: number }>>();
  const revisionEventsByCode = new Map<string, Array<{ date: string; rate: number }>>();
  for (const [itemCode, rows] of byCode) {
    const events: Array<{ date: string; rate: number }> = [];
    const revisions: Array<{ date: string; rate: number }> = [];
    for (let index = 1; index < rows.length; index += 1) {
      const previous = rows[index - 1]!;
      const current = rows[index]!;
      if ((previous.mrp ?? 0) <= 0 || (current.mrp ?? 0) <= 0 || current.mrp === previous.mrp) continue;
      const rate = ((current.mrp! - previous.mrp!) / previous.mrp!) * 100;
      if (!Number.isFinite(rate) || rate === 0) continue;
      revisions.push({ date: current.effectiveDate, rate });
      if (rate > 0) events.push({ date: current.effectiveDate, rate });
    }
    positiveEventsByCode.set(itemCode, events);
    revisionEventsByCode.set(itemCode, revisions);
  }

  const analyses: HistoricalSeriesAnalysis[] = [];
  const bySeries = new Map<string, HistoricalSeriesAnalysis>();
  for (const [series, members] of groups) {
    const ratesByDate = new Map<string, number[]>();
    for (const product of members) {
      for (const event of positiveEventsByCode.get(product.itemCode) ?? []) {
        const rates = ratesByDate.get(event.date) ?? [];
        rates.push(event.rate);
        ratesByDate.set(event.date, rates);
      }
    }
    const revisionDates = [...ratesByDate.keys()].sort();
    const latestRevisionDate = revisionDates.at(-1) ?? null;
    const latestRates = latestRevisionDate ? (ratesByDate.get(latestRevisionDate) ?? []) : [];
    const eventDistributions = revisionDates.map((date) => {
      const eventRates = ratesByDate.get(date) ?? [];
      return {
        date,
        productCount: eventRates.length,
        rates: [...eventRates].sort((a, b) => a - b),
        typicalRate: median(eventRates),
        p10Rate: quantile(eventRates, 0.1),
        p90Rate: quantile(eventRates, 0.9),
      };
    });
    const dateIntervals = revisionDates.slice(1).map((date, index) => monthsBetween(revisionDates[index]!, date));
    const cadenceMonths = median(dateIntervals);
    // Earlier events establish cadence and revision count only. Pooling them
    // into the current rate would make an old house-rate distribution dilute
    // the most recent revision (and can hide a latest-event reset).
    const typicalRate = median(latestRates);
    const p10Rate = quantile(latestRates, 0.1);
    const p90Rate = quantile(latestRates, 0.9);
    const spreadPoints = p10Rate != null && p90Rate != null ? p90Rate - p10Rate : null;
    const uniform = spreadPoints != null && spreadPoints < 1.5;
    const cadenceConsistent = dateIntervals.length > 0 && cadenceMonths != null &&
      dateIntervals.every((interval) => Math.abs(interval - cadenceMonths!) <= 1);
    const confidence: HistoricalConfidence =
      latestRates.length < 5 || revisionDates.length < 2 || spreadPoints == null || spreadPoints > 4 ? "NONE" :
        revisionDates.length >= 3 && uniform && cadenceConsistent ? "STRONG" :
          uniform ? "MODERATE" :
            spreadPoints >= 1.5 && spreadPoints <= 4 ? "WEAK" : "NONE";
    // For three or more low-spread events with inconsistent cadence, the
    // deterministic fallback is MODERATE: the latest distribution is usable,
    // but the cadence evidence is not strong enough for STRONG.
    const usable = latestRates.length >= 5 && revisionDates.length >= 2 && uniform &&
      typicalRate != null && cadenceMonths != null;
    const lastRevisionDate = latestRevisionDate;
    const monthsSinceLast = lastRevisionDate ? Math.max(0, monthsBetween(lastRevisionDate, asOf)) : null;
    // Due dates use calendar-month arithmetic so a six-month cadence from
    // 01 Sep is due on 01 Mar even when the two intervals have different day
    // counts. This also makes the boundary deterministic for API consumers.
    const nextExpectedDate = lastRevisionDate && cadenceMonths != null ? addMonths(lastRevisionDate, cadenceMonths) : null;
    const due = usable && nextExpectedDate != null && asOf >= nextExpectedDate;
    const overdue = due && nextExpectedDate != null && asOf > nextExpectedDate;
    const status: HistoricalSeriesStatus = !usable ? "PATTERN_NOT_USABLE" :
      due ? (overdue ? "OVERDUE" : "DUE") : "NOT_DUE";
    let reason: string | null = null;
    if (!usable) {
      reason = latestRates.length < 5 ? "Pattern not usable: fewer than 5 products changed in the latest revision." :
        revisionDates.length < 2 ? "Pattern not usable: only one or no revision observed." :
          spreadPoints == null || spreadPoints > 4 ? "Pattern not usable: revision spread exceeds 4 percentage points; likely a reset." :
            "Pattern not usable: revision history is inconsistent.";
    } else if (!due) {
      reason = `Not due: last revision was ${monthsSinceLast ?? 0} months ago; next expected around ${addMonths(lastRevisionDate!, cadenceMonths!)}.`;
    }
    const analysis: HistoricalSeriesAnalysis = {
      series, productCount: members.length, revisionCount: revisionDates.length,
      revisionDates, eventDistributions, cadenceMonths, cadenceIntervals: dateIntervals,
      typicalRate, p10Rate, p90Rate, spreadPoints, uniform, usable, confidence,
      lastRevisionDate, monthsSinceLast, status, due, overdue,
      nextExpectedDate,
      reason,
    };
    analyses.push(analysis);
    bySeries.set(series, analysis);
  }

  const results = allProducts.map((product): HistoricalProductResult => {
    const series = seriesName(product);
    const analysis = bySeries.get(series)!;
    const productEvents = revisionEventsByCode.get(product.itemCode) ?? [];
    const lastProductEvent = productEvents.at(-1) ?? null;
    const productLastRevisionDate = lastProductEvent?.date ?? null;
    const productMonthsSinceLast = productLastRevisionDate
      ? Math.max(0, monthsBetween(productLastRevisionDate, asOf)) : null;
    const productNextExpectedDate = productLastRevisionDate && analysis.cadenceMonths != null
      ? addMonths(productLastRevisionDate, analysis.cadenceMonths) : null;
    const due = analysis.usable && lastProductEvent != null && productNextExpectedDate != null &&
      asOf >= productNextExpectedDate;
    const overdue = due && productNextExpectedDate != null && asOf > productNextExpectedDate;
    const productStatus: HistoricalSeriesStatus = !analysis.usable || !lastProductEvent
      ? "PATTERN_NOT_USABLE" : due ? (overdue ? "OVERDUE" : "DUE") : "NOT_DUE";
    const productReason = !analysis.usable ? analysis.reason :
      !lastProductEvent ? "No suggestion: product has no positive revision history." :
        !due ? `Not due: last revision was ${productMonthsSinceLast ?? 0} months ago; next expected around ${productNextExpectedDate}.` : null;
    const suggested = analysis.usable && due && product.currentMrp != null && analysis.typicalRate != null
      ? roundCurrency(product.currentMrp * (1 + analysis.typicalRate / 100)) : null;
    const reason = suggested != null
      ? `Series ${series} ${analysis.confidence} rate applied (${analysis.typicalRate!.toFixed(2)}%), ${overdue ? "overdue" : "due"}.`
      : productReason ?? (product.currentMrp == null
        ? "No suggestion: current MRP is unavailable."
        : "No historical suggestion.");
    return {
      ...product,
      currentMrp: product.currentMrp ?? null,
      currentDate: product.currentDate ?? null,
      currentRowId: product.currentRowId ?? null,
      series, suggestedMrp: suggested,
      status: suggested != null ? "suggested" : "no_change",
      reason, due, overdue,
      seriesRate: analysis.typicalRate,
      confidence: analysis.confidence,
      evidence: {
        series, revisionDates: analysis.revisionDates,
        eventDistributions: analysis.eventDistributions,
        cadenceMonths: analysis.cadenceMonths, typicalRate: analysis.typicalRate,
        p10Rate: analysis.p10Rate, p90Rate: analysis.p90Rate,
        spreadPoints: analysis.spreadPoints, confidence: analysis.confidence,
        status: productStatus,
        monthsSinceLast: productMonthsSinceLast,
        nextExpectedDate: productNextExpectedDate,
        product: {
          lastRevisionDate: productLastRevisionDate,
          monthsSinceLast: productMonthsSinceLast,
          nextExpectedDate: productNextExpectedDate,
          due, overdue, status: productStatus, reason: productReason,
        },
        seriesAnalysis: {
          series: analysis.series,
          productCount: analysis.productCount,
          revisionCount: analysis.revisionCount,
          revisionDates: analysis.revisionDates,
          cadenceMonths: analysis.cadenceMonths,
          cadenceIntervals: analysis.cadenceIntervals,
          typicalRate: analysis.typicalRate,
          p10Rate: analysis.p10Rate,
          p90Rate: analysis.p90Rate,
          spreadPoints: analysis.spreadPoints,
          uniform: analysis.uniform,
          usable: analysis.usable,
          confidence: analysis.confidence,
          lastRevisionDate: analysis.lastRevisionDate,
          monthsSinceLast: analysis.monthsSinceLast,
          status: analysis.status,
          due: analysis.due,
          overdue: analysis.overdue,
          nextExpectedDate: analysis.nextExpectedDate,
          reason: analysis.reason,
        },
      },
    };
  });
  const confidence = { STRONG: 0, MODERATE: 0, WEAK: 0, NONE: 0 };
  for (const analysis of analyses) confidence[analysis.confidence] += 1;
  return {
    products: results,
    series: analyses.sort((a, b) => a.series.localeCompare(b.series)),
    summary: {
      total: results.length,
      suggested: results.filter((result) => result.suggestedMrp != null).length,
      due: results.filter((result) => result.due && !result.overdue).length,
      overdue: results.filter((result) => result.overdue).length,
      usableSeries: analyses.filter((analysis) => analysis.usable).length,
      unusableSeries: analyses.filter((analysis) => !analysis.usable).length,
      confidence,
    },
  };
}

// Named aliases keep the pure engine convenient for callers that describe the
// operation as a computation rather than an evaluation.
export const computeHistoricalMrp = evaluateHistoricalMrp;
export const historicalMrpEngine = evaluateHistoricalMrp;