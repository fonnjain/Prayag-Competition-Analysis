import { createHash } from "node:crypto";

export type GeneratorScope = {
  division?: string | string[];
  series?: string | string[];
  category?: string | string[];
  competitorMapped?: boolean;
  explicitCodes?: string[];
  itemCodes?: string[];
  codes?: string[];
};

export type GeneratorRule = Record<string, unknown> & { type: string };

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
};

const asList = (value: unknown): string[] =>
  (Array.isArray(value) ? value : value == null ? [] : [value])
    .filter((x): x is string => typeof x === "string")
    .map((x) => x.trim())
    .filter(Boolean);

const norm = (value: string) => value.trim().toLowerCase();

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
    if (maxIncreaseLimit != null && candidate > maxIncreaseLimit) {
      return { value: maxIncreaseLimit, reason: maxIncreaseReason };
    }
    if (maxDecreaseLimit != null && candidate < maxDecreaseLimit) {
      return { value: maxDecreaseLimit, reason: maxDecreaseReason };
    }
    return { value: candidate, reason: null };
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
    if (type === "margin_floor" || type === "volume_tier") {
      const reason = type === "margin_floor"
        ? "Disabled in Stage 1: Sales API margin data is unavailable."
        : "Disabled in Stage 1: Sales API sales data is unavailable.";
      add(i + 1, type, "blocked", before, value, reason);
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

export function validateScenarioRules(rules: unknown): GeneratorRule[] {
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
     if (type === "margin_floor" || type === "volume_tier") {
       throw new Error(`rules[${index}] ${type} is unavailable in Stage 1 because the Sales API is unavailable.`);
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
    return r;
  });
}