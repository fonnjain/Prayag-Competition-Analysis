import { Router, type IRouter } from "express";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  catalogProductsTable,
  mrpPriceHistoryTable,
  competitorPricesTable,
  mrpGeneratorScenariosTable,
  mrpGeneratorRunsTable,
  mrpGeneratorResultsTable,
  mrpRevisionBatchesTable,
  mrpRevisionRowsTable,
} from "@workspace/db";
import { requireAdmin } from "../middlewares/authMiddleware";
import { getCompetitorRowsForPeriod, getPrayagCatalogMapForPeriod } from "./analysis";
import { effectivePrice } from "../lib/analysis";
import {
  evaluateProduct,
  inputFingerprint,
  matchesScope,
  stableJson,
  validateScenarioRules,
  canonicalItemCode,
  computeVolumeTiers,
  evaluateP011Scenario,
  validateP011Policy,
  DEFAULT_P011_POLICY,
  DEFAULT_P012_SCENARIO,
  DEFAULT_P017_SCENARIO,
  normalizeP012Policy,
  validateP012Policy,
  evaluateP012Scenario,
  promoteP012ToAdvanced,
  convertAdvancedToP012,
  SUPPORTED_VOLUME_PERIOD,
  type GeneratorProduct,
  type GeneratorRule,
  type GeneratorScope,
  type P011Policy,
  type P012SimplePolicy,
  type P012AdvancedRepresentation,
} from "../lib/mrpGenerator";
import { evaluateHistoricalMrp, type HistoricalPriceRow } from "../lib/historicalMrp";
import {
  awaitingConfirmationCodes,
  getSalesApiStatus,
  getCachedSalesSnapshot,
  getSalesSnapshot,
  getSalesOptionSnapshot,
  getSalesComponentStatus,
  hasHeldMarginCoverage,
  SalesApiError,
  type SalesSnapshot,
  type SalesCoverage,
  SUPPORTED_SALES_PERIOD,
  SALES_PAGE_SIZE,
  SALES_REQUEST_LIMIT,
  SALES_REQUEST_WINDOW_SECONDS,
  SALES_TARGET_REQUEST_INTERVAL_MS,
} from "../lib/salesApi";
import {
  calculateCollectiveMargin,
  matchingPosition,
  materializeMatchingDecision,
  normalizeMatchingCompetitorName,
  selectMatchingCompetitor,
  type MatchingAction,
  type MatchingActionType,
  type MatchingDriver,
  type CollectiveMarginInput,
} from "../lib/p015";

const router: IRouter = Router();
const today = () => new Date().toISOString().slice(0, 10);
const KNOWN_LIMITS = {
  pageLimit: SALES_PAGE_SIZE,
  pageSize: SALES_PAGE_SIZE,
  requestLimit: SALES_REQUEST_LIMIT,
  requestWindowSeconds: SALES_REQUEST_WINDOW_SECONDS,
  targetRequestIntervalMs: SALES_TARGET_REQUEST_INTERVAL_MS,
  maxRestarts: 2,
  salesPeriod: ["2026-04..2026-08"],
  marginPeriod: ["2026-04..2026-06"],
} as const;
const json = (value: unknown): string => JSON.stringify(value);
const parsed = <T>(value: unknown, fallback: T): T => {
  if (value && typeof value === "object") return value as T;
  try { return JSON.parse(String(value)) as T; } catch { return fallback; }
};
const scenarioPolicyFromRules = (value: unknown): P011Policy | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const wrapper = value as { policyVersion?: unknown; policy?: unknown };
  return wrapper.policyVersion === 2 && wrapper.policy && typeof wrapper.policy === "object"
    ? wrapper.policy as P011Policy : null;
};
const scenarioSimplePolicyFromRules = (value: unknown): P012SimplePolicy | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const wrapper = value as { policyVersion?: unknown; policy?: unknown; mode?: unknown };
  if (wrapper.policyVersion === 3 && wrapper.policy && typeof wrapper.policy === "object") {
    return normalizeP012Policy(wrapper.policy);
  }
  if (wrapper.mode === "simple" && Array.isArray((wrapper as { rows?: unknown }).rows)) {
    return normalizeP012Policy(wrapper);
  }
  return null;
};
const scenarioPromotedAdvancedFromRules = (value: unknown): P012SimplePolicy | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const advanced = (value as { advanced?: unknown }).advanced;
  if (!advanced || typeof advanced !== "object" || Array.isArray(advanced)) return null;
  const source = advanced as { source?: unknown; simpleRows?: unknown };
  return source.source === "p012-simple" && Array.isArray(source.simpleRows)
    ? normalizeP012Policy({ ...advanced, rows: source.simpleRows }) : null;
};
const advancedPolicyFromInput = (value: unknown): P012AdvancedRepresentation => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("advancedPolicy must be an object.");
  const converted = convertAdvancedToP012(value);
  if ("reasons" in converted) throw new Error(converted.reasons.join(" "));
  return value as P012AdvancedRepresentation;
};
const snapshotPolicyVersion = (snapshot: {
  policyVersion?: unknown;
  policy?: unknown;
  p011Results?: unknown;
  simplePolicy?: unknown;
  p012Results?: unknown;
}): 1 | 2 | 3 =>
  snapshot.policyVersion === 1 || snapshot.policyVersion === 2 || snapshot.policyVersion === 3
    ? snapshot.policyVersion
    : snapshot.p012Results != null || snapshot.simplePolicy != null ? 3
      : snapshot.p011Results != null || snapshot.policy != null ? 2 : 1;
const snapshotModelKind = (snapshot: { modelKind?: unknown }): "competitive" | "historical" =>
  snapshot.modelKind === "historical" ? "historical" : "competitive";
const snapshotRunType = (snapshot: { runType?: unknown; modelKind?: unknown }): "rule" | "historical" | "matching" =>
  snapshot.runType === "historical" || snapshot.modelKind === "historical" ? "historical"
    : snapshot.runType === "matching" ? "matching" : "rule";
