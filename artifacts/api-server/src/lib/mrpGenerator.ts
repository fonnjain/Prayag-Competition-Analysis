import { createHash } from "node:crypto";

export type GeneratorScope = {
  division?: string | string[];
  series?: string | string[];
  category?: string | string[];
  competitorMapped?: boolean;
  explicitCodes?: string[];
  itemCodes?: string[];
  codes?: string[];
  confidenceOnly?: boolean;
};

export type GeneratorRule = Record<string, unknown> & { type: string };
export const SUPPORTED_VOLUME_PERIOD = "2026-27";

export type GeneratorProduct = {
  itemCode: string;
  productName: string | null;
  division: string | null;
  seriesRange?: string | null;
  category: string | null;
  currentMrp: number | null;
  currentDate: string | null;
  currentRowId?: number | null;
  competitors: GeneratorCompetitor[];
  sales?: GeneratorSalesEvidence | null;
  margin?: GeneratorMarginEvidence | null;
};

export type GeneratorSalesEvidence = {
  salesAmount: number;
  qty: number | null;
  qtyUnknown: boolean;
  fySalesExists?: boolean;
  awaitingConfirmation?: boolean;
  tier?: "A" | "B" | "C" | null;
};

export type GeneratorMarginEvidence = {
  grossMarginPct: number | null;
  qty?: number | null;
  saleValue?: number | null;
  bomValue?: number | null;
  unitBomValue?: number | null;
  qtyUnknown?: boolean;
  discountFrac?: number | null;
  held?: boolean;
  latestMonth?: string | null;
  warnings?: string[];
};

export type GeneratorCompetitor = {
  competitor: string;
  price: number | null;
  effectivePrice: number | null;
  effectiveDate: string | null;
  ageDays: number | null;
  stale: boolean;
  matched: boolean;
};

export type GeneratorTrace = {
  order: number;
  ruleType: string;
  outcome: "fired" | "blocked" | "skipped";
  before: number | null;
  after: number | null;
  reason: string;
  target?: number | null;
};

export type GeneratorResult = {
  itemCode: string;
  productName: string | null;
  division: string | null;
  category: string | null;
  currentMrp: number | null;
  currentDate: string | null;
  currentRowId?: number | null;
  suggestedMrp: number | null;
  status: "suggested" | "no_change" | "excluded";
  exclusions: string[];
  competitorValues: GeneratorCompetitor[];
  trace: GeneratorTrace[];
  competitiveTarget: number | null;
  bindingConstraint: string | null;
  changePercent: number | null;
  salesEvidence?: GeneratorSalesEvidence | null;
  marginEvidence?: GeneratorMarginEvidence | null;
  warnings: string[];
  /** P011 policy fields. They are optional so immutable legacy runs remain readable. */
  policyVersion?: number;
  band?: P011Band;
  fySalesAmount?: number | null;
  selectedCompetitor?: string | null;
  competitorMode?: P011CompetitorMode | null;
  gap?: number | null;
  position?: P011Position | null;
  action?: P011Action;
  marginFloorEvidence?: P011MarginFloorEvidence | null;
  bindingConstraints?: string[];
  escalation?: boolean;
  escalationReason?: string | null;
  fullTrace?: GeneratorTrace[];
  /** P012 simple-table evidence. Optional for immutable P011/legacy rows. */
  matchedRowNumber?: number | null;
  matchedRowId?: string | null;
  matchedRowLabel?: string | null;
  selectedCompetitorPrice?: number | null;
  rawTarget?: number | null;
  decisionSentence?: string;
  volumeTier?: P011Band | null;
};

export type P011Band = "A" | "B" | "C" | "D" | "E" | "F";
export type P011Position = "well_below" | "parity" | "above";
export type P011CompetitorMode = "nearest" | "lowest" | "named";
export type P011Action = "CAPTURE" | "DEFEND" | "HOLD" | "REVIEW" | "LEAVE_ALONE" | "MARGIN_ONLY" | "EXCLUDED";

export type P012TargetMode = "below" | "match" | "above" | "close_gap";
export type P012AppliesTo = "division" | "series" | "category" | "explicit_codes" | "all";
export type P012CompetitorMode = "named" | "nearest" | "lowest";
export type P012Competitor = { mode: P012CompetitorMode; name?: string | null };
export type P012Rule = {
  id: string;
  order: number;
  label: string;
  competitor: P012Competitor;
  appliesTo: { type: P012AppliesTo; value?: string | string[] | null };
  target: { mode: P012TargetMode; percent?: number | null };
  maxIncrease?: number | null;
  maxDecrease?: number | null;
  catchAll?: boolean;
};
export type P012SimplePolicy = {
  policyVersion: 3;
  mode: "simple";
  holdBelow: number;
  rounding: { unit: number; direction: "nearest" | "up" | "down" };
  marginEnabled: boolean;
  volumeEnabled: boolean;
  categoryFloors: Record<string, number>;
  rows: P012Rule[];
};
export type P012Scenario = {
  name: string;
  description: string;
  scope: GeneratorScope;
  policy: P012SimplePolicy;
};

export const DEFAULT_P012_SCENARIO: P012Scenario = {
  name: "Match competition, stay below",
  description: "Starting point. Edit freely -- it explains itself as you change it.",
  scope: { competitorMapped: true },
  policy: {
    policyVersion: 3,
    mode: "simple",
    holdBelow: 50,
    rounding: { unit: 1, direction: "nearest" },
    marginEnabled: false,
    volumeEnabled: false,
    categoryFloors: { PTMT: 65, "C P": 38, PLUMBING: 30, SANITARYWARE: 38, SINK: 40, HARDWARE: 38 },
    rows: [{
      id: "default-nearest-below",
      order: 1,
      label: "Nearest competitor, 5% below",
      competitor: { mode: "nearest", name: null },
      appliesTo: { type: "all" },
      target: { mode: "below", percent: 5 },
      maxIncrease: 15,
      maxDecrease: 5,
      catchAll: true,
    }],
  },
};
export const DEFAULT_P012_POLICY = DEFAULT_P012_SCENARIO.policy;

const p012Number = (value: unknown, fallback: number | null = null): number | null => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

function normalizeP012Rule(value: unknown, index: number): P012Rule {
  const row = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  const competitorValue = row.competitor;
  const competitorObject = competitorValue && typeof competitorValue === "object" && !Array.isArray(competitorValue)
    ? competitorValue as Record<string, unknown> : {};
  const modeRaw = competitorObject.mode ?? row.competitorMode ?? (typeof competitorValue === "string" ? competitorValue : "nearest");
  const mode = String(modeRaw).toLowerCase().replace(/[\s-]+/g, "_");
  const competitorMode: P012CompetitorMode =
    mode === "named" ? "named" : mode === "lowest" ? "lowest" : "nearest";
  const appliesValue = row.appliesTo;
  const appliesObject = appliesValue && typeof appliesValue === "object" && !Array.isArray(appliesValue)
    ? appliesValue as Record<string, unknown> : {};
  const appliesRaw = appliesObject.type ?? (typeof appliesValue === "string" ? appliesValue : "all");
  const appliesType = String(appliesRaw).toLowerCase().replace(/[\s-]+/g, "_");
  const applies: P012AppliesTo =
    appliesType === "division" || appliesType === "series" || appliesType === "category" ||
    appliesType === "explicit_codes" ? appliesType : "all";
  const targetValue = row.target;
  const targetObject = targetValue && typeof targetValue === "object" && !Array.isArray(targetValue)
    ? targetValue as Record<string, unknown> : {};
  const targetRaw = targetObject.mode ?? (typeof targetValue === "string" ? targetValue : "match");
  const targetModeRaw = String(targetRaw).toLowerCase().replace(/[\s-]+/g, "_");
  const targetMode: P012TargetMode =
    targetModeRaw === "below" || targetModeRaw === "above" || targetModeRaw === "close_gap"
      ? targetModeRaw : "match";
  const scopeValue = appliesObject.value ?? appliesObject.name ?? row.value ?? row.scopeValue;
  return {
    id: typeof row.id === "string" && row.id.trim() ? row.id.trim() : `p012-row-${index + 1}`,
    order: Number.isFinite(Number(row.order)) ? Number(row.order) : index + 1,
    label: typeof row.label === "string" && row.label.trim() ? row.label.trim() : `Row ${index + 1}`,
    competitor: {
      mode: competitorMode,
      name: typeof (competitorObject.name ?? competitorObject.named ?? row.competitorName ?? row.name) === "string"
        ? String(competitorObject.name ?? competitorObject.named ?? row.competitorName ?? row.name).trim() : null,
    },
    appliesTo: { type: applies, value: Array.isArray(scopeValue) ? scopeValue.filter((v): v is string => typeof v === "string") : typeof scopeValue === "string" ? scopeValue : null },
    target: { mode: targetMode, percent: p012Number(targetObject.percent ?? row.percent ?? row.percentage, targetMode === "match" ? null : 0) },
    maxIncrease: p012Number(row.maxIncrease ?? row.maxIncreasePercent),
    maxDecrease: p012Number(row.maxDecrease ?? row.maxDecreasePercent),
    catchAll: row.catchAll === true || applies === "all",
  };
}

export function normalizeP012Policy(value: unknown): P012SimplePolicy {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  const rows = Array.isArray(input.rows) ? input.rows.map(normalizeP012Rule) : [];
  const roundingValue = input.rounding;
  const rounding = roundingValue && typeof roundingValue === "object" && !Array.isArray(roundingValue)
    ? roundingValue as Record<string, unknown> : {};
  const direction = rounding.direction === "up" || rounding.direction === "down" ? rounding.direction : "nearest";
  return {
    policyVersion: 3,
    mode: "simple",
    holdBelow: p012Number(input.holdBelow, 50) ?? 50,
    rounding: { unit: p012Number(rounding.unit, 1) ?? 1, direction },
    marginEnabled: input.marginEnabled === true,
    volumeEnabled: input.volumeEnabled === true,
    categoryFloors: {
      PTMT: 65, "C P": 38, PLUMBING: 30, SANITARYWARE: 38, SINK: 40, HARDWARE: 38,
      ...(input.categoryFloors && typeof input.categoryFloors === "object" && !Array.isArray(input.categoryFloors)
        ? Object.fromEntries(Object.entries(input.categoryFloors).map(([key, value]) => [key, Number(value)]).filter(([, value]) => Number.isFinite(value)))
        : {}),
    },
    rows: rows.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)),
  };
}

export function validateP012Policy(value: unknown): P012SimplePolicy {
  const policy = normalizeP012Policy(value);
  if (!policy.rows.length) throw new Error("P012 simplePolicy.rows must be a non-empty ordered array.");
  if (!Number.isFinite(policy.holdBelow) || policy.holdBelow < 0) throw new Error("P012 holdBelow must be non-negative.");
  if (!Number.isFinite(policy.rounding.unit) || policy.rounding.unit <= 0) throw new Error("P012 rounding.unit must be positive.");
  for (const [category, floor] of Object.entries(policy.categoryFloors)) {
    if (!Number.isFinite(floor) || floor < 0 || floor >= 100) throw new Error(`P012 margin floor for ${category} must be at least 0 and below 100.`);
  }
  const ids = new Set<string>();
  const orders = new Set<number>();
  for (const [index, row] of policy.rows.entries()) {
    if (!row.id || ids.has(row.id)) throw new Error(`P012 rows[${index}] id must be unique.`);
    if (orders.has(row.order)) throw new Error(`P012 rows[${index}] order must be unique.`);
    ids.add(row.id);
    orders.add(row.order);
    if (row.competitor.mode === "named" && !row.competitor.name) throw new Error(`P012 rows[${index}] named competitor requires a name.`);
    if (row.target.mode !== "match" && (row.target.percent == null || row.target.percent < 0 || row.target.percent > 100)) {
      throw new Error(`P012 rows[${index}] target percent must be between 0 and 100.`);
    }
    for (const [field, raw] of [["maxIncrease", row.maxIncrease], ["maxDecrease", row.maxDecrease] ] as const) {
      if (raw != null && (!Number.isFinite(raw) || raw < 0 || raw > 100)) throw new Error(`P012 rows[${index}] ${field} must be between 0 and 100.`);
    }
  }
  return policy;
}

