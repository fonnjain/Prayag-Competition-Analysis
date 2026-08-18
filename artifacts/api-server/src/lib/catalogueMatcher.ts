/**
 * Matching engine for PDF catalogue imports.
 *
 * For each "target" (an existing competitor_prices row with a mapped Prayag
 * code), it finds the corresponding extracted item from the catalogue and
 * decides whether the match is clean ('ok'), needs human review
 * ('needs_review'), or was not found at all ('not_found').
 *
 * Three signals are used:
 *   1. Code  — exact match after normalising (uppercase, strip spaces/punct).
 *   2. Description — word-overlap semantic similarity (no extra API calls).
 *   3. Size / variant — HARD GATE. If both sides state a size and they
 *      disagree, the pair is rejected regardless of how well the code matches.
 *      This catches the WMP-188 (2 Mtr vs 3 Mtr) class of errors.
 */

import type { ExtractedItem } from "./pdfExtractor.js";

export interface MatchTarget {
  competitorCode: string | null; // code in competitor_prices
  matchedPrayagCode: string; // the Prayag SKU this maps to
  description: string | null; // Prayag product name (expected description)
  size: string | null; // size stored in competitor_prices
  existingPrice: number | null; // current price in competitor_prices
  prayagMrpCurrent: number | null; // live Prayag MRP from mrp_price_history
}

export interface CodeAlias {
  oldCode: string; // code in competitor_prices (master)
  newCode: string; // code in catalogue
}

export interface StagingRow {
  competitor: string;
  competitorCodeMaster: string | null;
  competitorCodeCatalogue: string | null;
  matchedPrayagCode: string | null;
  description: string | null; // expected (Prayag name)
  catalogueDescription: string | null; // found in PDF
  variant: string | null;
  oldMrp: number | null;
  newMrp: number | null;
  increasePct: number | null;
  prayagMrpCurrent: number | null;
  gapPct: number | null;
  page: number | null;
  matchMethod: string | null;
  status: "ok" | "needs_review" | "not_found" | "new_product";
  reviewReason: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function normCode(v: unknown): string {
  return String(v ?? "")
    .toUpperCase()
    .replace(/[\s\-_.]/g, "")
    .replace(/\(.*?\)/g, "")
    .trim();
}

const SIZE_TOKENS = /\b(\d+(?:\.\d+)?\s*(?:mm|mtr|m|inch|"|ft|ltr|l|pcs|pc)\b|\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?(?:\s*(?:mm|mtr|m|inch|")))/gi;

function extractSizes(s: string | null): string[] {
  if (!s) return [];
  const matches = s.match(SIZE_TOKENS) ?? [];
  return matches.map((m) => m.toLowerCase().replace(/\s+/g, ""));
}

/**
 * Hard size gate. Returns true if both sides specify sizes that DISAGREE.
 * Returns false if either side has no size info, or if they agree.
 */
function sizesConflict(a: string | null, b: string | null): boolean {
  const sa = extractSizes(a);
  const sb = extractSizes(b);
  if (sa.length === 0 || sb.length === 0) return false;
  // Any overlap is a non-conflict
  return !sa.some((x) => sb.includes(x));
}

/**
 * Simple word-overlap score (0–1). Good enough for product names like
 * "Bib Cock Fancy 15mm" vs "Bib Cock with Foam Flow".
 */
function descSimilarity(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  const tokenize = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2),
    );
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let overlap = 0;
  for (const w of ta) if (tb.has(w)) overlap++;
  return overlap / Math.max(ta.size, tb.size);
}

// ---------------------------------------------------------------------------
// Main matcher
// ---------------------------------------------------------------------------

