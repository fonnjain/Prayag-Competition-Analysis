import { createHash } from "node:crypto";
import * as XLSX from "xlsx";

export const PRINCE_COMPETITOR = "Prince";
export const PRINCE_EFFECTIVE_DATE = "2026-03-01";
export const PRINCE_MASTER_SHA256 =
  "20a3c363e7d2b8fd3dab54563db8844ea738d492f95d4007da0f6ebb6ae5b89f";
export const PRINCE_CONTENT_FINGERPRINT =
  "2b5b79da680b5a9e386811ee3a845a461e91a58d5ea0943fd847609502beb7ff";
export const PRINCE_MASTER_ROW_COUNT = 950;
const PRINCE_REQUIRED_SHEETS = new Set([
  "CPVC PIPE", "CPVC FITTINGS", "UPVC PIPE", "UPVC FITTINGS", "AGRI PIPE",
  "AGRI FITTINGS", "AGRI SMART FITTINGS", "SWR PIPE", "SWR FITTINGS",
  "CASING PIPE", "UGD PIPE", "PPR PIPE", "PPR FITTINGS",
]);
const PRINCE_EFFECTIVE_DATE_BY_SHEET = new Map(
  [...PRINCE_REQUIRED_SHEETS].map((sheet) => [
    sheet,
    sheet === "PPR PIPE" || sheet === "PPR FITTINGS" ? "2026-08-18" : PRINCE_EFFECTIVE_DATE,
  ]),
);
export function isPrinceCompetitorMasterWorkbook(workbook: XLSX.WorkBook): boolean {
  const sheets = new Set(workbook.SheetNames.map((name) => name.trim().toUpperCase()));
  const requiredFound = [...PRINCE_REQUIRED_SHEETS].filter((name) => sheets.has(name)).length;
  if (requiredFound === 0) return false;
  if (requiredFound !== PRINCE_REQUIRED_SHEETS.size) {
    throw new Error(`Prince-like workbook is incomplete: found ${requiredFound} of 13 required worksheets.`);
  }
  const unexpected = [...sheets].filter((name) => !PRINCE_REQUIRED_SHEETS.has(name));
  if (unexpected.length) {
    throw new Error(`Prince master contains unexpected worksheets: ${unexpected.join(", ")}.`);
  }
  return true;
}

export type PrinceMasterRow = {
  sheet: string;
  category: string;
  prayagCode: string;
  princeCode: string;
  prayagPrice: number | null;
  price: number;
  prayagPriceBasis: "piece";
  princePriceBasis: "piece";
  lengthMeters: number | null;
  catalogMatched: boolean;
  canonicalPrayagCode: string | null;
  /** 1-based source row, retained to pair duplicate codes deterministically. */
  sourceRow: number;
  effectiveDate: string;
};

export type PrinceMasterParseResult = {
  rows: PrinceMasterRow[];
  catalogMatchedRows: PrinceMasterRow[];
  unmatchedRows: PrinceMasterRow[];
  unmatchedCodes: string[];
  sourceSha256: string;
  contentFingerprint: string;
  priceSum: number;
  worksheetDiagnostics: Array<{ sheet: string; prayagCodes: number; princePriced: number }>;
  exactMatches: number;
  normalizedMatches: number;
  rejectedRows: Array<{ sheet: string; sourceRow: number; prayagCode: string; princeCode: string; price: number | null; reason: string }>;
  effectiveDate: string;
  worksheetNames: string[];
  effectiveDates: Array<{ sheet: string; effectiveDate: string }>;
};

export type PrinceDuplicateAnomaly = {
  competitorCode: string;
  prayagCodes: string[];
  sourceRows: number[];
};

/**
 * Trusted workbooks can contain a legitimate one-code/many-variant mapping,
 * but it must be adjudicated explicitly.  Keep this classifier independent
 * from workbook row numbers so reloads can apply durable decisions.
 */