export type P011Policy = {
  policyVersion: 2;
  period: string;
  bands?: { A: number; B: number; C: number; D: number };
  position?: { wellBelowAbove: number; parityBelow: number; parityAbove: number };
  competitor?: {
    mode: P011CompetitorMode;
    named?: string | null;
    staleAfterDays?: number;
    excludeStale?: boolean;
  };
  captureShares?: Partial<Record<Exclude<P011Band, "F">, number>>;
  defendTargetUndercut?: number;
  categoryFloors?: Record<string, number>;
  marginTargetUpliftPoints?: number;
  maxIncreasePercent?: number;
  maxDecreasePercent?: number;
  holdThreshold?: number;
  rounding?: { unit?: number; direction?: "nearest" | "up" | "down" };
  portfolio?: {
    mode: "hold_current" | "improve_by_points" | "allow_decline_points";
    points?: number;
  };
};

export type P011MarginFloorEvidence = {
  category: string | null;
  floorPercent: number | null;
  minimumMrp: number | null;
  currentGrossMargin: number | null;
  discountFraction: number | null;
  usable: boolean;
};

export type P011ActionValueImpact = {
  count: number;
  fySalesValue: number;
  grossContributionDelta: number;
};

export type P011OmittedReason = {
  count: number;
  fySalesValue: number;
};

export type P011HeadroomCandidate = {
  itemCode: string;
  band: P011Band;
  fySalesValue: number;
  additionalRealizedSaleValue: number;
  additionalGrossContribution: number;
};

export type P011PortfolioReport = {
  currentGrossMargin: number | null;
  proposedGrossMargin: number | null;
  deltaPoints: number | null;
  targetGrossMargin: number | null;
  targetMet: boolean | null;
  shortfallPoints: number;
  coveredProductCount: number;
  coveredSalesValue: number;
  omittedProductCount: number;
  omittedSalesValue: number;
  omittedByReason: Record<string, P011OmittedReason>;
  actionValueImpacts: Record<P011Action, P011ActionValueImpact>;
  headroom: P011HeadroomCandidate[];
};

export type P011Evaluation = {
  results: GeneratorResult[];
  portfolio: P011PortfolioReport;
  bands: Map<string, P011Band>;
};

const asList = (value: unknown): string[] =>
  (Array.isArray(value) ? value : value == null ? [] : [value])
    .filter((x): x is string => typeof x === "string")
    .map((x) => x.trim())
    .filter(Boolean);

const norm = (value: string) => value.trim().toLowerCase();

export function canonicalMasterCategory(value: string | null | undefined): string | null {
  if (!value) return null;
  const compact = value.toUpperCase().replace(/[\s_-]+/g, "");
  if (compact === "PTMT") return "PTMT";
  if (compact === "CP" || compact === "CPFITTINGS" || compact === "CPFITTING") return "C P";
  if (compact === "PLUMBING") return "PLUMBING";
  if (compact === "SANITARYWARE" || compact === "SANITARY") return "SANITARYWARE";
  if (compact === "SINK" || compact === "SINKS") return "SINK";
  if (compact === "HARDWARE") return "HARDWARE";
  return null;
}

export function computeVolumeTiers(products: GeneratorProduct[]): Map<string, "A" | "B" | "C"> {
  const sold = products
    .filter((product) => product.sales?.awaitingConfirmation !== true &&
      product.sales?.fySalesExists !== false && (product.sales?.salesAmount ?? 0) > 0)
    .sort((a, b) =>
      (b.sales!.salesAmount - a.sales!.salesAmount) ||
      canonicalItemCode(a.itemCode).localeCompare(canonicalItemCode(b.itemCode)),
    );
  const total = sold.reduce((sum, product) => sum + product.sales!.salesAmount, 0);
  const result = new Map<string, "A" | "B" | "C">();
  if (total <= 0) return result;
  let cumulative = 0;
  for (const product of sold) {
    const before = cumulative / total;
    result.set(canonicalItemCode(product.itemCode), before < 0.8 ? "A" : before < 0.95 ? "B" : "C");
    cumulative += product.sales!.salesAmount;
  }
  return result;
}

export const DEFAULT_P011_POLICY: P011Policy = {
  policyVersion: 2,
  period: SUPPORTED_VOLUME_PERIOD,
  bands: { A: 0.5, B: 0.8, C: 0.95, D: 0.99 },
  position: { wellBelowAbove: 0.08, parityBelow: -0.03, parityAbove: 0.08 },
  competitor: { mode: "nearest", named: null, staleAfterDays: 365, excludeStale: true },
  captureShares: { A: 0.3, B: 0.4, C: 0.5, D: 0.6, E: 0.7 },
  defendTargetUndercut: 0.02,
  categoryFloors: { PTMT: 65, "C P": 38, PLUMBING: 30, SANITARYWARE: 38, SINK: 40, HARDWARE: 38 },
  marginTargetUpliftPoints: 0,
  maxIncreasePercent: 15,
  maxDecreasePercent: 5,
  holdThreshold: 50,
  rounding: { unit: 1, direction: "nearest" },
  portfolio: { mode: "hold_current", points: 0 },
};

const p011Policy = (policy: P011Policy): Required<P011Policy> & {
  bands: { A: number; B: number; C: number; D: number };
  position: { wellBelowAbove: number; parityBelow: number; parityAbove: number };
  competitor: { mode: P011CompetitorMode; named: string | null; staleAfterDays: number; excludeStale: boolean };
  captureShares: Record<Exclude<P011Band, "F">, number>;
  rounding: { unit: number; direction: "nearest" | "up" | "down" };
  portfolio: { mode: "hold_current" | "improve_by_points" | "allow_decline_points"; points: number };
} => {
  const merged = {
    ...DEFAULT_P011_POLICY, ...policy,
    bands: { ...DEFAULT_P011_POLICY.bands, ...(policy.bands ?? {}) },
    position: { ...DEFAULT_P011_POLICY.position, ...(policy.position ?? {}) },
    competitor: { ...DEFAULT_P011_POLICY.competitor, ...(policy.competitor ?? {}) },
    captureShares: { ...DEFAULT_P011_POLICY.captureShares, ...(policy.captureShares ?? {}) },
    categoryFloors: { ...DEFAULT_P011_POLICY.categoryFloors, ...(policy.categoryFloors ?? {}) },
    rounding: { ...DEFAULT_P011_POLICY.rounding, ...(policy.rounding ?? {}) },
    portfolio: { ...DEFAULT_P011_POLICY.portfolio, ...(policy.portfolio ?? {}) },
  };
  validateP011Policy(merged as P011Policy);
  return merged as ReturnType<typeof p011Policy>;
};

export function validateP011Policy(policy: P011Policy): void {
  if (policy.policyVersion !== 2) throw new Error("P011 policyVersion must be 2.");
  if (!policy.period?.trim()) throw new Error("P011 policy period is required.");
  if (policy.period.trim().toUpperCase().replace(/^FY/, "") !== SUPPORTED_VOLUME_PERIOD) {
    throw new Error(`P011 policy period "${policy.period}" is unsupported; only ${SUPPORTED_VOLUME_PERIOD} is available.`);
  }
  const bands = { ...DEFAULT_P011_POLICY.bands, ...(policy.bands ?? {}) };
  if (!(bands.A! > 0 && bands.A! < bands.B! && bands.B! < bands.C! &&
    bands.C! < bands.D! && bands.D! < 1)) {
    throw new Error("P011 band cumulative thresholds must increase between 0 and 1.");
  }
  const position: { wellBelowAbove: number; parityBelow: number; parityAbove: number } =
    { ...DEFAULT_P011_POLICY.position, ...(policy.position ?? {}) } as { wellBelowAbove: number; parityBelow: number; parityAbove: number };
  if (!(position.parityBelow < position.parityAbove && position.wellBelowAbove >= position.parityAbove)) {
    throw new Error("P011 position thresholds overlap or invert.");
  }
  const competitor: { mode: P011CompetitorMode; named: string | null; staleAfterDays: number; excludeStale: boolean } =
    { ...DEFAULT_P011_POLICY.competitor, ...(policy.competitor ?? {}) } as { mode: P011CompetitorMode; named: string | null; staleAfterDays: number; excludeStale: boolean };
  if (!["nearest", "lowest", "named"].includes(competitor.mode)) throw new Error("P011 competitor mode is invalid.");
  if (competitor.mode === "named" && !competitor.named?.trim()) throw new Error("P011 named competitor is required.");
  if (!Number.isFinite(competitor.staleAfterDays) || competitor.staleAfterDays < 0) {
    throw new Error("P011 staleAfterDays must be non-negative.");
  }
  for (const [band, share] of Object.entries({ ...DEFAULT_P011_POLICY.captureShares, ...(policy.captureShares ?? {}) })) {
    if (!Number.isFinite(share) || share < 0 || share > 1) throw new Error(`P011 capture share for ${band} must be between 0 and 1.`);
  }
  const undercut = policy.defendTargetUndercut ?? DEFAULT_P011_POLICY.defendTargetUndercut!;
  if (!Number.isFinite(undercut) || undercut < 0 || undercut >= 1) throw new Error("P011 defend target undercut must be between 0 and 1.");
  for (const [key, value] of Object.entries(policy.categoryFloors ?? {})) {
    if (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) >= 100) {
      throw new Error(`P011 margin floor for ${key} must be at least 0 and below 100.`);
    }
  }
  for (const key of ["maxIncreasePercent", "maxDecreasePercent", "holdThreshold", "marginTargetUpliftPoints"]) {
    const value = policy[key as keyof P011Policy];
    if (value != null && (!Number.isFinite(Number(value)) || Number(value) < 0)) throw new Error(`P011 ${key} must be non-negative.`);
  }
  const uplift = policy.marginTargetUpliftPoints ?? 0;
  if (Object.values({ ...DEFAULT_P011_POLICY.categoryFloors, ...(policy.categoryFloors ?? {}) })
    .some((floor) => Number(floor) + uplift >= 100)) {
    throw new Error("P011 margin floor plus target uplift must remain below 100 percentage points.");
  }
}

/**
 * Assigns a sold catalogue to cumulative-value bands. The item that crosses
 * a threshold enters the next band (the cumulative value after the item is
 * compared with the threshold). Ties are always resolved by item code.
 */