export function matchCatalogue(
  competitor: string,
  targets: MatchTarget[],
  extracted: ExtractedItem[],
  aliases: CodeAlias[],
  priceBasis: string,
  gstPct: number | null,
): { staging: StagingRow[]; newProducts: ExtractedItem[] } {
  // Build alias maps
  const aliasOldToNew = new Map<string, string>(); // oldCode -> newCode
  const aliasNewToOld = new Map<string, string>(); // newCode -> oldCode
  for (const a of aliases) {
    aliasOldToNew.set(normCode(a.oldCode), normCode(a.newCode));
    aliasNewToOld.set(normCode(a.newCode), normCode(a.oldCode));
  }

  // Build a lookup of extracted items by their normalized cat_no
  const extractedByCode = new Map<string, ExtractedItem[]>();
  for (const item of extracted) {
    const key = normCode(item.cat_no);
    const list = extractedByCode.get(key) ?? [];
    list.push(item);
    extractedByCode.set(key, list);
  }

  // Track which extracted items have been claimed by a target
  const claimed = new Set<ExtractedItem>();

  function effectiveCompPrice(mrp: number): number {
    if (priceBasis === "Ex-GST") return mrp * (1 + (gstPct ?? 18) / 100);
    return mrp;
  }

  function gapPctFor(compMrp: number, prayagMrp: number | null): number | null {
    if (!prayagMrp || prayagMrp <= 0) return null;
    return ((effectiveCompPrice(compMrp) - prayagMrp) / prayagMrp) * 100;
  }

  function makeRow(
    target: MatchTarget,
    found: ExtractedItem | null,
    status: StagingRow["status"],
    matchMethod: string | null,
    reviewReason: string | null,
    catCode: string | null,
  ): StagingRow {
    const newMrp = found?.mrp ?? null;
    const oldMrp = target.existingPrice;
    const increasePct =
      newMrp != null && oldMrp != null && oldMrp > 0
        ? ((newMrp - oldMrp) / oldMrp) * 100
        : null;
    const gapPct =
      newMrp != null ? gapPctFor(newMrp, target.prayagMrpCurrent) : null;

    return {
      competitor,
      competitorCodeMaster: target.competitorCode,
      competitorCodeCatalogue: catCode,
      matchedPrayagCode: target.matchedPrayagCode,
      description: target.description,
      catalogueDescription: found?.product_name ?? null,
      variant: found?.variant ?? null,
      oldMrp,
      newMrp,
      increasePct,
      prayagMrpCurrent: target.prayagMrpCurrent,
      gapPct,
      page: found?.page ?? null,
      matchMethod,
      status,
      reviewReason,
    };
  }

  const staging: StagingRow[] = [];

  for (const target of targets) {
    const masterCode = target.competitorCode
      ? normCode(target.competitorCode)
      : null;
    if (!masterCode) {
      // No competitor code — can't match
      staging.push(makeRow(target, null, "not_found", null, "No competitor code in mapping", null));
      continue;
    }

    // Apply alias: if masterCode has a known alias, look for newCode in catalogue
    const lookupCode = aliasOldToNew.get(masterCode) ?? masterCode;
    const candidates = extractedByCode.get(lookupCode) ?? [];

    // TEMP diagnostic — remove after alias debugging resolved
    const DEBUG_CODES = new Set(["WC100", "RPS2285", "WMP188"]);
    if (DEBUG_CODES.has(masterCode)) {
      console.log(`[aliasDiag] masterCode=${masterCode} aliasHit=${aliasOldToNew.has(masterCode)} lookupCode=${lookupCode} inExtracted=${extractedByCode.has(lookupCode)} extractedKeys=[${[...extractedByCode.keys()].filter(k => k.startsWith(masterCode.slice(0,3))).join(",")}]`);
    }

    if (candidates.length === 0) {
      // Not found in extracted items
      staging.push(makeRow(target, null, "not_found", null, null, null));
      continue;
    }

    // Take the best candidate (first unclaimed; if all claimed, use first)
    const candidate =
      candidates.find((c) => !claimed.has(c)) ?? candidates[0]!;
    claimed.add(candidate);

    // Size gate: only fires when BOTH sides have an explicit size/variant field
    // and they disagree. If either is absent, skip — descriptions alone can
    // carry numeric tokens (part numbers, box counts) that would cause false
    // positives (e.g. "expected (none), found (none)").
    const targetSizeStr = [target.size, target.description].join(" ");
    const catSizeStr = [candidate.variant, candidate.product_name].join(" ");

    if (target.size && candidate.variant && sizesConflict(targetSizeStr, catSizeStr)) {
      staging.push(
        makeRow(
          target,
          candidate,
          "needs_review",
          "code+desc",
          `Size conflict: expected "${target.size ?? "(none)"}", found "${candidate.variant ?? "(none)"}"`,
          candidate.cat_no,
        ),
      );
      continue;
    }

    // Description check: low similarity is a soft flag (needs_review)
    const sim = descSimilarity(target.description, candidate.product_name);
    const isAlias = lookupCode !== masterCode;

    if (isAlias) {
      // Alias match → always needs_review so user confirms the renumbering
      staging.push(
        makeRow(
          target,
          candidate,
          "needs_review",
          "desc+size",
          `Code renumbered: master ${target.competitorCode} → catalogue ${candidate.cat_no}`,
          candidate.cat_no,
        ),
      );
    } else if (sim < 0.2 && target.description) {
      // Code matched but descriptions don't overlap at all
      staging.push(
        makeRow(
          target,
          candidate,
          "needs_review",
          "code+desc",
          `Description mismatch: expected "${target.description}", found "${candidate.product_name}"`,
          candidate.cat_no,
        ),
      );
    } else {
      // Clean code match
      staging.push(
        makeRow(target, candidate, "ok", "code+desc", null, candidate.cat_no),
      );
    }
  }

  // New products: extracted items not claimed by any target
  const newProducts = extracted.filter((item) => !claimed.has(item));

  return { staging, newProducts };
}
