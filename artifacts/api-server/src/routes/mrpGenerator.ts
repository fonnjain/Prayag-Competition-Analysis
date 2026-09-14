import { Router, type IRouter } from "express";
import { and, asc, desc, eq, sql } from "drizzle-orm";
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
  SUPPORTED_VOLUME_PERIOD,
  type GeneratorProduct,
  type GeneratorRule,
  type GeneratorScope,
} from "../lib/mrpGenerator";
import {
  awaitingConfirmationCodes,
  getSalesApiStatus,
  getCachedSalesSnapshot,
  getSalesSnapshot,
  hasHeldMarginCoverage,
  SalesApiError,
  type SalesSnapshot,
  type SalesCoverage,
  SUPPORTED_SALES_PERIOD,
} from "../lib/salesApi";

const router: IRouter = Router();
const today = () => new Date().toISOString().slice(0, 10);
const KNOWN_LIMITS = {
  pageLimit: 500,
  maxRestarts: 2,
  salesPeriod: ["2026-04..2026-08"],
  marginPeriod: ["2026-04..2026-06"],
} as const;
const json = (value: unknown): string => JSON.stringify(value);
const parsed = <T>(value: string, fallback: T): T => {
  try { return JSON.parse(value) as T; } catch { return fallback; }
};
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
  if (error instanceof SalesApiError && error.kind === "missing_credential") return 503;
  return 503;
}

async function requiredSalesSnapshot(refresh = false, period = SUPPORTED_VOLUME_PERIOD): Promise<SalesSnapshot> {
  try {
    return await getSalesSnapshot({ refresh, period });
  } catch (error) {
    const wrapped = error instanceof Error ? error : new Error("Sales API snapshot is unavailable.");
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
  const stage2 = sales.available;
  const salesReason = sales.available ? undefined : sales.reason;
  res.json({
    stage: stage2 ? 2 : 1,
    deterministic: true,
    salesApi: { ...sales, ...(salesReason ? { reason: salesReason } : {}) },
    disabledRules: stage2 ? [] : [
      {
        type: "margin_floor",
        reason: sales.reason,
        configurationSummary: "One floor per master category: PTMT 65%, C P 38%, PLUMBING 30%, SANITARYWARE 38%, SINK 40%, HARDWARE 38%; narrower scope overrides will be supported.",
      },
      {
        type: "volume_tier",
        reason: sales.reason,
        configurationSummary: "A/B/C by cumulative sales-value contribution (first 80%, next 15%, remainder) or an explicit FY sales-value threshold. Percentile bands are not used.",
      },
    ],
    supportedRules: [
      "scope", "percent_below", "match", "percent_above_lowest", "max_increase",
      "max_decrease", "hold_below", "rounding",
      ...(stage2 ? ["margin_floor", "volume_tier"] : []),
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

router.get("/mrp-generator/scenarios", requireAdmin, async (_req, res) => {
  const rows = await db.select().from(mrpGeneratorScenariosTable).orderBy(asc(mrpGeneratorScenariosTable.createdAt));
  res.json(rows.map((row) => ({ ...row, scope: parsed(row.scope, {}), rules: parsed(row.rules, []) })));
});

router.post("/mrp-generator/scenarios", requireAdmin, async (req, res) => {
  try {
    const body = req.body as { name?: unknown; description?: unknown; scope?: unknown; rules?: unknown };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) { res.status(400).json({ error: "name is required." }); return; }
    const scope = body.scope && typeof body.scope === "object" ? body.scope as GeneratorScope : {};
    const ruleList = Array.isArray(body.rules) ? body.rules as GeneratorRule[] : [];
    const needsSales = hasSalesRules(ruleList, scope);
    const rules = validateScenarioRules(body.rules, { salesAvailable: true });
     if (needsSales) await requiredSalesSnapshot(false, salesPeriod(rules));
    const inserted = await db.insert(mrpGeneratorScenariosTable).values({
      name,
      description: typeof body.description === "string" ? body.description.trim() : null,
      scope: json(scope),
      rules: json(rules),
      createdBy: actor(req),
    }).returning();
    const row = inserted[0]!;
    res.status(201).json({ ...row, scope, rules });
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
  res.json({ ...row, scope: parsed(row.scope, {}), rules: parsed(row.rules, []) });
});

router.patch("/mrp-generator/scenarios/:scenarioId", requireAdmin, async (req, res) => {
  const id = Number(req.params.scenarioId);
  const current = (await db.select().from(mrpGeneratorScenariosTable).where(eq(mrpGeneratorScenariosTable.id, id)).limit(1))[0];
  if (!current) { res.status(404).json({ error: "Scenario not found." }); return; }
  try {
    const body = req.body as { name?: unknown; description?: unknown; scope?: unknown; rules?: unknown };
    const changes: Partial<typeof mrpGeneratorScenariosTable.$inferInsert> = { updatedAt: new Date() };
    if (body.name !== undefined) {
      if (typeof body.name !== "string" || !body.name.trim()) throw new Error("name is required.");
      changes.name = body.name.trim();
    }
    if (body.description !== undefined) changes.description = typeof body.description === "string" ? body.description.trim() : null;
    if (body.scope !== undefined) changes.scope = json(body.scope);
    if (body.rules !== undefined) {
      const scope = body.scope !== undefined
        ? body.scope && typeof body.scope === "object" ? body.scope as GeneratorScope : {}
        : parsed<GeneratorScope>(current.scope, {});
      const ruleList = Array.isArray(body.rules) ? body.rules as GeneratorRule[] : [];
      const needsSales = hasSalesRules(ruleList, scope);
      const rules = validateScenarioRules(body.rules, { salesAvailable: true });
       if (needsSales) await requiredSalesSnapshot(false, salesPeriod(rules));
      changes.rules = json(rules);
    } else if (body.scope !== undefined) {
      const scope = body.scope && typeof body.scope === "object" ? body.scope as GeneratorScope : {};
      const existingRules = parsed<GeneratorRule[]>(current.rules, []);
       if (hasSalesRules(existingRules, scope)) await requiredSalesSnapshot(false, salesPeriod(existingRules));
    }
    const updated = (await db.update(mrpGeneratorScenariosTable).set(changes).where(eq(mrpGeneratorScenariosTable.id, id)).returning())[0]!;
    res.json({ ...updated, scope: parsed(updated.scope, {}), rules: parsed(updated.rules, []) });
  } catch (error) {
    const status = (error as { httpStatus?: number }).httpStatus ?? 400;
    res.status(status).json({ error: error instanceof Error ? error.message : "Invalid scenario." });
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
    const needsSales = hasSalesRules(ruleList, scope);
    const allProducts = await productsFor(asOf);
    let snapshotSales: SalesSnapshot | null = null;
    let enrichedAll = allProducts;
    if (needsSales) {
       snapshotSales = await requiredSalesSnapshot(refreshSales, salesPeriod(ruleList));
      enrichedAll = enrichProducts(allProducts, snapshotSales);
      const tiers = computeVolumeTiers(enrichedAll);
      enrichedAll = enrichedAll.map((product) => ({
        ...product,
        sales: product.sales ? { ...product.sales, tier: tiers.get(canonicalItemCode(product.itemCode)) ?? null } : product.sales,
      }));
    }
    const rules = validateScenarioRules(rawRules, { salesAvailable: needsSales });
    const products = enrichedAll.filter((product) => matchesScope(product, scope));
    const results = products.map((product) => evaluateProduct(product, rules, {
      confidenceOnly: scope.confidenceOnly,
      ...(snapshotSales ? { volumeTiers: computeVolumeTiers(enrichedAll) } : {}),
    }));
    const coverageSummary = snapshotSales
      ? salesCoverageSummary(enrichedAll, products, snapshotSales, scope.confidenceOnly === true)
      : null;
    const snapshot = {
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
      })));
      return runId;
    });
    res.status(201).json({ runId: run, scenarioId, asOf, inputFingerprint: fingerprint, summary, sourceFreshness: freshness });
  } catch (error) {
    const status = (error as { httpStatus?: number }).httpStatus ?? 400;
    res.status(status).json({ error: error instanceof Error ? error.message : "Could not run scenario." });
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
      inputSnapshot: parsed(run.inputSnapshot, {}),
      summary: parsed(run.summary, {}),
      sourceFreshness: parsed(run.sourceFreshness, {}),
    })),
    limit,
  });
});

