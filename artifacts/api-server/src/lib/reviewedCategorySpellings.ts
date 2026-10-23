/**
 * Reviewed Category-only decisions. Never apply these rules to item codes,
 * divisions, Range/series, competitor categories, or signed undo snapshots.
 *
 * Sales check: /v1/products passes category through, but Distributor Analysis's
 * authorityClient drops it. Its exact competitor_price.category filter reads
 * competitor_prices.category, not catalog_products.category. Recheck those
 * consumers before any future stored-category merge; this is not merge approval.
 */
export const reviewedCategoryGroups = [
  { divisions: ["Pipes & Fittings"], keep: "SWR Pipe", remove: "SWR PIPE" },
  { divisions: ["Pipes & Fittings"], keep: "Silent Fittings", remove: "SILENT FITTINGS" },
  { divisions: ["Pipes & Fittings"], keep: "UPVC Pipe", remove: "UPVC PIPE" },
  ...["Aspire 52", "Marcus 68", "Macasa 76", "Saga 79F", "Evian 87", "Laguna 93",
    "Orbit 53", "Vincent 66", "Aqua 54", "Ocean 55", "Urbona 78", "Blaze 62",
    "Polo 60", "Virgo P66", "Europa 90", "Niagara 81", "Cygnus 71"]
    .map(keep => ({ divisions: ["CP Fittings / Faucets"], keep, remove: keep.toUpperCase() })),
  // Official PTMT SINK sheet: rows 32–40 and 76–78 describe 800/304/0.75.
  // The double-bowl heading omits "MM"; no product type or dimension is changed.
  { divisions: ["PTMT & Plastic Fittings", "Sink"],
    keep: "800 Series 304 Super Steel (0.75 Mm)", remove: "800 Series 304 Super Steel (0.75)" },
] as const;

/** Explicit, division-scoped Category aliases, not a general title-case rule. */
export function reviewedCategorySpelling(division: string | null, category: string): string | undefined {
  const key = category.trim().toLowerCase();
  return reviewedCategoryGroups.find(group =>
    division !== null && group.divisions.some(value => value === division) &&
    (group.keep.toLowerCase() === key || group.remove.toLowerCase() === key))?.keep;
}
