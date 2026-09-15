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
const parsed = <T>(value: string, fallback: T): T => {
  try { return JSON.parse(value) as T; } catch { return fallback; }
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
  const isCanonicalDefault = Boolean(storedRules && typeof storedRules === "object" && !Array.isArray(storedRules) &&
    (storedRules as { p012DefaultKey?: unknown }).p012DefaultKey === "canonical");
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
      division: product.division,
      seriesRange: product.seriesRange,
      category: product.category,
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
      default: DEFAULT_P012_SCENARIO.policy,
      defaultScenario: {
        name: DEFAULT_P012_SCENARIO.name,
        description: DEFAULT_P012_SCENARIO.description,
        scope: DEFAULT_P012_SCENARIO.scope,
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
    db.select({ division: catalogProductsTable.division, series: catalogProductsTable.seriesRange, category: catalogProductsTable.category })
      .from(catalogProductsTable).where(eq(catalogProductsTable.isActive, true)),
    db.selectDistinct({ competitor: competitorPricesTable.competitor }).from(competitorPricesTable),
  ]);
  res.json({
    divisions: [...new Set(products.map((p) => p.division).filter((v): v is string => !!v))].sort(),
    series: [...new Set(products.map((p) => p.series).filter((v): v is string => !!v))].sort(),
    categories: [...new Set(products.map((p) => p.category).filter((v): v is string => !!v))].sort(),
    competitors: competitors.map((c) => c.competitor).sort(),
  });
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
  try {
    const products = await productsFor(asOf);
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
    const evaluation = evaluateHistoricalMrp(products, history, asOf);
    const snapshot = {
      modelKind: "historical",
      asOf,
      products: products.map((product) => ({
        itemCode: product.itemCode, productName: product.productName,
        division: product.division, category: product.category,
        seriesRange: product.seriesRange, currentMrp: product.currentMrp,
        currentDate: product.currentDate, currentRowId: product.currentRowId,
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
      sales: getSalesApiStatus(),
      source: "approved Standard Prayag MRP history",
      historyRows: history.length,
      latestDate: history.map((row) => row.effectiveDate).sort().at(-1) ?? null,
    };
    const summary = { ...evaluation.summary, modelKind: "historical" };
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
          evidence: json(result.evidence),
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
      runId, scenarioId: null, modelKind: "historical", asOf,
      policyVersion: null, inputFingerprint: fingerprint, summary,
      sourceFreshness: freshness, series: evaluation.series,
    });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Could not compute historical MRP." });
  }
});

