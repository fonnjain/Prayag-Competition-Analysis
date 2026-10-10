import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import { resolveStoredCompetitorName } from "./competitorLoadName";
import { normalizeVocabularyKey } from "./priceEditorVocabulary";

export const PROTECTED_WORKBOOK_BRANDS = ["Apollo", "Ashirvad", "Prince", "Sparsh Pearl"];
export const WORKBOOK_LOADER_KIND = "multi-competitor-workbook-v1";
export const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const text = (v: unknown) => String(v ?? "").normalize("NFKC").trim().replace(/\s+/g, " ");
export const codeKey = (v: unknown) => text(v).replace(/\s+/g, "").toUpperCase();
const brandKey = (v: string) => {
  const key = normalizeVocabularyKey(v);
  return key === normalizeVocabularyKey("Ashirwad") ? normalizeVocabularyKey("Ashirvad") : key;
};
export function assertWorkbookScope(brands: string[]) {
  if (!brands.length || brands.length > 20 || brands.some(b => !text(b) || b.length > 100)) {
    throw new Error("Select between one and twenty workbook brands.");
  }
  const protectedKeys = new Set(PROTECTED_WORKBOOK_BRANDS.map(brandKey));
  if (brands.some(b => protectedKeys.has(brandKey(b)))) {
    throw new Error("This loader cannot modify Apollo, Ashirvad, Prince or Sparsh Pearl.");
  }
  if (new Set(brands.map(brandKey)).size !== brands.length) throw new Error("Duplicate normalized brand selection.");
}
export type WorkbookRow = {
  competitor: string; prayagCode: string; competitorCode: string; price: number;
  effectiveDate: string; unit: string; sheet: string; row: number; priceCell: string;
};
export type WorkbookRefusal = {
  sheet: string; row: number; competitor: string; prayagCode: string; competitorCode: string; reason: string;
};
export type WorkbookParse = {
  contentFingerprint: string; fileSha256: string; brands: string[]; sheets: string[];
  rows: WorkbookRow[]; refused: WorkbookRefusal[]; blockers: string[];
  unitSummary: {sheet: string; competitor: string; columns: string[]; units: string[]}[];
  nameResolutions: {requested: string; stored: string}[];
};

function dateHeader(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString().slice(0, 10);
  if (typeof value === "number" && value >= 20000 && value <= 100000) {
    const d = XLSX.SSF.parse_date_code(value);
    return d ? `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}` : null;
  }
  const s = text(value);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  const words = /^(\d{1,2})(?:st|nd|rd|th)?[\s,-]+([a-z]+)[\s,-]+(\d{4})$/i.exec(s);
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const candidate = iso ? s : words && months.includes(words[2]!.slice(0, 3).toLowerCase())
    ? `${words[3]}-${String(months.indexOf(words[2]!.slice(0, 3).toLowerCase()) + 1).padStart(2, "0")}-${words[1]!.padStart(2, "0")}` : null;
  return candidate && new Date(`${candidate}T00:00:00Z`).toISOString().slice(0, 10) === candidate ? candidate : null;
}

/** Grouped master workbook, not a filename/brand allowlist. Prices and dates
 * come exclusively from selected brands' own groups. Never evaluate formulas
 * or multiply/divide units. A formula needs its existing numeric XLSX cache. */