export function computeP011Bands(products: GeneratorProduct[], policy: P011Policy = DEFAULT_P011_POLICY): Map<string, P011Band> {
  const p = p011Policy(policy);
  const result = new Map<string, P011Band>();
  const sold = products.filter((product) =>
    product.sales?.awaitingConfirmation !== true &&
    product.sales?.fySalesExists !== false &&
    product.sales?.salesAmount != null && Number.isFinite(product.sales.salesAmount) && product.sales.salesAmount > 0,
  ).sort((a, b) =>
    (b.sales!.salesAmount - a.sales!.salesAmount) ||
    canonicalItemCode(a.itemCode).localeCompare(canonicalItemCode(b.itemCode)),
  );
  const total = sold.reduce((sum, product) => sum + product.sales!.salesAmount, 0);
  let cumulative = 0;
  for (const product of sold) {
    cumulative += product.sales!.salesAmount;
    const fraction = cumulative / total;
    const band: P011Band = fraction <= p.bands.A ? "A"
      : fraction <= p.bands.B ? "B"
        : fraction <= p.bands.C ? "C"
          : fraction <= p.bands.D ? "D" : "E";
    result.set(canonicalItemCode(product.itemCode), band);
  }
  for (const product of products) {
    const key = canonicalItemCode(product.itemCode);
    if (!result.has(key)) result.set(key, "F");
  }
  return result;
}

function p011Floor(product: GeneratorProduct, policy: ReturnType<typeof p011Policy>): { category: string | null; floor: number | null } {
  const category = canonicalMasterCategory(product.division) ?? canonicalMasterCategory(product.category);
  if (!category) return { category: null, floor: null };
  const configured = Object.entries(policy.categoryFloors ?? {}).find(([key]) => canonicalMasterCategory(key) === category)?.[1];
  const floor = configured == null ? null : Number(configured);
  return { category, floor: floor != null && Number.isFinite(floor) ? floor : null };
}

