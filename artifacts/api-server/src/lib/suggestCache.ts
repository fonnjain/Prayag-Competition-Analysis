// Memoized top-suggestion tiers for the auto-accept preview. Scoring one
// competitor row against the full catalog is the expensive part of the preview,
// and the preview re-runs it over every pending row on each filter change. The
// resulting tier only depends on the row's (category, description, size) and the
// current catalog, so we cache it keyed by a cheap catalog-version signature.
// When the catalog changes (new products, an MRP push, renames) the version
// changes and the cache resets, so stale tiers never leak.

import {
  suggestMatches,
  type CatalogCandidate,
  type CompetitorRowInput,
} from "./suggest.js";

export type SuggestionTier = "high" | "medium" | "low" | "none";

let cachedVersion: string | null = null;
let tierCache = new Map<string, SuggestionTier>();

// Cheap rolling (FNV-1a) hash over only the candidate fields that affect
// scoring, so any catalog edit invalidates the cache without comparing the whole
// array. Adding/removing products also changes the length prefix.
export function catalogVersion(candidates: CatalogCandidate[]): string {
  let h = 2166136261 >>> 0;
  const mix = (s: string): void => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    // Field separator so "ab"+"c" and "a"+"bc" don't collide.
    h = Math.imul(h ^ 0x1f, 16777619) >>> 0;
  };
  for (const c of candidates) {
    mix(c.itemCode);
    mix(c.productName ?? "");
    mix(c.currentMrp == null ? "" : String(c.currentMrp));
    mix(c.sizeNorm);
  }
  return `${candidates.length}:${(h >>> 0).toString(16)}`;
}

function rowKey(row: CompetitorRowInput): string {
  return `${row.category ?? ""}\u0000${row.description ?? ""}\u0000${row.size ?? ""}`;
}

// Top-suggestion tier for a competitor row, served from cache when the catalog
// is unchanged. Rows with identical matching inputs share a cache entry, so
// duplicate descriptions only score once.
export function topSuggestionTier(
  row: CompetitorRowInput,
  candidates: CatalogCandidate[],
  version: string,
): SuggestionTier {
  if (version !== cachedVersion) {
    cachedVersion = version;
    tierCache = new Map();
  }
  const key = rowKey(row);
  const cached = tierCache.get(key);
  if (cached !== undefined) return cached;
  const top = suggestMatches(row, candidates)[0];
  const tier: SuggestionTier = top ? top.confidenceLabel : "none";
  tierCache.set(key, tier);
  return tier;
}

// Exposed for tests so a fresh run isn't polluted by a prior catalog version.
export function resetSuggestionTierCache(): void {
  cachedVersion = null;
  tierCache = new Map();
}
