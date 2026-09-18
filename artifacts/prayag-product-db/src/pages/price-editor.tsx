import { useState } from "react";
import { PriceCorrectionTab } from "./price-editor-correction";
import { ProductCreationTab } from "./price-editor-creation";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetCatalogProductsQueryKey, getGetCatalogFiltersQueryKey,
  getGetComparisonFiltersQueryKey, getGetPriceFinderBrowseQueryKey,
  getGetCatalogDataHealthQueryKey, getGetPriceFinderSearchQueryKey,
  getGetComparisonQueryKey, getGetPriceEditorProductQueryKey,
  getGetPriceEditorEditsQueryKey
} from "@workspace/api-client-react";

export function useEditorInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: getGetCatalogProductsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetCatalogFiltersQueryKey() });
    qc.invalidateQueries({ queryKey: getGetComparisonFiltersQueryKey() });
    qc.invalidateQueries({ queryKey: getGetPriceFinderBrowseQueryKey() });
    qc.invalidateQueries({ queryKey: getGetCatalogDataHealthQueryKey() });
    qc.invalidateQueries({ queryKey: getGetPriceFinderSearchQueryKey() });
    qc.invalidateQueries({ queryKey: getGetComparisonQueryKey() });
    qc.invalidateQueries({ queryKey: getGetPriceEditorProductQueryKey() });
    qc.invalidateQueries({ queryKey: getGetPriceEditorEditsQueryKey() });
  };
}

export default function PriceEditorPage() {
  const [tab, setTab] = useState("correction");

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-7">
      <header>
        <p className="text-xs font-bold uppercase tracking-[.14em] text-[#2d7c78]">Controlled correction</p>
        <h1 className="mt-1 text-3xl font-bold">Single-product price editor</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Find one catalogue product and change one price, or create a new Prayag product. This page cannot create competitors, and cannot change a price on a product it did not just create.
        </p>
      </header>

      <div className="flex flex-col space-y-6">
        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2 max-w-[400px]">
            <TabsTrigger value="correction">Correct price</TabsTrigger>
            <TabsTrigger value="creation">Create product</TabsTrigger>
          </TabsList>

          <div className={tab === "correction" ? "mt-6 block" : "hidden"}>
            <PriceCorrectionTab />
          </div>

          <div className={tab === "creation" ? "mt-6 block" : "hidden"}>
            <ProductCreationTab />
          </div>
        </Tabs>
      </div>
    </div>
  );
}
