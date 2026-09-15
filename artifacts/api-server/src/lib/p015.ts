import type { GeneratorProduct, GeneratorCompetitor } from "./mrpGenerator";

export type MatchingDriver = "lowest" | "highest" | { named: string };
export type MatchingActionType = "match" | "less_by_percent" | "leave" | "set";

export type MatchingAction = {
  itemCode: string;
  action: MatchingActionType;
  percent?: number;
  price?: number;
  driver?: MatchingDriver;
  source?: "manual" | "bulk";
  bulkId?: string;
  bulkDescription?: string;
  filter?: "above" | "below" | "all";
};

export type MatchingDecision = {
  suggestedMrp: number | null;
  status: "suggested" | "no_change";
  driver: string | null;
  action: MatchingActionType;
  trace: Array<Record<string, unknown>>;
};

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export function normalizeMatchingCompetitorName(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function selectMatchingCompetitor(
  product: GeneratorProduct,
  selected: string[],
  driver: MatchingDriver = "lowest",
): GeneratorCompetitor | null {
  const candidates = product.competitors.filter((competitor) =>
    selected.some((name) => normalizeMatchingCompetitorName(name) === normalizeMatchingCompetitorName(competitor.competitor)) &&
    competitor.matched && finite(competitor.effectivePrice) && competitor.effectivePrice > 0,
  );
  if (!candidates.length) return null;
  if (typeof driver === "object") {
    return candidates.find((candidate) =>
      normalizeMatchingCompetitorName(candidate.competitor) === normalizeMatchingCompetitorName(driver.named),
    ) ?? null;
  }
  return [...candidates].sort((a, b) =>
    (driver === "highest" ? b.effectivePrice! - a.effectivePrice! : a.effectivePrice! - b.effectivePrice!) ||
    a.competitor.localeCompare(b.competitor),
  )[0] ?? null;
}

export function matchingPosition(
  currentMrp: number | null,
  competitor: number | null,
): { signedPercent: number | null; direction: "above" | "below" | "equal" | "unknown" } {
  if (!finite(currentMrp) || currentMrp <= 0 || !finite(competitor) || competitor <= 0) {
    return { signedPercent: null, direction: "unknown" };
  }
  const signedPercent = ((currentMrp - competitor) / competitor) * 100;
  return {
    signedPercent,
    direction: signedPercent > 0 ? "above" : signedPercent < 0 ? "below" : "equal",
  };
}

export function materializeMatchingDecision(
  product: GeneratorProduct,
  action: MatchingAction,
  selectedCompetitors: string[],
  globalDriver: MatchingDriver = "lowest",
): MatchingDecision {
  const driver = action.driver ?? globalDriver;
  const competitor = selectMatchingCompetitor(product, selectedCompetitors, driver);
  const driverName = competitor?.competitor ?? (typeof driver === "object" ? driver.named : driver);
  const evidence = competitor?.effectivePrice ?? null;
  const trace: Array<Record<string, unknown>> = [{
    order: 1,
    ruleType: "matching_manual_action",
    outcome: action.action === "leave" ? "skipped" : evidence == null && action.action !== "set" ? "blocked" : "fired",
    before: product.currentMrp,
    after: null,
    reason: action.action === "leave" ? "Reviewed; no change requested." : "P015 manual matching decision.",
    action: action.action,
    actorSource: "authenticated_user",
    attribution: action.source ?? "manual",
    driver: driverName,
    evidence: competitor ? {
      competitor: competitor.competitor,
      effectivePrice: competitor.effectivePrice,
      effectiveDate: competitor.effectiveDate,
      stale: competitor.stale,
    } : null,
  }];
  if (action.action === "leave") {
    return { suggestedMrp: null, status: "no_change", driver: driverName, action: action.action, trace };
  }
  let suggested: number | null = null;
  if (action.action === "set") suggested = finite(action.price) && action.price > 0 ? action.price : null;
  if (action.action === "match") suggested = evidence;
  if (action.action === "less_by_percent" && evidence != null && finite(action.percent) && action.percent >= 0 && action.percent <= 100) {
    suggested = evidence * (1 - action.percent / 100);
  }
  if (suggested == null || !finite(suggested) || suggested <= 0) {
    return { suggestedMrp: null, status: "no_change", driver: driverName, action: action.action, trace };
  }
  trace[0]!.after = suggested;
  return { suggestedMrp: suggested, status: "suggested", driver: driverName, action: action.action, trace };
}

export type CollectiveMarginInput = {
  itemCode?: string;
  currentMrp?: number | null;
  suggestedMrp?: number | null;
  sales?: { qty?: number | null; salesAmount?: number | null } | null;
  margin?: {
    qty?: number | null;
    bomValue?: number | null;
    saleValue?: number | null;
    avgSale?: number | null;
    held?: boolean;
  } | null;
};

export type CollectiveMarginReport = {
  current: number | null;
  projected: number | null;
  deltaPoints: number | null;
  includedCount: number;
  excludedCount: number;
  excludedByReason: Record<string, number>;
  coverage: { numerator: number; denominator: number; share: number | null };
  valueAtRisk: { value: number; unknownCount: number };
  sourcePeriods: { sales: string | null; margin: string | null };
  holds: string[];
  assumptions: string[];
};

/**
 * P015's collective margin calculation. This is intentionally pure: callers
 * supply one already-cached Sales snapshot and no source refresh occurs here.
 */
export function calculateCollectiveMargin(
  products: CollectiveMarginInput[],
  metadata: Partial<Pick<CollectiveMarginReport, "sourcePeriods" | "holds">> = {},
): CollectiveMarginReport {
  let currentNumerator = 0;
  let currentDenominator = 0;
  let projectedNumerator = 0;
  let projectedDenominator = 0;
  let coverageNumerator = 0;
  let coverageDenominator = 0;
  let valueAtRisk = 0;
  let valueAtRiskUnknown = 0;
  let includedCount = 0;
  const excludedByReason: Record<string, number> = {};
  const excluded = (reason: string) => { excludedByReason[reason] = (excludedByReason[reason] ?? 0) + 1; };
  for (const product of products) {
    const persistedSalesValue = finite(product.sales?.salesAmount) && product.sales!.salesAmount! >= 0
      ? product.sales!.salesAmount! : null;
    const scopeValue = persistedSalesValue != null && persistedSalesValue > 0 ? persistedSalesValue : null;
    if (scopeValue != null) coverageDenominator += scopeValue;
    const suggestion = product.suggestedMrp;
    if (!finite(suggestion) || suggestion <= 0) { excluded("no_suggestion"); continue; }
    const currentMrp = product.currentMrp;
    if (!finite(currentMrp) || currentMrp <= 0) { excluded("missing_current_mrp"); continue; }
    // Value-at-risk is a Sales-value measure, not a margin-eligibility
    // measure. Count every valid rising suggestion before strict margin
    // evidence checks exclude it from the collective-margin formula.
    if (suggestion > currentMrp) {
      if (persistedSalesValue != null) valueAtRisk += persistedSalesValue;
      else valueAtRiskUnknown += 1;
    }
    const margin = product.margin;
    if (!margin || margin.held) { excluded(margin?.held ? "margin_held" : "missing_margin"); continue; }
    const marginQty = margin.qty;
    const salesQty = product.sales?.qty;
    const bomValue = margin.bomValue;
    const avgSale = margin.avgSale ?? (
      finite(margin.saleValue) && finite(marginQty) && marginQty > 0 ? margin.saleValue! / marginQty : null
    );
    if (!finite(marginQty) || marginQty <= 0 || !finite(bomValue) || !finite(avgSale) || avgSale <= 0) {
      excluded("unusable_margin_evidence"); continue;
    }
    if (!finite(salesQty) || salesQty <= 0) { excluded("missing_sales_qty"); continue; }
    const unitCost = bomValue! / marginQty!;
    const newAvgSale = avgSale! * (suggestion! / currentMrp!);
    if (!finite(unitCost) || !finite(newAvgSale) || newAvgSale <= 0) { excluded("invalid_formula"); continue; }
    const currentProfit = avgSale! - unitCost;
    const projectedProfit = newAvgSale - unitCost;
    currentNumerator += salesQty! * currentProfit;
    currentDenominator += salesQty! * avgSale!;
    projectedNumerator += salesQty! * projectedProfit;
    projectedDenominator += salesQty! * newAvgSale;
    includedCount += 1;
    if (scopeValue != null) coverageNumerator += scopeValue;
  }
  const current = currentDenominator > 0 ? currentNumerator / currentDenominator : null;
  const projected = projectedDenominator > 0 ? projectedNumerator / projectedDenominator : null;
  return {
    current, projected,
    deltaPoints: current != null && projected != null ? (projected - current) * 100 : null,
    includedCount,
    excludedCount: products.length - includedCount,
    excludedByReason,
    coverage: {
      numerator: coverageNumerator,
      denominator: coverageDenominator,
      share: coverageDenominator > 0 ? coverageNumerator / coverageDenominator : null,
    },
    valueAtRisk: { value: valueAtRisk, unknownCount: valueAtRiskUnknown },
    sourcePeriods: { sales: metadata.sourcePeriods?.sales ?? null, margin: metadata.sourcePeriods?.margin ?? null },
    holds: metadata.holds ?? [],
    assumptions: [
      "Discount holds: realised price changes by the same percentage as MRP.",
      "Volume holds: sales quantities are unchanged; no elasticity estimate is used.",
    ],
  };
}