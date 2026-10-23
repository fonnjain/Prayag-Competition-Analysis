/** Shared Price Finder ranking. Normalisation is a suggestion/ranking signal
 * only: callers must use raw stored-code equality to establish identity.
 * This module owns no scope, bucket, authentication or price eligibility rules.
 */
export const PRODUCT_SEARCH_FIELDS = ["item_code", "product_name", "division", "category", "size"] as const;
/** Fits realistic catalogue families without adding a paging interaction.
 * The caller still discloses totalCount when a family exceeds this ceiling.
 */
export const CALCULATOR_SEARCH_LIMIT = 300;

export function productSearchResultNotice(shown: number, total: number): string {
  return total > shown
    ? `Showing the first ${shown} of ${total} matching products — refine your search.`
    : `Showing all ${total} matching products.`;
}
export type ProductSearchRow = {
  item_code: string;
  product_name: string | null;
  division: string | null;
  category: string | null;
  size?: string | null;
};

export function normaliseProductSearch(value: string): string {
  return value.toLowerCase().replace(/[\s\-_.]/g, "");
}

const SPOKEN_NUMBERS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40,
  fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

function normaliseSpokenQuery(value: string): string {
  const text = value.toLowerCase().replace(/\b(?:dash|hyphen)\b/g, "-")
    .replace(/\bone and a half inch(?:es)?\b/g, '1.5"');
  const tokens = text.split(/\s+/).filter(Boolean);
  const output: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    if (!(tokens[i] in SPOKEN_NUMBERS) && tokens[i] !== "hundred") {
      output.push(tokens[i++]);
      continue;
    }
    const phrase: string[] = [];
    while (i < tokens.length &&
      (tokens[i] in SPOKEN_NUMBERS || tokens[i] === "hundred" || tokens[i] === "and")) {
      if (tokens[i] !== "and") phrase.push(tokens[i]);
      i++;
    }
    if (phrase.length === 0) continue;
    const values = phrase.map(token => token === "hundred" ? 100 : SPOKEN_NUMBERS[token]);
    let number = 0;
    if (values.length === 3 && values[0] < 10 && values[1] >= 20 && values[2] < 10) {
      number = values[0] * 100 + values[1] + values[2];
    } else {
      let current = 0;
      for (const part of values) {
        if (part === 100) {
          current = (current || 1) * 100;
          number += current;
          current = 0;
        } else {
          current += part;
        }
      }
      number += current;
    }
    output.push(String(number));
  }
  return output.join(" ");
}

const FILTER_FILLER = /\b(?:show me|find|what is the price of|what's the price of|ka price|wala)\b/gi;
export function productSearchVariants(value: string): string[] {
  const raw = value.trim().toLowerCase();
  const cleaned = raw.replace(FILTER_FILLER, " ").replace(/\s+/g, " ").trim();
  const spoken = normaliseSpokenQuery(cleaned);
  const variants = [raw, cleaned, spoken];
  if (cleaned.includes("half inch")) {
    variants.push(cleaned.replace(/\bhalf inch\b/g, '½"'));
    variants.push(cleaned.replace(/\bhalf inch\b/g, "0.5 inch"));
  }
  if (cleaned.includes("three quarter")) {
    variants.push(cleaned.replace(/\bthree quarter\b/g, '¾"'));
    variants.push(cleaned.replace(/\bthree quarter\b/g, "0.75 inch"));
  }
  const synonymVariants = [...variants];
  for (const variant of variants) {
    if (/\btap\b/.test(variant)) synonymVariants.push(variant.replace(/\btap\b/g, "cock"));
    if (/\bptmt\b/.test(variant)) synonymVariants.push(variant.replace(/\bptmt\b/g, "ptmt & plastic fittings"));
    if (/\bss\b/.test(variant)) synonymVariants.push(variant.replace(/\bss\b/g, "stainless steel"));
  }
  return synonymVariants.filter((candidate, index, all) => candidate && all.indexOf(candidate) === index);
}

export function productSearchScore(row: ProductSearchRow, query: string): number {
  const queries = productSearchVariants(query);
  const code = normaliseProductSearch(row.item_code);
  const name = normaliseProductSearch(row.product_name ?? "");
  const division = normaliseProductSearch(row.division ?? "");
  const category = normaliseProductSearch(row.category ?? "");
  const size = normaliseProductSearch(row.size ?? "");
  return Math.max(...queries.map(candidate => {
    const q = normaliseProductSearch(candidate);
    if (code === q) return 1000;
    if (code.startsWith(q)) return 900 - Math.min(code.length, 100) / 100;
    if (code.includes(q)) return 800 - Math.min(code.indexOf(q), 100) / 100;
    if (name.startsWith(q)) return 700;
    if (name.includes(q)) return 600 - Math.min(name.indexOf(q), 100) / 100;
    if (division.includes(q)) return 550 - Math.min(division.indexOf(q), 100) / 100;
    if (category.startsWith(q)) return 500;
    if (category.includes(q)) return 400 - Math.min(category.indexOf(q), 100) / 100;
    if (size.includes(q)) return 350 - Math.min(size.indexOf(q), 100) / 100;
    return 0;
  }));
}

/** Preserves Price Finder's positive-score filter and numeric-aware tie order.
 * No-query browse keeps its caller's explicit catalogue order.
 */
export function rankProductSearchRows<T extends ProductSearchRow>(rows: readonly T[], filters: readonly string[]): T[] {
  if (!filters.length) return [...rows];
  return rows.map(row => ({
    row, score: filters.reduce((total, filter) => total + productSearchScore(row, filter), 0),
  })).filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.row.item_code.localeCompare(b.row.item_code, undefined, { numeric: true }))
    .map(({ row }) => row);
}
