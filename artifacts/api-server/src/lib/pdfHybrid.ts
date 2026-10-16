import type { ExtractedItem } from "./pdfExtractor.js";
import type { PrincePdfItem } from "./princeTextPdfExtractor.js";

export type HybridConflict = {
  code: string;
  occurrence: number;
  values: number[];
  pages: number[];
};

function keyCode(value: string): string {
  return value;
}

export function princeItemsToExtracted(items: PrincePdfItem[]): ExtractedItem[] {
  return items.filter((item) => item.priced).map((item) => ({
    cat_no: item.cat_no,
    variant: item.variant,
    mrp: item.piecePrice,
    product_name: item.product_name,
    page: item.page,
    discoveryPasses: [1],
    adjudicated: false,
  }));
}

/**
 * Merge by code plus deterministic page/occurrence identity. A disagreement
 * is returned separately so staging can mark the affected mapping as review;
 * neither source is silently overwritten.
 */
export function mergeHybridItems(
  textItems: ExtractedItem[],
  visionItems: ExtractedItem[],
): { items: ExtractedItem[]; conflicts: HybridConflict[] } {
  const textByCode = new Map<string, ExtractedItem[]>();
  const visionByCode = new Map<string, ExtractedItem[]>();
  for (const item of textItems) {
    const code = keyCode(item.cat_no);
    textByCode.set(code, [...(textByCode.get(code) ?? []), item]);
  }
  for (const item of visionItems) {
    const code = keyCode(item.cat_no);
    visionByCode.set(code, [...(visionByCode.get(code) ?? []), item]);
  }
  const items: ExtractedItem[] = [];
  const conflicts: HybridConflict[] = [];
  for (const code of new Set([...textByCode.keys(), ...visionByCode.keys()])) {
    const text = [...(textByCode.get(code) ?? [])].sort((a, b) => a.page - b.page);
    const vision = [...(visionByCode.get(code) ?? [])].sort((a, b) => a.page - b.page);
    for (let occurrence = 0; occurrence < Math.max(text.length, vision.length); occurrence += 1) {
      const textItem = text[occurrence];
      const visionItem = vision[occurrence];
      if (textItem && visionItem && textItem.mrp !== visionItem.mrp) {
        conflicts.push({
          code,
          occurrence,
          values: [textItem.mrp, visionItem.mrp],
          pages: [textItem.page, visionItem.page],
        });
      }
      // Page assignments should be disjoint in production. Keep both sources
      // when both found an occurrence so reconciliation cannot silently choose.
      if (textItem) items.push(textItem);
      if (visionItem) items.push(visionItem);
    }
  }
  return { items, conflicts };
}