export function classifyBinaryHistoricalCompetitiveCategory(
  historicalValue: number | null,
  competitiveValue: number | null,
): "competitive_only" | "historical_only" | "agree" | "historical_above_competitive" | "historical_below_competitive" | "disagreement" {
  if (historicalValue == null && competitiveValue != null) return "competitive_only";
  if (historicalValue != null && competitiveValue == null) return "historical_only";
  if (historicalValue === competitiveValue) return "agree";
  if (historicalValue != null && competitiveValue != null && historicalValue > competitiveValue) return "historical_above_competitive";
  if (historicalValue != null && competitiveValue != null && historicalValue < competitiveValue) return "historical_below_competitive";
  return "disagreement";
}
function exposedScenario(row: typeof mrpGeneratorScenariosTable.$inferSelect) {
  const storedRules = parsed<unknown>(row.rules, []);
  const isCanonicalDefault = isVerifiedP017Canonical(row) || isVerifiedP017Policy(row);
  const p017Migration = storedRules && typeof storedRules === "object" && !Array.isArray(storedRules) &&
    JSON.stringify((storedRules as { p017Migration?: unknown }).p017Migration) === JSON.stringify(P017_CANONICAL_MARKER)
    ? P017_CANONICAL_MARKER : null;
  const policy = scenarioPolicyFromRules(storedRules);
  const simplePolicy = scenarioSimplePolicyFromRules(storedRules);
  const advanced = storedRules && typeof storedRules === "object" && !Array.isArray(storedRules)
    ? (storedRules as { advanced?: unknown }).advanced ?? null : null;
  return {
    ...row,
    scope: parsed(row.scope, {}),
    rules: policy || simplePolicy ? [] : storedRules,
    policy,
    simplePolicy,
    advanced,
    advancedPolicy: advanced,
    policyVersion: policy ? 2 : simplePolicy ? 3 : advanced ? 2 : 1,
    isDefault: isCanonicalDefault,
    canReset: isCanonicalDefault,
    canonicalProvenance: p017Migration,
  };
}
const actor = (req: Parameters<typeof requireAdmin>[0]) => req.user?.email ?? req.user?.id ?? null;
const validDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
const median = (values: number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

function ageDays(date: string | null, asOf: string): number | null {
  if (!date) return null;
  const value = Math.floor((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86400000);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function isStale(date: string | null, asOf: string): boolean {
  const age = ageDays(date, asOf);
  // Calendar approximation deliberately errs on the visible side for a
  // requirement stated in months (18 months is at least 548 days).
  return age != null && age >= 548;
}

async function productsFor(asOf: string): Promise<GeneratorProduct[]> {
  const [products, maps, competitors, currentRows] = await Promise.all([
    db.select({
      itemCode: catalogProductsTable.itemCode,
      productName: catalogProductsTable.productName,
      division: catalogProductsTable.division,
      category: catalogProductsTable.category,
      seriesRange: catalogProductsTable.seriesRange,
    }).from(catalogProductsTable).where(and(
      eq(catalogProductsTable.isActive, true),
      sql`(${catalogProductsTable.discontinuedFrom} is null or ${catalogProductsTable.discontinuedFrom} > ${asOf})`,
    )),
    getPrayagCatalogMapForPeriod(asOf),
    getCompetitorRowsForPeriod(asOf),
    db.execute<{ id: number; item_code: string; mrp: number; effective_date: string }>(sql`
      SELECT DISTINCT ON (item_code) id, item_code, mrp, effective_date
      FROM mrp_price_history
      WHERE effective_date <= ${asOf} AND mrp IS NOT NULL
        AND review_status = 'approved' AND variant = 'Standard'
      ORDER BY item_code, effective_date DESC, id DESC
    `),
  ]);
  const rowIds = new Map(currentRows.rows.map((r) => [canonicalItemCode(r.item_code), r]));
  const byCode = new Map<string, typeof competitors>();
  for (const row of competitors) {
    if (row.matchStatus !== "matched" || !row.matchedPrayagCode) continue;
    const key = canonicalItemCode(row.matchedPrayagCode);
    const list = byCode.get(key) ?? [];
    list.push(row);
    byCode.set(key, list);
  }
  return [...products].sort((a, b) => a.itemCode.localeCompare(b.itemCode)).map((product) => {
    const key = canonicalItemCode(product.itemCode);
    const map = maps.get(key);
    const row = rowIds.get(key);
    const values = (byCode.get(key) ?? []).map((c) => ({
      competitor: c.competitor,
      price: c.price,
      effectivePrice: c.price == null ? null : effectivePrice(c.unit, c.price, c.priceBasis, c.gstPct),
      effectiveDate: c.effectiveDate ?? null,
      ageDays: ageDays(c.effectiveDate ?? null, asOf),
      stale: isStale(c.effectiveDate ?? null, asOf),
      matched: c.matchStatus === "matched",
    })).sort((a, b) => a.competitor.localeCompare(b.competitor) || (a.effectiveDate ?? "").localeCompare(b.effectiveDate ?? ""));
    return {
      itemCode: product.itemCode,
      productName: product.productName,
      division: product.division?.trim() || null,
      seriesRange: product.seriesRange,
      category: product.category?.trim() || null,
      currentMrp: map?.mrp ?? row?.mrp ?? null,
      currentDate: map?.effectiveDate ?? row?.effective_date ?? null,
      currentRowId: row?.id ?? null,
      competitors: values,
    };
  });
}

const salesRuleTypes = new Set(["margin_floor", "volume_tier"]);
const hasSalesRules = (rules: GeneratorRule[], scope: GeneratorScope): boolean =>
  scope.confidenceOnly === true || rules.some((rule) => salesRuleTypes.has(
    typeof rule.type === "string" ? rule.type.toLowerCase().replace(/[\s-]+/g, "_") : "",
  ));
const salesPeriod = (rules: GeneratorRule[]): string =>
  String(rules.find((rule) => rule.type === "volume_tier")?.period ?? SUPPORTED_VOLUME_PERIOD)
    .trim().toUpperCase().replace(/^FY/, "");

function salesErrorStatus(error: unknown): number {
  if (error instanceof SalesApiError && error.kind === "auth") return 502;
  if (error instanceof SalesApiError && error.kind === "rate_limited") return 429;
  if (error instanceof SalesApiError && error.kind === "missing_credential") return 503;
  return 503;
}

async function requiredSalesSnapshot(refresh = false, period = SUPPORTED_VOLUME_PERIOD, option?: "margin" | "volume" | "both"): Promise<SalesSnapshot> {
  try {
    if (option === "margin") return await getSalesOptionSnapshot({ margin: true, refresh, period });
    if (option === "volume") return await getSalesOptionSnapshot({ sales: true, refresh, period });
    if (option === "both") return await getSalesOptionSnapshot({ sales: true, margin: true, refresh, period });
    return await getSalesSnapshot({ refresh, period });
  } catch (error) {
    const wrapped = error instanceof Error ? error : new Error("Sales API snapshot is unavailable.");
    if (option) Object.assign(wrapped, { option });
    Object.assign(wrapped, { httpStatus: salesErrorStatus(error) });
    throw wrapped;
  }
}

async function bootstrapSalesStatus() {
  const current = getSalesApiStatus();
  if (current.status === "missing_credential" || current.status === "auth_failed" || current.available) return current;
  try {
    await getSalesSnapshot();
  } catch {
    // Metadata/freshness are status surfaces; an upstream failure is returned
    // as a safe status rather than turning the request into a 5xx.
  }
  return getSalesApiStatus();
}

async function bootstrapComponentStatus(component: "sales" | "margin") {
  const current = getSalesComponentStatus(component);
  if (current.status === "missing_credential" || current.status === "auth_failed" || current.available) return current;
  try {
    await getSalesOptionSnapshot(component === "sales" ? { sales: true } : { margin: true });
  } catch {
    // Metadata exposes the typed component failure below.
  }
  return getSalesComponentStatus(component);
}

function enrichProducts(products: GeneratorProduct[], snapshot: SalesSnapshot): GeneratorProduct[] {
  return products.map((product) => {
    const code = canonicalItemCode(product.itemCode);
    const sales = snapshot.salesByCode[code];
    const awaiting = snapshot.awaitingConfirmationByCode[code];
    const margin = snapshot.marginByCode[code];
    const held = !margin && hasHeldMarginCoverage(snapshot.coverage.margin, product.division);
    return {
      ...product,
       sales: sales ? { ...sales, fySalesExists: true, awaitingConfirmation: false } :
         awaiting ? { ...awaiting, fySalesExists: false, awaitingConfirmation: true, tier: null } :
           { salesAmount: 0, qty: null, qtyUnknown: false, fySalesExists: false, tier: null },
      margin: margin ? {
        grossMarginPct: margin.grossMarginPct,
        qty: margin.qty,
        saleValue: margin.saleValue,
        bomValue: margin.bomValue,
         unitBomValue: margin.unitBomValue,
         qtyUnknown: margin.qtyUnknown,
        discountFrac: margin.discountFrac,
        held: margin.held,
        latestMonth: margin.latestMonth,
        warnings: margin.warnings,
      } : held ? { grossMarginPct: null, held: true, warnings: ["H1/PTMT margin is held by source coverage."] } : null,
    };
  });
}

type CoverageReconciliation = {
  fy: string | null;
  control: number | null;
  actual: number | null;
  variance: number | null;
  variancePct: number | null;
  status: string | null;
  reference: string | null;
};

type CoverageSummary = {
  catalogTotal: number;
  inScopeTotal: number;
  withFySales: number;
  withoutFySales: number;
  withMargin: number;
  confidencePassCount: number | null;
  absentSoldCodes: { count: number; value: number; codes: string[] };
  awaitingConfirmation: { count: number; value: number; codes: string[] };
  periods: {
    sales: { fy: string; from: string; to: string };
    margin: { fy: string; from: string; to: string };
  };
  readAt: { sales: string | null; margin: string | null };
  ages: { salesDays: number | null; marginDays: number | null };
  latestMonths: { sales: string | null; margin: string | null };
  provisional: { sales: string[]; margin: string[] };
  holds: { sales: string[]; margin: string[] };
  unavailable: { sales: string[]; margin: string[] };
  reconciliation: { sales: CoverageReconciliation; margin: CoverageReconciliation };
  dataSource: string | null;
};

function normalizeReconciliation(value: unknown): CoverageReconciliation {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const number = (...keys: string[]) => {
    const value = keys.map((key) => raw[key]).find((item) => item != null);
    const result = value == null ? null : Number(value);
    return result != null && Number.isFinite(result) ? result : null;
  };
  return {
    fy: typeof raw.fy === "string" ? raw.fy : null,
    control: number("control", "controlValue"),
    actual: number("actual", "actualValue"),
    variance: number("variance"),
    variancePct: number("variancePct", "variance_pct"),
    status: typeof raw.status === "string" ? raw.status : null,
    reference: typeof raw.reference === "string" ? raw.reference : null,
  };
}

function salesCoverageSummary(
  allProducts: GeneratorProduct[],
  inScopeProducts: GeneratorProduct[],
  snapshot: SalesSnapshot,
  confidenceOnly: boolean,
): CoverageSummary {
  const aggregateByCode = new Map<string, { amount: number; status: string }>();
  for (const row of snapshot.salesRows) {
    const key = canonicalItemCode(row.code);
    const previous = aggregateByCode.get(key) ?? { amount: 0, status: row.catalogueStatus };
    previous.amount += row.amountTaxable;
    previous.status = row.catalogueStatus;
    aggregateByCode.set(key, previous);
  }
  const awaiting = awaitingConfirmationCodes
    .map((code) => ({ code, value: snapshot.awaitingConfirmationByCode[code]?.salesAmount ?? 0 }))
    .filter((entry) => entry.value > 0);
  const absent = [...aggregateByCode.entries()]
    .filter(([, value]) => value.status === "absent")
    .map(([code, value]) => ({ code, value: value.amount }));
  const withSales = inScopeProducts.filter((product) => product.sales?.fySalesExists).length;
  const withMargin = inScopeProducts.filter((product) =>
    product.margin?.grossMarginPct != null && product.margin.unitBomValue != null && !product.margin.held,
  ).length;
  const confidencePassCount = inScopeProducts.filter((product) =>
    product.competitors.some((competitor) => competitor.matched && competitor.effectivePrice != null) &&
    product.competitors.every((competitor) =>
      !competitor.matched || (competitor.effectivePrice != null && competitor.ageDays != null && competitor.ageDays < 365),
    ) &&
    Boolean(product.sales?.fySalesExists && (product.sales.salesAmount > 0)) &&
    Boolean(product.margin?.grossMarginPct != null && product.margin.unitBomValue != null && !product.margin.held),
  ).length;
  return {
    catalogTotal: allProducts.length,
    inScopeTotal: inScopeProducts.length,
    withFySales: withSales,
    withoutFySales: inScopeProducts.length - withSales,
    withMargin,
    confidencePassCount: confidenceOnly ? confidencePassCount : null,
     absentSoldCodes: {
       count: absent.length,
       value: absent.reduce((sum, row) => sum + row.value, 0),
       codes: absent.map((entry) => entry.code),
     },
     awaitingConfirmation: {
       count: awaiting.length,
       value: awaiting.reduce((sum, row) => sum + row.value, 0),
       codes: awaiting.map((entry) => entry.code),
     },
     periods: {
       sales: { fy: SUPPORTED_VOLUME_PERIOD, from: "2026-04", to: "2026-08" },
       margin: { fy: SUPPORTED_VOLUME_PERIOD, from: "2026-04", to: "2026-06" },
     },
     readAt: {
       sales: typeof snapshot.coverage.sales.read_at === "string" ? snapshot.coverage.sales.read_at : null,
       margin: typeof snapshot.coverage.margin.read_at === "string" ? snapshot.coverage.margin.read_at : null,
     },
     ages: {
       salesDays: typeof snapshot.coverage.sales.read_at === "string" ? ageDays(snapshot.coverage.sales.read_at.slice(0, 10), today()) : null,
       marginDays: typeof snapshot.coverage.margin.read_at === "string" ? ageDays(snapshot.coverage.margin.read_at.slice(0, 10), today()) : null,
     },
     latestMonths: {
       sales: snapshot.salesRows.map((row) => row.monthLabel).sort().at(-1) ?? null,
       margin: snapshot.marginRows.map((row) => row.monthLabel).sort().at(-1) ?? null,
     },
     provisional: {
       sales: snapshot.coverage.sales.provisional,
       margin: snapshot.coverage.margin.provisional,
     },
     holds: { sales: snapshot.coverage.sales.held, margin: snapshot.coverage.margin.held },
     unavailable: { sales: snapshot.coverage.sales.unavailable, margin: snapshot.coverage.margin.unavailable },
     reconciliation: {
       sales: normalizeReconciliation(snapshot.coverage.sales.reconciliation),
       margin: normalizeReconciliation(snapshot.coverage.margin.reconciliation),
     },
     dataSource: snapshot.availability.dataSource,
  };
}

function exclusionReasonBreakdown(results: ReturnType<typeof evaluateProduct>[]): Record<string, number>;
function exclusionReasonBreakdown(results: ReturnType<typeof evaluateProduct> | ReturnType<typeof evaluateProduct>[]) {
  const rows = Array.isArray(results) ? results : [results];
  const counts: Record<string, number> = {};
  for (const result of rows) for (const reason of result.exclusions) {
    const key = reason.split(":")[0]!.trim() || reason;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function publicResult(result: ReturnType<typeof evaluateProduct>) {
  return {
    ...result,
    staleCompetitors: result.competitorValues.filter((c) => c.stale).map((c) => c.competitor),
  };
}

router.get("/mrp-generator/metadata", requireAdmin, async (_req, res) => {
  const sales = await bootstrapSalesStatus();
  const [volumeStatus, marginStatus] = await Promise.all([
    bootstrapComponentStatus("sales"),
    bootstrapComponentStatus("margin"),
  ]);
  const stage2 = volumeStatus.available || marginStatus.available;
  const salesReason = sales.available ? undefined : sales.reason;
  res.json({
    stage: stage2 ? 2 : 1,
    deterministic: true,
    policyVersions: [1, 2, 3],
    p012: {
      policyVersion: 3,
      mode: "simple",
      default: DEFAULT_P017_SCENARIO.policy,
      defaultScenario: {
        name: DEFAULT_P017_SCENARIO.name,
        description: DEFAULT_P017_SCENARIO.description,
        scope: DEFAULT_P017_SCENARIO.scope,
      },
    },
    p011: {
      policyVersion: 2,
      period: SUPPORTED_VOLUME_PERIOD,
      bands: "A 0-50%, B 50-80%, C 80-95%, D 95-99%, E remainder, F no FY sales",
      staleAfterDays: 365,
    },
    salesApi: {
      ...sales,
      ...(salesReason ? { reason: salesReason } : {}),
      components: { sales: volumeStatus, margin: marginStatus },
    },
    options: {
      competitiveOnly: { available: true, coverage: "competitor mappings and approved MRP", reason: null },
      margin: {
        enabledByDefault: false,
        available: marginStatus.available,
        coverage: marginStatus.available ? "authenticated margin snapshot" : null,
        reason: marginStatus.available ? null : marginStatus.reason,
        status: marginStatus.status,
        endpoint: marginStatus.endpoint,
        upstreamStatus: marginStatus.upstreamStatus ?? null,
        lastAttemptAt: marginStatus.lastAttemptAt ?? null,
        coverageDetail: marginStatus.coverage ?? null,
      },
      volume: {
        enabledByDefault: false,
        available: volumeStatus.available,
        coverage: volumeStatus.available ? "authenticated FY sales snapshot" : null,
        reason: volumeStatus.available ? null : volumeStatus.reason,
        status: volumeStatus.status,
        endpoint: volumeStatus.endpoint,
        upstreamStatus: volumeStatus.upstreamStatus ?? null,
        lastAttemptAt: volumeStatus.lastAttemptAt ?? null,
        coverageDetail: volumeStatus.coverage ?? null,
      },
    },
    disabledRules: [
      {
        type: "margin_floor",
        reason: marginStatus.available ? null : marginStatus.reason,
        configurationSummary: "One floor per master category: PTMT 65%, C P 38%, PLUMBING 30%, SANITARYWARE 38%, SINK 40%, HARDWARE 38%; narrower scope overrides will be supported.",
      },
      {
        type: "volume_tier",
        reason: volumeStatus.available ? null : volumeStatus.reason,
        configurationSummary: "A/B/C by cumulative sales-value contribution (first 80%, next 15%, remainder) or an explicit FY sales-value threshold. Percentile bands are not used.",
      },
    ].filter((rule) => rule.reason),
    supportedRules: [
      "scope", "percent_below", "match", "percent_above_lowest", "max_increase",
      "max_decrease", "hold_below", "rounding",
      ...(marginStatus.available ? ["margin_floor"] : []),
      ...(volumeStatus.available ? ["volume_tier"] : []),
    ],
    staleAfterMonths: 18,
     sources: ["approved Standard Prayag MRP", "matched competitor price with normalized basis", ...(stage2 ? ["authenticated Sales snapshot"] : [])],
  });
});

router.get("/mrp-generator/scopes", requireAdmin, async (_req, res) => {
  const [products, competitors] = await Promise.all([
    db.execute<{
      division: string;
      series: string | null;
      category: string | null;
    }>(sql`
      SELECT
        coalesce(nullif(trim(p.division), ''), 'Uncategorised') AS division,
        p.series_range AS series,
        nullif(trim(p.category), '') AS category
      FROM catalog_products p
      WHERE p.is_active IS TRUE
        AND (p.discontinued_from IS NULL OR p.discontinued_from > CURRENT_DATE)
        AND EXISTS (
          SELECT 1
          FROM mrp_price_history h
          WHERE h.item_code = p.item_code
            AND h.effective_date <= CURRENT_DATE
            AND h.mrp IS NOT NULL
            AND h.review_status = 'approved'
        )
    `),
    db.selectDistinct({ competitor: competitorPricesTable.competitor }).from(competitorPricesTable),
  ]);
  const productRows = products.rows;
  const categoryPairs = [...new Map(productRows.map((product) => [
    `${product.division}\u0000${product.category ?? "__uncategorised__"}`,
    { division: product.division, category: product.category, count: 0 },
  ])).values()];
  for (const pair of categoryPairs) {
    pair.count = productRows.filter((product) =>
      product.division === pair.division && product.category === pair.category,
    ).length;
  }
  res.json({
    divisions: [...new Set(productRows.map((p) => p.division))].sort(),
    series: [...new Set(productRows.map((p) => p.series).filter((v): v is string => !!v))].sort(),
    categories: [...new Set(productRows.map((p) => p.category).filter((v): v is string => !!v))].sort(),
    categoryPairs,
    competitors: competitors.map((c) => c.competitor).sort(),
  });
});

function queryList(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value == null ? [] : String(value).split(",");
  return [...new Set(values.flatMap((item) => String(item).split(",")).map((item) => item.trim()).filter(Boolean))];
}

function matchingFilter(value: unknown): "above" | "below" | "all" {
  const filter = String(value ?? "above").toLowerCase();
  return filter === "all" ? "all" : filter === "below" || filter === "below_only" ? "below" : "above";
}

function optionalScopeValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

const UNCATEGORISED_CATEGORY = "__uncategorised__";

function browseDivision(product: GeneratorProduct): string {
  return product.division?.trim() || "Uncategorised";
}

function matchingScopeProducts(
  products: GeneratorProduct[],
  division: string | null,
  category: string | null,
): GeneratorProduct[] {
  return products.filter((product) =>
    (division == null || browseDivision(product) === division) &&
    (category == null ||
      (category === UNCATEGORISED_CATEGORY
        ? !product.category?.trim()
        : product.category?.trim() === category)),
  );
}

function matchingDriver(value: unknown): MatchingDriver {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const object = value as { mode?: unknown; name?: unknown; named?: unknown };
    if (object.mode === "lowest" || object.mode === "highest") return object.mode;
    const named = object.named ?? object.name;
    if (typeof named === "string" && named.trim()) return { named: named.trim() };
  }
  const text = String(value ?? "lowest").trim();
  if (text === "highest") return "highest";
  if (text === "lowest" || !text) return "lowest";
  return { named: text };
}

function matchingRows(products: GeneratorProduct[], competitors: string[], driver: MatchingDriver) {
  return products.map((product) => {
    const competitorValues = competitors.map((name) => {
      const candidates = product.competitors.filter((candidate) =>
        normalizeMatchingCompetitorName(candidate.competitor) === normalizeMatchingCompetitorName(name) &&
        candidate.matched && candidate.effectivePrice != null,
      );
      const value = [...candidates].sort((a, b) =>
        (b.effectiveDate ?? "").localeCompare(a.effectiveDate ?? "") || b.effectivePrice! - a.effectivePrice!,
      )[0] ?? null;
      return value ? {
        competitor: value.competitor, price: value.price, normalizedPrice: value.effectivePrice,
        effectiveDate: value.effectiveDate, stale: value.stale, matched: value.matched,
      } : { competitor: name, price: null, normalizedPrice: null, effectiveDate: null, stale: false, matched: false };
    });
    const selected = selectMatchingCompetitor({ ...product, competitors: competitorValues.map((value) => ({
      competitor: value.competitor, price: value.price, effectivePrice: value.normalizedPrice,
      effectiveDate: value.effectiveDate, ageDays: null, stale: value.stale, matched: value.matched,
    })) }, competitors, driver);
    const position = matchingPosition(product.currentMrp, selected?.effectivePrice ?? null);
    return {
      itemCode: product.itemCode, productName: product.productName, division: product.division,
      category: product.category, currentMrp: product.currentMrp, currentDate: product.currentDate,
      currentRowId: product.currentRowId, competitors: competitorValues,
      competitorValues,
      driver: selected?.competitor ?? null, driverPrice: selected?.effectivePrice ?? null,
      signedPositionPercent: position.signedPercent, position: position.direction,
    };
  }).sort((a, b) =>
    (b.signedPositionPercent ?? Number.NEGATIVE_INFINITY) - (a.signedPositionPercent ?? Number.NEGATIVE_INFINITY) ||
    a.itemCode.localeCompare(b.itemCode),
  );
}

/**
 * P015 workbench data is deliberately read-only. Category uses exact catalog
 * equality; compound division text is never split, so each product appears
 * once under its stored category/division.
 */
router.get("/mrp-generator/matching", requireAdmin, async (req, res) => {
  const requestedView = optionalScopeValue(req.query.view);
  const princeExposure = requestedView === "prince" || requestedView === "prince_exposure";
  const division = princeExposure ? null : optionalScopeValue(req.query.division);
  const requestedCategory = optionalScopeValue(req.query.category);
  const category = requestedCategory === UNCATEGORISED_CATEGORY ? null : requestedCategory;
  if (!princeExposure && !division && !requestedCategory) { res.status(400).json({ error: "division is required (category-only matching is retained for compatibility)." }); return; }
  const competitors = princeExposure ? ["Prince"] : queryList(req.query.competitors ?? req.query.competitor);
  if (!competitors.length) { res.status(400).json({ error: "At least one competitor is required." }); return; }
  const asOf = validDate(req.query.asOf) ? req.query.asOf : today();
  const allProducts = await productsFor(asOf);
  const products = matchingScopeProducts(allProducts, division, requestedCategory);
  const options = [...new Set(allProducts.flatMap((product) => product.competitors.map((value) => value.competitor)))].sort();
  const unknown = competitors.filter((name) => !options.some((option) => normalizeMatchingCompetitorName(option) === normalizeMatchingCompetitorName(name)));
  if (unknown.length) { res.status(400).json({ error: `Unknown competitor(s): ${unknown.join(", ")}.` }); return; }
  const driver = princeExposure ? { named: "Prince" } as MatchingDriver : matchingDriver(req.query.driver);
  const allRows = matchingRows(products, competitors, driver);
  const filter = princeExposure ? "all" : matchingFilter(req.query.filter);
  // The fixed P017 exposure view is not the generic "below target" filter:
  // it shows only mapped Prince rows whose actual price is below Prayag MRP.
  const filteredProducts = princeExposure
    ? allRows.filter((row) => row.driverPrice != null && row.currentMrp != null && row.driverPrice < row.currentMrp)
    : filter === "all" ? allRows : allRows.filter((row) => filter === row.position);
  const divisionOptions = [...new Set(allProducts.map(browseDivision))].sort().map((value) => ({
    division: value, count: allProducts.filter((product) => browseDivision(product) === value).length,
  }));
  const categoryOptions = [...new Set(allProducts
    .filter((product) => division == null || browseDivision(product) === division)
    .map((product) => product.category))]
    .sort((a, b) => (a ?? "").localeCompare(b ?? ""))
    .map((value) => ({
      category: value, label: value ?? "Uncategorised",
      count: allProducts.filter((product) =>
        (division == null || browseDivision(product) === division) && product.category === value,
      ).length,
    }));
  const categoryPairs = [...new Map(allProducts.map((product) => [
    `${browseDivision(product)}\u0000${product.category ?? "__uncategorised__"}`,
    { division: browseDivision(product), category: product.category, label: product.category ?? "Uncategorised", count: 0 },
  ])).values()];
  for (const pair of categoryPairs) {
    pair.count = allProducts.filter((product) =>
      browseDivision(product) === pair.division && product.category === pair.category,
    ).length;
  }
  const exposureCategories = princeExposure
    ? [...new Map(filteredProducts.map((row) => [row.category ?? row.division ?? "__uncategorised__", {
      category: row.category ?? row.division, label: row.category ?? row.division ?? "Uncategorised", count: 0,
    }])).values()]
    : [];
  for (const option of exposureCategories) {
    option.count = filteredProducts.filter((row) => (row.category ?? row.division) === option.category).length;
  }
  res.json({
    runType: "matching", asOf, division, category, selectedCompetitors: competitors,
    ...(princeExposure ? {
      view: "prince_exposure",
      readOnly: true,
      suggestions: false,
      exposure: {
        name: "Where Prince undercuts us",
        description: "The products where Prince is cheaper. Review only — suggests nothing. Use Matching MRP to act on it.",
        competitor: "Prince",
        scope: "Products mapped to Prince",
        count: filteredProducts.length,
        categories: exposureCategories,
      },
    } : {}),
    driver: typeof driver === "object" ? { mode: "named", name: driver.named } : { mode: driver },
    driverSummary: {
      mode: typeof driver === "object" ? "named" : driver,
      name: typeof driver === "object" ? driver.named : null,
      description: typeof driver === "object" ? `Named competitor: ${driver.named}` : `Selected ${driver} competitor price`,
    },
    filter,
    divisions: divisionOptions,
    categories: categoryOptions,
    categoryOptions,
    categoryPairs,
    competitors: options, products: princeExposure ? filteredProducts : allRows, filteredProducts,
    counts: {
      all: princeExposure ? filteredProducts.length : allRows.length,
      above: allRows.filter((row) => row.position === "above").length,
      below: allRows.filter((row) => row.position === "below").length,
      ...(princeExposure ? { princeCheaper: filteredProducts.length } : {}),
    },
  });
});

router.post("/mrp-generator/matching", requireAdmin, async (req, res) => {
  const body = req.body as Record<string, unknown> | null;
  if (body?.view === "prince" || body?.view === "prince_exposure" ||
    body?.reportMode === true || body?.mode === "report") {
    res.status(405).json({ error: "The Prince exposure view is read-only and cannot be saved or run.", code: "read_only_view" });
    return;
  }
  const division = optionalScopeValue(body?.division);
  const requestedCategory = optionalScopeValue(body?.category);
  const category = requestedCategory === UNCATEGORISED_CATEGORY ? null : requestedCategory;
  const competitors = queryList(body?.selectedCompetitors ?? body?.competitors);
  if (!division && !requestedCategory || !competitors.length) {
    res.status(400).json({ error: "division and selected competitors are required (category-only matching is retained for compatibility)." }); return;
  }
  const asOf = validDate(body?.asOf) ? body!.asOf as string : today();
  const allProducts = await productsFor(asOf);
  const products = matchingScopeProducts(allProducts, division, requestedCategory);
  if (!products.length) { res.status(400).json({ error: "Matching division/category scope has no active products." }); return; }
  const available = [...new Set(allProducts.flatMap((product) => product.competitors.map((value) => value.competitor)))];
  const unknown = competitors.filter((name) => !available.some((option) => normalizeMatchingCompetitorName(option) === normalizeMatchingCompetitorName(name)));
  if (unknown.length) { res.status(400).json({ error: `Unknown competitor(s): ${unknown.join(", ")}.` }); return; }
  const globalDriver = matchingDriver(body?.driver);
  const rows = matchingRows(products, competitors, globalDriver);
  const effectiveProducts = products.map((product) => {
    const row = rows.find((candidate) => canonicalItemCode(candidate.itemCode) === canonicalItemCode(product.itemCode));
    return row ? {
      ...product,
      competitors: row.competitors.map((value) => ({
        competitor: value.competitor, price: value.price, effectivePrice: value.normalizedPrice,
        effectiveDate: value.effectiveDate, ageDays: null, stale: value.stale, matched: value.matched,
      })),
    } : product;
  });
  const byCode = new Map(effectiveProducts.map((product) => [canonicalItemCode(product.itemCode), product]));
  const rowByCode = new Map(rows.map((row) => [canonicalItemCode(row.itemCode), row]));
  const decisions = new Map<string, MatchingAction>();
  const rawBulk = [...(Array.isArray(body?.bulkActions) ? body!.bulkActions : []),
    ...(body?.bulkAction && typeof body.bulkAction === "object" ? [body.bulkAction] : [])];
  for (const [index, raw] of rawBulk.entries()) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) { res.status(400).json({ error: `bulkActions[${index}] must be an object.` }); return; }
    const bulk = raw as Record<string, unknown>;
    if (typeof bulk.filter !== "string" || !["above", "below", "all"].includes(bulk.filter)) {
      res.status(400).json({ error: `bulkActions[${index}].filter must be above, below, or all.` }); return;
    }
    const filter = matchingFilter(bulk.filter);
    const bulkAction = String(bulk.action ?? "").toLowerCase().replace(/[\s-]+/g, "_");
    if (!["match", "less_by_percent", "leave", "set", "set_exact_price"].includes(bulkAction)) {
      res.status(400).json({ error: `bulkActions[${index}] has an invalid action.` }); return;
    }
    // Bulk actions are scoped to exactly what the user could see. Recompute
    // eligibility on the server, reject stale/out-of-scope codes, and never
    // expand an omitted or partial visibleCodes list. When bulk rules overlap,
    // this stable input order is authoritative: the later rule wins. Manual
    // individual actions are applied afterward and always win over bulk.
    const suppliedVisibleCodes = bulk.visibleCodes ?? bulk.filteredCodes;
    if (!Array.isArray(suppliedVisibleCodes) || suppliedVisibleCodes.length < 1 ||
      suppliedVisibleCodes.some((code) => typeof code !== "string" || !code.trim())) {
      res.status(400).json({ error: `bulkActions[${index}].visibleCodes must be a non-empty array of item codes.` }); return;
    }
    const eligible = new Set(rows
      .filter((row) => filter === "all" || row.position === filter)
      .map((row) => canonicalItemCode(row.itemCode)));
    const submitted = [...new Set((suppliedVisibleCodes as string[]).map((code) => canonicalItemCode(code)))];
    const invalid = submitted.filter((code) => !eligible.has(code));
    if (invalid.length) {
      res.status(400).json({
        error: `bulkActions[${index}] visibleCodes outside the freshly eligible workbench set: ${invalid.join(", ")}.`,
      }); return;
    }
    for (const code of submitted) {
      const row = rowByCode.get(code)!;
      decisions.set(code, {
        itemCode: row.itemCode, action: (bulkAction === "set_exact_price" ? "set" : bulkAction) as MatchingActionType,
        percent: typeof bulk.percent === "number" ? bulk.percent : Number(bulk.percent),
        price: typeof bulk.price === "number" ? bulk.price : Number(bulk.price),
        driver: bulk.driver == null ? undefined : matchingDriver(bulk.driver),
         filter,
        source: "bulk", bulkId: String(bulk.id ?? `bulk-${index + 1}`),
        bulkDescription: typeof bulk.description === "string" ? bulk.description : undefined,
      });
    }
  }
  const rawActions = Array.isArray(body?.actions) ? body.actions : [];
  for (const [index, raw] of rawActions.entries()) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) { res.status(400).json({ error: `actions[${index}] must be an object.` }); return; }
    const input = raw as Record<string, unknown>;
    const itemCode = typeof input.itemCode === "string" ? input.itemCode : "";
    const product = byCode.get(canonicalItemCode(itemCode));
    if (!product) { res.status(400).json({ error: `actions[${index}] references a product outside the exact category.` }); return; }
    const actionText = String(input.action ?? "").toLowerCase().replace(/[\s-]+/g, "_");
    if (!["match", "less_by_percent", "leave", "set", "set_exact_price"].includes(actionText)) {
      res.status(400).json({ error: `actions[${index}] has an invalid action.` }); return;
    }
    const action = actionText as MatchingActionType | "set_exact_price";
    decisions.set(canonicalItemCode(itemCode), {
      itemCode: product.itemCode, action: action === "set_exact_price" ? "set" : action,
      percent: typeof input.percent === "number" ? input.percent : Number(input.percent),
      price: typeof input.price === "number" ? input.price : Number(input.price ?? input.exactPrice),
      driver: input.driver == null ? undefined : matchingDriver(input.driver),
      source: "manual",
    });
  }
  if (typeof globalDriver === "object" &&
    !competitors.some((name) => normalizeMatchingCompetitorName(name) === normalizeMatchingCompetitorName(globalDriver.named))) {
    res.status(400).json({ error: `Named driver "${globalDriver.named}" is not selected.` }); return;
  }
  for (const [code, action] of decisions) {
    const product = byCode.get(code)!;
    if (action.action === "set" && (!(typeof action.price === "number") || !Number.isFinite(action.price) || action.price <= 0)) {
      res.status(400).json({ error: `A positive exact price is required for ${action.itemCode}.` }); return;
    }
    if (action.action === "less_by_percent" &&
      (!(typeof action.percent === "number") || !Number.isFinite(action.percent) || action.percent < 0 || action.percent > 100)) {
      res.status(400).json({ error: `less_by_percent for ${action.itemCode} requires a percent from 0 to 100.` }); return;
    }
    if (action.action === "match" || action.action === "less_by_percent") {
      const driver = action.driver ?? globalDriver;
      if (typeof driver === "object" &&
        !competitors.some((name) => normalizeMatchingCompetitorName(name) === normalizeMatchingCompetitorName(driver.named))) {
        res.status(400).json({ error: `Named driver "${driver.named}" is not selected.` }); return;
      }
      if (!selectMatchingCompetitor(product, competitors, driver)) {
        res.status(400).json({ error: `No usable competitor evidence for ${action.itemCode} and its selected driver.` }); return;
      }
    }
  }
  if (!decisions.size) { res.status(400).json({ error: "At least one explicit manual or bulk action is required." }); return; }
  const actorEmail = actor(req);
  if (!actorEmail) { res.status(403).json({ error: "Authenticated actor is required for manual matching actions." }); return; }
  // A matching run freezes the one cached paired snapshot that was available
  // at creation. It never refreshes a source as a side effect of saving.
  const cachedSales = getCachedSalesSnapshot();
  const frozenProducts = cachedSales
    ? enrichProducts(effectiveProducts, cachedSales)
    : effectiveProducts.map((product) => ({
      ...product,
        sales: null,
        margin: null,
    }));
  const frozenByCode = new Map(frozenProducts.map((product) => [canonicalItemCode(product.itemCode), product]));
  const results = effectiveProducts.filter((product) => decisions.has(canonicalItemCode(product.itemCode))).map((product) => {
    const action = decisions.get(canonicalItemCode(product.itemCode))!;
    const decision = materializeMatchingDecision(product, action, competitors, globalDriver);
    decision.trace[0] = {
      ...decision.trace[0],
      actor: actorEmail,
      source: action.source ?? "manual",
      bulkId: action.bulkId ?? null,
      bulkDescription: action.bulkDescription ?? null,
    };
    return { product: frozenByCode.get(canonicalItemCode(product.itemCode)) ?? product, action, decision };
  });
  const snapshot = {
    runType: "matching", modelKind: "competitive", asOf, division, category,
    matchingScope: { division, category },
    selectedCompetitors: competitors, driver: globalDriver, actor: actorEmail,
    products: frozenProducts.map((product) => ({ ...product, competitors: product.competitors })),
    actions: results.map(({ action, decision }) => ({ ...action, ...decision })),
    compoundDivisionPolicy: "stored compound division is one value; products appear once",
  };
  const freshness = {
    asOf,
    mrpDates: [...new Set(products.map((product) => product.currentDate).filter((value): value is string => Boolean(value)))].sort(),
    competitors: [...new Map(products.flatMap((product) => product.competitors
      .filter((value) => competitors.some((name) => normalizeMatchingCompetitorName(name) === normalizeMatchingCompetitorName(value.competitor)))
      .map((value) => [`${value.competitor}:${value.effectiveDate ?? "undated"}`, {
        competitor: value.competitor, effectiveDate: value.effectiveDate, ageDays: value.ageDays, stale: value.stale,
      }]))).values()],
    sales: cachedSales ? {
      ...cachedSales.availability, fetchedAt: cachedSales.fetchedAt,
    } : { ...getSalesApiStatus(), dataSource: null },
    ...(cachedSales ? { coverage: cachedSales.coverage, dataSource: cachedSales.availability.dataSource } : {}),
    ...(!cachedSales ? { coverage: null, dataSource: null } : {}),
    ...(!cachedSales ? { coverageUnavailableReason: "No cached paired Sales snapshot was available at matching run creation." } : {}),
    source: "approved Standard Prayag MRP and matched competitor prices",
  };
  const summary = {
    total: results.length, suggested: results.filter(({ decision }) => decision.suggestedMrp != null).length,
    noChange: results.filter(({ decision }) => decision.suggestedMrp == null).length,
    manual: results.length, actor: actorEmail, runType: "matching",
    scope: { division, category },
  };
  const fingerprint = inputFingerprint({ snapshot, freshness });
  const runId = await db.transaction(async (tx) => {
    const inserted = await tx.insert(mrpGeneratorRunsTable).values({
      scenarioId: null, modelKind: "competitive", asOf, inputSnapshot: stableJson(snapshot),
      inputFingerprint: fingerprint, summary: json(summary), sourceFreshness: json(freshness), createdBy: actorEmail,
    }).returning({ id: mrpGeneratorRunsTable.id });
    const id = inserted[0]!.id;
    if (results.length) await tx.insert(mrpGeneratorResultsTable).values(results.map(({ product, action, decision }) => ({
      runId: id, itemCode: product.itemCode, productName: product.productName, division: product.division,
      category: product.category, currentMrp: product.currentMrp, currentDate: product.currentDate,
      currentRowId: product.currentRowId ?? null, suggestedMrp: decision.suggestedMrp, status: decision.status,
      exclusions: json(decision.suggestedMrp == null ? ["reviewed_no_change"] : []),
      competitorValues: json(product.competitors), trace: json(decision.trace),
      competitiveTarget: decision.suggestedMrp, bindingConstraint: null,
      changePercent: decision.suggestedMrp != null && product.currentMrp
        ? ((decision.suggestedMrp - product.currentMrp) / product.currentMrp) * 100 : null,
      modelKind: "competitive", reason: decision.action === "leave" ? "Reviewed; no change." : "P015 manual matching action.",
      evidence: json({
        action: decision.action, driver: decision.driver, actor: actorEmail,
        source: action.source ?? "manual", bulkId: action.bulkId ?? null,
        bulkDescription: action.bulkDescription ?? null,
        filter: action.filter ?? null,
        salesEvidence: product.sales ?? null,
        marginEvidence: product.margin ?? null,
      }),
    })));
    return id;
  });
  res.status(201).json({ runId, runType: "matching", modelKind: "competitive", asOf, division, category,
    scope: { division, category }, actor: actorEmail, summary, inputFingerprint: fingerprint });
});

