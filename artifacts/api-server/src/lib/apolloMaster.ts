/**
 * P045 Apollo master reader.  This is intentionally a pure workbook parser:
 * it never imports the database or mutates application state.
 */
import * as XLSX from "xlsx";
import { apolloPipeIdentity, normalizeApolloDescription, normalizeApolloSize } from "./apolloPipeIdentity";

export type ApolloMasterRow = {
  category: string; description: string; size: string | null; prayagCode: string | null;
  competitorCode: string; codeSource: "supplier" | "locally_assigned"; price: number;
  sheet: string; sourceRow: number;
};
export type ApolloUnpricedGap = { category: string; sheet: string; sourceRow: number; prayagCode: string | null; generatedCode: string | null };
export type ApolloPriceConflict = { competitorCode: string; prices: number[]; rows: Array<{ sheet: string; sourceRow: number }> };
export type ApolloRename = { oldCode: string; newCode: string; sheet: string; prayagCode: string | null; status?: "applied" | "reserved_dropped" };
export type ApolloMasterParse = {
  rows: ApolloMasterRow[]; coverageGaps: Record<string, number>; unpriced: ApolloUnpricedGap[];
  renames: ApolloRename[]; conflicts: ApolloPriceConflict[]; pipeCount: number; fittingCount: number;
};

export type ApolloInput = string | Uint8Array | ArrayBuffer | XLSX.WorkBook;

