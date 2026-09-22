const money = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

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