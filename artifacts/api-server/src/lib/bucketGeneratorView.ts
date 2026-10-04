import type { mrpGeneratorResultsTable, mrpGeneratorRunsTable } from "@workspace/db";
import { filterBucketRows, hasBucketFilter } from "./bucketFilter";
import { evaluateP011Portfolio, type GeneratorProduct, type GeneratorResult } from "./mrpGenerator";

type Run = typeof mrpGeneratorRunsTable.$inferSelect;
type Result = typeof mrpGeneratorResultsTable.$inferSelect;
const parse = (value: string | null | undefined): Record<string, any> => JSON.parse(value ?? "{}");
const median = (values: number[]) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)]! + sorted[Math.floor(sorted.length / 2)]!) / 2 : null;
};
const distribution = (values: (string | null | undefined)[]) => {
  const counts: Record<string, number> = {};
  for (const value of values) if (value != null) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
};

/** Read-only projection of an immutable run: never reevaluate recommendations
 * or overwrite the snapshot, fingerprint, policy, results or stored summary. */
export function bucketRunSummary(run: Run, supplied: Result[]) {
  const original = parse(run.summary);
  if (!hasBucketFilter()) return original;
  const rows = filterBucketRows(supplied, row => row.itemCode);
  const snapshot = parse(run.inputSnapshot);
  const products = new Map((snapshot.products ?? []).map((product: any) => [product.itemCode, product]));
  const policies = filterBucketRows<any>(snapshot.p012Results ?? snapshot.p011Results ?? [], row => row.itemCode);
  const evidence = rows.map(row => parse(row.evidence));
  const changes = rows.map(row => row.changePercent).filter((n): n is number => n != null);
  const reasons = rows.filter(row => row.status === "excluded").map(row => row.reason ?? "Unspecified exclusion");
  const summary: Record<string, any> = {
    ...Object.fromEntries(["modelKind", "runType", "actor", "scope", "policyVersion"].filter(key => key in original).map(key => [key, original[key]])),
    total: rows.length,
    suggested: rows.filter(row => row.status === "suggested").length,
    noChange: rows.filter(row => row.status === "no_change").length,
    excluded: rows.filter(row => row.status === "excluded").length,
    increases: changes.filter(n => n > 0).length, decreases: changes.filter(n => n < 0).length,
    medianIncreasePercent: median(changes.filter(n => n > 0)),
    medianDecreasePercent: median(changes.filter(n => n < 0)),
    medianChangePercent: median(changes.filter(n => n !== 0)),
    exclusionReasonBreakdown: distribution(reasons),
    // A legacy run without per-product confidence evidence cannot truthfully
    // redistribute its original full-scope coverage count.
    confidencePassCount: null,
  };
  if ("manual" in original) summary.manual = rows.length;
  if (run.modelKind === "historical") {
    const series = new Map(rows.map((row, i) => [row.series ?? row.itemCode, evidence[i]!]));
    Object.assign(summary, {
      due: evidence.filter(row => row.status === "DUE").length,
      overdue: evidence.filter(row => row.status === "OVERDUE").length,
      usableSeries: [...series.values()].filter(row => row.typicalRate != null).length,
      unusableSeries: [...series.values()].filter(row => row.typicalRate == null).length,
      confidence: { STRONG: 0, MODERATE: 0, WEAK: 0, NONE: 0, ...distribution(evidence.map(row => row.confidence)) },
    });
  }
  if (original.policyVersion === 3) {
    const tierDistribution = { A: 0, B: 0, C: 0, F: 0 };
    const rowCounts: Record<string, any> = Object.fromEntries(Object.keys(original.rowCounts ?? {}).map(id => [
      id, { scopeMatched: 0, withCompetitorPrice: 0, wouldChange: 0, matchedFySalesValue: 0, tierDistribution: { ...tierDistribution } },
    ]));
    for (const result of policies) {
      const tier = result.volumeTier as keyof typeof tierDistribution;
      if (tier in tierDistribution) tierDistribution[tier]++;
      if (!result.matchedRowId) continue;
      const count = rowCounts[result.matchedRowId] ??= { scopeMatched: 0, withCompetitorPrice: 0, wouldChange: 0, matchedFySalesValue: 0, tierDistribution: { A: 0, B: 0, C: 0, F: 0 } };
      count.scopeMatched++;
      if (result.selectedCompetitorPrice != null) count.withCompetitorPrice++;
      if (result.status === "suggested") count.wouldChange++;
      if (Number.isFinite(result.fySalesAmount)) count.matchedFySalesValue += result.fySalesAmount;
      if (tier in count.tierDistribution) count.tierDistribution[tier]++;
    }
    Object.assign(summary, {
      evaluated: rows.length, wouldChange: summary.suggested,
      noCompetitorUntouched: policies.filter(row => row.matchedRowId != null && row.selectedCompetitorPrice == null).length,
      fallthroughUntouched: policies.filter(row => row.matchedRowId == null).length,
      rowCounts, tierDistribution,
      warnings: policies.some(row => row.matchedRowId == null) ? [`${policies.filter(row => row.matchedRowId == null).length} visible product(s) fall through untouched.`] : [],
    });
  }
  if (original.policyVersion === 2 && Array.isArray(snapshot.p011Results)) {
    // Reuse the original portfolio aggregation over frozen evidence and frozen
    // recommendations. This does not reevaluate bands, actions or suggestions.
    const values = filterBucketRows<GeneratorProduct>([...products.values()] as GeneratorProduct[], row => row.itemCode);
    const portfolio = evaluateP011Portfolio(values, policies as GeneratorResult[], snapshot.policy);
    Object.assign(summary, {
      actionCounts: distribution(policies.map(row => row.action)), bandDistribution: distribution(policies.map(row => row.band)),
      actionValueImpacts: portfolio.actionValueImpacts,
      salesValueRepresented: portfolio.coveredSalesValue,
      portfolio,
    });
  }
  return summary;
}

export function bucketRunSnapshot(raw: string | null | undefined) {
  const snapshot = parse(raw);
  if (!hasBucketFilter()) return snapshot;
  for (const key of ["products", "p011Results", "p012Results"]) {
    if (Array.isArray(snapshot[key])) snapshot[key] = filterBucketRows<any>(snapshot[key], row => row.itemCode);
  }
  return snapshot;
}