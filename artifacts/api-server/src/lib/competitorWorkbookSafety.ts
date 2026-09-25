import * as XLSX from "xlsx";

const cleanCell = (value: unknown) => String(value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
const KNOWN_COMPETITOR_GROUPS = new Set([
  "prayag", "apollo", "prince", "ashirvad", "sparsh pearl", "astral", "finolex",
  "supreme", "truflo", "vectus", "avonplast", "ori plast", "water tec", "parryware",
]);

/**
 * Finds grouped competitor headers in the first three rows of any sheet.
 * These workbooks must never be sent through the generic first-numeric-column
 * parser: without an audited brand-specific parser it cannot safely isolate a
 * supplier's price/date columns.
 */
export function detectGroupedCompetitorBrands(workbook: XLSX.WorkBook): string[] {
  const brands = new Set<string>();
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: false,
      defval: null,
      range: 0,
    }).slice(0, 3);
    for (const row of rows) {
      const labels = row.map(cleanCell);
      const recognized = labels.filter((label) => KNOWN_COMPETITOR_GROUPS.has(label));
      // Some masters use a flat header ("Apollo Price", "Prince Price")
      // instead of a separate brand-group row. The generic first-price
      // heuristic is no safer for those workbooks.
      const qualified = [...KNOWN_COMPETITOR_GROUPS].filter((brand) =>
        brand !== "prayag" && labels.some((label) => {
          const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`).test(label) &&
            /\b(?:price|mrp|rate|cost|net|item code|date)\b/.test(label);
        }),
      );
      qualified.forEach((brand) => brands.add(brand));
      const hasPrayagReferenceGroup = labels.includes("prayag") &&
        labels.some((label) => label && label !== "prayag" && !["item code", "mrp", "price", "rate", "cost"].includes(label));
      if (recognized.length >= 2 || hasPrayagReferenceGroup) {
        recognized.forEach((label) => brands.add(label));
        if (hasPrayagReferenceGroup && recognized.length < 2) {
          brands.add(labels.find((label) => label === "prayag")!);
          const other = labels.find((label) => label && label !== "prayag" &&
            !["item code", "mrp", "price", "rate", "cost"].includes(label));
          if (other) brands.add(other);
        }
      }
    }
  }
  return [...brands].sort();
}

/**
 * Validates a generic single-brand workbook's extracted row dates against the
 * selected date. `null` means the workbook follows the established undated
 * single-brand contract and the supplied date remains authoritative.
 */
export function validateGenericWorkbookDate(
  sourceDates: Array<string | null | undefined>,
  selectedDate: string,
): string | null {
  const dates = [...new Set(sourceDates.filter((date): date is string => Boolean(date)))].sort();
  if (dates.length > 1) {
    throw new Error(`Workbook contains multiple competitor effective dates (${dates.join(", ")}); it cannot be staged as one brand period.`);
  }
  if (dates.length === 0) return null;
  const sourceDate = dates[0]!;
  if (sourceDate !== selectedDate) {
    throw new Error(`Selected effective date ${selectedDate} does not match the competitor date in the workbook ${sourceDate}. Upload refused.`);
  }
  return sourceDate;
}