const PIPE = new Set(["AGRI PIPE", "CPVC PIPE", "CASING PIPE", "PPR PIPE", "SWR PIPE", "UGD PIPE", "UPVC PIPE"]);
const clean = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
const number = (v: unknown): number | null => {
  if (v === null || v === undefined || clean(v) === "") return null;
  const n = Number(String(v).replace(/[₹,\s]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};
const isCode = (v: unknown) => /^[A-Z][A-Z0-9 _-]{2,}$/i.test(clean(v));

function workbook(input: ApolloInput): XLSX.WorkBook {
  if (typeof input === "object" && !(input instanceof Uint8Array) && !(input instanceof ArrayBuffer) && "SheetNames" in input) return input as XLSX.WorkBook;
  return XLSX.read(input as any, { type: typeof input === "string" ? "file" : "array", cellDates: false });
}

/** Parse the two-tier (Prayag/Apollo) master, locating Apollo columns by row 1 group. */
export function parseApolloMaster(input: ApolloInput): ApolloMasterParse {
  const book = workbook(input);
  const rows: ApolloMasterRow[] = [], unpriced: ApolloUnpricedGap[] = [];
  const coverageGaps: Record<string, number> = {};
  const renames: ApolloRename[] = [];
  const seenCodes = new Map<string, ApolloMasterRow[]>();
  for (const sheet of book.SheetNames) {
    const name = clean(sheet), category = name.toUpperCase();
    // Annotated output workbooks may carry a non-source summary tab.
    if (/^P045 SUMMARY$/i.test(name)) continue;
    if (!/PIPE|FITTINGS/i.test(category)) throw new Error(`Malformed Apollo sheet grouping: ${sheet}`);
    const values = XLSX.utils.sheet_to_json(book.Sheets[sheet], { header: 1, raw: false, defval: null }) as unknown[][];
    if (values.length < 2) throw new Error(`Malformed Apollo sheet (missing group/header rows): ${sheet}`);
    const group = values[0].map(clean), headers = values[1].map(clean);
    const apolloStarts = group.map((v, i) => /^apollo$/i.test(v) ? i : -1).filter(i => i >= 0);
    if (!apolloStarts.length) throw new Error(`Malformed Apollo sheet grouping (Apollo group missing): ${sheet}`);
    const aStart = apolloStarts[0];
    const aEnd = apolloStarts[1] ?? values[0].length;
    const aHeaders = headers.slice(aStart, aEnd);
    const codeOffset = aHeaders.findIndex(v => /^item code$/i.test(v));
    // Some sheets put the actual dated Apollo price immediately after code;
    // casing/UGD/PPR put an MRP-per-metre marker there and the dated value
    // one column farther right.
    const priceOffset = aHeaders[codeOffset + 1] && /mrp\s*\(/i.test(aHeaders[codeOffset + 1])
      ? codeOffset + 2
      : aHeaders.findIndex((v, i) => i > codeOffset && (/mrp|price|net|date|\d{1,2}\s+[a-z]{3}/i.test(v)) && !/^item code$/i.test(v));
    if (codeOffset < 0 || priceOffset < 0) throw new Error(`Malformed Apollo sheet grouping (Apollo code/price missing): ${sheet}`);
    const aCode = aStart + codeOffset, aPrice = aStart + priceOffset;
    const prayagStart = group.findIndex(v => /^prayag$/i.test(v));
    const pStart = prayagStart < 0 ? 0 : prayagStart;
    const pEnd = prayagStart < 0 ? aStart : apolloStarts[0];
    const pHeaders = headers.slice(pStart, pEnd);
    const pCodeOffset = pHeaders.findIndex(v => /^item code$/i.test(v));
    const pCode = pCodeOffset < 0 ? -1 : pStart + pCodeOffset;
    const sizeCols = headers.map((h, i) => /size\s*\(mm\)|size|length|socket|variant/i.test(h) && i < aStart ? i : -1).filter(i => i >= 0);
    const coverageStatusCol = headers.findIndex(h => /^coverage status$/i.test(h));
    let headings: string[] = [];
    let lastCategory = category.replace(/\s+(PIPE|FITTINGS)$/i, "").trim();
    for (let r = 2; r < values.length; r++) {
      const row = values[r] ?? [], ac = clean(row[aCode]), pc = pCode >= 0 ? clean(row[pCode]) : "";
      const price = number(row[aPrice]);
      const candidates = ac || pc;
      // Heading rows have text but no item code and no Apollo code.
      if (!ac && !pc && row.some(v => clean(v)) && !row.some(v => number(v) !== null)) {
        const text = row.slice(0, aStart).map(clean).filter(Boolean).join(" ");
        if (text) { headings = [...headings.slice(-2), text]; lastCategory = text; }
        continue;
      }
      const pipe = PIPE.has(category);
      // In a reviewed workbook the generated code has already been cleared.
      // Only the explicit coverage marker distinguishes those rows from other
      // ordinary blank comparison rows in the original sheet.
      if (pipe && coverageStatusCol >= 0 &&
          /coverage gap/i.test(clean(row[coverageStatusCol])) && price === null) {
        unpriced.push({ category, sheet, sourceRow: r + 1, prayagCode: pc || null, generatedCode: null });
        coverageGaps[category] = (coverageGaps[category] ?? 0) + 1;
        continue;
      }
      if (!candidates) continue;
      const generated = pipe && (/^AP[ACKPSU]\d{3}$/i.test(ac) || /^APUGD\d{3}$/i.test(ac));
      const supplier = !pipe && !!ac;
      if (!generated && !supplier) continue;
      const renamed = category === "UGD PIPE" && /^APU\d{3}$/i.test(ac) ? `APUGD${ac.slice(3)}` : ac;
      // Include the tenth mapping even when UGD's APU007 is unpriced. It is
      // reserved/dropped, never emitted as a competitor row.
      if (renamed !== ac && price === null) renames.push({ oldCode: ac, newCode: renamed, sheet, prayagCode: pc || null, status: "reserved_dropped" });
      const description = [category.replace(/\s+PIPE$/i, ""), ...headings].filter(Boolean).join(" - ");
      const size = sizeCols.map(i => clean(row[i])).filter(Boolean).join(" x ") || null;
      if (price === null) {
        if (generated) { unpriced.push({ category, sheet, sourceRow: r + 1, prayagCode: pc || null, generatedCode: ac }); coverageGaps[category] = (coverageGaps[category] ?? 0) + 1; }
        continue;
      }
      if (renamed !== ac) renames.push({ oldCode: ac, newCode: renamed, sheet, prayagCode: pc || null, status: "applied" });
      const out: ApolloMasterRow = { category, description, size, prayagCode: pc || null, competitorCode: renamed, codeSource: pipe ? "locally_assigned" : "supplier", price, sheet, sourceRow: r + 1 };
      rows.push(out);
      const key = renamed.toUpperCase();
      seenCodes.set(key, [...(seenCodes.get(key) ?? []), out]);
    }
  }
  const conflicts = [...seenCodes.entries()].flatMap(([competitorCode, list]) => {
    const prices = [...new Set(list.map(x => x.price))];
    return prices.length > 1 ? [{ competitorCode, prices, rows: list.map(x => ({ sheet: x.sheet, sourceRow: x.sourceRow })) }] : [];
  });
  for (const [code, list] of seenCodes) {
    if (list.length < 2) continue;
    const generated = list.some(r => r.codeSource === "locally_assigned");
    const differentPrices = new Set(list.map(r => r.price)).size > 1;
    if (generated || !differentPrices) throw new Error(`Duplicate Apollo competitor code across sheets: ${code}`);
  }
  return { rows, coverageGaps, unpriced, renames, conflicts, pipeCount: rows.filter(r => r.codeSource === "locally_assigned").length, fittingCount: rows.filter(r => r.codeSource === "supplier").length };
}

export type ApolloPlanState = { rows: ApolloMasterRow[] };
const appliedApolloStates = new WeakSet<object>();
/** Apply a parsed file to an in-memory plan; repeated application is idempotent. */
export function applyApolloPlan(state: ApolloPlanState, parsed: ApolloMasterParse): { created: number; updated: number; state: ApolloPlanState } {
  if (appliedApolloStates.has(state)) return { created: 0, updated: 0, state };
  const alreadyApplied = parsed.rows.every(incoming => state.rows.some(existing =>
    existing.sheet === incoming.sheet && existing.sourceRow === incoming.sourceRow &&
    existing.competitorCode === incoming.competitorCode && existing.price === incoming.price));
  if (alreadyApplied) return { created: 0, updated: 0, state };
  let created = 0, updated = 0;
  const existingRows = state.rows.slice();
  for (const incoming of parsed.rows) {
    const identity = incoming.codeSource === "supplier" ? incoming.competitorCode.toUpperCase() : apolloPipeIdentity(incoming.description, incoming.size);
    if (!identity) throw new Error(`Apollo row has no usable identity: ${incoming.sheet}:${incoming.sourceRow}`);
    // Prefer the source code when re-applying the same file.  Locally
    // assigned rows still match by description+size for revised Apollo files,
    // but this prevents duplicate identities within one master from causing
    // a later identical application to rewrite the first matching row.
    const found = existingRows.find(r => r.competitorCode.toUpperCase() === incoming.competitorCode.toUpperCase() && r.price === incoming.price)
      ?? existingRows.find(r => r.competitorCode.toUpperCase() === incoming.competitorCode.toUpperCase())
      ?? existingRows.find(r => (incoming.codeSource === "supplier" ? r.competitorCode.toUpperCase() : apolloPipeIdentity(r.description, r.size)) === identity);
    if (found) {
      const unchanged = (Object.keys(incoming) as Array<keyof ApolloMasterRow>).every(key => found[key] === incoming[key]);
      if (!unchanged) { Object.assign(found, incoming); updated++; }
    } else { state.rows.push({ ...incoming }); created++; }
  }
  appliedApolloStates.add(state);
  return { created, updated, state };
}

export const parseApolloWorkbook = parseApolloMaster;