router.get("/mrp-generator/freshness", requireAdmin, async (req, res) => {
  const asOf = validDate(req.query.asOf) ? req.query.asOf : today();
  const [mrp, comp] = await Promise.all([
    db.execute<{ effective_date: string }>(sql`SELECT MAX(effective_date) AS effective_date FROM mrp_price_history WHERE effective_date <= ${asOf} AND review_status = 'approved' AND variant = 'Standard' AND mrp IS NOT NULL`),
    db.execute<{ competitor: string; effective_date: string }>(sql`SELECT competitor, MAX(effective_date) AS effective_date FROM competitor_prices WHERE effective_date <= ${asOf} AND match_status = 'matched' AND price IS NOT NULL GROUP BY competitor ORDER BY competitor`),
  ]);
  const salesStatus = await bootstrapSalesStatus();
  const cachedSales = getCachedSalesSnapshot();
  const freshnessProducts = cachedSales ? await productsFor(asOf) : [];
  const freshnessEnriched = cachedSales ? enrichProducts(freshnessProducts, cachedSales) : [];
  const freshnessCoverage = cachedSales
    ? salesCoverageSummary(freshnessProducts, freshnessEnriched, cachedSales, false)
    : null;
  res.json({
    asOf,
    mrp: { effectiveDate: mrp.rows[0]?.effective_date ?? null, ageDays: ageDays(mrp.rows[0]?.effective_date ?? null, asOf), stale: isStale(mrp.rows[0]?.effective_date ?? null, asOf) },
    competitors: comp.rows.map((c) => ({ competitor: c.competitor, effectiveDate: c.effective_date, ageDays: ageDays(c.effective_date, asOf), stale: isStale(c.effective_date, asOf) })),
    sales: {
       ...salesStatus,
      ...(cachedSales ? { fetchedAt: cachedSales.fetchedAt, coverage: cachedSales.coverage, dataSource: cachedSales.availability.dataSource } : {}),
    },
    ...(freshnessCoverage ? {
      coverageSummary: freshnessCoverage,
      knownLimits: KNOWN_LIMITS,
      dataSource: cachedSales?.availability.dataSource ?? null,
    } : {}),
  });
});

