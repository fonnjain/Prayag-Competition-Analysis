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
  "each",
  "type",
  "series",
  "range",
  "grade",
  "set",
  "nos",
  // Units, pressure/weight ratings and packaging words. These are incidental
  // noise for product-type matching — the dedicated size score handles the
  // actual dimension, so leaving these in the text channel only lets a wrong
  // product type win on a shared "mm"/"kg"/"class" token.
  "mm",
  "cm",
  "kg",
  "kgs",
  "gm",
  "gms",
  "mtr",
  "mtrs",
  "meter",
  "meters",
  "metre",
  "metres",
  "ltr",
  "ml",
  "oz",
  "sch",
  "sdr",
  "pn",
  "class",
  "isi",
  "mark",
  "tin",
]);

function tokenWeight(token: string): number {
  // Product-type words ("coupler", "elbow", "adapter") are what should decide
  // a match, so plain alphabetic words count double. Numeric/dimension tokens
  // (sizes, gauges, pressure classes) count single because the dedicated size
  // score already handles the real dimension — otherwise an incidental number
  // like a "10 KG" rating would let the wrong product type outrank the right
  // one purely on a shared digit.
  return /\d/.test(token) ? 1 : 2;
}

function tokenize(s: string | null | undefined): string[] {
  if (!s) return [];
  return String(s)
    .toLowerCase()
    .replace(/\u2044/g, "/") // unicode fraction slash → ascii so 3⁄4 ≈ 3/4
    .replace(/[^a-z0-9./-]+/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^[-./]+|[-./]+$/g, "").trim())
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

// Normalize a size string for comparison so the same nominal size written
// different ways collapses to one token: `1/2"`, `1/2 "` and `1/2` → `1/2`;
// `20 mm`, `20mm` and the competitor's bare `20` → `20`; `20 x 15 mm` → `20x15`.
function normSize(s: string | null | undefined): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/\u2044/g, "/")
    .replace(/inches?|inch/g, "")
    .replace(/[×]/g, "x")
    .replace(/\bmm\b/g, "")
    .replace(/\s*x\s*/g, "x")
    .replace(/["”'\s]+/g, "")
    .trim();
}

// The Prayag catalog `size` column is mostly null — the real nominal size is
// embedded in the product name (e.g. "COUPLER 75 mm - 2.5 KG"). Pull out the
// last `<num> mm` group so size matching is exact rather than a substring scan.
// Returns a canonical string like "20 mm" or "20x15 mm", or null when the name
// carries no mm dimension (taps, handles, showers, etc.).
export function parseSizeFromName(name: string | null | undefined): string | null {
  if (!name) return null;
  const s = String(name).replace(/\u2044/g, "/");
  const re = /(\d[\d.\/]*(?:\s*[x×]\s*\d[\d.\/]*)*)\s*mm\b/gi;
  let m: RegExpExecArray | null;
  let last: string | null = null;
  while ((m = re.exec(s)) !== null) last = m[1];
  if (last == null) return null;
  const canonical = last.replace(/\s*[x×]\s*/gi, "x").replace(/\s+/g, "");
  return `${canonical} mm`;
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
}

export function buildCandidate(p: {
  itemCode: string;
  productName: string | null;
  category: string | null;
  division: string | null;
  size: string | null;
  currentMrp: number | null;
}): CatalogCandidate {
  // The catalog size column is usually null; fall back to the size embedded in
  // the product name so size matching is exact instead of a substring scan.
  const effectiveSize = p.size ?? parseSizeFromName(p.productName);
  // The text channel carries product-type signal only (name + size). Category
  // and division are scored separately via catTokens — folding them in here too
  // would double-count structural words ("agri", "fittings") and let them drown
  // out the discriminating product-type word ("coupler" vs "pipe").
  const text = [p.productName, effectiveSize].filter(Boolean).join(" ");
  return {
    ...p,
    size: effectiveSize,
    textTokens: weightedTokens(text),
    catTokens: new Set([...tokenize(p.category), ...tokenize(p.division)]),
    sizeNorm: normSize(effectiveSize),
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
    // Exact, token-level matching only. A loose substring scan would treat
    // "200" as a match for "20" (200 contains 20) and let a wildly different
    // size win; now that the catalog size column is parsed from the name, the
    // normalized sizes compare cleanly.
    if (cand.sizeNorm && cand.sizeNorm === comp.sizeNorm) sizeScore = 1;
    else if (cand.textTokens.has(comp.sizeNorm)) sizeScore = 0.8;
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
  // Description only — category is compared via catTokens below, so keeping it
  // out of the text channel preserves the product-type signal in the wording.
  const textTokens = weightedTokens(row.description);
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
