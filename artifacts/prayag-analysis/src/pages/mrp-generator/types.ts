import type {
  MrpGeneratorScope,
  MrpGeneratorRule,
  MrpGeneratorMarginFloorRuleCategoryFloors,
  MrpGeneratorPolicy
} from "@workspace/api-client-react";

export type { MrpGeneratorScope, MrpGeneratorRule, MrpGeneratorMarginFloorRuleCategoryFloors, MrpGeneratorPolicy };

export const ALL_RULE_TYPES = [
  "percent_below",
  "match",
  "percent_above_lowest",
  "max_increase",
  "max_decrease",
  "hold_below",
  "rounding",
  "margin_floor",
  "volume_tier",
] as const;

export function getRuleDescription(rule: MrpGeneratorRule) {
  switch (rule.type) {
    case "percent_below":
      return `Target ${rule.percent}% below ${rule.competitor || "competitor"}`;
    case "match":
      return `Match ${rule.competitor || "competitor"}`;
    case "percent_above_lowest":
      return `Target ${rule.percent}% above lowest competitor`;
    case "max_increase":
      return `Max increase ${rule.percent}%`;
    case "max_decrease":
      return `Max decrease ${rule.percent}%`;
    case "hold_below":
      return `Hold under ₹${rule.threshold}`;
    case "rounding":
      return `Round ${rule.direction} to nearest ₹${rule.unit}`;
    case "margin_floor":
      return `Maintain category-specific margin floors`;
    case "volume_tier":
      return rule.mode === "cumulative_contribution"
        ? `${rule.tier} tier by cumulative contribution for ${rule.period}`
        : `FY sales ${(rule as any).operator} ₹${(rule as any).salesValue} for ${(rule as any).period}`;
    default:
      return "Unknown rule";
  }
}
