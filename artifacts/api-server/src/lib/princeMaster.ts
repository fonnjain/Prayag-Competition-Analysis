import { createHash } from "node:crypto";
import * as XLSX from "xlsx";

export const PRINCE_COMPETITOR = "Prince";
export const PRINCE_EFFECTIVE_DATE = "2026-03-01";
export const PRINCE_MASTER_SHA256 =
  "5338bb3bc49e07f7aa39f8f913559cac015c57ef265ba64ce23c4a02ba381b0c";
export const PRINCE_MASTER_ROW_COUNT = 813;

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
};

export type PrinceMasterParseResult = {
  rows: PrinceMasterRow[];
  catalogMatchedRows: PrinceMasterRow[];
  unmatchedRows: PrinceMasterRow[];
  unmatchedCodes: string[];
  sourceSha256: string;
  effectiveDate: string;
};

const clean = (value: unknown): string => String(value ?? "").trim();
export const normalizePrinceCode = (value: unknown): string =>
  clean(value).toUpperCase().replace(/\s+/g, "");

function numberCell(value: unknown): number | null {
  if (value == null || clean(value) === "" || clean(value) === "-") return null;
  const number = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(number) ? number : null;
}

function isPrinceDate(value: unknown): boolean {
  if (value instanceof Date) {
    return value.getUTCFullYear() === 2026 && value.getUTCMonth() === 2 && value.getUTCDate() === 1;
  }
  const text = clean(value).toLowerCase();
  if (text.includes("2026-03-01") || text.includes("1-mar-26") || text.includes("01-mar-26")) return true;
  if (typeof value === "number") {
    const date = XLSX.SSF.parse_date_code(value);
    return date?.y === 2026 && date.m === 3 && date.d === 1;
  }
  return false;
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
  if (sourceSha256 !== PRINCE_MASTER_SHA256) {
    throw new Error("Prince master checksum does not match the approved trusted snapshot.");
  }

  const rows: PrinceMasterRow[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });
    const layout = sheetLayout(sheetName);
    const hasDatedHeader = grid.slice(0, 3).flat().some(isPrinceDate);
    if (!hasDatedHeader) {
      throw new Error(`Prince sheet ${sheetName.trim()} has no dated 2026-03-01 price column.`);
    }
    for (const [sourceRowIndex, row] of grid.entries()) {
      const prayagCode = clean(row[layout.prayag]);
      const princeCode = clean(row[layout.prince]);
      const price = numberCell(row[layout.princePrice]);
      if (!princeCode && !prayagCode) continue;
      if (/^(prayag|prince|item code)$/i.test(princeCode) || /^(prayag|item code)$/i.test(prayagCode)) continue;
      if (!princeCode) continue; // PMR-5 is deliberately an unmapped Prayag row.
      if (price == null || price <= 0) {
        throw new Error(`Prince row ${sheetName.trim()} ${princeCode} has no positive dated price.`);
      }
      const canonical = canonicalCodes.get(normalizePrinceCode(prayagCode)) ?? null;
      const category = sheetName.trim();
      rows.push({
        sheet: category,
        category,
        prayagCode,
        princeCode,
        prayagPrice: numberCell(row[layout.prayagPrice]),
        price,
        prayagPriceBasis: "piece",
        princePriceBasis: "piece",
        lengthMeters: sheetLength(category, row, layout.length),
        catalogMatched: canonical != null,
        canonicalPrayagCode: canonical,
          sourceRow: sourceRowIndex + 1,
      });
    }
  }
  if (rows.length !== PRINCE_MASTER_ROW_COUNT) {
    throw new Error(`Prince master must contain exactly ${PRINCE_MASTER_ROW_COUNT} mapped rows; found ${rows.length}.`);
  }
  const unmatchedRows = rows.filter((row) => !row.catalogMatched);
  return {
    rows,
    catalogMatchedRows: rows.filter((row) => row.catalogMatched),
    unmatchedRows,
    unmatchedCodes: [...new Set(unmatchedRows.map((row) => row.prayagCode))].sort(),
    sourceSha256,
    effectiveDate: PRINCE_EFFECTIVE_DATE,
  };
}