function p011SelectedCompetitor(
  product: GeneratorProduct,
  policy: ReturnType<typeof p011Policy>,
): GeneratorCompetitor | null {
  const eligible = product.competitors.filter((competitor) =>
    competitor.matched && typeof competitor.effectivePrice === "number" && Number.isFinite(competitor.effectivePrice) &&
    (!policy.competitor.excludeStale ||
      (!competitor.stale && (competitor.ageDays == null || competitor.ageDays <= policy.competitor.staleAfterDays))),
  );
  if (policy.competitor.mode === "named") {
    return eligible.find((competitor) => norm(competitor.competitor) === norm(policy.competitor.named!)) ?? null;
  }
  return [...eligible].sort((a, b) => {
    const aPrice = a.effectivePrice!;
    const bPrice = b.effectivePrice!;
    const aGap = Math.abs(aPrice - (product.currentMrp ?? 0));
    const bGap = Math.abs(bPrice - (product.currentMrp ?? 0));
    return (policy.competitor.mode === "lowest" ? aPrice - bPrice : aGap - bGap) ||
      a.competitor.localeCompare(b.competitor);
  })[0] ?? null;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function invalidNumeric(value: unknown): boolean {
  return value != null && finiteOrNull(value) == null;
}

function safeP011Product(product: GeneratorProduct): GeneratorProduct {
  return {
    ...product,
    currentMrp: finiteOrNull(product.currentMrp),
    competitors: product.competitors.map((competitor) => ({
      ...competitor,
      price: finiteOrNull(competitor.price),
      effectivePrice: finiteOrNull(competitor.effectivePrice),
      ageDays: finiteOrNull(competitor.ageDays),
    })),
    sales: product.sales ? {
      ...product.sales,
      salesAmount: finiteOrNull(product.sales.salesAmount) ?? 0,
      qty: finiteOrNull(product.sales.qty),
    } : product.sales,
    margin: product.margin ? {
      ...product.margin,
      grossMarginPct: finiteOrNull(product.margin.grossMarginPct),
      saleValue: finiteOrNull(product.margin.saleValue),
      bomValue: finiteOrNull(product.margin.bomValue),
      unitBomValue: finiteOrNull(product.margin.unitBomValue),
      discountFrac: finiteOrNull(product.margin.discountFrac),
    } : product.margin,
  };
}

function p011InvalidNumericReasons(product: GeneratorProduct): string[] {
  const reasons: string[] = [];
  if (invalidNumeric(product.currentMrp)) reasons.push("Invalid non-finite current MRP evidence.");
  if (product.sales && invalidNumeric(product.sales.salesAmount)) reasons.push("Invalid non-finite FY sales evidence.");
  if (product.sales && invalidNumeric(product.sales.qty)) reasons.push("Invalid non-finite sales quantity evidence.");
  if (product.margin) {
    for (const [label, value] of [
      ["gross margin", product.margin.grossMarginPct],
      ["sale value", product.margin.saleValue],
      ["BOM value", product.margin.bomValue],
      ["unit BOM value", product.margin.unitBomValue],
      ["discount", product.margin.discountFrac],
    ] as const) {
      if (invalidNumeric(value)) reasons.push(`Invalid non-finite ${label} evidence.`);
    }
  }
  if (product.competitors.some((competitor) =>
    invalidNumeric(competitor.price) || invalidNumeric(competitor.effectivePrice) || invalidNumeric(competitor.ageDays),
  )) reasons.push("Invalid non-finite competitor price evidence.");
  return reasons;
}

function p011CategoryFloorEvidence(product: GeneratorProduct, policy: ReturnType<typeof p011Policy>): P011MarginFloorEvidence {
  const { category, floor } = p011Floor(product, policy);
  const margin = product.margin;
  const discount = typeof margin?.discountFrac === "number" && Number.isFinite(margin.discountFrac)
    ? margin.discountFrac : null;
  const unitBom = typeof margin?.unitBomValue === "number" && Number.isFinite(margin.unitBomValue)
    ? margin.unitBomValue : null;
  const minimumCandidate = floor != null && unitBom != null && discount != null && discount < 1
    ? unitBom / (1 - floor / 100) / (1 - discount) : null;
  const minimum = minimumCandidate != null && Number.isFinite(minimumCandidate) ? minimumCandidate : null;
  const grossMargin = typeof margin?.grossMarginPct === "number" && Number.isFinite(margin.grossMarginPct)
    ? margin.grossMarginPct : null;
  return {
    category, floorPercent: floor, minimumMrp: minimum,
    currentGrossMargin: grossMargin,
    discountFraction: discount,
    usable: Boolean(margin && grossMargin != null && unitBom != null && discount != null &&
      margin.qtyUnknown !== true && product.sales?.qty != null && product.sales.qty > 0),
  };
}

function p011RoundAndConstrain(
  candidate: number,
  current: number,
  policy: ReturnType<typeof p011Policy>,
  floor: number | null,
  preferIncreaseCap = false,
  rejectInfeasible = false,
): { value: number; constraints: string[]; infeasible: boolean } {
  const constraints: string[] = [];
  if (!Number.isFinite(candidate) || !Number.isFinite(current) || (floor != null && !Number.isFinite(floor))) {
    constraints.push("non-finite pricing derivation");
    return { value: Number.isFinite(current) ? current : 0, constraints, infeasible: true };
  }
  // Keep decimal caps stable when a percentage such as 15% is represented in
  // binary floating point (115 must not become 114.99999999999999).
  const decimal = (value: number) => Number(value.toFixed(10));
  const maxIncrease = decimal(current * (1 + (policy.maxIncreasePercent ?? 15) / 100));
  const minDecrease = decimal(current * (1 - (policy.maxDecreasePercent ?? 5) / 100));
  if (!Number.isFinite(maxIncrease) || !Number.isFinite(minDecrease)) {
    constraints.push("non-finite pricing constraint");
    return { value: current, constraints, infeasible: true };
  }
  const floorBound = floor != null && (!preferIncreaseCap || floor <= maxIncrease) ? floor : null;
  const lowerBound = Math.max(minDecrease, floorBound ?? Number.NEGATIVE_INFINITY);
  // A DEFEND result must never claim that its margin floor is met when the
  // increase cap makes that floor unreachable.  Margin-only deliberately
  // uses the cap as a safe fallback, but automatic competitive actions need a
  // representable price satisfying every bound or must escalate.
  if (rejectInfeasible && !preferIncreaseCap && lowerBound > maxIncrease) {
    if (floorBound != null && floorBound > maxIncrease) {
      constraints.push(`category margin floor ₹${floorBound}`);
    }
    constraints.push(`maximum increase ${policy.maxIncreasePercent}%`);
    return { value: current, constraints, infeasible: true };
  }
  let value = candidate;
  if (value > maxIncrease) { value = maxIncrease; constraints.push(`maximum increase ${policy.maxIncreasePercent}%`); }
  if (value < lowerBound) {
    value = lowerBound;
    if (minDecrease >= (floorBound ?? Number.NEGATIVE_INFINITY) && value === minDecrease) {
      constraints.push(`maximum decrease ${policy.maxDecreasePercent}%`);
    }
    if (floorBound != null && value === floorBound) constraints.push(`category margin floor ₹${floorBound}`);
  }
  if (floorBound != null && candidate < floorBound &&
    !constraints.some((constraint) => constraint.startsWith("category margin floor"))) {
    constraints.push(`category margin floor ₹${floorBound}`);
  }
  value = roundValue(value, policy.rounding.unit, policy.rounding.direction);
  // Rounding is subordinate to every configured binding constraint. Lower
  // bounds round upward and the increase cap rounds downward.
  if (value > maxIncrease) value = roundValue(maxIncrease, policy.rounding.unit, "down");
  if (value < lowerBound) value = roundValue(lowerBound, policy.rounding.unit, "up");
  value = decimal(value);
  // A coarse rounding unit can leave no representable value in the closed
  // interval.  Do not return a rounded price outside either binding bound.
  if (rejectInfeasible && (value < lowerBound || value > maxIncrease)) {
    constraints.push(`rounding cannot represent a price between ₹${lowerBound} and ₹${maxIncrease}`);
    return { value: current, constraints, infeasible: true };
  }
  return { value, constraints, infeasible: false };
}

export function evaluateP011Product(
  product: GeneratorProduct,
  band: P011Band,
  policy: P011Policy = DEFAULT_P011_POLICY,
): GeneratorResult {
  const p = p011Policy(policy);
  const safeProduct = safeP011Product(product);
  const invalidNumericReasons = p011InvalidNumericReasons(product);
  const trace: GeneratorTrace[] = [];
  const exclusions: string[] = [];
  const warnings = [...(product.margin?.warnings ?? [])];
  const current = safeProduct.currentMrp;
  const salesAmount = safeProduct.sales?.salesAmount ?? 0;
  const floorEvidence = p011CategoryFloorEvidence(safeProduct, p);
  const constraints: string[] = [];
  const floorInputsFinite = safeProduct.margin?.unitBomValue != null &&
    safeProduct.margin.discountFrac != null &&
    Number.isFinite(safeProduct.margin.unitBomValue) &&
    Number.isFinite(safeProduct.margin.discountFrac) &&
    safeProduct.margin.discountFrac < 1;
  if (floorEvidence.floorPercent != null && floorInputsFinite && floorEvidence.minimumMrp == null) {
    invalidNumericReasons.push("Computed category floor minimum MRP is non-finite.");
  }
  let value = current;
  let action: P011Action = "HOLD";
  let selected: GeneratorCompetitor | null = null;
  let actionTarget: number | null = null;
  let gap: number | null = null;
  let position: P011Position | null = null;
  let escalation = false;
  let escalationReason: string | null = null;
  const add = (ruleType: string, outcome: GeneratorTrace["outcome"], before: number | null, after: number | null, reason: string, target?: number | null) =>
    trace.push({ order: trace.length + 1, ruleType, outcome, before, after, reason, ...(target === undefined ? {} : { target }) });
  const rejectDerived = (reason: string, target: number | null = null) => {
    action = "REVIEW";
    value = current;
    escalation = true;
    escalationReason = reason;
    exclusions.push(reason);
    add("p011_numeric_validation", "blocked", current, current, reason, target);
  };

  if (invalidNumericReasons.length) {
    action = current == null ? "EXCLUDED" : "REVIEW";
    exclusions.push(...invalidNumericReasons);
    add("p011_input_validation", "blocked", current, current, invalidNumericReasons.join(" "));
  } else if (band === "F") {
    action = "EXCLUDED"; exclusions.push("No FY sales: band F is excluded before competitive action.");
    add("p011_band", "blocked", current, current, exclusions[0]!);
  } else if (current == null) {
    action = "EXCLUDED"; exclusions.push("Current approved Standard Prayag MRP is missing.");
    add("p011_current_mrp", "blocked", current, null, exclusions[0]!);
  } else if (current < (p.holdThreshold ?? 50)) {
    action = "HOLD"; constraints.push(`MRP below hold threshold ₹${p.holdThreshold}`);
    add("p011_hold_threshold", "fired", current, current, constraints[0]!);
  } else {
    selected = p011SelectedCompetitor(safeProduct, p);
    if (selected?.effectivePrice != null) {
      gap = (selected.effectivePrice - current) / current;
      position = gap > p.position.wellBelowAbove ? "well_below"
        : gap >= p.position.parityBelow ? "parity" : "above";
      add("p011_competitor_selection", "fired", current, current,
        `${selected.competitor} selected by ${p.competitor.mode}; effective price ₹${selected.effectivePrice}.`);
      add("p011_position", "fired", current, current, `Gap ${(gap * 100).toFixed(2)}%; position ${position}.`, gap);
    } else add("p011_competitor_selection", "blocked", current, current,
      p.competitor.mode === "named"
        ? `Named competitor ${p.competitor.named} is missing or stale; no competitor substitution is permitted.`
        : "No eligible non-stale competitor price.");

    if (!selected || gap == null || position == null) {
      action = "MARGIN_ONLY";
      const targetMargin = ((floorEvidence.floorPercent ?? 0) + (p.marginTargetUpliftPoints ?? 0)) / 100;
      if (!floorEvidence.usable || floorEvidence.minimumMrp == null || safeProduct.margin?.discountFrac == null) {
        action = "EXCLUDED";
        exclusions.push("Margin-only fallback requires usable quantity, unit BOM cost, and discount evidence.");
        add("p011_margin_only", "blocked", current, null, exclusions[0]!);
      } else {
        const target = safeProduct.margin!.unitBomValue! / (1 - targetMargin) / (1 - safeProduct.margin.discountFrac!);
        actionTarget = Number.isFinite(target) ? target : null;
        if (!Number.isFinite(target)) {
          rejectDerived("Margin-only required MRP is non-finite; no automatic price change was made.", null);
        } else if ((safeProduct.margin?.grossMarginPct ?? 0) >= targetMargin) {
          value = current; add("p011_margin_only", "fired", current, value, "Current gross margin already meets the margin-only target.", target);
        } else {
          const constrained = p011RoundAndConstrain(target, current, p, floorEvidence.minimumMrp, true);
          if (constrained.infeasible || !Number.isFinite(constrained.value)) {
            rejectDerived(`Margin-only constrained MRP is invalid (${constrained.constraints.join("; ")}); no automatic price change was made.`, target);
            constraints.push(...constrained.constraints);
          } else {
            value = constrained.value; constraints.push(...constrained.constraints);
          const increaseCap = current * (1 + (p.maxIncreasePercent ?? 15) / 100);
          if (target > increaseCap || value < target) {
            escalation = true;
            escalationReason = `Cannot reach the ${floorEvidence.category ?? "category"} margin floor plus ${(p.marginTargetUpliftPoints ?? 0).toFixed(2)}-point uplift within the maximum increase of ${p.maxIncreasePercent}%; capped at ₹${value}.`;
          }
          add("p011_margin_only", "fired", current, value, `Margin-only target gross margin ${(targetMargin * 100).toFixed(2)}%.`, target);
          }
        }
      }
    } else if (position === "well_below") {
      action = "CAPTURE";
      const target = current + (p.captureShares[band as Exclude<P011Band, "F">] ?? 0) * (selected.effectivePrice! - current);
      actionTarget = Number.isFinite(target) ? target : null;
      const constrained = p011RoundAndConstrain(target, current, p, floorEvidence.minimumMrp);
      if (!Number.isFinite(target) || constrained.infeasible || !Number.isFinite(constrained.value)) {
        rejectDerived(`CAPTURE target or constrained MRP is non-finite/invalid (${constrained.constraints.join("; ")}); no automatic price change was made.`, Number.isFinite(target) ? target : null);
        constraints.push(...constrained.constraints);
      } else {
        value = constrained.value; constraints.push(...constrained.constraints);
        add("p011_capture", "fired", current, value, `Capture ${p.captureShares[band as Exclude<P011Band, "F">]} of competitor gap.`, target);
      }
    } else if (position === "parity") {
      action = "HOLD"; value = current; add("p011_parity", "fired", current, value, "Parity position: reviewed and held.");
    } else if (band === "A" || band === "B") {
      action = "DEFEND";
      const target = selected.effectivePrice! * (1 - p.defendTargetUndercut!);
      actionTarget = Number.isFinite(target) ? target : null;
      const constrained = p011RoundAndConstrain(target, current, p, floorEvidence.minimumMrp, false, true);
      if (constrained.infeasible || !Number.isFinite(constrained.value)) {
        action = "REVIEW";
        value = current;
        constraints.push(...constrained.constraints);
        escalation = true;
        escalationReason = `No feasible automatic DEFEND price satisfies both the ${floorEvidence.category ?? "category"} margin floor (minimum MRP ₹${floorEvidence.minimumMrp}) and the maximum increase of ${p.maxIncreasePercent}% (upper bound ₹${Number((current * (1 + (p.maxIncreasePercent ?? 15) / 100)).toFixed(10))}); no automatic price change was made.`;
        add("p011_defend", "blocked", current, current, escalationReason, Number.isFinite(target) ? target : null);
      } else {
        value = constrained.value; constraints.push(...constrained.constraints);
        const decreaseBound = Math.max(
          floorEvidence.minimumMrp ?? Number.NEGATIVE_INFINITY,
          current * (1 - (p.maxDecreasePercent ?? 5) / 100),
        );
        if (decreaseBound > target) {
          escalation = true;
          const reason = floorEvidence.minimumMrp != null && floorEvidence.minimumMrp >= decreaseBound
            ? `the ${floorEvidence.category ?? "category"} ${floorEvidence.floorPercent}% gross-margin floor`
            : `the maximum decrease of ${p.maxDecreasePercent}%`;
          escalationReason = `Cannot reach ${selected.competitor} at ${(p.defendTargetUndercut! * 100).toFixed(0)}% undercut without breaching ${reason}; held at ₹${value}.`;
        }
        add("p011_defend", "fired", current, value, escalationReason ?? `Defend at ${(p.defendTargetUndercut! * 100).toFixed(0)}% under competitor.`, target);
      }
    } else if (band === "C") {
      action = "REVIEW"; value = current; add("p011_review", "fired", current, value, "Above competition in band C requires review; no automatic change.");
    } else {
      action = "LEAVE_ALONE"; value = current; add("p011_leave_alone", "fired", current, value, `Above competition in band ${band}; tail is left alone.`);
    }
  }
  if (action !== "EXCLUDED" && value != null && !Number.isFinite(value)) {
    rejectDerived("Constrained or rounded MRP suggestion is non-finite; no automatic price change was made.");
  }
  if (actionTarget != null && !Number.isFinite(actionTarget)) actionTarget = null;
  const changed = action !== "EXCLUDED" && value != null && current != null && value !== current;
  if (action === "EXCLUDED") value = null;
  if (value != null && current != null && value === current && action !== "HOLD" && action !== "REVIEW" && action !== "LEAVE_ALONE") {
    action = action === "MARGIN_ONLY" ? "MARGIN_ONLY" : "HOLD";
  }
  return {
    ...safeProduct, policyVersion: 2, band, fySalesAmount: salesAmount,
    selectedCompetitor: selected?.competitor ?? null,
    competitorMode: band === "F" ? null : p.competitor.mode,
    gap, position, action, suggestedMrp: changed ? value : null,
    status: action === "EXCLUDED" ? "excluded" : changed ? "suggested" : "no_change",
    exclusions: [...new Set(exclusions)], competitorValues: safeProduct.competitors, trace,
    fullTrace: trace, competitiveTarget: actionTarget,
    bindingConstraint: constraints[0] ?? (floorEvidence.minimumMrp != null ? `Margin floor minimum MRP ₹${floorEvidence.minimumMrp}` : null),
    bindingConstraints: constraints, escalation, escalationReason,
    changePercent: changed ? ((value! - current!) / Math.abs(current!)) * 100 : 0,
    salesEvidence: safeProduct.sales ?? null, marginEvidence: safeProduct.margin ?? null, marginFloorEvidence: floorEvidence, warnings,
  };
}

export function evaluateP011Portfolio(
  products: GeneratorProduct[],
  results: GeneratorResult[],
  policy: P011Policy = DEFAULT_P011_POLICY,
): P011PortfolioReport {
  const p = p011Policy(policy);
  let currentNumerator = 0, proposedNumerator = 0, denominator = 0, proposedDenominator = 0, coveredSalesValue = 0, coveredCount = 0;
  let omittedSalesValue = 0;
  const omittedByReason: Record<string, P011OmittedReason> = {};
  const addOmitted = (reason: string, salesValue: number) => {
    const safeSalesValue = Number.isFinite(salesValue) ? salesValue : 0;
    const boundedAdd = (left: number, right: number) => {
      const sum = left + right;
      return Number.isFinite(sum) ? sum : Number.MAX_VALUE;
    };
    const existing = omittedByReason[reason] ?? { count: 0, fySalesValue: 0 };
    existing.count++;
    existing.fySalesValue = boundedAdd(existing.fySalesValue, safeSalesValue);
    omittedByReason[reason] = existing;
    omittedSalesValue = boundedAdd(omittedSalesValue, safeSalesValue);
  };
  const actionValueImpacts = Object.fromEntries(
    (["CAPTURE", "DEFEND", "HOLD", "REVIEW", "LEAVE_ALONE", "MARGIN_ONLY", "EXCLUDED"] as P011Action[])
      .map((action) => [action, { count: 0, fySalesValue: 0, grossContributionDelta: 0 }]),
  ) as Record<P011Action, P011ActionValueImpact>;
  const headroomCandidates: P011HeadroomCandidate[] = [];
  const byCode = new Map(results.map((result) => [canonicalItemCode(result.itemCode), result]));
  for (const product of products) {
    const result = byCode.get(canonicalItemCode(product.itemCode));
    const salesValue = finiteOrNull(product.sales?.salesAmount);
    if (salesValue == null && product.sales?.salesAmount != null) {
      addOmitted("invalid non-finite sales evidence", 0);
      continue;
    }
    const realizedSalesValue = salesValue ?? 0;
    if (!result) { addOmitted("not evaluated", realizedSalesValue); continue; }
    if (result.band === "F") { addOmitted("band F/no FY sales", realizedSalesValue); continue; }
    const qty = finiteOrNull(product.sales?.qty);
    const unitCost = finiteOrNull(product.margin?.unitBomValue);
    if (qty == null || qty <= 0) { addOmitted("missing usable quantity", realizedSalesValue); continue; }
    if (unitCost == null) { addOmitted("missing unit BOM cost", realizedSalesValue); continue; }
    const discount = finiteOrNull(product.margin?.discountFrac);
    const currentMrp = finiteOrNull(product.currentMrp);
    const suggestedMrp = finiteOrNull(result.suggestedMrp);
    if (discount == null || currentMrp == null || (result.suggestedMrp != null && suggestedMrp == null)) {
      addOmitted("invalid/missing realized sale evidence", realizedSalesValue); continue;
    }
    const currentSale = currentMrp * (1 - discount);
    const proposedSale = (suggestedMrp ?? currentMrp) * (1 - discount);
    if (!Number.isFinite(currentSale) || !Number.isFinite(proposedSale)) {
      addOmitted("invalid non-finite realized price", realizedSalesValue); continue;
    }
    const contributionDelta = qty * ((proposedSale - unitCost) - (currentSale - unitCost));
    if (!Number.isFinite(contributionDelta)) {
      addOmitted("invalid non-finite contribution", realizedSalesValue); continue;
    }
    const impact = actionValueImpacts[result.action ?? "HOLD"] ?? actionValueImpacts.REVIEW;
    if (!Number.isFinite(impact.fySalesValue + realizedSalesValue) ||
      !Number.isFinite(impact.grossContributionDelta + contributionDelta)) {
      addOmitted("invalid non-finite contribution output", realizedSalesValue); continue;
    }
    impact.count++;
    impact.fySalesValue += realizedSalesValue;
    impact.grossContributionDelta += contributionDelta;
    const nextCurrentNumerator = currentNumerator + qty * (currentSale - unitCost);
    const nextProposedNumerator = proposedNumerator + qty * (proposedSale - unitCost);
    const nextDenominator = denominator + qty * currentSale;
    const nextProposedDenominator = proposedDenominator + qty * proposedSale;
    const nextCoveredSalesValue = coveredSalesValue + realizedSalesValue;
    if (![nextCurrentNumerator, nextProposedNumerator, nextDenominator, nextProposedDenominator, nextCoveredSalesValue].every(Number.isFinite)) {
      addOmitted("invalid non-finite portfolio output", realizedSalesValue); continue;
    }
    currentNumerator = nextCurrentNumerator;
    proposedNumerator = nextProposedNumerator;
    denominator = nextDenominator;
    proposedDenominator = nextProposedDenominator;
    coveredSalesValue = nextCoveredSalesValue;
    coveredCount++;
    if (result.action === "CAPTURE") {
      const competitor = finiteOrNull(result.competitorValues.find((c) => c.competitor === result.selectedCompetitor)?.effectivePrice) ?? currentMrp;
      const increaseCap = currentMrp * (1 + (p.maxIncreasePercent ?? 15) / 100);
      const feasibleMaximum = Math.min(competitor, roundValue(increaseCap, p.rounding.unit, "down"));
      const available = feasibleMaximum - (suggestedMrp ?? currentMrp);
      const additional = qty * available * (1 - discount);
      if (Number.isFinite(feasibleMaximum) && Number.isFinite(available) && Number.isFinite(additional) && available > 0) headroomCandidates.push({
        itemCode: product.itemCode, band: result.band!, fySalesValue: realizedSalesValue,
        additionalRealizedSaleValue: additional,
        additionalGrossContribution: additional,
      });
    }
  }
  const currentMargin = denominator > 0 ? currentNumerator / denominator : null;
  const proposedMargin = proposedDenominator > 0 ? proposedNumerator / proposedDenominator : null;
  const points = finiteOrNull(p.portfolio.points) ?? 0;
  const safeCurrentMargin = currentMargin != null && Number.isFinite(currentMargin) ? currentMargin : null;
  const safeProposedMargin = proposedMargin != null && Number.isFinite(proposedMargin) ? proposedMargin : null;
  const targetCandidate = safeCurrentMargin == null ? null
    : p.portfolio.mode === "improve_by_points" ? safeCurrentMargin + points / 100
      : p.portfolio.mode === "allow_decline_points" ? safeCurrentMargin - points / 100 : safeCurrentMargin;
  const targetMargin = targetCandidate != null && Number.isFinite(targetCandidate) ? targetCandidate : null;
  const targetMet = safeCurrentMargin == null || safeProposedMargin == null ? null
    : safeProposedMargin >= targetMargin!;
  const shortfallRaw = targetMargin != null && safeProposedMargin != null ? Math.max(0, (targetMargin - safeProposedMargin) * 100) : 0;
  const shortfallPoints = Number.isFinite(shortfallRaw) ? shortfallRaw : 0;
  return {
    currentGrossMargin: safeCurrentMargin,
    proposedGrossMargin: safeProposedMargin,
    deltaPoints: safeCurrentMargin != null && safeProposedMargin != null && Number.isFinite((safeProposedMargin - safeCurrentMargin) * 100) ? (safeProposedMargin - safeCurrentMargin) * 100 : null,
    targetGrossMargin: targetMargin,
    targetMet,
    shortfallPoints,
    coveredProductCount: coveredCount,
    coveredSalesValue,
    omittedProductCount: Object.values(omittedByReason).reduce((sum, item) => sum + item.count, 0),
    omittedSalesValue,
    omittedByReason,
    actionValueImpacts,
    headroom: headroomCandidates.sort((a, b) =>
      b.additionalGrossContribution - a.additionalGrossContribution || b.fySalesValue - a.fySalesValue || a.itemCode.localeCompare(b.itemCode)),
  };
}

export function evaluateP011Scenario(
  products: GeneratorProduct[],
  policy: P011Policy = DEFAULT_P011_POLICY,
  scope?: GeneratorScope,
): P011Evaluation {
  const inScope = scope ? products.filter((product) => matchesScope(product, scope)) : products;
  // Bands are contribution bands for the complete snapshot; scope limits the
  // returned recommendations, not the denominator that defines a band's
  // cumulative taxable sales contribution.
  const bands = computeP011Bands(products, policy);
  const results = inScope
    .sort((a, b) => canonicalItemCode(a.itemCode).localeCompare(canonicalItemCode(b.itemCode)))
    .map((product) => evaluateP011Product(product, bands.get(canonicalItemCode(product.itemCode)) ?? "F", policy));
  return { results, portfolio: evaluateP011Portfolio(inScope, results, policy), bands };
}

/** Stable aliases for callers that name the P011 engine by its policy number. */
export const assignP011Bands = computeP011Bands;
export const evaluateP011 = evaluateP011Scenario;

export function canonicalItemCode(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "").replace(/\.0$/, "");
}

