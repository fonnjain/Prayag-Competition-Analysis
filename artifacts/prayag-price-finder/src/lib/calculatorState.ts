export * from "@workspace/formatting";
import type { CalculatorBlock } from "@workspace/formatting";
export const CALCULATOR_LINK_CAP = 6000;
export const MAX_CALCULATOR_BLOCKS = 50;
export const MAX_CALCULATOR_COMPETITORS = 10;
export type CalculatorState = { asOf: string; blocks: CalculatorBlock[] };
export function isCalculatorDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function encodeCalculator(state: CalculatorState): string | null {
  const json = JSON.stringify(state);
  const value = encodeURIComponent(json);
  // URLSearchParams encodes this ONCE; returning pre-encoded JSON doubles it.
  return value.length <= CALCULATOR_LINK_CAP ? json : null;
}
export function decodeCalculator(value: string | null): CalculatorState | null {
  if (!value || encodeURIComponent(value).length > CALCULATOR_LINK_CAP) return null;
  try {
    const s = JSON.parse(value);
    if (!s || typeof s.asOf !== "string" || !isCalculatorDate(s.asOf) || !Array.isArray(s.blocks) ||
      s.blocks.length > 50 || new Set(s.blocks.map((b: CalculatorBlock) => b.id)).size !== s.blocks.length) return null;
    for (const b of s.blocks) {
      if (typeof b.id !== "string" || (b.itemCode !== null && typeof b.itemCode !== "string") ||
        typeof b.variant !== "string" || typeof b.discount !== "string" || typeof b.quantity !== "string" ||
        !Array.isArray(b.competitors) || b.competitors.length > 10 ||
        new Set(b.competitors.map((c: CalculatorBlock["competitors"][number]) => c.competitor).filter(Boolean)).size !== b.competitors.filter((c: CalculatorBlock["competitors"][number]) => c.competitor).length) return null;
      for (const c of b.competitors) if (typeof c.id !== "string" || (c.competitor !== null && typeof c.competitor !== "string") || typeof c.discount !== "string") return null;
    }
    return s;
  } catch { return null; }
}
