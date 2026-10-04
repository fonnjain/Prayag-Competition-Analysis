import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useGetPriceFinderBrowse, useActiveBucket } from "@workspace/api-client-react";
import { useAuth } from "@workspace/replit-auth-web";
import { useLocation, useSearch } from "wouter";
import { localPriceFinderUrl, normalizePriceFinderParams } from "./priceFinderRouteState";
import type { PriceFinderBrowseResponse } from "@workspace/api-client-react";

interface BrowseContextValue {
  scopeKey: readonly unknown[];
  scopeReady: boolean;
  browseDivision: string | null;
  browseCategory: string | null;
  divisionsData: PriceFinderBrowseResponse | undefined;
  isDivisionsLoading: boolean;
  categoriesData: PriceFinderBrowseResponse | undefined;
  isCategoriesLoading: boolean;
  selectDivision: (div: string | null) => void;
  selectCategory: (cat: string | null) => void;
}

const BrowseContext = createContext<BrowseContextValue | null>(null);

export function BrowseProvider({ children }: { children: React.ReactNode }) {
  const [browseDivision, setBrowseDivision] = useState<string | null>(null);
  const [browseCategory, setBrowseCategory] = useState<string | null>(null);
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const { user, isLoading: isAuthLoading } = useAuth();
  const bucket = useActiveBucket(user?.id);
  const scopeReady = !isAuthLoading && (!user || bucket.scopeKey !== null);
  const scopeKey = [user?.id ?? "anonymous", bucket.scopeKey] as const;

  const { data: divisionsData, isLoading: isDivisionsLoading } = useGetPriceFinderBrowse(
    { limit: 300 },
    {
      query: {
        queryKey: ["price-finder-browse-divisions", ...scopeKey],
        enabled: scopeReady && !browseDivision,
        staleTime: 1000 * 60,
      },
    },
  );

  const { data: categoriesData, isLoading: isCategoriesLoading } = useGetPriceFinderBrowse(
    { division: browseDivision ?? undefined, limit: 300 },
    {
      query: {
        queryKey: ["price-finder-browse-categories", browseDivision, ...scopeKey],
        enabled: scopeReady && !!browseDivision,
        staleTime: 1000 * 60,
      },
    },
  );

  useEffect(() => {
    if (browseDivision && !browseCategory && categoriesData?.categories?.length) {
      const first = categoriesData.categories[0];
      setBrowseCategory(first.category ?? "__uncategorised__");
    }
  }, [browseDivision, browseCategory, categoriesData]);

  const selectDivision = useCallback((div: string | null) => {
    setBrowseDivision(div);
    setBrowseCategory(null);
    const currentParams = new URLSearchParams(searchString);
    const searchHref = localPriceFinderUrl(
      "/",
      normalizePriceFinderParams(currentParams, "search")
    );
    setLocation(searchHref);
  }, [searchString, setLocation]);

  const selectCategory = useCallback((cat: string | null) => {
    setBrowseCategory(cat);
    if (cat !== null) {
      const currentParams = new URLSearchParams(searchString);
      const searchHref = localPriceFinderUrl(
        "/",
        normalizePriceFinderParams(currentParams, "search")
      );
      setLocation(searchHref);
    }
  }, [searchString, setLocation]);

  return (
    <BrowseContext.Provider value={{
      browseDivision,
      scopeKey,
      scopeReady,
      browseCategory,
      divisionsData,
      isDivisionsLoading: !scopeReady || isDivisionsLoading,
      categoriesData,
      isCategoriesLoading: !scopeReady || isCategoriesLoading,
      selectDivision,
      selectCategory
    }}>
      {children}
    </BrowseContext.Provider>
  );
}

export function useBrowse() {
  const ctx = useContext(BrowseContext);
  if (!ctx) throw new Error("useBrowse must be used within BrowseProvider");
  return ctx;
}