async function ensureDefaultP012Scenario(createdBy: string | null = null) {
  const existingRows = await db.select().from(mrpGeneratorScenariosTable);
  const marked = existingRows.find((row) => {
    const stored = parsed<unknown>(row.rules, null);
    return stored && typeof stored === "object" && !Array.isArray(stored) &&
      (stored as { p012DefaultKey?: unknown }).p012DefaultKey === "canonical";
  });
  if (marked) return marked;
  const existing = existingRows.find((row) => row.name === DEFAULT_P012_SCENARIO.name);
  if (existing) {
    const stored = parsed<Record<string, unknown>>(existing.rules, {});
    const updated = (await db.update(mrpGeneratorScenariosTable).set({
      rules: json({ ...stored, p012DefaultKey: "canonical" }),
    }).where(eq(mrpGeneratorScenariosTable.id, existing.id)).returning())[0];
    return updated ?? existing;
  }
  try {
    return (await db.insert(mrpGeneratorScenariosTable).values({
      name: DEFAULT_P012_SCENARIO.name,
      description: DEFAULT_P012_SCENARIO.description,
      scope: json(DEFAULT_P012_SCENARIO.scope),
      rules: json({ policyVersion: 3, p012DefaultKey: "canonical", policy: DEFAULT_P012_SCENARIO.policy }),
      version: 3,
      createdBy,
    }).returning())[0]!;
  } catch {
    // A concurrent first request may have won the unique-name insert.
    return (await db.select().from(mrpGeneratorScenariosTable)
      .where(eq(mrpGeneratorScenariosTable.name, DEFAULT_P012_SCENARIO.name)).limit(1))[0]!;
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
    if (name === DEFAULT_P012_SCENARIO.name) {
      const conflict = new Error("The canonical default name is reserved; use the default scenario or choose another name.");
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
        policy: simplePolicy,
      });
      changes.version = 3;
    } else if (body.policy !== undefined || body.policyVersion !== undefined) {
      const policyInput = body.policy && typeof body.policy === "object" ? body.policy as P011Policy : null;
      if (!policyInput || body.policyVersion !== 2 && policyInput.policyVersion !== 2) throw new Error("P011 policy requires policyVersion 2 and a policy object.");
      const policy = { ...DEFAULT_P011_POLICY, ...policyInput, policyVersion: 2 as const };
      validateP011Policy(policy);
      changes.rules = json({ policyVersion: 2, policy });
      changes.version = 2;
    }
    if (body.rules !== undefined) {
      if (Array.isArray(body.rules) && body.rules.length && (body.policy !== undefined || body.simplePolicy !== undefined || body.advancedPolicy !== undefined || body.policyVersion !== undefined)) {
        throw new Error("P011 scenarios cannot combine policy with non-empty ordered rules.");
      }
      if (body.policy !== undefined || body.simplePolicy !== undefined || body.advancedPolicy !== undefined || body.policyVersion !== undefined) {
        // Empty legacy storage is harmless when a P011 policy is supplied.
      } else {
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
    (currentRules as { p012DefaultKey?: unknown }).p012DefaultKey === "canonical")) {
    res.status(409).json({ error: "Only the canonical default scenario can be reset.", code: "not_canonical_default" });
    return;
  }
  const updated = (await db.update(mrpGeneratorScenariosTable).set({
    name: DEFAULT_P012_SCENARIO.name,
    description: DEFAULT_P012_SCENARIO.description,
    scope: json(DEFAULT_P012_SCENARIO.scope),
    rules: json({ policyVersion: 3, p012DefaultKey: "canonical", policy: DEFAULT_P012_SCENARIO.policy }),
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
    ? Object.fromEntries(Object.entries(duplicateRules).filter(([key]) => key !== "p012DefaultKey"))
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
    rules: json({ policyVersion: 2, ...(currentStored.p012DefaultKey === "canonical" ? { p012DefaultKey: "canonical" } : {}), advanced }),
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
      })));
      return runId;
    });
    res.status(201).json({ runId: run, scenarioId, modelKind: "competitive", asOf, policyVersion: p011 ? 2 : p012 ? 3 : 1, inputFingerprint: fingerprint, summary, sourceFreshness: freshness });
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
      scenarioName: scenarioName ?? null,
      inputSnapshot: exposedInputSnapshot(run.inputSnapshot, run.modelKind),
      summary: parsed(run.summary, {}),
      sourceFreshness: parsed(run.sourceFreshness, {}),
      policyVersion: run.modelKind === "historical" ? null : snapshotPolicyVersion(parsed(run.inputSnapshot, {})),
      modelKind: run.modelKind ?? snapshotModelKind(parsed(run.inputSnapshot, {})),
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
  };
}

function exposedRun(run: typeof mrpGeneratorRunsTable.$inferSelect) {
  return {
    ...run,
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
    salesEvidence: evidence?.sales ?? null,
    marginEvidence: evidence?.margin ?? null,
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
  const run = (await db.select({ inputSnapshot: mrpGeneratorRunsTable.inputSnapshot }).from(mrpGeneratorRunsTable).where(eq(mrpGeneratorRunsTable.id, id)).limit(1))[0];
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
  res.json({ runId: id, results: rows.map((row) => exposedResult(row, evidence.get(canonicalItemCode(row.itemCode)), p011ByCode.get(canonicalItemCode(row.itemCode)) ?? p012ByCode.get(canonicalItemCode(row.itemCode)))) });
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
    inputSnapshot: exposedInputSnapshot(runById.get(id)!.inputSnapshot, runById.get(id)!.modelKind),
    summary: parsed(runById.get(id)!.summary, {}),
    policyVersion: (runById.get(id)!.modelKind ?? "competitive") === "historical" ? null : snapshotPolicyVersion(parsed(runById.get(id)!.inputSnapshot, {})),
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