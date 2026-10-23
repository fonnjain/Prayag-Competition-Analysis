// Calculator-only wrappers around the generated, contract-first SDK.
// The calculator is deliberately unscoped (P067 §5): no bucket keys, no saved selections.
import { useQuery } from "@tanstack/react-query";
import {
  getPriceFinderCalculatorRows, getPriceFinderDiscountDefaults,
  getGetPriceFinderCalculatorRowsQueryKey, getGetPriceFinderDiscountDefaultsQueryKey,
  getExportPriceFinderCalculatorUrl,
  getPriceCalculatorSearch, getGetPriceCalculatorSearchQueryKey,
  getPriceCalculatorCompetitors, getGetPriceCalculatorCompetitorsQueryKey,
} from "@workspace/api-client-react";
import { getAuthHeaders } from "@workspace/replit-auth-web";
import type { CalculatorEvidence, CalculatorBlock } from "@/lib/calculatorState";

export type CalculatorRowsResponse = {
  asOfDate: string;
  rows: CalculatorEvidence[];
  scopeDisclosure: string[];
  unavailableCodes: string[];
  catalogueCodes: string[];
};
export type DiscountDefault = { scope: string; discountPct: number };
export type CalculatorSearchParams = { q?: string; division?: string; category?: string; asOf?: string; limit?: number };

export function useCalculatorRows(codes: string[], asOf: string, enabled: boolean) {
  return useQuery({
    queryKey: getGetPriceFinderCalculatorRowsQueryKey({ code: codes, asOf }),
    enabled: enabled && codes.length > 0,
    queryFn: () => getPriceFinderCalculatorRows({ code: codes, asOf }) as Promise<CalculatorRowsResponse>,
  });
}

/** q is sent verbatim: no trim, no case-folding. Exact code resolution happens server-side. */
export function useCalculatorSearch(params: CalculatorSearchParams, enabled: boolean) {
  return useQuery({
    queryKey: getGetPriceCalculatorSearchQueryKey(params),
    enabled,
    staleTime: 30_000,
    queryFn: () => getPriceCalculatorSearch(params),
  });
}

/** Full competitor set, not only brands priced for one product. */
export function useCalculatorCompetitors(asOf: string, enabled: boolean) {
  const params = { asOf: asOf || undefined };
  return useQuery({
    queryKey: getGetPriceCalculatorCompetitorsQueryKey(params),
    enabled,
    staleTime: 60_000,
    queryFn: () => getPriceCalculatorCompetitors(params),
  });
}

/** Authenticated-only. Callers must pass enabled=false for anonymous viewers. */
export function useDiscountDefaults(userId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: [...getGetPriceFinderDiscountDefaultsQueryKey(), userId],
    enabled: enabled && !!userId,
    staleTime: 5 * 60 * 1000,
    retry: 1,
    queryFn: () => getPriceFinderDiscountDefaults(),
  });
}

/** POST transport only: the server re-resolves prices and writes nothing. */
export async function downloadCalculatorExport(asOf: string, blocks: CalculatorBlock[], format: "xlsx" | "pdf" = "xlsx"): Promise<void> {
  const res = await fetch(getExportPriceFinderCalculatorUrl(), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify({ asOf, blocks, format }),
  });
  if (!res.ok) throw new Error(`Export failed (HTTP ${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `prayag-price-calculator-${asOf}.${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