/**
 * P014 historical model. This endpoint intentionally has no scenario and no
 * handoff/apply path: the run is an immutable read-only analysis snapshot.
 */
router.post("/mrp-generator/historical/run", requireAdmin, async (req, res) => {
  const asOf = validDate(req.body?.asOf) ? req.body.asOf : today();
  const requestedCategory = typeof req.body?.category === "string" ? req.body.category : null;
  try {
    const allProducts = await productsFor(asOf);
    const products = requestedCategory == null
      ? allProducts
      : allProducts.filter((product) => product.category === requestedCategory);
    const cachedSales = getCachedSalesSnapshot();
    const frozenProducts = cachedSales
      ? enrichProducts(products, cachedSales)
      : products.map((product) => ({
        ...product,
        sales: null,
        margin: null,
      }));
    const frozenByCode = new Map(frozenProducts.map((product) => [canonicalItemCode(product.itemCode), product]));
    const historyRows = await db.execute<{
      id: number; item_code: string; mrp: number | null; effective_date: string;
      review_status: string | null; variant: string | null;
    }>(sql`
      SELECT id, item_code, mrp, effective_date, review_status, variant
      FROM mrp_price_history
      WHERE effective_date <= ${asOf}
        AND review_status = 'approved'
        AND variant = 'Standard'
      ORDER BY item_code, effective_date, id
    `);
    const history: HistoricalPriceRow[] = historyRows.rows.map((row) => ({
      id: row.id, itemCode: row.item_code, mrp: row.mrp,
      effectiveDate: row.effective_date, reviewStatus: row.review_status,
      variant: row.variant,
    }));
    const evaluation = evaluateHistoricalMrp(frozenProducts, history, asOf);
    const snapshot = {
      modelKind: "historical",
      runType: "historical",
      asOf,
      ...(requestedCategory != null ? { category: requestedCategory } : {}),
      products: frozenProducts.map((product) => ({
        itemCode: product.itemCode, productName: product.productName,
        division: product.division, category: product.category,
        seriesRange: product.seriesRange, currentMrp: product.currentMrp,
        currentDate: product.currentDate, currentRowId: product.currentRowId,
        sales: product.sales, margin: product.margin,
      })),
      history,
      seriesAnalyses: evaluation.series,
      summary: evaluation.summary,
    };
    const freshness = {
      asOf,
      modelKind: "historical",
      mrpDates: [...new Set(products.map((product) => product.currentDate).filter(Boolean))].sort(),
      competitors: [],
      sales: cachedSales ? {
        ...cachedSales.availability, fetchedAt: cachedSales.fetchedAt,
      } : { ...getSalesApiStatus(), dataSource: null },
      ...(cachedSales ? { coverage: cachedSales.coverage, dataSource: cachedSales.availability.dataSource } : {}),
      ...(!cachedSales ? { coverage: null, dataSource: null } : {}),
      ...(!cachedSales ? { coverageUnavailableReason: "No cached paired Sales snapshot was available at historical run creation." } : {}),
      source: "approved Standard Prayag MRP history",
      historyRows: history.length,
      latestDate: history.map((row) => row.effectiveDate).sort().at(-1) ?? null,
    };
    const summary = { ...evaluation.summary, modelKind: "historical", runType: "historical" };
    const fingerprint = inputFingerprint({ modelKind: "historical", asOf, snapshot, freshness });
    const runId = await db.transaction(async (tx) => {
      const inserted = await tx.insert(mrpGeneratorRunsTable).values({
        scenarioId: null,
        modelKind: "historical",
        asOf,
        inputSnapshot: stableJson(snapshot),
        inputFingerprint: fingerprint,
        summary: json(summary),
        sourceFreshness: json(freshness),
        createdBy: actor(req),
      }).returning({ id: mrpGeneratorRunsTable.id });
      const id = inserted[0]!.id;
      if (evaluation.products.length) {
        const rows = evaluation.products.map((result) => ({
          runId: id,
          itemCode: result.itemCode,
          productName: result.productName ?? null,
          division: result.division ?? null,
          category: result.category ?? null,
          currentMrp: result.currentMrp,
          currentDate: result.currentDate,
          currentRowId: result.currentRowId,
          suggestedMrp: result.suggestedMrp,
          status: result.status,
          exclusions: json(result.suggestedMrp == null ? [result.reason] : []),
          competitorValues: "[]",
          trace: json([{ ruleType: "historical_series_rate", outcome: result.suggestedMrp == null ? "blocked" : "fired", before: result.currentMrp, after: result.suggestedMrp, reason: result.reason }]),
          competitiveTarget: null,
          bindingConstraint: result.suggestedMrp == null ? result.reason : null,
          changePercent: result.suggestedMrp != null && result.currentMrp
            ? ((result.suggestedMrp - result.currentMrp) / result.currentMrp) * 100 : null,
          modelKind: "historical",
          series: result.series,
          reason: result.reason,
          evidence: json({
            ...result.evidence,
            salesEvidence: frozenByCode.get(canonicalItemCode(result.itemCode))?.sales ?? null,
            marginEvidence: frozenByCode.get(canonicalItemCode(result.itemCode))?.margin ?? null,
          }),
        }));
        // Historical runs cover the complete catalog. Keep each insert below
        // PostgreSQL's 16-bit bind-parameter limit.
        for (let offset = 0; offset < rows.length; offset += 500) {
          await tx.insert(mrpGeneratorResultsTable).values(rows.slice(offset, offset + 500));
        }
      }
      return id;
    });
    res.status(201).json({
      runId, scenarioId: null, modelKind: "historical", runType: "historical", asOf,
      policyVersion: null, inputFingerprint: fingerprint, summary,
      sourceFreshness: freshness, series: evaluation.series,
    });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Could not compute historical MRP." });
  }
});

const P017_SUPERSEDED_NAME = "5% below nearest (superseded)";
export const P017_CANONICAL_MARKER = { key: "p017-canonical-default", version: 1 } as const;
const isReservedCanonicalName = (name: string) =>
  name === DEFAULT_P017_SCENARIO.name || name === DEFAULT_P012_SCENARIO.name;
const P017_SUPERSEDED_NOTE =
  "Superseded by P017: the former 5%-below rule could suggest decreases when Prayag was at or above the competition. " +
  "It is retained for audit history; the new default captures only products more than 8% below the nearest competitor, " +
  "with increases only, and explicitly holds everything else.";

type P017MigrationCandidate = {
  name: string;
  description: string | null;
  scope: unknown;
  rules: unknown;
};

export function isVerifiedLegacyCanonical(row: P017MigrationCandidate): boolean {
  const stored = parsed<Record<string, unknown>>(row.rules, {});
  if (stored.p012DefaultKey === "canonical") return true;
  if (row.name.trim() !== DEFAULT_P012_SCENARIO.name ||
    (row.description ?? "").trim() !== DEFAULT_P012_SCENARIO.description ||
    stableJson(parsed<unknown>(row.scope, {})) !== stableJson(DEFAULT_P012_SCENARIO.scope) ||
    stored.policyVersion !== 3 || stored.policy == null) return false;
  return stableJson(normalizeP012Policy(stored.policy)) === stableJson(normalizeP012Policy(DEFAULT_P012_SCENARIO.policy));
}

export function isVerifiedP017Canonical(row: P017MigrationCandidate): boolean {
  const stored = parsed<Record<string, unknown>>(row.rules, {});
  return JSON.stringify(stored.p017Migration) === JSON.stringify(P017_CANONICAL_MARKER);
}

export function isVerifiedP017Policy(row: P017MigrationCandidate): boolean {
  const stored = parsed<Record<string, unknown>>(row.rules, {});
  return stored.policyVersion === 3 &&
    stableJson(parsed<unknown>(row.scope, {})) === stableJson(DEFAULT_P017_SCENARIO.scope) &&
    (row.description ?? "").trim() === DEFAULT_P017_SCENARIO.description &&
    stored.policy != null &&
    stableJson(normalizeP012Policy(stored.policy)) === stableJson(normalizeP012Policy(DEFAULT_P017_SCENARIO.policy));
}