function exposedRun(run: typeof mrpGeneratorRunsTable.$inferSelect) {
  return { ...run, summary: parsed(run.summary, {}), sourceFreshness: parsed(run.sourceFreshness, {}), inputSnapshot: parsed(run.inputSnapshot, {}) };
}
function exposedResult(
  row: typeof mrpGeneratorResultsTable.$inferSelect,
  evidence?: { sales?: unknown; margin?: unknown; warnings?: string[] },
) {
  return {
    ...row,
    exclusions: parsed(row.exclusions, []),
    competitorValues: parsed(row.competitorValues, []),
    trace: parsed(row.trace, []),
    salesEvidence: evidence?.sales ?? null,
    marginEvidence: evidence?.margin ?? null,
    warnings: evidence?.warnings ?? [],
  };
}

router.get("/mrp-generator/runs/:runId", requireAdmin, async (req, res) => {
  const id = Number(req.params.runId);
  const run = (await db.select().from(mrpGeneratorRunsTable).where(eq(mrpGeneratorRunsTable.id, id)).limit(1))[0];
  if (!run) { res.status(404).json({ error: "Run not found." }); return; }
  const scenario = (await db.select({ id: mrpGeneratorScenariosTable.id, name: mrpGeneratorScenariosTable.name }).from(mrpGeneratorScenariosTable).where(eq(mrpGeneratorScenariosTable.id, run.scenarioId)).limit(1))[0];
  const results = await db.select().from(mrpGeneratorResultsTable).where(eq(mrpGeneratorResultsTable.runId, id)).orderBy(asc(mrpGeneratorResultsTable.itemCode));
  const snapshot = parsed<{ products?: Array<{ itemCode?: string; sales?: unknown; margin?: unknown }> }>(run.inputSnapshot, {});
  const evidence = new Map((snapshot.products ?? []).map((product) => [
    canonicalItemCode(product.itemCode ?? ""),
    {
      sales: product.sales,
      margin: product.margin,
      warnings: (product.margin && typeof product.margin === "object" && Array.isArray((product.margin as { warnings?: unknown }).warnings))
        ? (product.margin as { warnings: string[] }).warnings : [],
    },
  ]));
  res.json({ run: exposedRun(run), scenario, results: results.map((row) => exposedResult(row, evidence.get(canonicalItemCode(row.itemCode)))) });
});

