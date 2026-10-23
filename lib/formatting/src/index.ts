export * from "./priceCalculator.ts";
export * from "./productSearch.ts";

const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Export metadata only: a raw saved name is never parsed as type information. */
export function formatBucketExportDisclosure(list: {
  name: string; type: "included" | "excluded"; count: number;
} | null): string {
  if (!list) return "Bucket lists: none applied";
  const type = list.type === "excluded" ? "Excluded" : "Included";
  const effect = list.type === "excluded"
    ? `${list.count} items hidden from results`
    : `only ${list.count} items shown`;
  return `Showing: List name: ${JSON.stringify(list.name)} · Type: ${type} · Effect: ${effect}`;
}

/** Prayag's approved Range divisions. Exact stored values only; no aliases. */
export const RANGE_DIVISIONS = [
  "CP Fittings / Faucets",
  "CP (QUAA / FERN)",
  "PTMT & Plastic Fittings",
] as const;

export function supportsCatalogRange(division: string | null | undefined): boolean {
  return RANGE_DIVISIONS.some(value => value === division);
}

/** Inserts a resolved Category; the master planner resolves non-Range series first. */
export function masterClassification(row: {
  itemCode: string; division: string; category?: string | null; series: string | null;
}): { category: string; seriesRange?: string | null } {
  if (!row.category?.trim()) {
    throw new Error(`Product ${row.itemCode}: a real Category is required before insertion; CP/PTMT Range cannot be used as Category.`);
  }
  return {
    category: row.category.trim(),
    ...(supportsCatalogRange(row.division) ? { seriesRange: row.series } : {}),
  };
}

const moneyWhole = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const count = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 0,
});

export type NullableNumber = number | null | undefined;
export type WorksheetLike = Record<string, unknown> & { "!ref"?: string };

export const excelIndianMoneyFormat = "[$₹-en-IN]##,##,##0.00";
export const excelIndianMoneyWholeFormat = "[$₹-en-IN]##,##,##0";
export const excelIndianCountFormat = "##,##,##0";

/**
 * Applies display formats without changing worksheet cell values. Columns are
 * zero-based, matching the arrays used to build SheetJS worksheets.
 */
export function applyIndianNumberFormats(
  worksheet: WorksheetLike,
  options: {
    moneyColumns?: number[];
    moneyWholeColumns?: number[];
    countColumns?: number[];
  },
): void {
  const ref = worksheet["!ref"];
  if (typeof ref !== "string") return;
  const match = ref.match(/^[A-Z]+(\d+):([A-Z]+)(\d+)$/);
  if (!match) return;
  const startRow = Number(match[1]);
  const endRow = Number(match[3]);
  const columnName = (index: number): string => {
    let result = "";
    let n = index + 1;
    while (n > 0) {
      const remainder = (n - 1) % 26;
      result = String.fromCharCode(65 + remainder) + result;
      n = Math.floor((n - 1) / 26);
    }
    return result;
  };
  const apply = (columns: number[] | undefined, format: string) => {
    for (const column of columns ?? []) {
      for (let row = startRow; row <= endRow; row++) {
        const cell = worksheet[`${columnName(column)}${row}`] as
          | { v?: unknown; z?: string }
          | undefined;
        if (cell && typeof cell.v === "number") cell.z = format;
      }
    }
  };
  apply(options.moneyColumns, excelIndianMoneyFormat);
  apply(options.moneyWholeColumns, excelIndianMoneyWholeFormat);
  apply(options.countColumns, excelIndianCountFormat);
}

/** Formats a rupee amount, preserving the application's no-value treatment. */
export function formatMoney(value: NullableNumber, empty = "—"): string {
  if (value == null || !Number.isFinite(value)) return empty;
  return money.format(value).replace("-₹", "₹-");
}

/** Formats a whole-rupee amount, preserving the application's no-value treatment. */
export function formatMoneyWhole(value: NullableNumber, empty = "—"): string {
  if (value == null || !Number.isFinite(value)) return empty;
  return moneyWhole.format(value).replace("-₹", "₹-");
}

/** Formats a count/quantity with Indian digit grouping. */
export function formatCount(value: NullableNumber, empty = "—"): string {
  return value == null || !Number.isFinite(value) ? empty : count.format(value);
}