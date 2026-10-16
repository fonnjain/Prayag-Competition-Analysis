/**
 * P045 Apollo master reader.  This is intentionally a pure workbook parser:
 * it never imports the database or mutates application state.
 */
import * as XLSX from "xlsx";
import { apolloPipeIdentityV2, reserveAPUGD007, assertApolloReservationOwner, type ApolloCodeReservation } from "./apolloPipeIdentity";

export type ApolloMasterRow = {
  category: string; description: string; size: string | null; prayagCode: string | null;
  competitorCode: string; codeSource: "supplier" | "locally_assigned"; price: number;
  sheet: string; sourceRow: number;
};
export type ApolloUnpricedGap = { category: string; sheet: string; sourceRow: number; prayagCode: string | null; generatedCode: string | null; description: string | null; size: string | null; owner: string | null };
export type ApolloPriceConflict = { competitorCode: string; prices: number[]; rows: Array<{ sheet: string; sourceRow: number }> };
export type ApolloRename = { oldCode: string; newCode: string; sheet: string; sourceRow?: number; prayagCode: string | null; status?: "applied" | "reserved_dropped" };
export type ApolloMasterParse = {
  rows: ApolloMasterRow[]; coverageGaps: Record<string, number>; unpriced: ApolloUnpricedGap[];
  renames: ApolloRename[]; conflicts: ApolloPriceConflict[]; pipeCount: number; fittingCount: number;
  reservations: ApolloCodeReservation[]; effectiveDate: string;
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
// XLSX.write re-materializes date-formatted headers as their Excel serial
// number (for example, 01 Aug 2026 becomes 46235).  Keep accepting those
// headers as dated Apollo price columns without changing column semantics.
const isDateHeader = (v: string) =>
  /^\d{1,2}(?:st|nd|rd|th)?\s+[a-z]{3}/i.test(v) || (/^\d{5}$/.test(v) && Number(v) >= 20000 && Number(v) <= 100000);

function parseApolloHeaderDate(value: unknown): string | null {
  const fromParts = (year: number, month: number, day: number) => {
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
      ? `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
      : null;
  };
  const fromExcelSerial = (serial: number): string | null => {
    if (!Number.isInteger(serial) || serial < 1 || serial > 100000) return null;
    const parts = XLSX.SSF.parse_date_code(serial);
    return parts ? fromParts(parts.y, parts.m, parts.d) : null;
  };
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return fromParts(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  }
  if (typeof value === "number") return fromExcelSerial(value);
  const text = clean(value);
  if (!text) return null;
  if (/^\d{5}$/.test(text)) return fromExcelSerial(Number(text));
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return fromParts(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const monthNumbers: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  };
  const monthWord = (month: string) => monthNumbers[month.slice(0, 3).toLowerCase()] ?? null;
  const dayFirst = text.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9}),?\s+(\d{4})$/i);
  if (dayFirst) {
    const month = monthWord(dayFirst[2]!);
    return month ? fromParts(Number(dayFirst[3]), month, Number(dayFirst[1])) : null;
  }
  const monthFirst = text.match(/^([a-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i);
  if (monthFirst) {
    const month = monthWord(monthFirst[1]!);
    return month ? fromParts(Number(monthFirst[3]), month, Number(monthFirst[2])) : null;
  }
  return null;
}

function workbook(input: ApolloInput): XLSX.WorkBook {
  if (typeof input === "object" && !(input instanceof Uint8Array) && !(input instanceof ArrayBuffer) && "SheetNames" in input) return input as XLSX.WorkBook;
  return XLSX.read(input as any, { type: typeof input === "string" ? "file" : "array", cellDates: false });
}

/** Parse the two-tier (Prayag/Apollo) master, locating Apollo columns by row 1 group. */
export function parseApolloMaster(input: ApolloInput): ApolloMasterParse {
  const book = workbook(input);
  const canonicalSheets = new Map<string, string>();
  for (const rawName of book.SheetNames) {
    const canonical = clean(rawName).normalize("NFC").toUpperCase();
    const existing = canonicalSheets.get(canonical);
    if (existing) throw new Error(`Ambiguous Apollo worksheet names: ${JSON.stringify(existing)} and ${JSON.stringify(rawName)}`);
    canonicalSheets.set(canonical, rawName);
  }
  const rows: ApolloMasterRow[] = [], unpriced: ApolloUnpricedGap[] = [];
  const coverageGaps: Record<string, number> = {};
  const renames: ApolloRename[] = [];
  const seenCodes = new Map<string, ApolloMasterRow[]>();
  const apolloSheetDates: Array<{ sheet: string; date: string }> = [];
  const summaryReservations = new Map<string, { oldCode: string; newCode: string; sheet: string; sourceRow: number }>();
  const summary = book.Sheets[book.SheetNames.find(s => /^P045 SUMMARY$/i.test(s)) ?? ""];
  if (summary) {
    const values = XLSX.utils.sheet_to_json(summary, { header: 1, raw: false, defval: null }) as unknown[][];
    const headerRow = values.findIndex(row => row.some(v => /old.*code|new.*code|source.*sheet/i.test(clean(v))));
    const headers = (values[headerRow < 0 ? 0 : headerRow] ?? []).map(clean);
    const find = (patterns: RegExp[]) => headers.findIndex(h => patterns.some(p => p.test(h)));
    const oldAt = find([/old.*code/i, /from/i]), newAt = find([/new.*code/i, /to/i]);
    const sheetAt = find([/source.*sheet/i, /^sheet$/i]), rowAt = find([/source.*row/i, /^row$/i]);
    if (oldAt >= 0 && newAt >= 0 && sheetAt >= 0 && rowAt >= 0) for (const row of values.slice((headerRow < 0 ? 0 : headerRow) + 1)) {
      const oldCode = clean(row[oldAt]), newCode = clean(row[newAt]), sheet = clean(row[sheetAt]);
      const sourceRow = Number(row[rowAt]);
      if (oldCode && newCode && sheet && Number.isInteger(sourceRow)) {
        const key = `${sheet.normalize("NFC").toUpperCase()}:${sourceRow}`;
        if (summaryReservations.has(key)) throw new Error(`Ambiguous Apollo summary reservation: ${JSON.stringify(sheet)} row ${sourceRow}`);
        summaryReservations.set(key, { oldCode, newCode, sheet, sourceRow });
      }
    }
  }
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
    if (apolloStarts.length !== 1) throw new Error(`Ambiguous Apollo price periods: ${sheet} has ${apolloStarts.length} Apollo column groups.`);
    const aStart = apolloStarts[0];
    // A combined master may place another competitor after Apollo. Never
    // inspect its price/date headers as part of Apollo's column group.
    const nextGroup = group.findIndex((label, index) => index > aStart && label.length > 0);
    const aEnd = nextGroup < 0 ? values[0].length : nextGroup;
    const aHeaders = headers.slice(aStart, aEnd);
    const codeOffset = aHeaders.findIndex(v => /^item code$/i.test(v));
    if (codeOffset < 0) throw new Error(`Malformed Apollo sheet grouping (Apollo code column missing): ${sheet}`);
    const apolloDateHeaders = aHeaders
      .map((header, offset) => ({ header, offset, date: parseApolloHeaderDate(values[1]?.[aStart + offset]) }))
      .filter((entry) => entry.offset > codeOffset && entry.date !== null);
    if (apolloDateHeaders.length > 1) {
      const dates = apolloDateHeaders.map((entry) => entry.date).join(", ");
      throw new Error(`Multiple Apollo price periods are not supported: ${sheet} contains Apollo date columns ${dates}.`);
    }
    // Some sheets put the actual dated Apollo price immediately after code;
    // casing/UGD/PPR put an MRP-per-metre marker there and the dated value
    // one column farther right.
    const priceOffset = aHeaders[codeOffset + 1] && /mrp\s*\(/i.test(aHeaders[codeOffset + 1])
      ? codeOffset + 2
      : aHeaders.findIndex((v, i) => i > codeOffset &&
        (/mrp|price|net|date/i.test(v) || isDateHeader(v)) && !/^item code$/i.test(v));
    if (codeOffset < 0 || priceOffset < 0) throw new Error(`Malformed Apollo sheet grouping (Apollo code/price missing): ${sheet}`);
    const sheetEffectiveDate = parseApolloHeaderDate(values[1]?.[aStart + priceOffset]);
    if (!sheetEffectiveDate) {
      const headerValue = clean(values[1]?.[aStart + priceOffset]) || "blank";
      throw new Error(`Apollo price date is missing or invalid at ${sheet} Apollo price header: ${JSON.stringify(headerValue)}.`);
    }
    apolloSheetDates.push({ sheet, date: sheetEffectiveDate });
    const aCode = aStart + codeOffset, aPrice = aStart + priceOffset;
    const prayagStart = group.findIndex(v => /^prayag$/i.test(v));
    const pStart = prayagStart < 0 ? 0 : prayagStart;
    const pEnd = prayagStart < 0 ? aStart : apolloStarts[0];
    const pHeaders = headers.slice(pStart, pEnd);
    const pCodeOffset = pHeaders.findIndex(v => /^item code$/i.test(v));
    const pCode = pCodeOffset < 0 ? -1 : pStart + pCodeOffset;
    const sizeCols = headers.map((h, i) => /size\s*\(mm\)|size|length|socket|variant/i.test(h) && i < aStart ? i : -1).filter(i => i >= 0);
    const coverageStatusCol = headers.findIndex(h => /^coverage status$/i.test(h));
    let activeHeading = "";
    for (let r = 2; r < values.length; r++) {
      const row = values[r] ?? [], ac = clean(row[aCode]), pc = pCode >= 0 ? clean(row[pCode]) : "";
      const price = number(row[aPrice]);
      const candidates = ac || pc;
      // Heading rows have text but no item code and no Apollo code.
      if (!ac && !pc && row.some(v => clean(v)) && !row.some(v => number(v) !== null)) {
        const text = row.slice(0, aStart).map(clean).filter(Boolean).join(" ");
        if (text) activeHeading = text;
        continue;
      }
      const pipe = PIPE.has(category);
      // In a reviewed workbook the generated code has already been cleared.
      // Only the explicit coverage marker distinguishes those rows from other
      // ordinary blank comparison rows in the original sheet.
      const finalDescription = [category.replace(/\s+PIPE$/i, ""), activeHeading].filter(Boolean).join(" - ");
      const size = sizeCols.map(i => clean(row[i])).filter(Boolean).join(" x ") || null;
      const summaryMapping = summaryReservations.get(`${clean(sheet).normalize("NFC").toUpperCase()}:${r + 1}`);
      if (pipe && coverageStatusCol >= 0 &&
          /coverage gap/i.test(clean(row[coverageStatusCol])) && price === null) {
        const mappedCode = summaryMapping?.newCode && /^APUGD007$/i.test(summaryMapping.newCode) ? "APUGD007" : null;
        unpriced.push({ category, sheet, sourceRow: r + 1, prayagCode: pc || null, generatedCode: mappedCode, description: finalDescription || null, size, owner: apolloPipeIdentityV2(category, pc, size) });
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
       if (renamed !== ac && price === null) renames.push({ oldCode: ac, newCode: renamed, sheet, sourceRow: r + 1, prayagCode: pc || null, status: "reserved_dropped" });
      if (price === null) {
        if (generated) {
          const generatedCode = renamed || ac;
          unpriced.push({ category, sheet, sourceRow: r + 1, prayagCode: pc || null, generatedCode, description: finalDescription || null, size, owner: apolloPipeIdentityV2(category, pc, size) });
          coverageGaps[category] = (coverageGaps[category] ?? 0) + 1;
        }
        continue;
      }
       if (renamed !== ac) renames.push({ oldCode: ac, newCode: renamed, sheet, sourceRow: r + 1, prayagCode: pc || null, status: "applied" });
       const out: ApolloMasterRow = { category, description: finalDescription, size, prayagCode: pc || null, competitorCode: renamed, codeSource: pipe ? "locally_assigned" : "supplier", price, sheet, sourceRow: r + 1 };
      rows.push(out);
      const key = renamed.toUpperCase();
      seenCodes.set(key, [...(seenCodes.get(key) ?? []), out]);
    }
  }
  const distinctApolloDates = [...new Set(apolloSheetDates.map(({ date }) => date))];
  if (distinctApolloDates.length !== 1) {
    throw new Error(`Multiple Apollo effective dates are not supported: ${apolloSheetDates.map(({ sheet, date }) => `${sheet}=${date}`).join("; ")}.`);
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
  const reservations: ApolloCodeReservation[] = [];
  const gap = unpriced.find(g => g.generatedCode === "APUGD007");
  if (gap?.owner) {
    if (!gap.prayagCode) throw new Error("APUGD007 reservation requires a Prayag code (U-11B)");
    reservations.push(reserveAPUGD007(gap.category, gap.prayagCode, gap.size, {
      prayagCode: gap.prayagCode, sheet: gap.sheet, sourceRow: gap.sourceRow,
    }));
  }
  return { rows, coverageGaps, unpriced, renames, conflicts, reservations, effectiveDate: distinctApolloDates[0]!, pipeCount: rows.filter(r => r.codeSource === "locally_assigned").length, fittingCount: rows.filter(r => r.codeSource === "supplier").length };
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
    const identity = incoming.codeSource === "supplier" ? incoming.competitorCode : apolloPipeIdentityV2(incoming.category, incoming.prayagCode, incoming.size);
    if (!identity) throw new Error(`Apollo row has no usable identity: ${incoming.sheet}:${incoming.sourceRow}`);
    // Prefer the source code when re-applying the same file.  Locally
    // assigned rows match by V2 category/code/size for revised Apollo files;
    // this prevents duplicate identities within one master from causing a
    // later identical application to rewrite the first matching row.
    const found = existingRows.find(r => r.competitorCode === incoming.competitorCode && r.price === incoming.price)
      ?? existingRows.find(r => r.competitorCode === incoming.competitorCode)
      ?? existingRows.find(r => (incoming.codeSource === "supplier" ? r.competitorCode : apolloPipeIdentityV2(r.category, r.prayagCode, r.size)) === identity);
    if (found) {
      const unchanged = (Object.keys(incoming) as Array<keyof ApolloMasterRow>).every(key => found[key] === incoming[key]);
      if (!unchanged) { Object.assign(found, incoming); updated++; }
    } else { state.rows.push({ ...incoming }); created++; }
  }
  appliedApolloStates.add(state);
  return { created, updated, state };
}

export const parseApolloWorkbook = parseApolloMaster;

/**
 * Integration boundary for a loader: call this before inserting or updating
 * an Apollo row.  It intentionally performs no persistence and allows the
 * reserved owner to become positively priced.
 */
export function assertApolloReservedAssignment(
  code: string,
  category: string | null | undefined,
  prayagCode: string | null | undefined,
  size: string | null | undefined,
  reservations: readonly ApolloCodeReservation[],
): void {
  const reservation = reservations.find(r => r.code === code);
  if (reservation) assertApolloReservationOwner(code, category, prayagCode, size, reservation);
}