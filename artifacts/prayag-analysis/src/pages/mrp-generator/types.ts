export type MrpGeneratorScope = {
  division?: string;
  series?: string;
  category?: string;
  competitorMapped?: boolean;
  explicitCodes?: string[];
};

export type MrpMasterCategory =
  | "PTMT"
  | "C P"
  | "PLUMBING"
  | "SANITARYWARE"
  | "SINK"
  | "HARDWARE";

export type MrpCategoryFloors = Partial<Record<MrpMasterCategory, number>>;

export type MrpGeneratorRule =
  | { type: "percent_below"; competitor: string; percent: number }
  | { type: "match"; competitor: string }
  | { type: "percent_above_lowest"; percent: number }
  | { type: "max_increase"; percent: number }
  | { type: "max_decrease"; percent: number }
  | { type: "hold_below"; threshold: number }
  | { type: "rounding"; unit: 1 | 5 | 10 | 50; direction: "nearest" | "up" | "down" }
  | { type: "margin_floor"; categoryFloors: MrpCategoryFloors; scope?: MrpGeneratorScope }
  | {
      type: "volume_tier";
      period: string;
      mode: "cumulative_contribution";
      tier: "A" | "B" | "C";
      cumulativeValuePercent: 80 | 95 | 100;
    }
  | {
      type: "volume_tier";
      period: string;
      mode: "value_threshold";
      operator: "above" | "below";
      salesValue: number;
    };

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
        : `FY sales ${rule.operator} ₹${rule.salesValue} for ${rule.period}`;
    default:
      return "Unknown rule";
  }
}
