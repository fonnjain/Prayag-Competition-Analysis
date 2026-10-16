import {
  selectedCodesFromParams,
  writeSelectedCodes,
} from "./selectionState.ts";

/**
 * Competitor brands are dynamic: the offered set comes from
 * GET /price-finder/competitors for the current selection. URL values are
 * carried through verbatim here and validated against the fetched list on
 * the comparison page (unknown / uncovered brands are dropped silently there).
 */
export type PriceFinderCompetitor = string;

/** Keep only URL competitors present in the fetched, covered list. */
export function filterAvailableCompetitors(
  requested: readonly string[],
  available: readonly string[],
): string[] {
  const allowed = new Set(available);
  return requested.filter((value) => allowed.has(value));
}

const KNOWN_PARAMS = new Set(["code", "filter", "competitor", "asOf"]);

function uniqueTrimmed(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  values.forEach((value) => {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    result.push(trimmed);
  });

  return result;
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function comparisonStateFromParams(params: URLSearchParams): {
  competitors: PriceFinderCompetitor[];
  asOf: string;
} {
  const competitors = uniqueTrimmed(params.getAll("competitor"));
  const asOf = params.get("asOf")?.trim() ?? "";

  return {
    competitors,
    asOf: isValidDate(asOf) ? asOf : "",
  };
}

export function normalizePriceFinderParams(
  source: URLSearchParams,
  route: "search" | "comparison",
): URLSearchParams {
  const next = new URLSearchParams();
  const codes = selectedCodesFromParams(source);
  const filters = uniqueTrimmed(source.getAll("filter"));
  const { competitors, asOf } = comparisonStateFromParams(source);

  codes.forEach((code) => next.append("code", code));
  filters.forEach((filter) => next.append("filter", filter));

  // Keep comparison choices on the search route so Back to Search followed by
  // Compare selected returns to the same context.
  if (route === "comparison" || source.has("competitor")) {
    competitors.forEach((competitor) => next.append("competitor", competitor));
  }
  if (asOf) next.set("asOf", asOf);

  return next;
}

export function updateComparisonParams(
  source: URLSearchParams,
  competitors: readonly PriceFinderCompetitor[],
  asOf: string,
): URLSearchParams {
  const next = normalizePriceFinderParams(source, "comparison");
  next.delete("competitor");
  competitors.forEach((competitor) => next.append("competitor", competitor));
  next.delete("asOf");
  if (isValidDate(asOf)) next.set("asOf", asOf);
  return next;
}

export function updateSelectedCodes(
  source: URLSearchParams,
  codes: string[],
): URLSearchParams {
  return writeSelectedCodes(source, codes);
}

export function localPriceFinderUrl(
  path: "/" | "/comparison",
  params: URLSearchParams,
): string {
  const query = params.toString();
  return `${path}${query ? `?${query}` : ""}`;
}

export function hasUnsupportedParams(params: URLSearchParams): boolean {
  return [...params.keys()].some((key) => !KNOWN_PARAMS.has(key));
}