export function classifyPrinceDuplicateAnomalies(
  rows: PrinceMasterRow[],
  confirmedCompetitorCodes: ReadonlySet<string> = new Set(),
): Map<string, { status: "ok" | "needs_review"; reason: string | null; confirmedByDecision: boolean }> {
  const groups = new Map<string, PrinceMasterRow[]>();
  for (const row of rows) {
    const code = normalizePrinceCode(row.princeCode);
    const group = groups.get(code) ?? [];
    group.push(row);
    groups.set(code, group);
  }
  const result = new Map<string, { status: "ok" | "needs_review"; reason: string | null; confirmedByDecision: boolean }>();
  for (const [code, group] of groups) {
    const prayagCodes = [...new Set(group.map((row) => row.canonicalPrayagCode ?? row.prayagCode))];
    if (prayagCodes.length < 2) continue;
    const confirmed = confirmedCompetitorCodes.has(code);
    for (const row of group) {
      result.set(`${code}|${normalizePrinceCode(row.canonicalPrayagCode ?? row.prayagCode)}`, {
        status: confirmed ? "ok" : "needs_review",
        reason: confirmed
          ? "Duplicate anomaly adjudicated: confirmed_by_decision; staging anomaly flag cleared."
          : `Duplicate anomaly: ${code} maps to multiple Prayag codes (${prayagCodes.join(", ")}).`,
        confirmedByDecision: confirmed,
      });
    }
  }
  return result;
}

const clean = (value: unknown): string => String(value ?? "").trim();
export const normalizePrinceCode = (value: unknown): string =>
  clean(value).toUpperCase().replace(/[^A-Z0-9]/g, "");

function numberCell(value: unknown): number | null {
  if (value == null || clean(value) === "" || clean(value) === "-") return null;
  const number = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(number) ? number : null;
}