export function matchesScope(product: GeneratorProduct, scope: GeneratorScope): boolean {
  const matches = (value: string | null | undefined, wanted: unknown) => {
    const values = asList(wanted);
    return values.length === 0 || (value != null && values.some((x) => norm(x) === norm(value)));
  };
  const explicit = asList(scope.explicitCodes ?? scope.itemCodes ?? scope.codes).map(canonicalItemCode);
  if (explicit.length && !explicit.includes(canonicalItemCode(product.itemCode))) return false;
  if (!matches(product.division, scope.division)) return false;
  if (!matches(product.seriesRange, scope.series)) return false;
  if (!matches(product.category, scope.category)) return false;
  if (
    typeof scope.competitorMapped === "boolean" &&
    product.competitors.some((c) => c.matched) !== scope.competitorMapped
  ) return false;
  return true;
}

function p012RowMatches(product: GeneratorProduct, row: P012Rule): boolean {
  const type = row.appliesTo.type;
  if (row.catchAll || type === "all") return true;
  const configured = Array.isArray(row.appliesTo.value) ? row.appliesTo.value : row.appliesTo.value == null ? [] : [row.appliesTo.value];
  if (!configured.length) return false;
  const wanted = configured.map(norm);
  if (type === "explicit_codes") return wanted.includes(canonicalItemCode(product.itemCode).toLowerCase());
  const actual = type === "division" ? product.division : type === "series" ? product.seriesRange : product.category;
  return actual != null && wanted.includes(norm(actual));
}

function p012Competitor(product: GeneratorProduct, row: P012Rule): GeneratorCompetitor | null {
  const candidates = product.competitors.filter((candidate) =>
    candidate.matched && candidate.effectivePrice != null && Number.isFinite(candidate.effectivePrice),
  );
  if (!candidates.length) return null;
  if (row.competitor.mode === "named") {
    const named = norm(row.competitor.name ?? "");
    return candidates.find((candidate) => norm(candidate.competitor) === named) ?? null;
  }
  if (row.competitor.mode === "lowest") {
    return [...candidates].sort((a, b) =>
      a.effectivePrice! - b.effectivePrice! || a.competitor.localeCompare(b.competitor),
    )[0] ?? null;
  }
  // Nearest is deterministic: absolute gap, then effective price, then name.
  const current = product.currentMrp;
  if (current == null || !Number.isFinite(current)) return null;
  return [...candidates].sort((a, b) =>
    Math.abs(a.effectivePrice! - current) - Math.abs(b.effectivePrice! - current) ||
    a.effectivePrice! - b.effectivePrice! || a.competitor.localeCompare(b.competitor),
  )[0] ?? null;
}

function p012Target(current: number, competitor: number, target: P012Rule["target"]): number {
  const percent = target.percent ?? 0;
  if (target.mode === "below") return competitor * (1 - percent / 100);
  if (target.mode === "above") return competitor * (1 + percent / 100);
  if (target.mode === "close_gap") return current + (competitor - current) * (percent / 100);
  return competitor;
}

function p012RoundBounded(
  candidate: number,
  current: number,
  policy: P012SimplePolicy,
  row: P012Rule,
  minimumMrp: number | null = null,
): { value: number; infeasible: boolean; reason: string | null } {
  let value = candidate;
  const decimal = (number: number) => Number(number.toFixed(10));
  const lower = row.maxDecrease == null ? Number.NEGATIVE_INFINITY : decimal(current * (1 - row.maxDecrease / 100));
  const upper = row.maxIncrease == null ? Number.POSITIVE_INFINITY : decimal(current * (1 + row.maxIncrease / 100));
  const effectiveLower = Math.max(lower, minimumMrp ?? Number.NEGATIVE_INFINITY);
  if (effectiveLower > upper + 1e-9) {
    return { value: current, infeasible: true, reason: "movement cap and margin floor do not overlap" };
  }
  value = Math.min(upper, Math.max(effectiveLower, value));
  value = roundValue(value, policy.rounding.unit, policy.rounding.direction);
  // Never let nearest rounding violate an explicitly configured movement cap.
  if (value < effectiveLower) value = roundValue(effectiveLower, policy.rounding.unit, "up");
  if (value > upper) value = roundValue(upper, policy.rounding.unit, "down");
  value = decimal(value);
  if (value < effectiveLower - 1e-9 || value > upper + 1e-9) {
    return { value: current, infeasible: true, reason: "rounding lattice has no value within configured bounds" };
  }
  return { value, infeasible: false, reason: null };
}