export function collisionSafeScenarioName(base: string, usedNames: Iterable<string>): string {
  const used = new Set(usedNames);
  if (!used.has(base)) return base;
  for (let suffix = 2; ; suffix++) {
    const candidate = `${base} ${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
}

/**
 * Idempotent P017 installation migration. The old row is never deleted and
 * its rules are intentionally left byte-for-byte equivalent apart from the
 * canonical marker; only its display name and explanatory note change.
 */
export async function ensureDefaultP012Scenario(createdBy: string | null = null, database: typeof db = db) {
  const existingRows = await database.select().from(mrpGeneratorScenariosTable);
  // A verified legacy marker is authoritative even when a prior P017 row is
  // already present, including the (bad but recoverable) case where the old
  // row was saved under the new display name.
  const markedRows = existingRows.filter((row) => {
    const stored = parsed<unknown>(row.rules, null);
    return stored && typeof stored === "object" && !Array.isArray(stored) &&
      (stored as { p012DefaultKey?: unknown }).p012DefaultKey === "canonical" &&
      !isVerifiedP017Canonical(row);
  });
  const p017Marked = existingRows.find((row) => isVerifiedP017Canonical(row));
  // Once P017 is installed, never use names or an unmarked policy signature
  // to discover or rename later user-created scenarios. The durable marker is
  // the migration boundary; the explicit legacy marker above is the one
  // exception because it is a verified historical identity.
  if (p017Marked && !markedRows.length) return p017Marked;

  // A marker is authoritative even if the user edited the old canonical row.
  // Without it, require the complete legacy metadata and executable policy
  // signature; a matching name by itself is never enough.
  const legacyCandidates = markedRows.length
    ? markedRows
    : existingRows.filter((row) => isVerifiedLegacyCanonical(row));
  for (const legacy of legacyCandidates) {
    if (legacy.name === DEFAULT_P017_SCENARIO.name && !markedRows.length) continue;
    const legacyRules = parsed<unknown>(legacy.rules, []);
    const preservedRules = legacyRules && typeof legacyRules === "object" && !Array.isArray(legacyRules)
      ? Object.fromEntries(Object.entries(legacyRules).filter(([key]) => key !== "p012DefaultKey"))
      : legacyRules;
    const usedNames = existingRows.filter((row) => row.id !== legacy.id).map((row) => row.name);
    const renamed = collisionSafeScenarioName(P017_SUPERSEDED_NAME, usedNames);
    const description = legacy.description?.trim()
      ? `${legacy.description.trim()}\n\n${P017_SUPERSEDED_NOTE}`
      : P017_SUPERSEDED_NOTE;
    const updated = (await database.update(mrpGeneratorScenariosTable).set({
      name: renamed,
      description,
      rules: json(preservedRules),
      updatedAt: new Date(),
    }).where(eq(mrpGeneratorScenariosTable.id, legacy.id)).returning())[0];
    if (updated) {
      existingRows.splice(existingRows.findIndex((row) => row.id === legacy.id), 1, updated);
    }
  }

  const canonical = existingRows.find((row) => {
    return row.name === DEFAULT_P017_SCENARIO.name &&
      (isVerifiedP017Canonical(row) || isVerifiedP017Policy(row));
  });
  if (canonical) {
    if (isVerifiedP017Canonical(canonical)) return canonical;
    const stored = parsed<Record<string, unknown>>(canonical.rules, {});
    const upgraded = (await database.update(mrpGeneratorScenariosTable).set({
      rules: json({ ...stored, p012DefaultKey: "canonical", p017Migration: P017_CANONICAL_MARKER }),
      updatedAt: new Date(),
    }).where(eq(mrpGeneratorScenariosTable.id, canonical.id)).returning())[0];
    return upgraded ?? canonical;
  }

  // A pre-existing new-name row without the marker is an arbitrary user
  // scenario, not proof of P017. Preserve it under a collision-safe name.
  const existingNew = existingRows.find((row) => row.name === DEFAULT_P017_SCENARIO.name);
  if (existingNew) {
    if (isVerifiedP017Policy(existingNew)) {
      const stored = parsed<Record<string, unknown>>(existingNew.rules, {});
    const updated = (await database.update(mrpGeneratorScenariosTable).set({
        rules: json({ ...stored, p012DefaultKey: "canonical", p017Migration: P017_CANONICAL_MARKER }),
        updatedAt: new Date(),
      }).where(eq(mrpGeneratorScenariosTable.id, existingNew.id)).returning())[0];
      return updated ?? existingNew;
    }
    const base = `${DEFAULT_P017_SCENARIO.name} (user saved)`;
    const renamed = collisionSafeScenarioName(base, existingRows.filter((row) => row.id !== existingNew.id).map((row) => row.name));
    await database.update(mrpGeneratorScenariosTable).set({ name: renamed, updatedAt: new Date() })
      .where(eq(mrpGeneratorScenariosTable.id, existingNew.id));
  }
  try {
    return (await database.insert(mrpGeneratorScenariosTable).values({
      name: DEFAULT_P017_SCENARIO.name,
      description: DEFAULT_P017_SCENARIO.description,
      scope: json(DEFAULT_P017_SCENARIO.scope),
      rules: json({
        policyVersion: 3,
        p012DefaultKey: "canonical",
        p017Migration: P017_CANONICAL_MARKER,
        policy: DEFAULT_P017_SCENARIO.policy,
      }),
      version: 3,
      createdBy,
    }).returning())[0]!;
  } catch {
    // A concurrent first request may have won the unique-name insert.
    return (await database.select().from(mrpGeneratorScenariosTable)
      .where(eq(mrpGeneratorScenariosTable.name, DEFAULT_P017_SCENARIO.name)).limit(1))[0]!;
  }
}

router.get("/mrp-generator/scenarios", requireAdmin, async (req, res) => {
  await ensureDefaultP012Scenario(actor(req));
  const rows = await db.select().from(mrpGeneratorScenariosTable).orderBy(asc(mrpGeneratorScenariosTable.createdAt));
  res.json(rows.map(exposedScenario));
});

router.post("/mrp-generator/scenarios", requireAdmin, async (req, res) => {
  try {
    const body = req.body as { name?: unknown; description?: unknown; scope?: unknown; rules?: unknown; policy?: unknown; simplePolicy?: unknown; advancedPolicy?: unknown; policyVersion?: unknown };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) { res.status(400).json({ error: "name is required." }); return; }
    if (isReservedCanonicalName(name)) {
      const conflict = new Error("The canonical default names are reserved; use the shipped default or choose another name.");
      Object.assign(conflict, { httpStatus: 409 });
      throw conflict;
    }
    const scope = body.scope && typeof body.scope === "object" ? body.scope as GeneratorScope : {};
    const advancedInput = body.advancedPolicy !== undefined ? advancedPolicyFromInput(body.advancedPolicy) : null;
    const simpleSource = body.simplePolicy ?? (body.policyVersion === 3 ? body.policy : null);
    const simpleInput = simpleSource && typeof simpleSource === "object" ? validateP012Policy(simpleSource) : null;
    const policyInput = !simpleInput && !advancedInput && body.policy && typeof body.policy === "object" ? body.policy as P011Policy : null;
    if (body.policyVersion === 3 && !simpleInput) throw new Error("P012 policyVersion 3 requires a simplePolicy object.");
    if (body.policyVersion === 2 && !policyInput && !advancedInput) throw new Error("policyVersion 2 requires either policy or advancedPolicy.");
    if (policyInput && Array.isArray(body.rules) && body.rules.length) throw new Error("P011 scenarios cannot combine policy with non-empty ordered rules.");
    const policy = policyInput ? { ...DEFAULT_P011_POLICY, ...policyInput, policyVersion: 2 as const } : null;
    if (policy) validateP011Policy(policy);
    const ruleList = Array.isArray(body.rules) ? body.rules as GeneratorRule[] : [];
    if (!policy && !simpleInput && !advancedInput && body.policyVersion !== 2 && !ruleList.length) throw new Error("rules must be a non-empty ordered array.");
    const needsSales = hasSalesRules(ruleList, scope);
    const rules = policy || simpleInput || advancedInput ? [] : validateScenarioRules(body.rules, { salesAvailable: true });
    if (needsSales || policy) await requiredSalesSnapshot(false, policy?.period ?? salesPeriod(rules));
    const inserted = await db.insert(mrpGeneratorScenariosTable).values({
      name,
      description: typeof body.description === "string" ? body.description.trim() : null,
      scope: json(scope),
      rules: json(policy ? { policyVersion: 2, policy } : advancedInput ? { policyVersion: 2, advanced: advancedInput } : simpleInput ? {
        policyVersion: 3,
        policy: simpleInput,
      } : rules),
      version: policy || advancedInput ? 2 : simpleInput ? 3 : 1,
      createdBy: actor(req),
    }).returning();
    const row = inserted[0]!;
    res.status(201).json(exposedScenario(row));
  } catch (error) {
    const status = (error as { httpStatus?: number }).httpStatus ?? 400;
    res.status(status).json({ error: error instanceof Error ? error.message : "Invalid scenario." });
  }
});

router.get("/mrp-generator/scenarios/:scenarioId", requireAdmin, async (req, res) => {
  const id = Number(req.params.scenarioId);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "scenarioId must be an integer." }); return; }
  const row = (await db.select().from(mrpGeneratorScenariosTable).where(eq(mrpGeneratorScenariosTable.id, id)).limit(1))[0];
  if (!row) { res.status(404).json({ error: "Scenario not found." }); return; }
  res.json(exposedScenario(row));
});

router.patch("/mrp-generator/scenarios/:scenarioId", requireAdmin, async (req, res) => {
  const id = Number(req.params.scenarioId);
  const current = (await db.select().from(mrpGeneratorScenariosTable).where(eq(mrpGeneratorScenariosTable.id, id)).limit(1))[0];
  if (!current) { res.status(404).json({ error: "Scenario not found." }); return; }
  try {
    const body = req.body as { name?: unknown; description?: unknown; scope?: unknown; rules?: unknown; policy?: unknown; simplePolicy?: unknown; advancedPolicy?: unknown; policyVersion?: unknown };
    const changes: Partial<typeof mrpGeneratorScenariosTable.$inferInsert> = { updatedAt: new Date() };
    if (body.name !== undefined) {
      if (typeof body.name !== "string" || !body.name.trim()) throw new Error("name is required.");
      if (isReservedCanonicalName(body.name.trim()) && body.name.trim() !== current.name) {
        const conflict = new Error("The canonical default names are reserved and cannot be assigned to user scenarios.");
        Object.assign(conflict, { httpStatus: 409 });
        throw conflict;
      }
      changes.name = body.name.trim();
    }
    if (body.description !== undefined) changes.description = typeof body.description === "string" ? body.description.trim() : null;
    if (body.scope !== undefined) changes.scope = json(body.scope);
    if (body.advancedPolicy !== undefined) {
      const advancedPolicy = advancedPolicyFromInput(body.advancedPolicy);
      const currentStored = parsed<Record<string, unknown>>(current.rules, {});
      changes.rules = json({
        policyVersion: 2,
        ...(currentStored.p012DefaultKey === "canonical" ? { p012DefaultKey: "canonical" } : {}),
        ...(JSON.stringify(currentStored.p017Migration) === JSON.stringify(P017_CANONICAL_MARKER) ? { p017Migration: P017_CANONICAL_MARKER } : {}),
        advanced: advancedPolicy,
      });
      changes.version = 2;
    } else if (body.simplePolicy !== undefined || body.policyVersion === 3) {
      const simpleSource = body.simplePolicy ?? body.policy;
      if (!simpleSource || typeof simpleSource !== "object") throw new Error("P012 policyVersion 3 requires a simplePolicy object.");
      const simplePolicy = validateP012Policy(simpleSource);
      const currentStored = parsed<Record<string, unknown>>(current.rules, {});
      changes.rules = json({
        policyVersion: 3,
        ...(currentStored.p012DefaultKey === "canonical" ? { p012DefaultKey: "canonical" } : {}),
        ...(JSON.stringify(currentStored.p017Migration) === JSON.stringify(P017_CANONICAL_MARKER) ? { p017Migration: P017_CANONICAL_MARKER } : {}),
        policy: simplePolicy,
      });
      changes.version = 3;
    } else if (body.policy !== undefined || body.policyVersion !== undefined) {
      const policyInput = body.policy && typeof body.policy === "object" ? body.policy as P011Policy : null;
      if (!policyInput || body.policyVersion !== 2 && policyInput.policyVersion !== 2) throw new Error("P011 policy requires policyVersion 2 and a policy object.");
      const policy = { ...DEFAULT_P011_POLICY, ...policyInput, policyVersion: 2 as const };
      validateP011Policy(policy);
      const currentStored = parsed<Record<string, unknown>>(current.rules, {});
      changes.rules = json({
        policyVersion: 2, policy,
        ...(currentStored.p017Migration && JSON.stringify(currentStored.p017Migration) === JSON.stringify(P017_CANONICAL_MARKER)
          ? { p017Migration: P017_CANONICAL_MARKER } : {}),
      });
      changes.version = 2;
    }
    if (body.rules !== undefined) {
      if (Array.isArray(body.rules) && body.rules.length && (body.policy !== undefined || body.simplePolicy !== undefined || body.advancedPolicy !== undefined || body.policyVersion !== undefined)) {
        throw new Error("P011 scenarios cannot combine policy with non-empty ordered rules.");
      }
      if (body.policy !== undefined || body.simplePolicy !== undefined || body.advancedPolicy !== undefined || body.policyVersion !== undefined) {
        // Empty legacy storage is harmless when a P011 policy is supplied.
      } else {
      const currentStored = parsed<Record<string, unknown>>(current.rules, {});
      if (JSON.stringify(currentStored.p017Migration) === JSON.stringify(P017_CANONICAL_MARKER)) {
        throw new Error("The canonical P017 scenario must be edited through its policy fields.");
      }
      const scope = body.scope !== undefined
        ? body.scope && typeof body.scope === "object" ? body.scope as GeneratorScope : {}
        : parsed<GeneratorScope>(current.scope, {});
      const ruleList = Array.isArray(body.rules) ? body.rules as GeneratorRule[] : [];
      const needsSales = hasSalesRules(ruleList, scope);
      const rules = validateScenarioRules(body.rules, { salesAvailable: true });
       if (needsSales) await requiredSalesSnapshot(false, salesPeriod(rules));
      changes.rules = json(rules);
      }
    } else if (body.scope !== undefined) {
      const scope = body.scope && typeof body.scope === "object" ? body.scope as GeneratorScope : {};
      const existingRules = parsed<GeneratorRule[]>(current.rules, []);
       if (hasSalesRules(existingRules, scope)) await requiredSalesSnapshot(false, salesPeriod(existingRules));
    }
    const updated = (await db.update(mrpGeneratorScenariosTable).set(changes).where(eq(mrpGeneratorScenariosTable.id, id)).returning())[0]!;
      res.json(exposedScenario(updated));
  } catch (error) {
    const status = (error as { httpStatus?: number }).httpStatus ?? 400;
    res.status(status).json({ error: error instanceof Error ? error.message : "Invalid scenario." });
  }
});

router.post("/mrp-generator/scenarios/:scenarioId/reset", requireAdmin, async (req, res) => {
  const id = Number(req.params.scenarioId);
  const current = (await db.select().from(mrpGeneratorScenariosTable).where(eq(mrpGeneratorScenariosTable.id, id)).limit(1))[0];
  if (!current) { res.status(404).json({ error: "Scenario not found." }); return; }
  const currentRules = parsed<unknown>(current.rules, []);
  if (!(currentRules && typeof currentRules === "object" && !Array.isArray(currentRules) &&
    JSON.stringify((currentRules as { p017Migration?: unknown }).p017Migration) === JSON.stringify(P017_CANONICAL_MARKER))) {
    res.status(409).json({ error: "Only the canonical default scenario can be reset.", code: "not_canonical_default" });
    return;
  }
  const updated = (await db.update(mrpGeneratorScenariosTable).set({
    name: DEFAULT_P017_SCENARIO.name,
    description: DEFAULT_P017_SCENARIO.description,
    scope: json(DEFAULT_P017_SCENARIO.scope),
    rules: json({ policyVersion: 3, p012DefaultKey: "canonical", p017Migration: P017_CANONICAL_MARKER, policy: DEFAULT_P017_SCENARIO.policy }),
    version: 3,
    updatedAt: new Date(),
  }).where(eq(mrpGeneratorScenariosTable.id, id)).returning())[0]!;
  res.json(exposedScenario(updated));
});

router.post("/mrp-generator/scenarios/:scenarioId/duplicate", requireAdmin, async (req, res) => {
  const id = Number(req.params.scenarioId);
  const current = (await db.select().from(mrpGeneratorScenariosTable).where(eq(mrpGeneratorScenariosTable.id, id)).limit(1))[0];
  if (!current) { res.status(404).json({ error: "Scenario not found." }); return; }
  const requested = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const base = requested || `${current.name} copy`;
  let name = base;
  for (let n = 2; (await db.select({ id: mrpGeneratorScenariosTable.id }).from(mrpGeneratorScenariosTable).where(eq(mrpGeneratorScenariosTable.name, name)).limit(1)).length; n++) {
    name = `${base} ${n}`;
  }
  const duplicateRules = parsed<unknown>(current.rules, []);
  const strippedRules = duplicateRules && typeof duplicateRules === "object" && !Array.isArray(duplicateRules)
    ? Object.fromEntries(Object.entries(duplicateRules).filter(([key]) => key !== "p012DefaultKey" && key !== "p017Migration"))
    : duplicateRules;
  const copy = (await db.insert(mrpGeneratorScenariosTable).values({
    name,
    description: current.description,
    scope: current.scope,
    rules: json(strippedRules),
    version: current.version,
    createdBy: actor(req),
  }).returning())[0]!;
  res.status(201).json(exposedScenario(copy));
});

router.post("/mrp-generator/scenarios/:scenarioId/promote", requireAdmin, async (req, res) => {
  const id = Number(req.params.scenarioId);
  const current = (await db.select().from(mrpGeneratorScenariosTable).where(eq(mrpGeneratorScenariosTable.id, id)).limit(1))[0];
  if (!current) { res.status(404).json({ error: "Scenario not found." }); return; }
  const submitted = req.body?.simplePolicy ?? req.body?.policy;
  const simple = submitted && typeof submitted === "object"
    ? validateP012Policy(submitted)
    : scenarioSimplePolicyFromRules(parsed(current.rules, {}));
  if (!simple) { res.status(409).json({ error: "Only a P012 Simple scenario can be promoted." }); return; }
  const advanced = promoteP012ToAdvanced(simple);
  // A payload supplied by the editor represents unsaved state. Promotion is
  // deliberately non-mutating; the caller can explicitly save the returned
  // advanced envelope when it is ready.
  if (submitted && typeof submitted === "object") {
    const currentView = exposedScenario(current);
    const unsavedScenario = {
      ...currentView,
      ...(typeof req.body?.name === "string" ? { name: req.body.name.trim() } : {}),
      ...(req.body?.description !== undefined ? { description: req.body.description } : {}),
      ...(req.body?.scope && typeof req.body.scope === "object" ? { scope: req.body.scope } : {}),
      simplePolicy: simple,
    };
    res.json({ scenario: unsavedScenario, advanced, advancedPolicy: advanced, unsaved: true });
    return;
  }
  const currentStored = parsed<Record<string, unknown>>(current.rules, {});
  const updated = (await db.update(mrpGeneratorScenariosTable).set({
    rules: json({
      policyVersion: 2,
      ...(currentStored.p012DefaultKey === "canonical" ? { p012DefaultKey: "canonical" } : {}),
      ...(JSON.stringify(currentStored.p017Migration) === JSON.stringify(P017_CANONICAL_MARKER) ? { p017Migration: P017_CANONICAL_MARKER } : {}),
      advanced,
    }),
    version: 2,
    updatedAt: new Date(),
  }).where(eq(mrpGeneratorScenariosTable.id, id)).returning())[0]!;
  res.json({ scenario: exposedScenario(updated), advanced });
});

router.post("/mrp-generator/scenarios/:scenarioId/demote", requireAdmin, async (req, res) => {
  const id = Number(req.params.scenarioId);
  const current = (await db.select().from(mrpGeneratorScenariosTable).where(eq(mrpGeneratorScenariosTable.id, id)).limit(1))[0];
  if (!current) { res.status(404).json({ error: "Scenario not found." }); return; }
  const supplied = req.body?.advancedPolicy ?? req.body?.advanced;
  const raw = supplied !== undefined ? supplied : parsed(current.rules, {});
  const advanced = raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as { policy?: unknown; advanced?: unknown }).policy ?? (raw as { advanced?: unknown }).advanced ?? raw
    : raw;
  const converted = convertAdvancedToP012(advanced);
  if ("reasons" in converted) { res.status(409).json({ error: "Advanced policy cannot be represented as Simple.", reasons: converted.reasons }); return; }
  // Demotion is a conversion preview. The editor explicitly saves the
  // returned Simple payload; stored scenario state is never changed here.
  res.json({ simplePolicy: converted.policy, unsaved: true });
});

// Deliberately does not create a scenario, run, result, or revision row.
router.post("/mrp-generator/scenarios/preview", requireAdmin, async (req, res) => {
  try {
    const body = req.body as { scope?: unknown; simplePolicy?: unknown; policy?: unknown; asOf?: unknown; limit?: unknown };
    const raw = body.simplePolicy ?? body.policy;
    if (!raw || typeof raw !== "object") { res.status(400).json({ error: "simplePolicy is required." }); return; }
    const policy = validateP012Policy(raw);
    const scope = body.scope && typeof body.scope === "object" ? body.scope as GeneratorScope : {};
    const asOf = validDate(body.asOf) ? body.asOf : today();
    let products = await productsFor(asOf);
    if (policy.marginEnabled || policy.volumeEnabled) {
      const snapshotSales = await requiredSalesSnapshot(
        false,
        SUPPORTED_VOLUME_PERIOD,
        policy.marginEnabled && policy.volumeEnabled ? "both" : policy.marginEnabled ? "margin" : "volume",
      );
      products = enrichProducts(products, snapshotSales);
      const tiers = computeVolumeTiers(products);
      products = products.map((product) => product.sales
        ? { ...product, sales: { ...product.sales, tier: tiers.get(canonicalItemCode(product.itemCode)) ?? null } } : product);
    }
    const evaluation = evaluateP012Scenario(products, policy, scope);
    const requestedLimit = Number(body.limit);
    const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 100) : 25;
    res.json({
      preview: true,
      asOf,
      summary: evaluation.summary,
      reach: evaluation.reach,
      warnings: evaluation.warnings,
      evidence: evaluation.results.slice(0, limit),
    });
  } catch (error) {
    const status = (error as { httpStatus?: number }).httpStatus ?? 400;
    const option = (error as { option?: string }).option;
    res.status(status).json({
      error: option ? `${option[0]!.toUpperCase()}${option.slice(1)} option unavailable: ${error instanceof Error ? error.message : "Sales API snapshot is unavailable."}` : error instanceof Error ? error.message : "Could not preview simple policy.",
      ...(option ? { code: `${option}_evidence_unavailable`, option } : {}),
    });
  }
});

router.delete("/mrp-generator/scenarios/:scenarioId", requireAdmin, async (req, res) => {
  const id = Number(req.params.scenarioId);
  const runs = await db.select({ id: mrpGeneratorRunsTable.id }).from(mrpGeneratorRunsTable).where(eq(mrpGeneratorRunsTable.scenarioId, id)).limit(1);
  if (runs.length) { res.status(409).json({ error: "Scenario has immutable runs and cannot be deleted." }); return; }
  const deleted = await db.delete(mrpGeneratorScenariosTable).where(eq(mrpGeneratorScenariosTable.id, id)).returning({ id: mrpGeneratorScenariosTable.id });
  if (!deleted.length) { res.status(404).json({ error: "Scenario not found." }); return; }
  res.json({ ok: true, id });
});

router.post("/mrp-generator/scenarios/:scenarioId/run", requireAdmin, async (req, res) => {
  const scenarioId = Number(req.params.scenarioId);
  const scenario = (await db.select().from(mrpGeneratorScenariosTable).where(eq(mrpGeneratorScenariosTable.id, scenarioId)).limit(1))[0];
  if (!scenario) { res.status(404).json({ error: "Scenario not found." }); return; }
  const asOf = validDate(req.body?.asOf) ? req.body.asOf : today();
  const refreshSales = req.query.refresh === "true" || req.body?.refreshSales === true;
  try {
    const scope = parsed<GeneratorScope>(scenario.scope, {});
    const rawRules = parsed<unknown>(scenario.rules, []);
    const ruleList = Array.isArray(rawRules) ? rawRules as GeneratorRule[] : [];
    const storedPolicy = scenarioPolicyFromRules(rawRules);
    const storedSimplePolicy = scenarioSimplePolicyFromRules(rawRules);
    const promotedSimplePolicy = scenarioPromotedAdvancedFromRules(rawRules);
    const p011 = storedPolicy?.policyVersion === 2;
    const p012Policy = storedSimplePolicy ?? promotedSimplePolicy;
    const p012 = p012Policy != null;
    const needsSales = p011 || (p012 ? p012Policy!.marginEnabled || p012Policy!.volumeEnabled : hasSalesRules(ruleList, scope));
    const allProducts = await productsFor(asOf);
    let snapshotSales: SalesSnapshot | null = null;
    let enrichedAll = allProducts;
    if (needsSales) {
       snapshotSales = await requiredSalesSnapshot(
         refreshSales,
         p011 ? storedPolicy!.period : salesPeriod(ruleList),
         p012 ? (p012Policy!.marginEnabled && p012Policy!.volumeEnabled ? "both" : p012Policy!.marginEnabled ? "margin" : "volume") : undefined,
       );
      enrichedAll = enrichProducts(allProducts, snapshotSales);
       if (!p011) {
         const tiers = computeVolumeTiers(enrichedAll);
         enrichedAll = enrichedAll.map((product) => ({
           ...product,
           sales: product.sales ? { ...product.sales, tier: tiers.get(canonicalItemCode(product.itemCode)) ?? null } : product.sales,
         }));
       }
    }
    const rules = p011 || p012 ? [] : validateScenarioRules(rawRules, { salesAvailable: needsSales });
    const products = enrichedAll.filter((product) => matchesScope(product, scope));
    const p011Evaluation = p011
      ? evaluateP011Scenario(enrichedAll, storedPolicy!, scope)
      : null;
    const p012Evaluation = p012
      ? evaluateP012Scenario(enrichedAll, p012Policy!, scope)
      : null;
    const results = p011Evaluation?.results ?? p012Evaluation?.results ?? products.map((product) => evaluateProduct(product, rules, {
      confidenceOnly: scope.confidenceOnly,
      ...(snapshotSales ? { volumeTiers: computeVolumeTiers(enrichedAll) } : {}),
    }));
    const coverageSummary = snapshotSales
      ? salesCoverageSummary(enrichedAll, products, snapshotSales, scope.confidenceOnly === true)
      : null;
    const snapshot = {
      modelKind: "competitive" as const,
      runType: "rule" as const,
      asOf,
      ...(snapshotSales ? {
        salesFetchedAt: snapshotSales.fetchedAt,
        salesCoverage: snapshotSales.coverage,
        salesDataSource: snapshotSales.availability.dataSource,
        knownLimits: KNOWN_LIMITS,
        salesCoverageSummary: coverageSummary,
      } : {}),
      products: products.map((p) => ({ ...p, competitors: p.competitors })),
      scope,
      rules,
      policyVersion: p011 ? 2 : p012 ? 3 : 1,
      ...(p011 ? { policy: storedPolicy, portfolio: p011Evaluation!.portfolio } : {}),
      ...(p011 ? { p011Results: p011Evaluation!.results } : {}),
      ...(p012 ? {
        simplePolicy: p012Policy,
        ...(scenarioPromotedAdvancedFromRules(rawRules)
          ? { advancedPolicy: (rawRules as { advanced?: unknown }).advanced } : {}),
        p012Results: p012Evaluation!.results,
      } : {}),
      stage: snapshotSales ? 2 : 1,
    };
    const freshness = {
      asOf,
      mrpDates: [...new Set(products.map((p) => p.currentDate).filter(Boolean))].sort(),
      competitors: [...new Map(products.flatMap((p) => p.competitors.map((c) => [
        `${c.competitor}:${c.effectiveDate ?? "undated"}`,
        { competitor: c.competitor, effectiveDate: c.effectiveDate, ageDays: c.ageDays, stale: c.stale },
      ]))).values()].sort((a, b) => a.competitor.localeCompare(b.competitor) || (a.effectiveDate ?? "").localeCompare(b.effectiveDate ?? "")),
      sales: snapshotSales ? {
        ...snapshotSales.availability,
        fetchedAt: snapshotSales.fetchedAt,
        coverage: snapshotSales.coverage,
        coverageSummary,
         knownLimits: KNOWN_LIMITS,
      } : getSalesApiStatus(),
      coverageSummary,
      knownLimits: KNOWN_LIMITS,
      dataSource: snapshotSales?.availability.dataSource ?? null,
    };
    const summary = {
      total: results.length,
      suggested: results.filter((r) => r.status === "suggested").length,
      noChange: results.filter((r) => r.status === "no_change").length,
      excluded: results.filter((r) => r.status === "excluded").length,
      increases: results.filter((r) => r.changePercent != null && r.changePercent > 0).length,
      decreases: results.filter((r) => r.changePercent != null && r.changePercent < 0).length,
      medianIncreasePercent: median(results.map((r) => r.changePercent).filter((v): v is number => v != null && v > 0)),
      medianDecreasePercent: median(results.map((r) => r.changePercent).filter((v): v is number => v != null && v < 0)),
      confidencePassCount: coverageSummary?.confidencePassCount ?? null,
      exclusionReasonBreakdown: exclusionReasonBreakdown(results),
      ...(p012 ? {
        policyVersion: 3,
        evaluated: p012Evaluation!.summary.evaluated,
        wouldChange: p012Evaluation!.summary.wouldChange,
        noCompetitorUntouched: p012Evaluation!.summary.noCompetitorUntouched,
        fallthroughUntouched: p012Evaluation!.summary.fallthroughUntouched,
        rowCounts: p012Evaluation!.summary.rowCounts,
        tierDistribution: p012Evaluation!.summary.tierDistribution,
        warnings: p012Evaluation!.warnings,
      } : {}),
      ...(p011 ? {
        policyVersion: 2,
        actionCounts: Object.fromEntries([...new Set(results.map((r) => r.action))].map((action) => [
          action, results.filter((r) => r.action === action).length,
        ])),
        actionValueImpacts: p011Evaluation!.portfolio.actionValueImpacts,
        bandDistribution: Object.fromEntries([...new Set(results.map((r) => r.band))].map((band) => [
          band, results.filter((r) => r.band === band).length,
        ])),
        salesValueRepresented: p011Evaluation!.portfolio.coveredSalesValue,
        portfolio: p011Evaluation!.portfolio,
      } : {}),
    };
    const fingerprint = inputFingerprint({ scenarioId, asOf, snapshot, freshness });
    const run = await db.transaction(async (tx) => {
      const inserted = await tx.insert(mrpGeneratorRunsTable).values({
        scenarioId, asOf, inputSnapshot: stableJson(snapshot), inputFingerprint: fingerprint,
        summary: json(summary), sourceFreshness: json(freshness), createdBy: actor(req),
      }).returning({ id: mrpGeneratorRunsTable.id });
      const runId = inserted[0]!.id;
      if (results.length) await tx.insert(mrpGeneratorResultsTable).values(results.map((r) => ({
        runId,
        itemCode: r.itemCode,
        productName: r.productName,
        division: r.division,
        category: r.category,
        currentMrp: r.currentMrp,
        currentDate: r.currentDate,
        currentRowId: r.currentRowId ?? null,
        suggestedMrp: r.suggestedMrp,
        status: r.status,
        exclusions: json(r.exclusions),
        competitorValues: json(r.competitorValues),
        trace: json(r.trace),
        competitiveTarget: r.competitiveTarget,
        bindingConstraint: r.bindingConstraint,
        changePercent: r.changePercent,
        modelKind: "competitive",
        evidence: json({
          salesEvidence: r.salesEvidence ?? null,
          marginEvidence: r.marginEvidence ?? null,
        }),
      })));
      return runId;
    });
    res.status(201).json({ runId: run, scenarioId, modelKind: "competitive", runType: "rule", asOf, policyVersion: p011 ? 2 : p012 ? 3 : 1, inputFingerprint: fingerprint, summary, sourceFreshness: freshness });
  } catch (error) {
    const status = (error as { httpStatus?: number }).httpStatus ?? 400;
    const option = (error as { option?: string }).option;
    res.status(status).json({
      error: option ? `${option[0]!.toUpperCase()}${option.slice(1)} option unavailable: ${error instanceof Error ? error.message : "Sales API snapshot is unavailable."}` : error instanceof Error ? error.message : "Could not run scenario.",
      ...(option ? { code: `${option}_evidence_unavailable`, option } : {}),
    });
  }
});

router.get("/mrp-generator/runs", requireAdmin, async (req, res) => {
  const rawLimit = Number(req.query.limit);
  const limit = Number.isInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 50;
  const rawScenarioId = req.query.scenarioId;
  const scenarioId = rawScenarioId == null || rawScenarioId === "" ? null : Number(rawScenarioId);
  if (scenarioId != null && !Number.isInteger(scenarioId)) {
    res.status(400).json({ error: "scenarioId must be an integer." });
    return;
  }
  const rows = await db
    .select({
      run: mrpGeneratorRunsTable,
      scenarioName: mrpGeneratorScenariosTable.name,
    })
    .from(mrpGeneratorRunsTable)
    .leftJoin(mrpGeneratorScenariosTable, eq(mrpGeneratorScenariosTable.id, mrpGeneratorRunsTable.scenarioId))
    .where(scenarioId == null ? undefined : eq(mrpGeneratorRunsTable.scenarioId, scenarioId))
    .orderBy(desc(mrpGeneratorRunsTable.createdAt))
    .limit(limit);
  res.json({
    runs: rows.map(({ run, scenarioName }) => ({
      ...run,
      scenarioName: scenarioName ?? (snapshotRunType(parsed(run.inputSnapshot, { modelKind: run.modelKind })) === "matching" ? "Matching Scenario" : null),
      inputSnapshot: exposedInputSnapshot(run.inputSnapshot, run.modelKind),
      summary: parsed(run.summary, {}),
      sourceFreshness: parsed(run.sourceFreshness, {}),
      policyVersion: run.modelKind === "historical" ? null : snapshotPolicyVersion(parsed(run.inputSnapshot, {})),
      modelKind: run.modelKind ?? snapshotModelKind(parsed(run.inputSnapshot, {})),
      runType: snapshotRunType(parsed(run.inputSnapshot, { modelKind: run.modelKind })),
      simplePolicy: (parsed<{ simplePolicy?: P012SimplePolicy }>(run.inputSnapshot, {}).simplePolicy ?? null),
      advancedPolicy: (parsed<{ advancedPolicy?: unknown }>(run.inputSnapshot, {}).advancedPolicy ?? null),
    })),
    limit,
  });
});

function exposedInputSnapshot(
  raw: string | null | undefined,
  persistedModelKind?: string | null,
) {
  const snapshot = parsed<{ modelKind?: unknown }>(raw ?? "{}", {});
  return {
    ...snapshot,
    modelKind: persistedModelKind === "historical" || snapshot.modelKind === "historical"
      ? "historical" : "competitive",
    runType: snapshotRunType({ ...snapshot, modelKind: persistedModelKind ?? snapshot.modelKind }),
  };
}

function exposedRun(run: typeof mrpGeneratorRunsTable.$inferSelect) {
  return {
    ...run,
    scenarioName: snapshotRunType(parsed(run.inputSnapshot, { modelKind: run.modelKind })) === "matching"
      ? "Matching Scenario" : null,
    summary: parsed(run.summary, {}),
    sourceFreshness: parsed(run.sourceFreshness, {}),
    inputSnapshot: exposedInputSnapshot(run.inputSnapshot, run.modelKind),
  };
}
function exposedResult(
  row: typeof mrpGeneratorResultsTable.$inferSelect,
  evidence?: { sales?: unknown; margin?: unknown; warnings?: string[] },
  policyResult?: Record<string, unknown>,
): any {
  const persistedEvidence = parsed<{ salesEvidence?: unknown; marginEvidence?: unknown }>(row.evidence ?? "{}", {});
  return {
    ...row,
    exclusions: parsed(row.exclusions, []),
    competitorValues: parsed(row.competitorValues, []),
    trace: parsed(row.trace, []),
    ...(policyResult ? {
      ...(policyResult.policyVersion === 3 ? {
        policyVersion: 3,
        matchedRowNumber: policyResult.matchedRowNumber,
        matchedRowId: policyResult.matchedRowId,
        matchedRowLabel: policyResult.matchedRowLabel,
        selectedCompetitor: policyResult.selectedCompetitor,
        competitorMode: policyResult.competitorMode,
        selectedCompetitorPrice: policyResult.selectedCompetitorPrice,
        rawTarget: policyResult.rawTarget,
        decisionSentence: policyResult.decisionSentence,
        volumeTier: policyResult.volumeTier ?? null,
        fySalesAmount: policyResult.fySalesAmount ?? null,
      } : {
        policyVersion: policyResult.policyVersion,
        band: policyResult.band,
        fySalesAmount: policyResult.fySalesAmount,
        selectedCompetitor: policyResult.selectedCompetitor,
        competitorMode: policyResult.competitorMode,
        gap: policyResult.gap,
        position: policyResult.position,
        action: policyResult.action,
        marginFloorEvidence: policyResult.marginFloorEvidence,
        bindingConstraints: policyResult.bindingConstraints,
        escalation: policyResult.escalation,
        escalationReason: policyResult.escalationReason,
      }),
    } : {}),
    salesEvidence: persistedEvidence.salesEvidence ?? evidence?.sales ?? null,
    marginEvidence: persistedEvidence.marginEvidence ?? evidence?.margin ?? null,
    warnings: evidence?.warnings ?? [],
    ...(row.modelKind === "historical" || row.evidence || row.reason || row.series ? {
      modelKind: row.modelKind ?? "historical",
      series: row.series,
      reason: row.reason,
      historicalEvidence: parsed(row.evidence ?? "{}", {}),
      confidence: parsed<{ confidence?: unknown }>(row.evidence ?? "{}", {}).confidence ?? null,
      seriesRate: parsed<{ typicalRate?: unknown }>(row.evidence ?? "{}", {}).typicalRate ?? null,
      due: parsed<{ status?: unknown }>(row.evidence ?? "{}", {}).status === "DUE" ||
        parsed<{ status?: unknown }>(row.evidence ?? "{}", {}).status === "OVERDUE",
      overdue: parsed<{ status?: unknown }>(row.evidence ?? "{}", {}).status === "OVERDUE",
    } : {}),
  };
}

router.get("/mrp-generator/runs/:runId", requireAdmin, async (req, res) => {
  const id = Number(req.params.runId);
  const run = (await db.select().from(mrpGeneratorRunsTable).where(eq(mrpGeneratorRunsTable.id, id)).limit(1))[0];
  if (!run) { res.status(404).json({ error: "Run not found." }); return; }
  const scenario = run.scenarioId == null ? undefined :
    (await db.select().from(mrpGeneratorScenariosTable).where(eq(mrpGeneratorScenariosTable.id, run.scenarioId)).limit(1))[0];
  const results = await db.select().from(mrpGeneratorResultsTable).where(eq(mrpGeneratorResultsTable.runId, id)).orderBy(asc(mrpGeneratorResultsTable.itemCode));
  const snapshot = parsed<{
    modelKind?: "competitive" | "historical";
    policyVersion?: number;
    policy?: P011Policy;
    products?: Array<{ itemCode?: string; sales?: unknown; margin?: unknown }>;
    p011Results?: Array<Record<string, unknown>>;
    p012Results?: Array<Record<string, unknown>>;
    simplePolicy?: P012SimplePolicy;
    advancedPolicy?: unknown;
  }>(run.inputSnapshot, {});
  const evidence = new Map((snapshot.products ?? []).map((product) => [
    canonicalItemCode(product.itemCode ?? ""),
    {
      sales: product.sales,
      margin: product.margin,
      warnings: (product.margin && typeof product.margin === "object" && Array.isArray((product.margin as { warnings?: unknown }).warnings))
        ? (product.margin as { warnings: string[] }).warnings : [],
    },
  ]));
  const p011ByCode = new Map((snapshot.p011Results ?? []).map((result) => [
    canonicalItemCode(String(result.itemCode ?? "")), result,
  ]));
  const p012ByCode = new Map((snapshot.p012Results ?? []).map((result) => [
    canonicalItemCode(String(result.itemCode ?? "")), result,
  ]));
  const scenarioView = scenario ? exposedScenario(scenario) : null;
  // A run is immutable: once an input snapshot has a policy/version, a later
  // scenario edit must not rewrite any run policy metadata. Old snapshots
  // infer P011 only from their own policy/result payload.
  const modelKind = run.modelKind ?? snapshotModelKind(snapshot);
  const runType = snapshotRunType({ ...snapshot, modelKind });
  const policyVersion = modelKind === "historical" ? null : snapshotPolicyVersion(snapshot);
  const policy = snapshot.policy ?? null;
  const simplePolicy = snapshot.simplePolicy ?? null;
  const advancedPolicy = snapshot.advancedPolicy ?? null;
  const immutableScenario = scenarioView
    ? { ...scenarioView, policyVersion, policy }
    : null;
  res.json({
    run: exposedRun(run),
    policyVersion,
    modelKind,
    runType,
    policy,
    scenario: immutableScenario,
    simplePolicy,
    advancedPolicy,
    results: results.map((row) => exposedResult(row, evidence.get(canonicalItemCode(row.itemCode)), p011ByCode.get(canonicalItemCode(row.itemCode)) ?? p012ByCode.get(canonicalItemCode(row.itemCode)))),
  });
});

router.get("/mrp-generator/runs/:runId/results", requireAdmin, async (req, res) => {
  const id = Number(req.params.runId);
  const rows = await db.select().from(mrpGeneratorResultsTable).where(eq(mrpGeneratorResultsTable.runId, id)).orderBy(asc(mrpGeneratorResultsTable.itemCode));
  if (!rows.length && !(await db.select({ id: mrpGeneratorRunsTable.id }).from(mrpGeneratorRunsTable).where(eq(mrpGeneratorRunsTable.id, id)).limit(1))[0]) { res.status(404).json({ error: "Run not found." }); return; }
  const run = (await db.select({
    inputSnapshot: mrpGeneratorRunsTable.inputSnapshot,
    modelKind: mrpGeneratorRunsTable.modelKind,
  }).from(mrpGeneratorRunsTable).where(eq(mrpGeneratorRunsTable.id, id)).limit(1))[0];
  const snapshot = parsed<{ products?: Array<{ itemCode?: string; sales?: unknown; margin?: unknown }>; p011Results?: Array<Record<string, unknown>>; p012Results?: Array<Record<string, unknown>> }>(run?.inputSnapshot ?? "{}", {});
  const evidence = new Map((snapshot.products ?? []).map((product) => [
    canonicalItemCode(product.itemCode ?? ""), {
      sales: product.sales,
      margin: product.margin,
      warnings: product.margin && typeof product.margin === "object" && Array.isArray((product.margin as { warnings?: unknown }).warnings)
        ? (product.margin as { warnings: string[] }).warnings : [],
    },
  ]));
  const p011ByCode = new Map((snapshot.p011Results ?? []).map((result) => [
    canonicalItemCode(String(result.itemCode ?? "")), result,
  ]));
  const p012ByCode = new Map((snapshot.p012Results ?? []).map((result) => [
    canonicalItemCode(String(result.itemCode ?? "")), result,
  ]));
  res.json({ runId: id, runType: snapshotRunType({ ...snapshot, modelKind: run?.modelKind }), results: rows.map((row) => exposedResult(row, evidence.get(canonicalItemCode(row.itemCode)), p011ByCode.get(canonicalItemCode(row.itemCode)) ?? p012ByCode.get(canonicalItemCode(row.itemCode)))) });
});

router.get("/mrp-generator/compare", requireAdmin, async (req, res) => {
  const queryIds = req.query.runIds ?? req.query.runs;
  const rawIds = queryIds == null ? [] : Array.isArray(queryIds) ? queryIds : String(queryIds).split(",");
  const parsedIds = rawIds.flatMap((value) => String(value).split(","))
    .map((value) => Number(value)).filter((value) => Number.isInteger(value));
  const leftId = Number(req.query.leftRunId ?? req.query.runA);
  const rightId = Number(req.query.rightRunId ?? req.query.runB);
  const runIds = [...new Set(parsedIds.length ? parsedIds : [leftId, rightId])];
  if (runIds.length < 2 || runIds.some((id) => !Number.isInteger(id))) {
    res.status(400).json({ error: "runIds must contain at least two integer run IDs." });
    return;
  }
  const runs = await db.select().from(mrpGeneratorRunsTable).where(inArray(mrpGeneratorRunsTable.id, runIds));
  const existing = new Set(runs.map((run) => run.id));
  const missing = runIds.filter((id) => !existing.has(id));
  if (missing.length) {
    res.status(404).json({ error: `Generator run(s) not found: ${missing.join(", ")}.` });
    return;
  }
  // Keep one query per run rather than relying on a database-specific
  // multi-key result ordering. This also preserves the legacy binary compare
  // contract exactly (including rows present on only the right).
  const resultSets = await Promise.all(runIds.map((id) =>
    db.select().from(mrpGeneratorResultsTable).where(eq(mrpGeneratorResultsTable.runId, id)),
  ));
  const resultRows = resultSets.flat();
  const byRun = new Map<number, typeof resultRows>();
  for (const row of resultRows) byRun.set(row.runId, [...(byRun.get(row.runId) ?? []), row]);
  const runById = new Map(runs.map((run) => [run.id, run]));
  const exposedByRun = new Map<number, Map<string, any>>();
  for (const id of runIds) {
    const run = runById.get(id)!;
    const snapshot = parsed<{
      modelKind?: unknown; policyVersion?: number; policy?: P011Policy; simplePolicy?: P012SimplePolicy;
      advancedPolicy?: unknown; p011Results?: Array<Record<string, unknown>>; p012Results?: Array<Record<string, unknown>>;
    }>(run.inputSnapshot, {});
    const p011 = new Map((snapshot.p011Results ?? []).map((result) => [canonicalItemCode(String(result.itemCode ?? "")), result]));
    const p012 = new Map((snapshot.p012Results ?? []).map((result) => [canonicalItemCode(String(result.itemCode ?? "")), result]));
    exposedByRun.set(id, new Map((byRun.get(id) ?? []).map((row) => [
      canonicalItemCode(row.itemCode), exposedResult(row, undefined, p011.get(canonicalItemCode(row.itemCode)) ?? p012.get(canonicalItemCode(row.itemCode))),
    ])));
  }
  const legacyLeft = runIds[0]!;
  const legacyRight = runIds[1]!;
  const codes = [...new Set(resultRows.map((row) => canonicalItemCode(row.itemCode)))].sort();
  const products = codes.map((code) => {
    const values = Object.fromEntries(runIds.map((id) => [String(id), exposedByRun.get(id)?.get(code) ?? null]));
    const suggestions = runIds.map((id) => (values[String(id)] as { suggestedMrp?: number | null } | null)?.suggestedMrp ?? null);
    const historical = runIds.find((id) => (runById.get(id)?.modelKind ?? "competitive") === "historical");
    const competitive = runIds.find((id) => (runById.get(id)?.modelKind ?? "competitive") !== "historical");
    const historicalIds = runIds.filter((id) => (runById.get(id)?.modelKind ?? "competitive") === "historical");
    const competitiveIds = runIds.filter((id) => (runById.get(id)?.modelKind ?? "competitive") !== "historical");
    const historicalValue = historical == null ? null : (values[String(historical)] as { suggestedMrp?: number | null } | null)?.suggestedMrp ?? null;
    const competitiveValue = competitive == null ? null : (values[String(competitive)] as { suggestedMrp?: number | null } | null)?.suggestedMrp ?? null;
    const signatures = runIds.map((id) => {
      const value = values[String(id)] as {
        suggestedMrp?: number | null; status?: string; action?: string | null;
        band?: string | null; position?: string | null; gap?: number | null;
        escalation?: boolean; escalationReason?: string | null;
      } | null;
      return JSON.stringify({
        suggestedMrp: value?.suggestedMrp ?? null, status: value?.status ?? null,
        action: value?.action ?? null, band: value?.band ?? null,
        position: value?.position ?? null, gap: value?.gap ?? null,
        escalation: value?.escalation ?? null, escalationReason: value?.escalationReason ?? null,
      });
    });
    const allAgree = signatures.every((value) => value === signatures[0]);
    const nonNullSuggestions = suggestions.filter((value): value is number => value != null);
    const distinctSuggestions = new Set(nonNullSuggestions);
    const oneSided = nonNullSuggestions.length > 0 && nonNullSuggestions.length < runIds.length;
    const suggestionDisagreement = distinctSuggestions.size > 1;
    const exactHistoricalCompetitivePair = runIds.length === 2 && historicalIds.length === 1 && competitiveIds.length === 1;
    // Keep the established directional categories for the binary historical vs
    // competitive comparison. For every other shape, classify using all
    // selected runs so a third run can never be hidden by the first pair.
    const category = exactHistoricalCompetitivePair
      ? classifyBinaryHistoricalCompetitiveCategory(historicalValue, competitiveValue)
      : oneSided ? "one_sided"
        : suggestionDisagreement ? "disagreement"
          : allAgree ? "agree" : "disagreement";
    return {
      itemCode: (resultRows.find((row) => canonicalItemCode(row.itemCode) === code)?.itemCode ?? code),
      values, category, comparisonChanged: !allAgree,
      left: values[String(legacyLeft)] ?? null, right: values[String(legacyRight)] ?? null,
    };
  });
  const differences = products.filter((product) => product.comparisonChanged)
    .map(({ comparisonChanged: _comparisonChanged, ...product }) => product);
  const categoryCounts = Object.fromEntries(["agree", "historical_above_competitive", "historical_below_competitive", "historical_only", "competitive_only", "one_sided", "disagreement"]
    .map((category) => [category, products.filter((product) => product.category === category).length]));
  const largestDisagreements = differences.map((product) => {
    const amounts = runIds.map((id) => (product.values[String(id)] as { suggestedMrp?: number | null } | null)?.suggestedMrp ?? null)
      .filter((value): value is number => value != null);
    const absoluteDifference = amounts.length > 1 ? Math.max(...amounts) - Math.min(...amounts) : 0;
    return { ...product, absoluteDifference, valueDifference: absoluteDifference };
  }).filter((product) => product.absoluteDifference > 0)
    .sort((a, b) => b.absoluteDifference - a.absoluteDifference).slice(0, 25);
  const runSummaries = runIds.map((id) => ({
    runId: id, modelKind: runById.get(id)!.modelKind ?? "competitive",
    runType: snapshotRunType({
      ...parsed<{ runType?: unknown; modelKind?: unknown }>(runById.get(id)!.inputSnapshot, {}),
      modelKind: runById.get(id)!.modelKind,
    }),
    inputSnapshot: exposedInputSnapshot(runById.get(id)!.inputSnapshot, runById.get(id)!.modelKind),
    summary: parsed(runById.get(id)!.summary, {}),
    policyVersion: (runById.get(id)!.modelKind ?? "competitive") === "historical" ? null : snapshotPolicyVersion(parsed(runById.get(id)!.inputSnapshot, {})),
    collectiveMargin: (() => {
      const snapshot = parsed<{
        products?: Array<CollectiveMarginInput & { itemCode?: string }>;
        salesCoverage?: { sales?: { held?: string[] }; margin?: { held?: string[] } };
      }>(runById.get(id)!.inputSnapshot, {});
      const freshness = parsed<{ coverage?: { sales?: { held?: string[] }; margin?: { held?: string[] } } }>(
        runById.get(id)!.sourceFreshness, {},
      );
      const evidence = new Map((snapshot.products ?? []).map((product) => [canonicalItemCode(product.itemCode ?? ""), product]));
      const resultByCode = new Map((byRun.get(id) ?? []).map((row) => [canonicalItemCode(row.itemCode), row]));
      const values = (snapshot.products ?? []).map((product) => {
        const code = canonicalItemCode(product.itemCode ?? "");
        const row = resultByCode.get(code);
        const persisted = parsed<{ salesEvidence?: unknown; marginEvidence?: unknown }>(row?.evidence ?? "{}", {});
        return {
          ...product,
          itemCode: row?.itemCode ?? product.itemCode,
          currentMrp: row?.currentMrp ?? product.currentMrp,
          suggestedMrp: row?.suggestedMrp ?? null,
          sales: persisted.salesEvidence ?? product.sales ?? null,
          margin: persisted.marginEvidence ?? product.margin ?? null,
        };
      });
      const coverage = snapshot.salesCoverage ?? freshness.coverage;
      return calculateCollectiveMargin(values, {
        sourcePeriods: {
          sales: coverage?.sales ? "2026-04..2026-08" : null,
          margin: coverage?.margin ? "2026-04..2026-06" : null,
        },
        holds: [
          ...(coverage?.sales?.held ?? []),
          ...(coverage?.margin?.held ?? []),
        ],
      });
    })(),
  }));
  const legacyLeftSnapshot = parsed<{ policy?: unknown; simplePolicy?: unknown; advancedPolicy?: unknown }>(runById.get(legacyLeft)!.inputSnapshot, {});
  const legacyRightSnapshot = parsed<{ policy?: unknown; simplePolicy?: unknown; advancedPolicy?: unknown }>(runById.get(legacyRight)!.inputSnapshot, {});
  res.json({
    runIds, runs: runSummaries, summaries: runSummaries,
    leftRunId: legacyLeft, rightRunId: legacyRight,
    leftPolicyVersion: runSummaries[0]!.policyVersion, rightPolicyVersion: runSummaries[1]!.policyVersion,
    leftPolicy: legacyLeftSnapshot.policy ?? null, rightPolicy: legacyRightSnapshot.policy ?? null,
    leftSimplePolicy: legacyLeftSnapshot.simplePolicy ?? null, rightSimplePolicy: legacyRightSnapshot.simplePolicy ?? null,
    leftAdvancedPolicy: legacyLeftSnapshot.advancedPolicy ?? null, rightAdvancedPolicy: legacyRightSnapshot.advancedPolicy ?? null,
    products, differences, categories: categoryCounts, categoryCounts,
    disagreementCounts: categoryCounts, largestDisagreements,
    comparisonMetrics: runSummaries.map(({ runId, runType, modelKind, collectiveMargin }) => ({
      runId, runType, modelKind, collectiveMargin,
    })),
    readOnly: true,
  });
});

router.post("/mrp-generator/runs/:runId/handoff", requireAdmin, async (req, res) => {
  const runId = Number(req.params.runId);
  const run = (await db.select().from(mrpGeneratorRunsTable).where(eq(mrpGeneratorRunsTable.id, runId)).limit(1))[0];
  if (!run) { res.status(404).json({ error: "Run not found." }); return; }
  if (run.modelKind === "historical") {
    res.status(409).json({ error: "Historical runs are read-only and cannot be handed off or applied." });
    return;
  }
  const selected = Array.isArray(req.body?.itemCodes) ? req.body.itemCodes.filter((x: unknown): x is string => typeof x === "string") : [];
  if (!selected.length) { res.status(400).json({ error: "itemCodes must contain at least one selected code." }); return; }
  if (run.asOf > today()) {
    res.status(409).json({ error: "Future-dated runs cannot be handed off. Run the scenario for today or an earlier date." });
    return;
  }
  const selectedKeys = selected.map(canonicalItemCode);
  if (new Set(selectedKeys).size !== selectedKeys.length) { res.status(400).json({ error: "itemCodes must not contain duplicates." }); return; }
  const rows = await db.select().from(mrpGeneratorResultsTable).where(eq(mrpGeneratorResultsTable.runId, runId));
  const byCode = new Map(rows.map((r) => [canonicalItemCode(r.itemCode), r]));
  type ResultRow = typeof mrpGeneratorResultsTable.$inferSelect;
  const chosen: Array<ResultRow | undefined> = selected.map((code: string) => byCode.get(canonicalItemCode(code)));
  if (chosen.some((r) => !r || r.status !== "suggested" || r.suggestedMrp == null || !r.currentRowId || r.currentMrp == null)) {
    res.status(409).json({ error: "Only eligible suggested results with a current approved MRP may be handed off. Excluded and no-change selections are rejected." });
    return;
  }
  const payload: Array<{ itemCode: string; currentRowId: number; currentMrp: number; currentDate: string; suggestedMrp: number }> = chosen.map((r) => ({
    itemCode: r!.itemCode,
    currentRowId: r!.currentRowId!,
    currentMrp: r!.currentMrp!,
    currentDate: r!.currentDate!,
    suggestedMrp: r!.suggestedMrp!,
  }));
  const periods = [...new Set(payload.map((item) => item.currentDate))];
  if (periods.length !== 1 || !periods[0]) {
    res.status(409).json({ error: "Selected products must share one exact approved MRP effective period." });
    return;
  }
  const lockedEffectiveDate = periods[0];
  const fileSha256 = inputFingerprint({ runId, payload });
  try {
    const batchId = await db.transaction(async (tx) => {
      // A run is a snapshot, not a lease on the source row. Lock and resolve
      // every selected Standard row again before creating the preview so a
      // concurrent edit or a newly effective revision cannot be handed off.
      for (const item of payload) {
        await tx.execute(sql`
          SELECT id
          FROM mrp_price_history
          WHERE id = ${item.currentRowId}
          FOR UPDATE
        `);
        const current = (await tx.execute<{ id: number; item_code: string; mrp: number | null; effective_date: string; variant: string; review_status: string }>(sql`
          SELECT id, item_code, mrp, effective_date, variant, review_status
          FROM mrp_price_history
          WHERE id = ${item.currentRowId}
            AND variant = 'Standard'
            AND review_status = 'approved'
            AND mrp IS NOT NULL
            AND effective_date <= ${today()}
        `)).rows[0];
        const latest = (await tx.execute<{ id: number; item_code: string; mrp: number | null; effective_date: string }>(sql`
          SELECT id, item_code, mrp, effective_date
          FROM mrp_price_history
          WHERE regexp_replace(regexp_replace(upper(trim(item_code)), '\\s+', '', 'g'), '\\.0$', '') =
            regexp_replace(regexp_replace(upper(trim(${item.itemCode})), '\\s+', '', 'g'), '\\.0$', '')
            AND variant = 'Standard'
            AND review_status = 'approved'
            AND mrp IS NOT NULL
            AND effective_date <= ${today()}
          ORDER BY effective_date DESC, id DESC
          LIMIT 1
          FOR UPDATE
        `)).rows[0];
        if (
          !current ||
          !latest ||
          latest.id !== item.currentRowId ||
          canonicalItemCode(latest.item_code) !== canonicalItemCode(item.itemCode) ||
          current.mrp !== item.currentMrp ||
          latest.effective_date !== item.currentDate ||
          latest.mrp !== item.currentMrp ||
          item.currentDate !== lockedEffectiveDate
        ) {
          throw Object.assign(
            new Error(`MRP for ${item.itemCode} changed after this run; create a fresh run.`),
            { httpStatus: 409 },
          );
        }
      }
      const batch = (await tx.insert(mrpRevisionBatchesTable).values({
        targetType: "mrp",
        lockedEffectiveDate,
        fileName: `mrp-generator-run-${runId}.json`,
        fileSha256,
        fileSizeBytes: Buffer.byteLength(stableJson(payload)),
        uploadedBy: actor(req),
        reason: `MRP Generator scenario ${run.scenarioId}, run ${runId}`,
        scenarioId: run.scenarioId,
        runId,
        rowsInFile: payload.length,
        rowsChanged: payload.length,
      }).returning({ id: mrpRevisionBatchesTable.id }))[0]!;
      await tx.insert(mrpRevisionRowsTable).values(payload.map((r, index) => ({
        batchId: batch.id,
        rowNumber: index + 1,
        itemCode: r.itemCode,
         effectiveDate: r.currentDate,
        variant: "Standard",
        targetRowId: r.currentRowId,
        previousValue: r.currentMrp,
        newValue: r.suggestedMrp,
        outcome: "change",
        note: `Generated by scenario ${run.scenarioId}, run ${runId}`,
      })));
      return batch.id;
    });
    res.status(201).json({ batchId, status: "preview", scenarioId: run.scenarioId, runId, rowsChanged: payload.length });
  } catch (error: any) {
    res.status(error?.httpStatus ?? 400).json({ error: error instanceof Error ? error.message : "Could not create revision preview." });
  }
});

export default router;