function dateValue(value: unknown): string | null {
  if (value instanceof Date || Object.prototype.toString.call(value) === "[object Date]") {
    const date = value as Date;
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
  }
  const text = clean(value).toLowerCase();
  if (/2026[-/ ]03[-/ ]01|2026.*mar.*01|01.*mar.*2026/i.test(text)) return "2026-03-01";
  if (typeof value === "number") {
    const date = XLSX.SSF.parse_date_code(value);
    return date ? `${date.y}-${String(date.m).padStart(2, "0")}-${String(date.d).padStart(2, "0")}` : null;
  }
  const parsedTextDate = Date.parse(text);
  if (Number.isFinite(parsedTextDate)) {
    const parsed = new Date(parsedTextDate);
    return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, "0")}-${String(parsed.getUTCDate()).padStart(2, "0")}`;
  }
  return null;
}

function sheetLayout(sheetName: string) {
  const name = sheetName.trim().toUpperCase();
  if (name === "SWR PIPE") return { prayag: 5, prayagPrice: 6, prince: 7, princePrice: 8, length: 2 };
  if (name === "CASING PIPE" || name === "UGD PIPE") {
    return { prayag: 2, prayagPrice: 4, prince: 5, princePrice: 7, length: null };
  }
  if (name === "AGRI FITTINGS") return { prayag: 2, prayagPrice: 3, prince: 4, princePrice: 5, length: null };
  if (name === "AGRI SMART FITTINGS") return { prayag: 1, prayagPrice: 2, prince: 3, princePrice: 4, length: null };
  if (name === "AGRI PIPE") return { prayag: 2, prayagPrice: 3, prince: 4, princePrice: 5, length: null };
  if (name === "PPR PIPE") return { prayag: 2, prayagPrice: 4, prince: 5, princePrice: 7, length: null };
  if (name === "PPR FITTINGS") return { prayag: 3, prayagPrice: 4, prince: 5, princePrice: 6, length: null };
  return { prayag: 3, prayagPrice: 4, prince: 5, princePrice: 6, length: null };
}

function sheetLength(sheetName: string, row: unknown[], lengthColumn: number | null): number | null {
  if (lengthColumn != null) {
    const value = numberCell(row[lengthColumn]);
    if (value != null && value > 0) return value;
  }
  const text = `${sheetName} ${row.map(clean).join(" ")}`.toLowerCase();
  if (/\bcasing\b/.test(text)) return 3;
  if (/\bugd\b/.test(text)) return 6;
  if (/\bagri\s+pipe\b/.test(text)) return 6;
  const match = text.match(/(\d+(?:\.\d+)?)\s*(?:mtr|meter|metre|meters|metres)\b/);
  return match ? Number(match[1]) : null;
}

/**
 * Parses the locked Prince mapping workbook. This is intentionally a
 * code-to-code parser, not the generic price-sheet parser: column positions
 * differ by sheet and casing/UGD carry both per-metre and dated piece prices.
 * The workbook checksum and dated header are part of the trusted source
 * contract; callers may stage unmatched Prayag codes but must not infer them.
 */
export function parsePrinceCompetitorMaster(
  buffer: Buffer,
  workbook: XLSX.WorkBook,
  canonicalCodes: Map<string, string>,
): PrinceMasterParseResult {
  const sourceSha256 = createHash("sha256").update(buffer).digest("hex");
  const rows: PrinceMasterRow[] = [];
  const worksheetDiagnostics: Array<{ sheet: string; prayagCodes: number; princePriced: number }> = [];
  const rejectedRows: PrinceMasterParseResult["rejectedRows"] = [];
  const sourceSheets = workbook.SheetNames.filter((name) => PRINCE_REQUIRED_SHEETS.has(name.trim().toUpperCase()));
  if (workbook.SheetNames.length !== 13 || sourceSheets.length !== PRINCE_REQUIRED_SHEETS.size) {
    throw new Error(`Prince master must contain all 13 required worksheets; found ${sourceSheets.length}. Worksheets: ${workbook.SheetNames.join(", ")}`);
  }
  const effectiveDates: Array<{ sheet: string; effectiveDate: string }> = [];
  for (const sheetName of sourceSheets) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });
    const layout = sheetLayout(sheetName);
    // These positions are the audited Prince workbook contract.  In
    // particular, casing/UGD have both per-metre and dated piece prices;
    // scanning numeric cells can silently select the former.
    const princePrice = layout.princePrice;
    const headerDate = dateValue(grid[1]?.[princePrice]);
    const expectedDate = PRINCE_EFFECTIVE_DATE_BY_SHEET.get(sheetName.trim().toUpperCase());
    if (!headerDate || headerDate !== expectedDate) {
      throw new Error(
        `Prince sheet ${sheetName.trim()} must use effective date ${expectedDate} at audited position ${princePrice}; found ${headerDate ?? "none"}.`,
      );
    }
    effectiveDates.push({ sheet: sheetName.trim(), effectiveDate: headerDate });
    const prince = layout.prince;
    const headerRow = Math.max(0, grid.findIndex((row) => row.some((cell, col) => col === prince && /item\s*code/i.test(clean(cell)))));
    const codeHeaders = (grid[headerRow] ?? []).flatMap((cell, col) => /item\s*code/i.test(clean(cell)) ? [col] : []);
    const prayag = layout.prayag;
    const counts = { sheet: sheetName.trim(), prayagCodes: 0, princePriced: 0 };
    for (const [sourceRowIndex, row] of grid.entries()) {
      if (sourceRowIndex <= headerRow) continue;
      const prayagCode = clean(row[prayag]);
      const princeCode = clean(row[prince]);
      const price = numberCell(row[princePrice]);
      if (!princeCode && !prayagCode) continue;
      if (/^(prayag|prince|item code)$/i.test(princeCode) || /^(prayag|item code)$/i.test(prayagCode)) continue;
      if (prayagCode) counts.prayagCodes++;
      if (princeCode && price != null) counts.princePriced++;
      if (!princeCode && (price === 0 || price == null) && prayagCode === "PMR-5") {
        rejectedRows.push({ sheet: sheetName.trim(), sourceRow: sourceRowIndex + 1, prayagCode, princeCode, price, reason: "PMR-5 has no Prince code and its zero price is explicitly rejected." });
        continue;
      }
      if (!princeCode) continue;
      if (price == null || price <= 0) {
        rejectedRows.push({ sheet: sheetName.trim(), sourceRow: sourceRowIndex + 1, prayagCode, princeCode, price, reason: "Prince price must be positive." });
        continue;
      }
      if (normalizePrinceCode(princeCode) === "SIM200032") {
        rejectedRows.push({ sheet: sheetName.trim(), sourceRow: sourceRowIndex + 1, prayagCode, princeCode, price, reason: "SIM200032 has conflicting Prince prices; both rows are rejected." });
        continue;
      }
      const canonical = canonicalCodes.get(normalizePrinceCode(prayagCode)) ?? null;
      const category = sheetName.trim();
      rows.push({
        sheet: category,
        category,
        prayagCode,
        princeCode,
        // Deliberately do not consume the stale Prayag price column.
        prayagPrice: null,
        price,
        prayagPriceBasis: "piece",
        princePriceBasis: "piece",
        lengthMeters: sheetLength(category, row, layout.length),
        catalogMatched: canonical != null,
        canonicalPrayagCode: canonical,
        sourceRow: sourceRowIndex + 1,
        effectiveDate: headerDate,
      });
    }
    worksheetDiagnostics.push(counts);
  }
  const diagnostics = worksheetDiagnostics.map((row) => `${row.sheet}: ${row.prayagCodes}/${row.princePriced}`).join(", ");
  const unmatchedRows = rows.filter((row) => !row.catalogMatched);
  const lines = [
    ...rows.map((row) => `${normalizePrinceCode(row.prayagCode)}|${normalizePrinceCode(row.princeCode)}|${row.price.toFixed(2)}`),
    ...rejectedRows.filter((row) => row.princeCode && row.price != null && row.price > 0)
      .map((row) => `${normalizePrinceCode(row.prayagCode)}|${normalizePrinceCode(row.princeCode)}|${row.price!.toFixed(2)}`),
  ].sort();
  const contentFingerprint = createHash("sha256").update(lines.join("\n"), "utf8").digest("hex");
  const priceSum = lines.reduce((sum, line) => sum + Number(line.slice(line.lastIndexOf("|") + 1)), 0);
  if (contentFingerprint !== PRINCE_CONTENT_FINGERPRINT) {
    throw new Error(`Prince content fingerprint mismatch: computed ${contentFingerprint}; row count ${lines.length}; price sum ${priceSum.toFixed(2)}; worksheets ${JSON.stringify(worksheetDiagnostics)}`);
  }
  const classified = [
    ...rows.map((row) => ({ prayagCode: row.prayagCode, canonical: row.canonicalPrayagCode })),
    ...rejectedRows.map((row) => ({ prayagCode: row.prayagCode, canonical: canonicalCodes.get(normalizePrinceCode(row.prayagCode)) ?? null })),
  ];
  const exactMatches = classified.filter((row) => row.canonical != null && clean(row.prayagCode).toUpperCase() === clean(row.canonical).toUpperCase()).length;
  return {
    rows,
    catalogMatchedRows: rows.filter((row) => row.catalogMatched),
    unmatchedRows,
    unmatchedCodes: [...new Set(unmatchedRows.map((row) => row.prayagCode).filter(Boolean))].sort(),
    sourceSha256,
    contentFingerprint,
    priceSum,
    worksheetDiagnostics,
    exactMatches,
    normalizedMatches: classified.filter((row) => row.canonical != null).length - exactMatches,
    rejectedRows,
    effectiveDate: PRINCE_EFFECTIVE_DATE,
    worksheetNames: sourceSheets.map((name) => name.trim()),
    effectiveDates,
  };
}