router.get("/mrp-generator/runs/:runId/results", requireAdmin, async (req, res) => {
  const id = Number(req.params.runId);
  const rows = await db.select().from(mrpGeneratorResultsTable).where(eq(mrpGeneratorResultsTable.runId, id)).orderBy(asc(mrpGeneratorResultsTable.itemCode));
  if (!rows.length && !(await db.select({ id: mrpGeneratorRunsTable.id }).from(mrpGeneratorRunsTable).where(eq(mrpGeneratorRunsTable.id, id)).limit(1))[0]) { res.status(404).json({ error: "Run not found." }); return; }
  const run = (await db.select({ inputSnapshot: mrpGeneratorRunsTable.inputSnapshot }).from(mrpGeneratorRunsTable).where(eq(mrpGeneratorRunsTable.id, id)).limit(1))[0];
  const snapshot = parsed<{ products?: Array<{ itemCode?: string; sales?: unknown; margin?: unknown }> }>(run?.inputSnapshot ?? "{}", {});
  const evidence = new Map((snapshot.products ?? []).map((product) => [
    canonicalItemCode(product.itemCode ?? ""), {
      sales: product.sales,
      margin: product.margin,
      warnings: product.margin && typeof product.margin === "object" && Array.isArray((product.margin as { warnings?: unknown }).warnings)
        ? (product.margin as { warnings: string[] }).warnings : [],
    },
  ]));
  res.json({ runId: id, results: rows.map((row) => exposedResult(row, evidence.get(canonicalItemCode(row.itemCode)))) });
});

router.get("/mrp-generator/compare", requireAdmin, async (req, res) => {
  const leftId = Number(req.query.leftRunId ?? req.query.runA);
  const rightId = Number(req.query.rightRunId ?? req.query.runB);
  if (!Number.isInteger(leftId) || !Number.isInteger(rightId)) { res.status(400).json({ error: "leftRunId and rightRunId are required integers." }); return; }
  const runs = await db.select({ id: mrpGeneratorRunsTable.id }).from(mrpGeneratorRunsTable)
    .where(sql`${mrpGeneratorRunsTable.id} IN (${leftId}, ${rightId})`);
  const existing = new Set(runs.map((run) => run.id));
  const missing = [leftId, rightId].filter((id, index, ids) => !existing.has(id) && ids.indexOf(id) === index);
  if (missing.length) {
    res.status(404).json({ error: `Generator run(s) not found: ${missing.join(", ")}.` });
    return;
  }
  const [left, right] = await Promise.all([
    db.select().from(mrpGeneratorResultsTable).where(eq(mrpGeneratorResultsTable.runId, leftId)),
    db.select().from(mrpGeneratorResultsTable).where(eq(mrpGeneratorResultsTable.runId, rightId)),
  ]);
  const leftByCode = new Map(left.map((r) => [canonicalItemCode(r.itemCode), r]));
  const rightByCode = new Map(right.map((r) => [canonicalItemCode(r.itemCode), r]));
  const codes = [...new Set([...leftByCode.keys(), ...rightByCode.keys()])].sort((a, b) => a.localeCompare(b));
  const differences = codes.map((code) => {
    const l = leftByCode.get(code);
    const r = rightByCode.get(code);
    return { itemCode: l?.itemCode ?? r?.itemCode ?? code, left: l ? exposedResult(l) : null, right: r ? exposedResult(r) : null };
  }).filter((entry) =>
    entry.left == null ||
    entry.right == null ||
    entry.left.suggestedMrp !== entry.right.suggestedMrp ||
    entry.left.status !== entry.right.status,
  );
  res.json({ leftRunId: leftId, rightRunId: rightId, differences });
});

router.post("/mrp-generator/runs/:runId/handoff", requireAdmin, async (req, res) => {
  const runId = Number(req.params.runId);
  const run = (await db.select().from(mrpGeneratorRunsTable).where(eq(mrpGeneratorRunsTable.id, runId)).limit(1))[0];
  if (!run) { res.status(404).json({ error: "Run not found." }); return; }
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