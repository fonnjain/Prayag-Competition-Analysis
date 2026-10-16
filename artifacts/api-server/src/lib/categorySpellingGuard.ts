import { createHash } from "node:crypto";
import { catalogProductsTable, db } from "@workspace/db";
import { normalizeVocabularyKey, lockPriceEditorVocabulary } from "./priceEditorVocabulary";

export interface CategoryCatalogueRow {
  itemCode?: string;
  division: string | null;
  category: string | null;
  isActive?: boolean | null;
}
export interface CategorySpellingDecision {
  itemCode?: string;
  division: string | null;
  inputCategory: string;
  selectedCategory: string | null;
  status: "matched existing spelling" | "new" | "ambiguous";
  candidates: Array<{ category: string; activeProducts: number }>;
  selectionReason: string;
}
const groupKey = (division: string | null, category: string) =>
  JSON.stringify([division, normalizeVocabularyKey(category)]);

/** P051: exact division boundary, P048's normalizer; never a merge. */
export function planCategorySpellings<T extends CategoryCatalogueRow>(
  incoming: T[], stored: CategoryCatalogueRow[],
): { rows: T[]; categorySpellings: CategorySpellingDecision[]; categorySpellingFingerprint: string } {
  const groups = new Map<string, Map<string, number>>();
  for (const row of stored) {
    if (!row.category || !normalizeVocabularyKey(row.category)) continue;
    const key = groupKey(row.division, row.category);
    const spellings = groups.get(key) ?? new Map<string, number>();
    spellings.set(row.category, (spellings.get(row.category) ?? 0) + (row.isActive === true ? 1 : 0));
    groups.set(key, spellings);
  }
  const newSpellings = new Map<string, string>();
  const categorySpellings: CategorySpellingDecision[] = [];
  const rows = incoming.map(row => {
    if (!row.category || !normalizeVocabularyKey(row.category)) return { ...row };
    const key = groupKey(row.division, row.category);
    const candidates = [...(groups.get(key) ?? [])].map(([category, activeProducts]) => ({ category, activeProducts }))
      .sort((a, b) => b.activeProducts - a.activeProducts || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
    const tie = candidates.length > 1 && candidates[0]!.activeProducts === candidates[1]!.activeProducts;
    const selectedCategory = tie ? null : candidates[0]?.category ?? newSpellings.get(key) ?? row.category;
    if (!candidates.length && selectedCategory) newSpellings.set(key, selectedCategory);
    categorySpellings.push({
      ...(row.itemCode ? { itemCode: row.itemCode } : {}),
      division: row.division, inputCategory: row.category, selectedCategory,
      status: tie ? "ambiguous" : candidates.length ? "matched existing spelling" : "new",
      candidates,
      selectionReason: tie ? "Active-product counts tie; no spelling was selected. Explicit review is required."
        : candidates.length > 1 ? "Selected the stored spelling with more active products; no stored product is changed."
        : candidates.length ? "Same division and shared P048 normalised Category key."
        : "New Category; requires the normal administrator approval. Equivalent new rows use the first previewed spelling.",
    });
    return { ...row, category: selectedCategory ?? row.category };
  });
  return { rows, categorySpellings,
    categorySpellingFingerprint: createHash("sha256").update(JSON.stringify(categorySpellings)).digest("hex") };
}

export function assertCategorySpellingPlan(plan: ReturnType<typeof planCategorySpellings>): void {
  const blocked = plan.categorySpellings.find(row => row.status === "ambiguous");
  if (blocked) throw new Error(`Category spelling is ambiguous in ${blocked.division}: ${JSON.stringify(blocked.candidates)}. No rows were written.`);
}
export function assertCategorySpellingPreview(expected: unknown, plan: ReturnType<typeof planCategorySpellings>): void {
  assertCategorySpellingPlan(plan);
  if (expected !== plan.categorySpellingFingerprint) {
    throw new Error("Category spellings or active-product counts changed since preview. Preview again; no rows were written.");
  }
}
/** Load boundary: only novel item codes can receive classification values. */
export function planNewProductCategories<T extends CategoryCatalogueRow & { seriesRange?: string | null }>(
  incoming: T[], stored: Array<CategoryCatalogueRow & { seriesRange?: string | null }>,
) {
  const codeKey = (value: string | undefined) => value ?? "";
  const exact = new Map(stored.filter(row => row.itemCode).map(row => [row.itemCode, row]));
  const groups = new Map<string, typeof stored>();
  for (const row of stored.filter(row => row.itemCode)) {
    const key = codeKey(row.itemCode);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const resolveExisting = (row: T) => {
    if (exact.has(row.itemCode)) return exact.get(row.itemCode);
    const candidates = groups.get(codeKey(row.itemCode)) ?? [];
    if (candidates.length > 1) throw new Error("Ambiguous existing item code; review identity before loading. No classifications were changed.");
    return candidates[0];
  };
  const plan = planCategorySpellings(incoming.filter(row => !resolveExisting(row)), stored);
  const guarded = new Map(plan.rows.map(row => [codeKey(row.itemCode), row]));
  return { ...plan, rows: incoming.map(row => {
    const current = resolveExisting(row);
    if (current) return { ...row, division: current.division, category: current.category,
      seriesRange: current.seriesRange, ...(current.isActive !== undefined ? { isActive: current.isActive } : {}) };
    return guarded.get(codeKey(row.itemCode)) ?? row;
  }) };
}
/** Historical signed values are immutable: reject, do not canonicalise an inverse. */
export function assertExactCategoryRestoration(incoming: CategoryCatalogueRow[], stored: CategoryCatalogueRow[]) {
  const plan = planCategorySpellings(incoming, stored);
  assertCategorySpellingPlan(plan);
  const conflict = plan.categorySpellings.find(row => row.inputCategory !== row.selectedCategory);
  if (conflict) throw new Error(`Exact restoration stopped: ${JSON.stringify(conflict.inputCategory)} matched existing spelling ${JSON.stringify(conflict.selectedCategory)} in ${conflict.division}. Snapshot was not rewritten. Candidates: ${JSON.stringify(conflict.candidates)}.`);
  return plan;
}

export async function readCategoryCatalogue(executor: Pick<typeof db, "select"> = db) {
  return executor.select({
    itemCode: catalogProductsTable.itemCode, division: catalogProductsTable.division,
    category: catalogProductsTable.category, isActive: catalogProductsTable.isActive,
  }).from(catalogProductsTable).for("share");
}
export { lockPriceEditorVocabulary as lockCategorySpellings };