export function parseMultiCompetitorWorkbook(buffer: Buffer, selected: string[], storedNames: string[] = []): WorkbookParse {
  if (selected.length) assertWorkbookScope(selected);
  const workbook = XLSX.read(buffer, {type: "buffer", cellDates: true, cellFormula: true});
  const canonical = workbook.SheetNames.map(name => [name, Object.keys(workbook.Sheets[name]!)
    .filter(k => !k.startsWith("!")).sort().map(k => {
      const c = workbook.Sheets[name]![k]!;
      return [k, c.t, c.v instanceof Date ? c.v.toISOString() : c.v ?? null, c.f ?? null];
    }), workbook.Sheets[name]!["!merges"] ?? []]);
  const result: WorkbookParse = {contentFingerprint: hash(JSON.stringify(canonical)), fileSha256: hash(buffer),
    brands: [], sheets: workbook.SheetNames, rows: [], refused: [], blockers: [], unitSummary: [], nameResolutions: []};
  const seen = new Set<string>();
  const selectedKeys = new Set(selected.map(brandKey));
  let visited = 0;
  for (const name of workbook.SheetNames) {
    const ws = workbook.Sheets[name]!;
    const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
    if (range.e.r > 100000 || range.e.c > 500 || (range.e.r + 1) * (range.e.c + 1) > 2000000) {
      throw new Error("Workbook sheet exceeds the loader's safe size limits.");
    }
    const cell = (r: number, c: number) => ws[XLSX.utils.encode_cell({r, c})];
    let header = -1;
    for (let r = 1; r <= Math.min(10, range.e.r); r++) {
      if (Array.from({length: range.e.c + 1}, (_, c) => text(cell(r, c)?.v).toUpperCase()).includes("ITEM CODE")) {header = r; break;}
    }
    if (header < 0) {
      result.blockers.push(`${name}: no grouped ITEM CODE header; sheet cannot be silently skipped.`);
      continue;
    }
    const groups: {name: string; start: number; end: number}[] = [];
    for (let c = 0; c <= range.e.c; c++) {
      if (text(cell(header, c)?.v).toUpperCase() === "ITEM CODE" && text(cell(header - 1, c)?.v)) {
        if (groups.length) groups[groups.length - 1]!.end = c;
        groups.push({name: text(cell(header - 1, c)!.v), start: c, end: range.e.c + 1});
      }
    }
    const prayag = groups.find(g => normalizeVocabularyKey(g.name) === "prayag");
    if (!prayag) {result.blockers.push(`${name}: missing Prayag identity group.`); continue;}
    for (const g of groups.filter(g => g !== prayag)) if (!result.brands.includes(g.name)) result.brands.push(g.name);
    for (const g of groups.filter(g => g !== prayag && selectedKeys.has(brandKey(g.name)))) {
      visited++;
      const resolved = resolveStoredCompetitorName(g.name, storedNames).competitor;
      assertWorkbookScope([resolved]);
      if (resolved !== g.name && !result.nameResolutions.some(n => n.requested === g.name)) {
        result.nameResolutions.push({requested: g.name, stored: resolved});
      }
      const dated: {column: number; date: string}[] = [];
      for (let c = g.start + 1; c < g.end; c++) {
        const d = dateHeader(cell(header, c)?.v);
        if (d) dated.push({column: c, date: d});
      }
      if (!dated.length) {result.blockers.push(`${name}/${g.name}: missing own effective-date columns.`); continue;}
      if (new Set(dated.map(d => d.date)).size !== dated.length) {
        result.blockers.push(`${name}/${g.name}: duplicate date columns need explicit source correction.`); continue;
      }
      const isPipe = /\bpipe[s]?\s*$/i.test(name.trim());
      let length: number | null = null;
      const lengthColumns = Array.from({length: prayag.start}, (_, c) => c)
        .filter(c => /^length\s*\((?:mtr|m|metres?|meters?)\)$/i.test(text(cell(header, c)?.v)));
      const units = new Set<string>();
      for (let r = header + 1; r <= range.e.r; r++) {
        // Shared physical length descriptors are identity evidence, not prices.
        for (let c = 0; c < prayag.start; c++) {
          const m = /(\d+(?:\.\d+)?)\s*(?:mtr|metres?|meters?)\b/i.exec(text(cell(r, c)?.v));
          if (m && Number(m[1]) > 0) length = Number(m[1]);
        }
        // Some masters put a section length beside the Prayag code (PPR).
        if (!text(cell(r, prayag.start)?.v) || /mtr|metre|meter/i.test(text(cell(r, prayag.start + 1)?.v))) {
          for (let c = prayag.start; c < prayag.end; c++) {
            const m = /^(\d+(?:\.\d+)?)\s*(?:mtr|metres?|meters?)$/i.exec(text(cell(r, c)?.v));
            if (m) length = Number(m[1]);
          }
        }
        for (const c of lengthColumns) {
          const v = cell(r, c)?.v;
          if (typeof v === "number" && v > 0 && v <= 100) length = v;
        }
        const pc = text(cell(r, prayag.start)?.v), cc = text(cell(r, g.start)?.v);
        if (!pc && !cc) continue;
        for (const d of dated) {
          const priceCell = cell(r, d.column), value = priceCell?.v;
          const refusal = (reason: string) => result.refused.push({sheet: name, row: r + 1, competitor: resolved, prayagCode: pc, competitorCode: cc, reason});
          if (!cc) {if (value != null) refusal("Price without competitor code"); continue;}
          if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
            refusal(priceCell?.f ? "Uncached/invalid formula: no evaluation or conversion permitted" : "No positive numeric price");
            if (priceCell?.f) result.blockers.push(`${name}/${g.name}/${r + 1}: dated price formula has no numeric cache.`);
            continue;
          }
          if (!pc) {refusal("Missing Prayag code"); continue;}
          const unit = isPipe && length ? `per ${length}-m pipe` : isPipe ? null : "each";
          if (!unit) {refusal("Pipe length is not explicit in source"); result.blockers.push(`${name}/${r + 1}: unresolved pipe unit.`); continue;}
          const identity = `${resolved}|${codeKey(pc)}|${d.date}`;
          if (seen.has(identity)) {refusal("Duplicate brand/product/period"); result.blockers.push(`${name}/${r + 1}: duplicate product-period.`); continue;}
          seen.add(identity); units.add(unit);
          result.rows.push({competitor: resolved, prayagCode: pc, competitorCode: cc, price: value,
            effectiveDate: d.date, unit, sheet: name, row: r + 1, priceCell: XLSX.utils.encode_cell({r, c: d.column})});
        }
      }
      result.unitSummary.push({sheet: name, competitor: resolved, columns: dated.map(d => XLSX.utils.encode_col(d.column)), units: [...units].sort()});
    }
  }
  if (selected.some(b => !result.brands.some(g => brandKey(g) === brandKey(b)))) throw new Error("A selected brand is not in this workbook.");
  if (selected.length && !visited) throw new Error("No selected brand columns found.");
  result.blockers = [...new Set(result.blockers)];
  return result;
}
