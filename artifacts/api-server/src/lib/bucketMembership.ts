import { supportsCatalogRange } from "@workspace/formatting";
import type { BucketListRecord, BucketRule } from "@workspace/db";
import { normalizeVocabularyKey } from "./priceEditorVocabulary";
import { normCode } from "./catalog";

export type BucketProduct = {
  itemCode: string; productName: string | null; division: string | null;
  category: string | null; seriesRange: string | null; isActive: boolean;
  discontinuedFrom: string | null;
};
export type BucketDefinition = Pick<BucketListRecord, "parentId" | "rules" | "addedCodes" | "removedCodes"> & {
  id?: string; observedCodes?: string[];
};
export class BucketError extends Error {
  constructor(message: string, public status = 400, public code = "BUCKET_INVALID", public extra: Record<string, unknown> = {}) { super(message); }
}
export function isLiveBucketProduct(product: BucketProduct, date = new Date().toISOString().slice(0, 10)) {
  return product.isActive && (!product.discontinuedFrom || product.discontinuedFrom > date);
}
export function matchesBucketRule(product: BucketProduct, rule: BucketRule): boolean {
  return !rule.competitor && (!rule.division || rule.division === product.division)
    && (!rule.category || normalizeVocabularyKey(rule.category) === normalizeVocabularyKey(product.category ?? ""))
    && (!rule.range || (supportsCatalogRange(product.division)
      && normalizeVocabularyKey(rule.range) === normalizeVocabularyKey(product.seriesRange ?? "")));
}

/** Inherited members + live rules, then explicit additions, then removals win. */
export function resolveBucketCodes(
  definition: BucketDefinition,
  lists: Map<string, BucketDefinition>,
  catalogue: BucketProduct[],
  ancestors = new Set<string>(),
): Set<string> {
  const path = new Set(ancestors);
  if (definition.id) {
    if (path.has(definition.id)) throw new BucketError("A bucket list cannot inherit from itself.", 400, "BUCKET_CYCLE");
    path.add(definition.id);
  }
  let members = new Set<string>();
  if (definition.parentId) {
    const parent = lists.get(definition.parentId);
    if (!parent) throw new BucketError("The original list is no longer available. Reload your editor.", 409, "BUCKET_PARENT_MISSING");
    members = resolveBucketCodes(parent, lists, catalogue, path);
  }
  for (const product of catalogue) {
    if (definition.rules.some(rule => matchesBucketRule(product, rule))) members.add(product.itemCode);
  }
  const byCode = new Map(catalogue.map(p => [p.itemCode, p]));
  for (const code of definition.observedCodes ?? []) {
    const product = byCode.get(code);
    if (!product || !isLiveBucketProduct(product)) members.add(code);
  }
  for (const code of definition.addedCodes) members.add(code);
  for (const code of definition.removedCodes) members.delete(code);
  return members;
}

export function bucketAllowsCode(type: "included" | "excluded", codes: Set<string>, code: string | null | undefined) {
  const present = code != null && codes.has(normCode(code));
  return type === "included" ? present : !present;
}

export type UploadRow = {
  row: number; inputCode: string; itemCode: string | null;
  status: "matched" | "space_matched" | "duplicate" | "not_found" | "inactive";
  productName: string | null; reason: string;
};
export function classifyBucketUpload(input: { row: number; code: string }[], catalogue: BucketProduct[], existing: Set<string>) {
  const byCode = new Map(catalogue.map(p => [p.itemCode, p]));
  const seen = new Set(existing);
  const counts = { matched: 0, space_matched: 0, duplicate: 0, not_found: 0, inactive: 0 };
  const addable = new Set<string>();
  const rows: UploadRow[] = input.map(({ row, code }) => {
    const inputCode = code;
    const exact = byCode.get(code);
    const product = exact;
    let status: UploadRow["status"], reason: string;
    if (!product) { status = "not_found"; reason = "Not found in the catalogue; this row was not added."; }
    else if (seen.has(product.itemCode)) { status = "duplicate"; reason = "Already in this list or repeated in this upload."; }
    else if (!isLiveBucketProduct(product)) { status = "inactive"; reason = "No longer active. You may explicitly retain this code."; }
    else { status = "matched"; reason = "Matched to the catalogue."; }
    counts[status]++;
    if (product) seen.add(product.itemCode);
    if (product && status === "matched") addable.add(product.itemCode);
    return { row, inputCode, itemCode: product?.itemCode ?? null, status, productName: product?.productName ?? null, reason };
  });
  return { rows, counts, addableCodes: [...addable] };
}