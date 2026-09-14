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
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) =>
    `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
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
         if (!Number.isFinite(floor) || floor < 0 || floor > 100) {
           throw new Error(`rules[${index}] margin floor for ${category} must be between 0 and 100 percentage points.`);
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