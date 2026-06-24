// Fuzzy suggestion engine: for an unmatched competitor row, propose the most
// likely Prayag catalog products by description + size + category similarity.
// Heuristic only — every suggestion carries a confidence so reviewers can judge.

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "per",
  "pc",
  "pcs",
  "mtr",
  "each",
  "type",
  "series",
  "range",
  "grade",
  "set",
  "nos",
]);

function tokenWeight(token: string): number {
  // Tokens carrying a digit (sizes, dimensions, gauges) are far more
  // discriminative than plain words, so they count double.
  return /\d/.test(token) ? 2 : 1;
}

function tokenize(s: string | null | undefined): string[] {
  if (!s) return [];
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9./-]+/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^[-./]+|[-./]+$/g, "").trim())
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

// Normalize a size string for comparison: drop quotes and whitespace so
// `1/2"`, `1/2 "` and `1/2` all collapse to the same token.
function normSize(s: string | null | undefined): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/inches?|inch/g, "")
    .replace(/["”'\s]+/g, "")
    .trim();
}

function weightedTokens(s: string | null | undefined): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of tokenize(s)) {
    if (!m.has(t)) m.set(t, tokenWeight(t));
  }
  return m;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union > 0 ? inter / union : 0;
}

export interface CatalogCandidate {
  itemCode: string;
  productName: string | null;
  category: string | null;
  division: string | null;
  size: string | null;
  currentMrp: number | null;
  // Precomputed once per request so scoring is cheap per row.
  textTokens: Map<string, number>;
  catTokens: Set<string>;
  sizeNorm: string;
  textJoined: string;
}

export function buildCandidate(p: {
  itemCode: string;
  productName: string | null;
  category: string | null;
  division: string | null;
  size: string | null;
  currentMrp: number | null;
}): CatalogCandidate {
  const text = [p.productName, p.category, p.division, p.size]
    .filter(Boolean)
    .join(" ");
  return {
    ...p,
    textTokens: weightedTokens(text),
    catTokens: new Set([...tokenize(p.category), ...tokenize(p.division)]),
    sizeNorm: normSize(p.size),
    textJoined: tokenize(text).join(" "),
  };
}

export interface CompetitorRowInput {
  category: string | null;
  description: string | null;
  size: string | null;
}

export interface Suggestion {
  itemCode: string;
  productName: string | null;
  category: string | null;
  size: string | null;
  currentMrp: number | null;
  confidence: number;
  confidenceLabel: "high" | "medium" | "low";
}

const MIN_SCORE = 0.18;
const MAX_SUGGESTIONS = 3;

function score(
  comp: {
    textTokens: Map<string, number>;
    textWeight: number;
    catTokens: Set<string>;
    sizeNorm: string;
  },
  cand: CatalogCandidate,
): number {
  let shared = 0;
  for (const [tok, w] of comp.textTokens) {
    if (cand.textTokens.has(tok)) shared += w;
  }
  const textRecall = comp.textWeight > 0 ? shared / comp.textWeight : 0;
  const catSim = jaccard(comp.catTokens, cand.catTokens);

  const hasSize = comp.sizeNorm.length > 0;
  let sizeScore = 0;
  if (hasSize) {
    if (cand.sizeNorm && cand.sizeNorm === comp.sizeNorm) sizeScore = 1;
    else if (cand.textTokens.has(comp.sizeNorm)) sizeScore = 0.8;
    else if (cand.textJoined.includes(comp.sizeNorm)) sizeScore = 0.6;
  }

  let num = textRecall * 0.45 + catSim * 0.35;
  let den = 0.8;
  if (hasSize) {
    num += sizeScore * 0.3;
    den += 0.3;
  }
  return den > 0 ? num / den : 0;
}

function label(confidence: number): "high" | "medium" | "low" {
  if (confidence >= 55) return "high";
  if (confidence >= 35) return "medium";
  return "low";
}

// Top 1-3 catalog matches for a single competitor row, ranked by confidence.
export function suggestMatches(
  row: CompetitorRowInput,
  candidates: CatalogCandidate[],
): Suggestion[] {
  const textTokens = weightedTokens(`${row.category ?? ""} ${row.description ?? ""}`);
  let textWeight = 0;
  for (const w of textTokens.values()) textWeight += w;
  const comp = {
    textTokens,
    textWeight,
    catTokens: new Set(tokenize(row.category)),
    sizeNorm: normSize(row.size),
  };

  // Nothing to compare against → no suggestions.
  if (textWeight === 0 && comp.sizeNorm.length === 0) return [];

  const scored: { cand: CatalogCandidate; s: number }[] = [];
  for (const cand of candidates) {
    const s = score(comp, cand);
    if (s >= MIN_SCORE) scored.push({ cand, s });
  }
  scored.sort((a, b) => {
    if (b.s !== a.s) return b.s - a.s;
    // Prefer candidates that have a live price, then stable by code.
    const ap = a.cand.currentMrp != null ? 1 : 0;
    const bp = b.cand.currentMrp != null ? 1 : 0;
    if (ap !== bp) return bp - ap;
    return a.cand.itemCode.localeCompare(b.cand.itemCode);
  });

  return scored.slice(0, MAX_SUGGESTIONS).map(({ cand, s }) => {
    const confidence = Math.max(0, Math.min(100, Math.round(s * 100)));
    return {
      itemCode: cand.itemCode,
      productName: cand.productName,
      category: cand.category,
      size: cand.size,
      currentMrp: cand.currentMrp,
      confidence,
      confidenceLabel: label(confidence),
    };
  });
}
