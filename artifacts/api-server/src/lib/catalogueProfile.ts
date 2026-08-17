/**
 * Catalogue profile types and helpers.
 *
 * A catalogue profile describes which pages in a competitor's PDF contain
 * priced products mapped to Prayag codes. The profile is loaded from a JSON
 * file in the `catalogue-profiles/` directory.
 *
 * Using the profile we build a sub-PDF of only the relevant pages (e.g.
 * 17 of 108 for Sparsh Pearl) before sending to Claude, cutting input
 * cost and latency by ~85%.
 */

import { PDFDocument } from "pdf-lib";

export interface SeriesEntry {
  prayagSeries: string;
  sparshSeries: string;
  codePrefix: string;
  pages: number[];
}

export interface CatalogueProfile {
  competitor: string;
  catalogueName: string;
  /** Total page count of the full catalogue PDF. Used to clamp widened ranges. */
  pageCount: number;
  codeFamilies: string[];
  ignoredFamilies?: string[];
  seriesMap: SeriesEntry[];
  tablePages?: number[];
  notes?: string;
}

/**
 * Return a sorted, deduplicated list of all 1-based page numbers that appear
 * in the profile's seriesMap. These are the pages that carry product prices.
 */
export function profilePages(profile: CatalogueProfile): number[] {
  const pages = new Set<number>();
  for (const s of profile.seriesMap) {
    for (const p of s.pages) pages.add(p);
  }
  return [...pages].sort((a, b) => a - b);
}

/**
 * Return a widened page list: every page in `base` extended by ±margin,
 * clamped to [1, pageCount], deduplicated and sorted.
 *
 * Used when coverage < threshold: we widen the range by ±2 to catch sections
 * that shifted by a page or two between catalogue volumes.
 */
export function widenedPages(
  base: number[],
  margin: number,
  pageCount: number,
): number[] {
  const wide = new Set<number>();
  for (const p of base) {
    for (let i = p - margin; i <= p + margin; i++) {
      if (i >= 1 && i <= pageCount) wide.add(i);
    }
  }
  return [...wide].sort((a, b) => a - b);
}

/**
 * Copy the given 1-based page numbers from `src` into a new PDF.
 * Returns the PDF bytes and a `pageMap` array where
 * `pageMap[subPdfIndex]` = original 1-based catalogue page number.
 *
 * Invalid page numbers (< 1 or > total pages) are silently dropped.
 */
export async function extractPages(
  src: Buffer,
  pages1Based: number[],
): Promise<{ bytes: Buffer; pageMap: number[] }> {
  const srcDoc = await PDFDocument.load(src);
  const total = srcDoc.getPageCount();

  const wanted = [...new Set(pages1Based)]
    .filter((p) => Number.isInteger(p) && p >= 1 && p <= total)
    .sort((a, b) => a - b);

  if (wanted.length === 0) throw new Error("No valid pages to extract");

  const out = await PDFDocument.create();
  const copied = await out.copyPages(srcDoc, wanted.map((p) => p - 1));
  copied.forEach((pg) => out.addPage(pg));

  return {
    bytes: Buffer.from(await out.save()),
    pageMap: wanted, // index 0 → original page 1-based
  };
}

/**
 * Return the series names (sparshSeries) that had no items extracted.
 * Used to surface a human-readable warning when coverage is poor.
 */
export function seriesWithNoItems(
  profile: CatalogueProfile,
  foundCodePrefixes: Set<string>,
): string[] {
  return profile.seriesMap
    .filter((s) => !foundCodePrefixes.has(s.codePrefix))
    .map((s) => s.sparshSeries);
}
