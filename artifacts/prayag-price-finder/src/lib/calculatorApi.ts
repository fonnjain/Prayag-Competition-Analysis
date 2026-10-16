// Scope/auth-specific cache keys wrap the generated, contract-first SDK.
import { useQuery } from "@tanstack/react-query";
import {
  getPriceFinderCalculatorRows, getPriceFinderDiscountDefaults,
  getGetPriceFinderCalculatorRowsQueryKey, getGetPriceFinderDiscountDefaultsQueryKey,
  getExportPriceFinderCalculatorUrl,
} from "@workspace/api-client-react";
import { getAuthHeaders } from "@workspace/replit-auth-web";
import type { CalculatorEvidence, CalculatorBlock } from "@/lib/calculatorState";

export type CalculatorRowsResponse = {
  asOfDate: string;
  rows: CalculatorEvidence[];
  scopeDisclosure: string[];
  unavailableCodes: string[];
};
export type DiscountDefault = { scope: string; discountPct: number };

export function useCalculatorRows(
  codes: string[],
  asOf: string,
  scopeKey: readonly unknown[],
  enabled: boolean,
) {
  return useQuery({
    queryKey: [...getGetPriceFinderCalculatorRowsQueryKey({ code: codes, asOf }), ...scopeKey],
    enabled: enabled && codes.length > 0,
    // Never carry previous prices across an as-of or restrictive-scope change.
    queryFn: () => getPriceFinderCalculatorRows({ code: codes, asOf }),
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
export async function downloadCalculatorExport(asOf: string, blocks: CalculatorBlock[]): Promise<void> {
  const res = await fetch(getExportPriceFinderCalculatorUrl(), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify({ asOf, blocks }),
  });
  if (!res.ok) throw new Error(`Export failed (HTTP ${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `prayag-price-calculator-${asOf}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