export type P012Result = GeneratorResult & {
  matchedRowNumber: number | null;
  matchedRowId: string | null;
  matchedRowLabel: string | null;
  selectedCompetitor: string | null;
  competitorMode: P012CompetitorMode | null;
  selectedCompetitorPrice: number | null;
  rawTarget: number | null;
  decisionSentence: string;
  volumeTier: P011Band | null;
  fySalesAmount: number | null;
};

export type P012Summary = {
  total: number;
  evaluated: number;
  wouldChange: number;
  noChange: number;
  noCompetitorUntouched: number;
  fallthroughUntouched: number;
  suggested: number;
  excluded: number;
  increases: number;
  decreases: number;
  rowCounts: Record<string, {
    scopeMatched: number;
    withCompetitorPrice: number;
    wouldChange: number;
    matchedFySalesValue: number;
    tierDistribution: Record<string, number>;
  }>;
  tierDistribution: Record<string, number>;
};

function p012CategoryFloor(product: GeneratorProduct, policy: P012SimplePolicy): number | null {
  const category = canonicalMasterCategory(product.division) ?? canonicalMasterCategory(product.category);
  if (!category) return null;
  const configured = Object.entries(policy.categoryFloors).find(([key]) => canonicalMasterCategory(key) === category)?.[1];
  return configured == null ? null : Number(configured);
}

function p012MinimumMrp(product: GeneratorProduct, policy: P012SimplePolicy): number | null {
  const floor = p012CategoryFloor(product, policy);
  const margin = product.margin;
  const qty = product.sales?.qty ?? margin?.qty;
  if (floor == null || !margin || margin.unitBomValue == null || margin.discountFrac == null ||
    !Number.isFinite(margin.unitBomValue) || !Number.isFinite(margin.discountFrac) ||
    margin.discountFrac < 0 || margin.discountFrac >= 1 || margin.qtyUnknown === true ||
    qty == null || !Number.isFinite(qty) || qty <= 0 || floor < 0 || floor >= 100) return null;
  const minimum = margin.unitBomValue / (1 - floor / 100) / (1 - margin.discountFrac);
  return Number.isFinite(minimum) ? minimum : null;
}

function p012Tier(product: GeneratorProduct, tiers?: Map<string, "A" | "B" | "C">): P011Band {
  const sales = product.sales;
  if (!sales || sales.awaitingConfirmation === true || sales.fySalesExists === false || !(sales.salesAmount > 0)) return "F";
  return tiers?.get(canonicalItemCode(product.itemCode)) ?? sales.tier ?? "F";
}

export function evaluateP012Product(
  product: GeneratorProduct,
  policyInput: P012SimplePolicy = DEFAULT_P012_SCENARIO.policy,
  options: { volumeTiers?: Map<string, "A" | "B" | "C"> } = {},
): P012Result {
  const policy = normalizeP012Policy(policyInput);
  const rows = policy.rows;
  const matched = rows.find((row) => p012RowMatches(product, row)) ?? null;
  const rowNumber = matched ? rows.indexOf(matched) + 1 : null;
  const competitor = matched ? p012Competitor(product, matched) : null;
  const current = product.currentMrp;
  const tier = policy.volumeEnabled ? p012Tier(product, options.volumeTiers) : null;
  const fySalesAmount = product.sales?.salesAmount ?? null;
  const untouched = (reason: string, optionalExclusions: string[] = [], bindingConstraint: string | null = null): P012Result => ({
    itemCode: product.itemCode, productName: product.productName, division: product.division,
    category: product.category, currentMrp: current, currentDate: product.currentDate, currentRowId: product.currentRowId,
    suggestedMrp: current, status: "no_change", exclusions: optionalExclusions, competitorValues: product.competitors,
    trace: [], competitiveTarget: null, bindingConstraint, changePercent: 0,
    salesEvidence: product.sales ?? null, marginEvidence: product.margin ?? null, warnings: [],
    matchedRowNumber: rowNumber, matchedRowId: matched?.id ?? null, matchedRowLabel: matched?.label ?? null,
    selectedCompetitor: competitor?.competitor ?? null, competitorMode: matched?.competitor.mode ?? null,
    selectedCompetitorPrice: competitor?.effectivePrice ?? null, rawTarget: null,
    decisionSentence: reason, policyVersion: 3, volumeTier: tier, fySalesAmount,
  });
  if (current == null || !Number.isFinite(current)) return untouched("No current MRP; untouched.");
  if (!matched) return untouched("No simple policy row matched; fallthrough untouched.");
  if (current < policy.holdBelow) return untouched(`Current MRP ₹${current} is below the ₹${policy.holdBelow} hold threshold; untouched.`);
  if (policy.marginEnabled && (!product.margin || product.margin.grossMarginPct == null)) {
    return untouched(`Row ${rowNumber}: margin option requires usable margin evidence; untouched.`, ["Margin option: usable margin evidence is unavailable."]);
  }
  if (!competitor) return untouched(`Row ${rowNumber}: ${matched.label}; no ${matched.competitor.mode === "named" ? `price for ${matched.competitor.name ?? "named competitor"}` : "competitor price"}; untouched.`);
  const rawTarget = p012Target(current, competitor.effectivePrice!, matched.target);
  const minimumMrp = policy.marginEnabled ? p012MinimumMrp(product, policy) : null;
  if (policy.marginEnabled && minimumMrp == null) {
    return untouched(`Row ${rowNumber}: margin option requires usable quantity, unit BOM, discount, and category-floor evidence; untouched.`, ["Margin option: usable margin evidence is unavailable."]);
  }
  const rowLower = matched.maxDecrease == null ? Number.NEGATIVE_INFINITY : current * (1 - matched.maxDecrease / 100);
  const rowUpper = matched.maxIncrease == null ? Number.POSITIVE_INFINITY : current * (1 + matched.maxIncrease / 100);
  if (minimumMrp != null && minimumMrp > rowUpper + 1e-9) {
    const reason = `Row ${rowNumber}: margin floor minimum ₹${minimumMrp.toFixed(2)} conflicts with maximum increase cap ₹${rowUpper.toFixed(2)}; review required.`;
    return untouched(reason, [reason], "margin floor conflicts with row movement cap");
  }
  const rounded = p012RoundBounded(rawTarget, current, policy, matched, minimumMrp);
  if (rounded.infeasible) {
    const reason = `Row ${rowNumber}: no nearest-rupee value satisfies the row movement and margin-floor bounds; review required.`;
    return untouched(reason, [reason], rounded.reason);
  }
  const suggested = rounded.value;
  const changePercent = current === 0 ? 0 : (suggested - current) / current * 100;
  const status = suggested === current ? "no_change" : "suggested";
  const direction = suggested > current ? "increase" : suggested < current ? "decrease" : "no change";
  return {
    itemCode: product.itemCode, productName: product.productName, division: product.division,
    category: product.category, currentMrp: current, currentDate: product.currentDate, currentRowId: product.currentRowId,
    suggestedMrp: suggested, status, exclusions: [], competitorValues: product.competitors,
    trace: [{ order: rowNumber!, ruleType: "p012_simple", outcome: "fired", before: current, after: suggested, reason: matched.label, target: rawTarget }],
    competitiveTarget: rawTarget, bindingConstraint: suggested !== rawTarget ? "simple row movement limit or rounding" : null,
    changePercent, salesEvidence: product.sales ?? null, marginEvidence: product.margin ?? null, warnings: [],
    matchedRowNumber: rowNumber, matchedRowId: matched.id, matchedRowLabel: matched.label,
    selectedCompetitor: competitor.competitor, competitorMode: matched.competitor.mode,
    selectedCompetitorPrice: competitor.effectivePrice, rawTarget,
    decisionSentence: `Row ${rowNumber}: ${matched.label} -> ${competitor.competitor} ₹${competitor.effectivePrice}; raw target ₹${rawTarget.toFixed(2)}, ${direction} to ₹${suggested}.`,
    policyVersion: 3,
    volumeTier: tier, fySalesAmount,
  };
}

export function evaluateP012Scenario(
  products: GeneratorProduct[],
  policyInput: P012SimplePolicy = DEFAULT_P012_SCENARIO.policy,
  scope?: GeneratorScope,
): { results: P012Result[]; summary: P012Summary; reach: P012Summary["rowCounts"]; warnings: string[] } {
  const policy = normalizeP012Policy(policyInput);
  const inScope = scope ? products.filter((product) => matchesScope(product, scope)) : products;
  const rowCounts: P012Summary["rowCounts"] = Object.fromEntries(policy.rows.map((row) => [
    row.id, {
      scopeMatched: 0, withCompetitorPrice: 0, wouldChange: 0, matchedFySalesValue: 0,
      tierDistribution: { A: 0, B: 0, C: 0, F: 0 },
    },
  ]));
  const volumeTiers = policy.volumeEnabled ? computeVolumeTiers(inScope) : undefined;
  const tierDistribution: Record<"A" | "B" | "C" | "F", number> = { A: 0, B: 0, C: 0, F: 0 };
  let fallthroughUntouched = 0;
  const results = inScope
    .sort((a, b) => canonicalItemCode(a.itemCode).localeCompare(canonicalItemCode(b.itemCode)))
    .map((product) => {
      const result = evaluateP012Product(product, policy, { volumeTiers });
      if (policy.volumeEnabled && result.volumeTier && result.volumeTier in tierDistribution) {
        tierDistribution[result.volumeTier as "A" | "B" | "C" | "F"]++;
      }
      if (result.matchedRowId) {
        const count = rowCounts[result.matchedRowId]!;
        count.scopeMatched++;
        if (result.selectedCompetitorPrice != null) count.withCompetitorPrice++;
        if (result.status === "suggested") count.wouldChange++;
        if (result.fySalesAmount != null && Number.isFinite(result.fySalesAmount)) count.matchedFySalesValue += result.fySalesAmount;
        if (result.volumeTier) count.tierDistribution[result.volumeTier]++;
      } else fallthroughUntouched++;
      return result;
    });
  const noCompetitorUntouched = results.filter((result) => result.matchedRowId != null && result.selectedCompetitorPrice == null).length;
  const wouldChange = results.filter((result) => result.status === "suggested").length;
  const noChange = results.filter((result) => result.status === "no_change").length;
  const warnings = policy.rows.some((row) => row.catchAll || row.appliesTo.type === "all")
    ? [] : [`No catch-all row; ${fallthroughUntouched} product(s) fall through untouched.`];
  const summary: P012Summary = {
    total: results.length, evaluated: results.length, wouldChange, noChange,
    noCompetitorUntouched, fallthroughUntouched, suggested: wouldChange, excluded: 0,
    increases: results.filter((r) => (r.changePercent ?? 0) > 0).length,
    decreases: results.filter((r) => (r.changePercent ?? 0) < 0).length,
    rowCounts, tierDistribution,
  };
  return { results, summary, reach: rowCounts, warnings };
}

export const evaluateP012 = evaluateP012Scenario;

/** An explicit Advanced envelope keeps every simple row visible instead of
 * silently translating it into a lossy P011 policy. */
export type P012AdvancedRepresentation = {
  policyVersion: 2;
  mode: "advanced";
  source: "p012-simple";
  simpleRows: P012Rule[];
  rules: GeneratorRule[];
  holdBelow: number;
  rounding: P012SimplePolicy["rounding"];
  marginEnabled: boolean;
  volumeEnabled: boolean;
  categoryFloors: Record<string, number>;
};

