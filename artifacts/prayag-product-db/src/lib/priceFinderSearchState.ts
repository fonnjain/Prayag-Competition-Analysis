import type {
  PriceFinderSearchResponse,
  PriceFinderSearchResult,
} from "@workspace/api-client-react";

export type PriceFinderSearchDisplay = {
  results: PriceFinderSearchResult[];
  totalCount: number;
  unmatchedFilter: string | undefined;
};

export function getPriceFinderSearchDisplay(
  data: PriceFinderSearchResponse | undefined,
): PriceFinderSearchDisplay {
  return {
    results: data?.results ?? [],
    totalCount: data?.totalCount ?? 0,
    unmatchedFilter: data?.unmatchedFilters[0],
  };
}