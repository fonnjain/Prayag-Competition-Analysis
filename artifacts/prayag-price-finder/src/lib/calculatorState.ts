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
type Competitor = CalculatorBlock["competitors"][number];
const optString = (v: unknown) => v === undefined || typeof v === "string";
const optBool = (v: unknown) => v === undefined || typeof v === "boolean";
/** Identity used for duplicate checks: a deliberate one-off "Astral" never collides with recorded Astral. */
export const competitorIdentity = (c: { competitor: string | null; adHoc?: boolean }) =>
  `${c.adHoc ? "adhoc" : "known"}:${c.competitor ?? ""}`;

/** Accepts old links (no free-entry fields) and new ones. Codes, names and raw MRP strings are kept verbatim. */
export function decodeCalculator(value: string | null): CalculatorState | null {
  if (!value || encodeURIComponent(value).length > CALCULATOR_LINK_CAP) return null;
  try {
    const s = JSON.parse(value);
    if (!s || typeof s.asOf !== "string" || !isCalculatorDate(s.asOf) || !Array.isArray(s.blocks) ||
      s.blocks.length > MAX_CALCULATOR_BLOCKS || new Set(s.blocks.map((b: CalculatorBlock) => b?.id)).size !== s.blocks.length) return null;
    for (const b of s.blocks) {
      if (!b || typeof b.id !== "string" || (b.itemCode !== null && typeof b.itemCode !== "string") ||
        typeof b.variant !== "string" || typeof b.discount !== "string" || typeof b.quantity !== "string" ||
        !optString(b.mrp) || !optBool(b.adHocProduct) || !optString(b.description) ||
        (b.adHocProduct === true && (b.itemCode === null || b.itemCode === "" || !b.description)) ||
        !Array.isArray(b.competitors) || b.competitors.length > MAX_CALCULATOR_COMPETITORS) return null;
      for (const c of b.competitors) if (!c || typeof c.id !== "string" || (c.competitor !== null && typeof c.competitor !== "string") ||
        typeof c.discount !== "string" || !optString(c.mrp) || !optBool(c.adHoc) || (c.adHoc === true && !c.competitor)) return null;
      const named = b.competitors.filter((c: Competitor) => c.competitor);
      if (new Set(named.map(competitorIdentity)).size !== named.length) return null;
    }
    return s;
  } catch { return null; }
}

function withoutMrp<T extends { mrp?: string }>(x: T): Omit<T, "mrp"> {
  const { mrp: _drop, ...rest } = x; // eslint-disable-line @typescript-eslint/no-unused-vars
  return rest;
}
/** Overrides belong to the exact product/variant/brand they were typed against; any switch clears them. */
export function clearCompetitorPrice(c: Competitor): Competitor {
  return c.adHoc ? { ...c, mrp: "" } : withoutMrp(c);
}
export function setCompetitor(c: Competitor, name: string, adHoc: boolean): Competitor {
  const base = withoutMrp({ ...c, competitor: name });
  if (adHoc) return { ...base, adHoc: true, mrp: "" };
  const { adHoc: _a, ...known } = base; // eslint-disable-line @typescript-eslint/no-unused-vars
  return known;
}
export function setBlockVariant(b: CalculatorBlock, variant: string): CalculatorBlock {
  const base = b.adHocProduct ? { ...b, mrp: "" } : withoutMrp(b);
  return { ...base, variant, competitors: b.competitors.map(clearCompetitorPrice) };
}
export type ProductChoice = { itemCode: string; adHoc: false } | { itemCode: string; adHoc: true; description: string };
export function setBlockProduct(b: CalculatorBlock, choice: ProductChoice | null): CalculatorBlock {
  const { mrp: _m, adHocProduct: _a, description: _d, ...rest } = b; // eslint-disable-line @typescript-eslint/no-unused-vars
  const base = { ...rest, itemCode: choice?.itemCode ?? null, variant: "Standard", competitors: [] };
  return choice?.adHoc ? { ...base, adHocProduct: true, description: choice.description, mrp: "" } : base;
}