export function promoteP012ToAdvanced(policyInput: P012SimplePolicy): P012AdvancedRepresentation {
  const policy = normalizeP012Policy(policyInput);
  return {
    policyVersion: 2,
    mode: "advanced",
    source: "p012-simple",
    simpleRows: policy.rows,
    holdBelow: policy.holdBelow,
    rounding: policy.rounding,
    marginEnabled: policy.marginEnabled,
    volumeEnabled: policy.volumeEnabled,
    categoryFloors: policy.categoryFloors,
    rules: policy.rows.map((row) => ({
      type: "p012_simple_row",
      id: row.id,
      order: row.order,
      label: row.label,
      competitor: row.competitor.mode,
      competitorName: row.competitor.name ?? null,
      appliesTo: row.appliesTo,
      target: row.target,
      maxIncrease: row.maxIncrease ?? null,
      maxDecrease: row.maxDecrease ?? null,
      catchAll: row.catchAll === true,
    })),
  };
}

export function convertAdvancedToP012(value: unknown): { policy: P012SimplePolicy } | { reasons: string[] } {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  if (input.source !== "p012-simple" || !Array.isArray(input.simpleRows)) {
    return { reasons: ["Advanced policy contains rules that cannot be represented by an ordered simple table."] };
  }
  const unsupported = Array.isArray(input.rules)
    ? input.rules.filter((rule) => !rule || typeof rule !== "object" || (rule as Record<string, unknown>).type !== "p012_simple_row")
    : [];
  if (unsupported.length) return { reasons: ["Advanced policy contains non-simple rules."] };
  const policy = normalizeP012Policy({
    holdBelow: input.holdBelow,
    rounding: input.rounding,
    marginEnabled: input.marginEnabled,
    volumeEnabled: input.volumeEnabled,
    categoryFloors: input.categoryFloors,
    rows: input.simpleRows,
  });
  const expected = promoteP012ToAdvanced(policy);
  if (JSON.stringify(expected.simpleRows) !== JSON.stringify(input.simpleRows) ||
    JSON.stringify(expected.rules) !== JSON.stringify(input.rules)) {
    return { reasons: ["Advanced policy simple representation has been edited and is no longer lossless."] };
  }
  return { policy };
}
export const simpleToAdvanced = promoteP012ToAdvanced;
export const advancedToSimple = convertAdvancedToP012;

function numberRule(rule: GeneratorRule, ...keys: string[]): number | null {
  for (const key of keys) {
    const n = Number(rule[key]);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function categoryFloor(rule: GeneratorRule, category: string): number | null {
  const configured = Object.entries(objectRecord(rule.categoryFloors))
    .find(([key]) => canonicalMasterCategory(key) === category)?.[1];
  const value = configured;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function confidenceRequested(
  product: GeneratorProduct,
  rules: GeneratorRule[],
  explicit?: boolean,
): boolean {
  if (explicit) return true;
  if (rules.some((rule) => canonicalType(rule) === "confidence_only")) return true;
  return rules.some((rule) => objectRecord(rule.scope).confidenceOnly === true);
}

function canonicalType(rule: GeneratorRule): string {
  const type = rule.type.toLowerCase().replace(/[\s-]+/g, "_");
  if (type === "competitive" || type === "competitive_positioning") {
    const mode = typeof rule.mode === "string" ? rule.mode.toLowerCase().replace(/[\s-]+/g, "_") : "";
    return mode === "percent_below" || mode === "below" ? "percent_below"
      : mode === "match" ? "match"
        : mode === "percent_above_lowest" || mode === "above_lowest_mapped" ? "percent_above_lowest"
          : type;
  }
  if (type === "change_limit" || type === "change_limits") {
    const direction = typeof rule.direction === "string" ? rule.direction.toLowerCase() : "";
    return direction === "increase" ? "max_increase" : direction === "decrease" ? "max_decrease" : type;
  }
  const aliases: Record<string, string> = {
    competitive_percent_below: "percent_below",
    percentbelow: "percent_below",
    below: "percent_below",
    competitive_match: "match",
    match_named_competitor: "match",
    competitive_percent_above_lowest: "percent_above_lowest",
    percent_above_lowest_mapped: "percent_above_lowest",
    maximum_increase: "max_increase",
    maximum_decrease: "max_decrease",
    hold_below_threshold: "hold_below",
    hold_under_threshold: "hold_below",
    round: "rounding",
    rounding_rule: "rounding",
    margin_floor: "margin_floor",
    volume_tier: "volume_tier",
  };
  return aliases[type] ?? type;
}

function ruleCompetitor(rule: GeneratorRule): string | null {
  const value = rule.competitor ?? rule.competitorName ?? rule.brand;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function roundValue(value: number, unit: number, direction: "nearest" | "up" | "down"): number {
  if (!Number.isFinite(unit) || unit <= 0) return value;
  const quotient = value / unit;
  const rounded =
    direction === "up" ? Math.ceil(quotient) :
      direction === "down" ? Math.floor(quotient) : Math.round(quotient);
  return rounded * unit;
}

/**
 * Apply the ordered, deliberately boring rules. This function has no database
 * dependencies and is also the deterministic fixture surface for Stage 1.
 */
export function evaluateProduct(
  product: GeneratorProduct,
  rules: GeneratorRule[],
  options: { volumeTiers?: Map<string, "A" | "B" | "C">; confidenceOnly?: boolean } = {},
): GeneratorResult {
  const trace: GeneratorTrace[] = [];
  const exclusions: string[] = [];
  let value = product.currentMrp;
  let target: number | null = null;
  let binding: string | null = null;
  let hadCompetitiveRule = false;
  let maxIncreaseLimit: number | null = null;
  let maxDecreaseLimit: number | null = null;
  let heldValue: number | null = null;
  let maxIncreaseReason = "Maximum increase constraint";
  let maxDecreaseReason = "Maximum decrease constraint";
  let holdReason = "Hold-below constraint";
  let marginFloorLimit: number | null = null;
  let marginFloorReason = "Margin floor constraint";
  const warnings = [...(product.margin?.warnings ?? [])];
  if (product.sales?.awaitingConfirmation) {
    exclusions.push("Code awaiting Prayag confirmation; sales attribution unresolved.");
  }

  if (confidenceRequested(product, rules, options.confidenceOnly)) {
    if (!product.competitors.some((competitor) =>
      competitor.matched && competitor.effectivePrice != null,
    )) {
      exclusions.push("Confidence filter: no mapped competitor price is present.");
    }
    if (product.competitors.some((competitor) =>
      competitor.matched && (competitor.effectivePrice == null || competitor.ageDays == null || competitor.ageDays >= 365),
    )) {
      exclusions.push("Confidence filter: a competitor price used/current is older than 12 months.");
    }
    if (!product.sales?.awaitingConfirmation &&
      (!product.sales || product.sales.fySalesExists === false || !(product.sales.salesAmount > 0))) {
      exclusions.push("Confidence filter: FY sales are missing.");
    }
    if (!product.margin || product.margin.grossMarginPct == null ||
      product.margin.unitBomValue == null || product.margin.held) {
      exclusions.push(product.margin?.held
        ? "Confidence filter: gross margin is held by H1 source coverage."
        : "Confidence filter: usable gross margin is missing.");
    }
  }

  const add = (
    order: number,
    ruleType: string,
    outcome: GeneratorTrace["outcome"],
    before: number | null,
    after: number | null,
    reason: string,
    ruleTarget?: number | null,
  ) => trace.push({ order, ruleType, outcome, before, after, reason, ...(ruleTarget === undefined ? {} : { target: ruleTarget }) });
  const constrain = (candidate: number | null): { value: number | null; reason: string | null } => {
    if (candidate == null) return { value: candidate, reason: null };
    if (heldValue != null && candidate !== heldValue) {
      return { value: heldValue, reason: holdReason };
    }
    let constrainedReason: string | null = null;
    if (maxIncreaseLimit != null && candidate > maxIncreaseLimit) {
      candidate = maxIncreaseLimit;
      constrainedReason = maxIncreaseReason;
    }
    if (maxDecreaseLimit != null && candidate < maxDecreaseLimit) {
      candidate = maxDecreaseLimit;
      constrainedReason = maxDecreaseReason;
    }
    if (marginFloorLimit != null && candidate < marginFloorLimit) {
      return { value: marginFloorLimit, reason: marginFloorReason };
    }
    return { value: candidate, reason: constrainedReason };
  };
  const addConstrained = (
    order: number,
    type: string,
    before: number | null,
    candidate: number | null,
    ruleTarget: number | null,
    firedReason: string,
  ) => {
    const constrained = constrain(candidate);
    if (constrained.reason) {
      binding = constrained.reason;
      value = constrained.value;
      add(order, type, "blocked", before, value, `${firedReason}; ${constrained.reason}.`, ruleTarget);
    } else {
      value = candidate;
      add(order, type, "fired", before, value, firedReason, ruleTarget);
    }
  };

  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i]!;
    const type = canonicalType(rule);
    const before = value;
    if (type === "scope") {
      add(i + 1, type, "skipped", before, value, "Scope is evaluated before product rules.");
      continue;
    }
    if (rule.scope && typeof rule.scope === "object" && !matchesScope(product, rule.scope as GeneratorScope)) {
      add(i + 1, type, "skipped", before, value, "Product is outside this rule scope.", target);
      continue;
    }
    if (type === "margin_floor") {
      const category = canonicalMasterCategory(product.division);
      const floor = category ? categoryFloor(rule, category) : null;
      if (!category) {
        const reason = `Master category cannot be resolved from catalog division "${product.division ?? ""}".`;
        exclusions.push(reason);
        add(i + 1, type, "blocked", before, value, reason);
      } else if (floor == null) {
        const reason = `Margin floor is missing for master category ${category}.`;
        exclusions.push(reason);
        add(i + 1, type, "blocked", before, value, reason);
      } else if (!product.margin || product.margin.grossMarginPct == null) {
        const reason = `No usable gross margin evidence for ${category}.`;
        exclusions.push(reason);
        add(i + 1, type, "blocked", before, value, reason);
      } else if (product.margin.held) {
        const reason = `Gross margin held for H1 source coverage (${category}).`;
        exclusions.push(reason);
        add(i + 1, type, "blocked", before, value, reason);
      } else {
        const currentMargin = product.margin.grossMarginPct;
        const floorFraction = floor / 100;
        const bom = product.margin.unitBomValue;
        const discount = product.margin.discountFrac ?? 0;
        const minimum = bom != null && floorFraction < 1 && discount < 1
          ? bom / (1 - floorFraction) / (1 - discount) : null;
        marginFloorReason = `Margin floor ${category} ${floor}% (current gross margin ${(currentMargin * 100).toFixed(2)}%)`;
        if (minimum != null && (!marginFloorLimit || minimum > marginFloorLimit)) marginFloorLimit = minimum;
        if (minimum != null) {
          const constrained = constrain(value);
          if (constrained.reason) {
            value = constrained.value;
            binding = constrained.reason;
            add(i + 1, type, "fired", before, value, `${marginFloorReason}; minimum MRP ₹${minimum}.`, minimum);
          } else add(i + 1, type, "skipped", before, value, `${marginFloorReason}; current MRP satisfies floor.`, minimum);
        } else {
          const reason = `${marginFloorReason}; unit BOM evidence or usable quantity is missing.`;
          exclusions.push(reason);
          add(i + 1, type, "blocked", before, value, reason);
        }
      }
      continue;
    }
    if (type === "volume_tier") {
      const sales = product.sales;
      if (!sales || sales.fySalesExists === false || !(sales.salesAmount > 0)) {
        const reason = sales?.awaitingConfirmation
          ? "Code awaiting Prayag confirmation; sales attribution unresolved."
          : "No FY sales: excluded from volume tier rule.";
        exclusions.push(reason);
        add(i + 1, type, "blocked", before, value, reason);
        continue;
      }
      const mode = typeof rule.mode === "string" ? rule.mode.toLowerCase() : "cumulative";
      let eligible = true;
      let reason = "";
      if (mode === "cumulative" || rule.tier !== undefined) {
        const tiers = options.volumeTiers;
        const tier = sales.tier ?? tiers?.get(canonicalItemCode(product.itemCode));
        const wanted = typeof rule.tier === "string" ? rule.tier.toUpperCase() : "";
        eligible = wanted === "A" || wanted === "B" || wanted === "C" ? tier === wanted : false;
        reason = `Volume tier ${tier ?? "unknown"}; sales amount ₹${sales.salesAmount}; qty ${sales.qty ?? "unknown"}.`;
      } else {
        const threshold = numberRule(rule, "salesValue", "threshold", "value");
        const operator = rule.operator === "below" ? "below" : rule.operator === "above" ? "above" : null;
        if (threshold == null || threshold < 0 || !operator) {
          reason = "Volume tier threshold requires operator above|below and non-negative salesValue.";
          eligible = false;
        } else {
          eligible = operator === "above" ? sales.salesAmount >= threshold : sales.salesAmount < threshold;
          reason = `Volume sales value ₹${sales.salesAmount} ${operator} ₹${threshold}; qty ${sales.qty ?? "unknown"}.`;
        }
      }
      if (!eligible) {
        const exclusion = `${reason} Product is outside volume rule eligibility.`;
        exclusions.push(exclusion);
        add(i + 1, type, "skipped", before, value, exclusion);
      } else add(i + 1, type, "fired", before, value, reason);
      continue;
    }
    if (type === "percent_below" || type === "match" || type === "percent_above_lowest") {
      hadCompetitiveRule = true;
      const named = type === "percent_above_lowest"
        ? product.competitors.filter((c) => c.matched && c.effectivePrice != null)
          .sort((a, b) => (a.effectivePrice! - b.effectivePrice!) || a.competitor.localeCompare(b.competitor))[0]
        : product.competitors.find((c) =>
          c.matched && c.effectivePrice != null &&
          (!ruleCompetitor(rule) || norm(c.competitor) === norm(ruleCompetitor(rule)!)),
        );
      if (!named || named.effectivePrice == null) {
        const required = type === "percent_above_lowest" ? "a mapped competitor" : (ruleCompetitor(rule) ?? "the named competitor");
        const reason = `Required competitor price is missing: ${required}.`;
        exclusions.push(reason);
        add(i + 1, type, "blocked", before, value, reason);
        continue;
      }
      const pct = numberRule(rule, "percent", "percentage", "value") ?? 0;
      target = type === "percent_below"
        ? named.effectivePrice * (1 - pct / 100)
        : type === "percent_above_lowest"
          ? named.effectivePrice * (1 + pct / 100)
          : named.effectivePrice;
      addConstrained(i + 1, type, before, target, target, `${type} ${named.competitor}`);
      continue;
    }
    if (type === "max_increase") {
      if (value == null) { add(i + 1, type, "blocked", before, value, "Current MRP is missing."); continue; }
      const pct = numberRule(rule, "percent", "percentage", "maxPercent") ?? 0;
      const limit = (product.currentMrp ?? value) * (1 + pct / 100);
      if (maxIncreaseLimit == null || limit < maxIncreaseLimit) {
        maxIncreaseLimit = limit;
        maxIncreaseReason = `Maximum increase ${pct}%`;
      }
      const constrained = constrain(value);
      if (constrained.reason) {
        value = constrained.value;
        binding = constrained.reason;
        add(i + 1, type, "fired", before, value, `Maximum increase ${pct}%`, target);
      } else add(i + 1, type, "skipped", before, value, `Within maximum increase ${pct}%`, target);
      continue;
    }
    if (type === "max_decrease") {
      if (value == null) { add(i + 1, type, "blocked", before, value, "Current MRP is missing."); continue; }
      const pct = numberRule(rule, "percent", "percentage", "maxPercent") ?? 0;
      const limit = (product.currentMrp ?? value) * (1 - pct / 100);
      if (maxDecreaseLimit == null || limit > maxDecreaseLimit) {
        maxDecreaseLimit = limit;
        maxDecreaseReason = `Maximum decrease ${pct}%`;
      }
      const constrained = constrain(value);
      if (constrained.reason) {
        value = constrained.value;
        binding = constrained.reason;
        add(i + 1, type, "fired", before, value, `Maximum decrease ${pct}%`, target);
      } else add(i + 1, type, "skipped", before, value, `Within maximum decrease ${pct}%`, target);
      continue;
    }
    if (type === "hold_below") {
      const threshold = numberRule(rule, "threshold", "under", "maxCurrent") ?? 0;
      if (product.currentMrp != null && product.currentMrp < threshold) {
        heldValue = product.currentMrp;
        holdReason = `Hold below ₹${threshold}`;
        value = heldValue;
        binding = `Hold below ₹${threshold}`;
        add(i + 1, type, "fired", before, value, binding, target);
      } else add(i + 1, type, "skipped", before, value, `Current MRP is not under ₹${threshold}`, target);
      continue;
    }
    if (type === "rounding") {
      const unit = numberRule(rule, "unit", "roundingUnit") ?? 1;
      const direction = rule.direction === "up" || rule.direction === "down" ? rule.direction : "nearest";
      if (value == null) add(i + 1, type, "blocked", before, value, "No value available to round.");
      else {
        const rounded = roundValue(value, unit, direction);
        addConstrained(i + 1, type, before, rounded, target, `Rounded ${direction} to ₹${unit}`);
      }
      continue;
    }
    add(i + 1, type, "blocked", before, value, "Unknown rule type.");
  }

  if (product.currentMrp == null) {
    exclusions.push("Current approved Standard Prayag MRP is missing.");
  }
  if (hadCompetitiveRule && target == null && !exclusions.length) {
    exclusions.push("No competitive target could be computed.");
  }
  if (exclusions.length) {
    return {
      ...product,
      suggestedMrp: null,
      status: "excluded",
      exclusions: [...new Set(exclusions)],
      competitorValues: product.competitors,
      trace,
      competitiveTarget: target,
      bindingConstraint: binding,
      changePercent: null,
      salesEvidence: product.sales ?? null,
      marginEvidence: product.margin ?? null,
      warnings,
    };
  }
  if (target != null && value != null && value !== target && binding == null) {
    binding = "Rounding rule";
  }
  const changed = value != null && product.currentMrp != null && value !== product.currentMrp;
  return {
    ...product,
    suggestedMrp: changed ? value : null,
    status: changed ? "suggested" : "no_change",
    exclusions: [],
    competitorValues: product.competitors,
    trace,
    competitiveTarget: target,
    bindingConstraint: binding,
    changePercent: changed ? ((value! - product.currentMrp!) / Math.abs(product.currentMrp!)) * 100 : 0,
    salesEvidence: product.sales ?? null,
    marginEvidence: product.margin ?? null,
    warnings,
  };
}

export function stableJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort()
    .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

export function inputFingerprint(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

export function validateScenarioRules(
  rules: unknown,
  options: { salesAvailable?: boolean } = {},
): GeneratorRule[] {
  if (!Array.isArray(rules) || rules.length === 0) throw new Error("rules must be a non-empty ordered array.");
  return rules.map((rule, index) => {
    if (!rule || typeof rule !== "object" || typeof (rule as { type?: unknown }).type !== "string") {
      throw new Error(`rules[${index}].type is required.`);
    }
    const r = rule as GeneratorRule;
    const type = canonicalType(r);
     const supported = new Set([
      "scope", "percent_below", "match", "percent_above_lowest", "max_increase",
        "max_decrease", "hold_below", "rounding",
    ]);
     if ((type === "margin_floor" || type === "volume_tier") && options.salesAvailable !== true) {
       throw new Error(`rules[${index}] ${type} is unavailable in Stage 1 because the Sales API is unavailable.`);
     }
     if (options.salesAvailable === true && (type === "margin_floor" || type === "volume_tier")) {
       supported.add(type);
     }
     if (!supported.has(type)) throw new Error(`rules[${index}] has unsupported type "${r.type}".`);
    if (["percent_below", "match"].includes(type) && !ruleCompetitor(r)) {
      throw new Error(`rules[${index}] requires a competitor.`);
    }
    if (type === "rounding") {
      const unit = numberRule(r, "unit", "roundingUnit");
      if (unit == null || ![1, 5, 10, 50].includes(unit)) throw new Error(`rules[${index}] rounding unit must be 1, 5, 10, or 50.`);
      if (r.direction !== undefined && r.direction !== "nearest" && r.direction !== "up" && r.direction !== "down") {
        throw new Error(`rules[${index}] rounding direction must be nearest, up, or down.`);
      }
    }
    if (["percent_below", "percent_above_lowest", "max_increase", "max_decrease"].includes(type)) {
      const pct = numberRule(r, "percent", "percentage", "maxPercent");
      if (pct == null || pct < 0 || pct > 100) throw new Error(`rules[${index}] percent must be between 0 and 100.`);
    }
     if (type === "margin_floor") {
       const floors = objectRecord(r.categoryFloors);
       if (Object.keys(floors).length === 0) {
         throw new Error(`rules[${index}] margin_floor requires categoryFloors; Sales API is unavailable until an authenticated snapshot is available.`);
       }
       for (const [category, raw] of Object.entries(floors)) {
         if (!canonicalMasterCategory(category)) throw new Error(`rules[${index}] has unsupported master category "${category}".`);
         const floor = Number(raw);
         if (!Number.isFinite(floor) || floor < 0 || floor >= 100) {
           throw new Error(`rules[${index}] margin floor for ${category} must be at least 0 and below 100 percentage points.`);
         }
       }
     }
     if (type === "volume_tier") {
       if (typeof r.period !== "string" || !r.period.trim()) {
         throw new Error(`rules[${index}] volume_tier period is required (Sales API is unavailable until an authenticated snapshot is available).`);
       }
        if (r.period.trim().toUpperCase().replace(/^FY/, "") !== SUPPORTED_VOLUME_PERIOD) {
          throw new Error(`rules[${index}] volume_tier period "${r.period}" is unsupported; only ${SUPPORTED_VOLUME_PERIOD} is currently available.`);
        }
       const mode = typeof r.mode === "string" ? r.mode.toLowerCase() : "cumulative";
       if (mode === "cumulative" || r.tier !== undefined) {
         if (!["A", "B", "C"].includes(String(r.tier).toUpperCase())) {
           throw new Error(`rules[${index}] cumulative volume_tier tier must be A, B, or C (Sales API is unavailable until an authenticated snapshot is available).`);
         }
       } else {
         if (r.operator !== "above" && r.operator !== "below") {
           throw new Error(`rules[${index}] volume_tier operator must be above or below (Sales API is unavailable until an authenticated snapshot is available).`);
         }
         const salesValue = numberRule(r, "salesValue", "threshold", "value");
         if (salesValue == null || salesValue < 0) {
           throw new Error(`rules[${index}] volume_tier salesValue must be non-negative (Sales API is unavailable until an authenticated snapshot is available).`);
         }
       }
     }
    return r;
  });
}