import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Search,
  Mic,
  MicOff,
  ChevronRight,
  Info,
  AlertCircle,
  X,
  Tag,
  Volume2,
  VolumeX,
  TrendingUp,
  TrendingDown,
  Minus,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { PriceWindowDetails } from "@/components/price-window";
import { buildSpokenPriceSummary } from "@/lib/priceSpeech";
import { getPriceFinderSearchDisplay } from "@/lib/priceFinderSearchState";
import {
  useGetPriceFinderBrowse,
  useGetPriceFinderProduct,
  useGetPriceFinderSearch,
  type PriceFinderCompetitor,
  type PriceFinderSearchResult,
} from "@workspace/api-client-react";

/** Compact one-line competitor price indicator for list rows */
function CompetitorLine({
  brand,
  price,
  gapPct,
  className,
}: {
  brand: string | null | undefined;
  price: number | null | undefined;
  gapPct: number | null | undefined;
  className?: string;
}) {
  if (!brand || price == null) return null;

  const absGap = gapPct != null ? Math.abs(gapPct) : null;
  const cheaper = gapPct != null && gapPct > 0.05;
  const costlier = gapPct != null && gapPct < -0.05;

  return (
    <span
      className={cn(
        "mt-1 flex items-center gap-1 text-xs font-medium",
        cheaper
          ? "text-emerald-700"
          : costlier
            ? "text-amber-700"
            : "text-muted-foreground",
        className,
      )}
    >
      {cheaper ? (
        <TrendingDown className="w-3 h-3 shrink-0" />
      ) : costlier ? (
        <TrendingUp className="w-3 h-3 shrink-0" />
      ) : (
        <Minus className="w-3 h-3 shrink-0" />
      )}
      <span>
        {brand} ₹{price.toFixed(0)}
        {absGap != null && absGap >= 0.05 && (
          <span className="ml-1 opacity-80">
            · Prayag {absGap.toFixed(1)}% {cheaper ? "cheaper" : "costlier"}
          </span>
        )}
        {absGap != null && absGap < 0.05 && (
          <span className="ml-1 opacity-70">· parity</span>
        )}
      </span>
    </span>
  );
}

function useVoiceSearch(
  onFinalResult: (text: string) => void,
  onTranscript: (text: string) => void,
) {
  const [isListening, setIsListening] = useState(false);
  const [supported, setSupported] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setSupported(false);
      return;
    }
    
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-IN";

    recognition.onresult = (event: any) => {
      let finalTranscript = '';
      let interimTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          interimTranscript += event.results[i][0].transcript;
        }
      }
      
      if (interimTranscript) onTranscript(interimTranscript);
      
      if (finalTranscript) {
        onFinalResult(finalTranscript);
        setError(null);
        setIsListening(false);
        recognition.stop();
      }
    };

    recognition.onerror = (event: any) => {
      setError(
        event.error === "not-allowed"
          ? "Microphone permission is blocked. You can continue with text search."
          : event.error === "no-speech"
            ? "No speech detected. Try again or type the product."
            : "Voice search is unavailable right now. You can continue with text search.",
      );
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
    };
  }, [onFinalResult, onTranscript]);

  const toggle = useCallback(() => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
    } else {
      try {
        setError(null);
        recognitionRef.current?.start();
        setIsListening(true);
      } catch (e) {
        setError("Voice search could not start. You can continue with text search.");
      }
    }
  }, [isListening]);

  return { isListening, supported, error, toggle };
}

export default function PriceFinderPage() {
  const [searchInput, setSearchInput] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [filters, setFilters] = useState<string[]>(() =>
    new URLSearchParams(window.location.search).getAll("filter").filter(Boolean),
  );
  const [selectedItemCode, setSelectedItemCode] = useState<string | null>(null);
  const [browseDivision, setBrowseDivision] = useState<string | null>(null);
  const [browseCategory, setBrowseCategory] = useState<string | null>(null);
  const [selectionSequence, setSelectionSequence] = useState(0);
  const [speechRequested, setSpeechRequested] = useState(false);
  const [speechAvailable, setSpeechAvailable] = useState(false);
  const [speechEnabled, setSpeechEnabled] = useState(false);

  const cancelSpeech = useCallback(() => {
    if (
      typeof window !== "undefined" &&
      typeof window.speechSynthesis?.cancel === "function"
    ) {
      window.speechSynthesis.cancel();
    }
  }, []);

  useEffect(() => {
    const available =
      typeof window !== "undefined" &&
      typeof window.speechSynthesis?.speak === "function" &&
      typeof window.SpeechSynthesisUtterance === "function";
    setSpeechAvailable(available);
    if (available) {
      setSpeechEnabled(
        window.localStorage.getItem("prayag-price-finder-speech-enabled") === "true",
      );
    }
    return cancelSpeech;
  }, [cancelSpeech]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQ(searchInput.trim());
    }, 250);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const writeFiltersToUrl = useCallback((nextFilters: string[]) => {
    const params = new URLSearchParams(window.location.search);
    params.delete("filter");
    nextFilters.forEach((filter) => params.append("filter", filter));
    const query = params.toString();
    window.history.pushState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}`,
    );
  }, []);

  useEffect(() => {
    const restoreFiltersFromHistory = () => {
      cancelSpeech();
      setFilters(
        new URLSearchParams(window.location.search)
          .getAll("filter")
          .filter(Boolean),
      );
      setSearchInput("");
      setSelectedItemCode(null);
      setSpeechRequested(false);
    };
    window.addEventListener("popstate", restoreFiltersFromHistory);
    return () => window.removeEventListener("popstate", restoreFiltersFromHistory);
  }, [cancelSpeech]);

  const addFilter = useCallback((term: string) => {
    const cleaned = term.trim();
    if (!cleaned) return;
    cancelSpeech();
    setFilters((current) => {
      if (
        current.some(
          (filter) => filter.toLowerCase() === cleaned.toLowerCase(),
        )
      ) {
        return current;
      }
      const next = [...current, cleaned];
      writeFiltersToUrl(next);
      return next;
    });
    setSearchInput("");
    setSelectedItemCode(null);
    setSpeechRequested(false);
  }, [cancelSpeech, writeFiltersToUrl]);

  const removeFilter = useCallback((index: number, edit = false) => {
    cancelSpeech();
    setFilters((current) => {
      const removed = current[index];
      if (edit && removed) setSearchInput(removed);
      const next = current.filter((_, itemIndex) => itemIndex !== index);
      writeFiltersToUrl(next);
      return next;
    });
    setSelectedItemCode(null);
    setSpeechRequested(false);
  }, [cancelSpeech, writeFiltersToUrl]);

  const handleVoiceResult = useCallback((text: string) => {
    addFilter(text);
  }, [addFilter]);

  const handleVoiceTranscript = useCallback((text: string) => {
    cancelSpeech();
    setSearchInput(text);
    setSelectedItemCode(null);
    setSpeechRequested(false);
  }, [cancelSpeech]);

  const {
    isListening,
    supported: voiceSupported,
    error: voiceError,
    toggle: toggleVoice,
  } = useVoiceSearch(handleVoiceResult, handleVoiceTranscript);

  const queryFilters = [
    ...filters,
    ...(debouncedQ ? [debouncedQ] : []),
  ];
  const queryKey = queryFilters.join("\u0001");

  useEffect(() => {
    setSelectedItemCode(null);
    setSpeechRequested(false);
    cancelSpeech();
  }, [queryKey, cancelSpeech]);

  const { data: searchData, isLoading: isSearchLoading, isError: isSearchError } = useGetPriceFinderSearch(
    { filters: queryFilters, limit: 3000 },
    {
      query: {
        queryKey: ["price-finder-search", queryFilters],
        enabled: queryFilters.length > 0,
        staleTime: 1000 * 60,
      },
    },
  );

  const { results, totalCount, unmatchedFilter } =
    getPriceFinderSearchDisplay(searchData);
  const hasSearch = queryFilters.length > 0;
  const confirmProduct = useCallback((itemCode: string) => {
    cancelSpeech();
    setSelectedItemCode(itemCode);
    setSelectionSequence((value) => value + 1);
    setSpeechRequested(speechEnabled);
  }, [cancelSpeech, speechEnabled]);
  // Query 1: divisions list (no division selected)
  const { data: divisionsData, isLoading: isDivisionsLoading } = useGetPriceFinderBrowse(
    { limit: 300 },
    {
      query: {
        queryKey: ["price-finder-browse-divisions"],
        enabled: !browseDivision,
        staleTime: 1000 * 60,
      },
    },
  );

  // Query 2: categories for selected division (tab list)
  const { data: categoriesData, isLoading: isCategoriesLoading } = useGetPriceFinderBrowse(
    { division: browseDivision ?? undefined, limit: 300 },
    {
      query: {
        queryKey: ["price-finder-browse-categories", browseDivision],
        enabled: !!browseDivision,
        staleTime: 1000 * 60,
      },
    },
  );

  // Query 3: products for selected division + category
  const { data: productsData, isLoading: isProductsLoading } = useGetPriceFinderBrowse(
    { division: browseDivision ?? undefined, category: browseCategory ?? undefined, limit: 300 },
    {
      query: {
        queryKey: ["price-finder-browse-products", browseDivision, browseCategory],
        enabled: !!browseDivision && !!browseCategory,
        staleTime: 1000 * 60,
      },
    },
  );

  // Auto-select first category when categories load
  useEffect(() => {
    if (browseDivision && !browseCategory && categoriesData?.categories?.length) {
      const first = categoriesData.categories[0];
      setBrowseCategory(first.category ?? "__uncategorised__");
    }
  }, [browseDivision, browseCategory, categoriesData]);

  return (
    <div
      className="max-w-3xl mx-auto p-4 md:p-8 space-y-6"
      onPointerDownCapture={cancelSpeech}
    >
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Price Finder</h1>
        <p className="text-muted-foreground mt-1 text-sm max-w-lg">
          Fast counter-side lookup for Prayag prices and market position.
        </p>
      </div>

      {voiceError && (
        <p className="text-sm text-amber-700" role="status">
          {voiceError}
        </p>
      )}

      {speechAvailable && (
        <div className="flex items-center justify-end gap-2">
          {speechEnabled ? (
            <Volume2 aria-hidden="true" className="h-4 w-4 text-primary" />
          ) : (
            <VolumeX aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
          )}
          <Label htmlFor="spoken-output" className="text-sm">
            Speak confirmed price
          </Label>
          <Switch
            id="spoken-output"
            checked={speechEnabled}
            onCheckedChange={(checked) => {
              cancelSpeech();
              setSpeechRequested(false);
              setSpeechEnabled(checked);
              window.localStorage.setItem(
                "prayag-price-finder-speech-enabled",
                String(checked),
              );
            }}
            data-testid="spoken-output-toggle"
          />
        </div>
      )}

      {/* Progressive voice and text filters */}
      <div className="space-y-3">
      <div className="relative flex items-center shadow-sm group">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground group-focus-within:text-primary transition-colors" />
        <Input
          value={searchInput}
          onChange={(e) => {
            cancelSpeech();
            setSelectedItemCode(null);
            setSpeechRequested(false);
            setSearchInput(e.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addFilter(searchInput);
            }
          }}
          placeholder={filters.length ? "Say or type the next narrowing term…" : "Say or type a product term…"}
          className="pl-12 pr-24 h-14 text-lg bg-card border-2 border-primary/20 focus-visible:ring-primary focus-visible:border-primary rounded-xl"
          autoFocus
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {searchInput && (
            <Button
              variant="ghost"
              size="icon"
              className="w-10 h-10 text-muted-foreground hover:text-foreground rounded-lg"
              onClick={() => {
                cancelSpeech();
                setSearchInput("");
                setSelectedItemCode(null);
                setSpeechRequested(false);
              }}
              title="Clear search"
            >
              <X className="w-5 h-5" />
            </Button>
          )}
          {voiceSupported && (
            <Button
              variant={isListening ? "default" : "ghost"}
              size="icon"
              className={cn(
                "w-10 h-10 rounded-lg transition-colors",
                isListening ? "bg-red-500 hover:bg-red-600 text-white animate-pulse" : "text-muted-foreground hover:text-foreground hover:bg-accent"
              )}
              onClick={() => {
                cancelSpeech();
                setSpeechRequested(false);
                toggleVoice();
              }}
              title={isListening ? "Stop listening" : "Voice search"}
            >
              {isListening ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
            </Button>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2" aria-label="Active filters">
        {filters.map((filter, index) => (
          <span key={`${filter}-${index}`} className="inline-flex items-center overflow-hidden rounded-full border border-primary/20 bg-primary/5 text-sm text-primary">
            <button
              type="button"
              className="px-3 py-1.5 font-medium hover:bg-primary/10"
              onClick={() => removeFilter(index, true)}
              title={`Edit ${filter}`}
            >
              {filter}
            </button>
            <button
              type="button"
              className="border-l border-primary/15 px-2 py-1.5 hover:bg-primary/10"
              onClick={() => removeFilter(index)}
              aria-label={`Remove ${filter} filter`}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        ))}
        {filters.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-muted-foreground"
            onClick={() => {
              cancelSpeech();
              setFilters([]);
              writeFiltersToUrl([]);
              setSearchInput("");
              setSelectedItemCode(null);
              setSpeechRequested(false);
            }}
          >
            Clear filters
          </Button>
        )}
      </div>
      {hasSearch && (
        <p className="text-sm font-semibold text-foreground" aria-live="polite">
          {isSearchLoading ? "Narrowing products…" : `${totalCount.toLocaleString("en-IN")} products`}
          {filters.length > 0 && " · keep narrowing or choose a product"}
        </p>
      )}
      {unmatchedFilter && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="status">
          Nothing matched “{unmatchedFilter}”. Your earlier filters are still active—edit or remove this term to continue.
        </div>
      )}
      {!unmatchedFilter && totalCount > 25 && (searchData?.filterSuggestions?.length ?? 0) > 0 && (
        <div className="rounded-xl border border-dashed bg-muted/20 p-3">
          <p className="mb-2 text-sm font-medium text-muted-foreground">Narrow further by</p>
          <div className="flex flex-wrap gap-2">
            {searchData!.filterSuggestions.flatMap((suggestion) =>
              suggestion.values.slice(0, 3).map((option) => (
                <Button
                  key={`${suggestion.field}-${option.value}`}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => addFilter(option.value)}
                >
                  {suggestion.field}: {option.value} <span className="ml-1 text-muted-foreground">({option.count})</span>
                </Button>
              )),
            )}
          </div>
        </div>
      )}
      </div>

      <section className="rounded-xl border bg-card p-4 md:p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            {browseDivision ? (
              <>
                <h2 className="font-semibold">{browseDivision}</h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {isCategoriesLoading
                    ? "Loading categories…"
                    : `${categoriesData?.categories?.length ?? 0} categories`}
                </p>
              </>
            ) : (
              <>
                <h2 className="font-semibold">Browse the catalogue</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Search is fastest. Use division and category when you want to explore.
                </p>
              </>
            )}
          </div>
          {browseDivision && (
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0"
              onClick={() => {
                setBrowseDivision(null);
                setBrowseCategory(null);
                setSelectedItemCode(null);
              }}
            >
              ← All divisions
            </Button>
          )}
        </div>

        {!browseDivision ? (
          /* Division grid */
          isDivisionsLoading ? (
            <p className="text-sm text-muted-foreground">Loading catalogue…</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {(divisionsData?.divisions ?? []).map((item) => (
                <button
                  key={item.division}
                  type="button"
                  onClick={() => {
                    setBrowseDivision(item.division);
                    setBrowseCategory(null);
                    setSelectedItemCode(null);
                  }}
                  className="flex items-center justify-between rounded-lg border px-4 py-3 text-left transition-colors hover:border-primary hover:bg-primary/5 focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <span className="font-medium">{item.division}</span>
                  <span className="font-mono text-sm text-muted-foreground">{item.count}</span>
                </button>
              ))}
            </div>
          )
        ) : (
          /* Category tabs + product list */
          <div>
            {/* Scrollable category tab pills */}
            {isCategoriesLoading ? (
              <p className="text-sm text-muted-foreground mb-4">Loading categories…</p>
            ) : (
              <div className="relative mb-4">
                <div className="flex gap-2 overflow-x-auto pb-2 scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {(categoriesData?.categories ?? []).map((item) => {
                    const key = item.category ?? "__uncategorised__";
                    const isActive = browseCategory === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => {
                          setBrowseCategory(key);
                          setSelectedItemCode(null);
                        }}
                        className={cn(
                          "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-primary",
                          isActive
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                        )}
                      >
                        {item.label}
                        <span
                          className={cn(
                            "rounded-full px-1.5 py-0.5 font-mono text-[11px]",
                            isActive
                              ? "bg-primary-foreground/20 text-primary-foreground"
                              : "bg-background text-muted-foreground",
                          )}
                        >
                          {item.count}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {/* fade-out gradient on the right to hint scroll */}
                <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-card to-transparent" />
              </div>
            )}

            {/* Product list for selected category */}
            {browseCategory && (
              isProductsLoading ? (
                <p className="text-sm text-muted-foreground">Loading products…</p>
              ) : (productsData?.products ?? []).length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No products in this category.</p>
              ) : (
                <div className="divide-y rounded-lg border">
                  {(productsData?.products ?? []).map((item) => (
                    <button
                      key={item.itemCode}
                      type="button"
                      onClick={() => confirmProduct(item.itemCode)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-primary/5 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary"
                    >
                      <span>
                        <span className="block font-mono text-sm font-semibold text-primary">{item.itemCode}</span>
                        <span className="block font-medium">{item.productName ?? "Unnamed product"}</span>
                        <DiscontinuationBadge value={item.discontinuedFrom} />
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block font-mono font-semibold">
                          {item.currentMrp != null ? `₹${item.currentMrp.toFixed(2)}` : "Pending"}
                        </span>
                        <PriceWindowDetails
                          compact
                          currentPrice={item.currentMrp}
                          validFrom={item.currentEffectiveDate}
                          validTo={item.currentValidTo}
                          upcomingPrice={item.upcomingMrp}
                          upcomingEffectiveDate={item.upcomingEffectiveDate}
                          upcomingChangePct={item.upcomingChangePct}
                        />
                      </span>
                    </button>
                  ))}
                </div>
              )
            )}
          </div>
        )}
      </section>

      {/* Results Picker */}
      {!selectedItemCode && hasSearch && (
        <div className="bg-card border rounded-xl overflow-hidden shadow-sm animate-in fade-in slide-in-from-top-2 motion-reduce:animate-none">
          {isSearchLoading ? (
            <div className="p-6 text-center text-muted-foreground font-medium">Searching...</div>
          ) : isSearchError ? (
            <div className="p-6 text-center text-destructive flex items-center justify-center gap-2">
              <AlertCircle className="w-5 h-5" />
              Failed to load search results.
            </div>
          ) : results.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              No products match the active filters. Remove or edit a chip to widen the list.
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {totalCount > results.length && (
                <p className="px-4 py-3 text-sm text-muted-foreground">
                  Showing the first {results.length.toLocaleString("en-IN")} of {totalCount.toLocaleString("en-IN")} matching products. Add another filter to narrow the list.
                </p>
              )}
              {results.map((res) => (
                <button
                  key={res.itemCode}
                  onClick={() => confirmProduct(res.itemCode)}
                  className="w-full text-left p-4 hover:bg-primary/5 focus:bg-primary/5 focus:outline-none transition-colors flex items-center justify-between group"
                >
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-sm font-bold text-primary">{res.itemCode}</span>
                    </div>
                    <p className="text-foreground font-semibold text-lg">{res.productName}</p>
                    <DiscontinuationBadge value={res.discontinuedFrom} />
                    <p className="text-xs font-medium text-muted-foreground mt-1">
                      {[res.division, res.category].filter(Boolean).join(" • ")}
                    </p>
                    <CompetitorLine
                      brand={res.bestCompetitorBrand}
                      price={res.bestCompetitorPrice}
                      gapPct={res.bestCompetitorGapPct}
                    />
                  </div>
                  <div className="flex items-center gap-4 text-right">
                    <div className="hidden sm:block">
                      {res.currentMrp != null ? (
                        <p className="font-black text-xl text-foreground">₹{res.currentMrp.toFixed(2)}</p>
                      ) : (
                        <p className="text-sm font-bold text-amber-600">Pending</p>
                      )}
                      <PriceWindowDetails
                        compact
                        currentPrice={res.currentMrp}
                        validFrom={res.currentEffectiveDate}
                        validTo={res.currentValidTo}
                        upcomingPrice={res.upcomingMrp}
                        upcomingEffectiveDate={res.upcomingEffectiveDate}
                        upcomingChangePct={res.upcomingChangePct}
                        className="mt-1 max-w-[260px]"
                      />
                    </div>
                    <ChevronRight className="w-6 h-6 text-muted-foreground group-hover:text-primary transition-colors" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Selected Product View */}
      {selectedItemCode && (
        <ProductView
          itemCode={selectedItemCode}
          speechEnabled={speechEnabled}
          speakRequestId={speechRequested ? selectionSequence : 0}
        />
      )}
    </div>
  );
}

function ProductView({
  itemCode,
  speechEnabled,
  speakRequestId,
}: {
  itemCode: string;
  speechEnabled: boolean;
  speakRequestId: number;
}) {
  const { data, isLoading, isError } = useGetPriceFinderProduct(itemCode, {
    query: {
      queryKey: ["price-finder-product", itemCode],
      enabled: !!itemCode,
      staleTime: 1000 * 60,
    },
  });
  const lastSpokenRequest = useRef(0);

  useEffect(() => {
    if (
      !speechEnabled ||
      !data?.product ||
      speakRequestId <= lastSpokenRequest.current ||
      typeof window.speechSynthesis?.speak !== "function" ||
      typeof window.SpeechSynthesisUtterance !== "function"
    ) {
      return;
    }
    lastSpokenRequest.current = speakRequestId;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(
      buildSpokenPriceSummary(data.product, data.competitors),
    );
    utterance.lang = "en-IN";
    window.speechSynthesis.speak(utterance);
  }, [data, speechEnabled, speakRequestId]);

  if (isLoading) {
    return (
      <div className="mt-6 bg-card border rounded-2xl p-8 shadow-sm flex flex-col items-center justify-center min-h-[300px] animate-pulse">
        <div className="w-12 h-12 rounded-full bg-muted mb-4" />
        <div className="h-6 w-1/3 bg-muted rounded mb-2" />
        <div className="h-4 w-1/4 bg-muted rounded" />
      </div>
    );
  }
  
  if (isError || !data?.product) {
    return (
      <div className="mt-6 bg-destructive/5 border border-destructive/20 rounded-2xl p-8 flex items-center justify-center gap-2 text-destructive">
        <AlertCircle className="w-5 h-5" />
        <span className="font-medium">Failed to load product details for {itemCode}.</span>
      </div>
    );
  }

  const { product, competitors } = data;

  return (
    <div className="mt-6 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300 motion-reduce:animate-none">
      <div className="bg-card border rounded-xl p-6 shadow-sm">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2 text-xs font-mono font-medium text-muted-foreground uppercase tracking-widest">
            <span className="bg-primary/10 text-primary px-2 py-0.5 rounded">{product.itemCode}</span>
            {product.division && <span>• {product.division}</span>}
            {product.category && <span>• {product.category}</span>}
            {product.discontinuedFrom && (
              <span className="rounded bg-destructive/10 px-2 py-0.5 text-destructive font-semibold">
                Discontinued from {new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${product.discontinuedFrom}T00:00:00`))}
              </span>
            )}
          </div>
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground mt-2">{product.productName}</h2>
        </div>

        <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Prayag MRP Card */}
          <div className="border bg-muted/20 rounded-lg p-5 flex flex-col justify-center relative">
            <p className="text-xs font-bold text-muted-foreground mb-1 uppercase tracking-widest">Current MRP</p>
            {product.currentMrp != null ? (
              <div className="flex items-baseline gap-2">
                <span className="text-4xl md:text-5xl font-bold tracking-tight text-foreground">₹{product.currentMrp.toFixed(2)}</span>
              </div>
            ) : (
              <span className="text-2xl font-bold text-muted-foreground">Price Pending</span>
            )}
            <PriceWindowDetails
              currentPrice={product.currentMrp}
              validFrom={product.currentEffectiveDate}
              validTo={product.currentValidTo}
              upcomingPrice={product.upcomingMrp}
              upcomingEffectiveDate={product.upcomingEffectiveDate}
              upcomingChangePct={product.upcomingChangePct}
              className="mt-4"
            />
          </div>

          {/* Competitor Data */}
          <div className="border rounded-lg p-5 bg-card flex flex-col">
            <p className="text-xs font-bold text-muted-foreground mb-3 uppercase tracking-widest">Market Context</p>
            
            {!competitors || competitors.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center py-6">
                <Info className="w-8 h-8 text-muted-foreground/40 mb-2" />
                <p className="text-sm font-semibold text-foreground">No competitor data</p>
                <p className="text-xs text-muted-foreground mt-1">This product has no mapped rivals.</p>
              </div>
            ) : (
              <div className="space-y-2 flex-1 overflow-y-auto">
                {competitors.map((comp: PriceFinderCompetitor) => {
                  const isPrayagCheaper = comp.gapPct != null && comp.gapPct > 0;
                  const isCompetitorCheaper = comp.gapPct != null && comp.gapPct < 0;

                  return (
                    <div key={comp.competitor} className="flex items-start justify-between gap-3 p-3 bg-muted/30 border-b last:border-b-0 rounded-md">
                      <div className="min-w-0">
                        <p className="font-bold text-foreground text-sm flex items-center gap-1.5">
                          {comp.competitor}
                        </p>
                        <p className="text-xs font-mono text-muted-foreground mt-0.5">
                          ₹{comp.price.toFixed(2)} {comp.priceBasis ? `(${comp.priceBasis})` : ""}
                        </p>
                        <PriceWindowDetails
                          compact
                          currentPrice={comp.price}
                          validFrom={comp.effectiveDate}
                          validTo={comp.validTo}
                          upcomingPrice={comp.upcomingPrice}
                          upcomingEffectiveDate={comp.upcomingEffectiveDate}
                          upcomingChangePct={comp.upcomingChangePct}
                          className="mt-1 max-w-[300px]"
                        />
                      </div>
                      <div className="text-right flex flex-col items-end">
                        {comp.gapPct != null ? (
                          <div className={cn(
                            "inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-bold font-mono",
                            isCompetitorCheaper ? "bg-destructive/10 text-destructive" : 
                            isPrayagCheaper ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" : "bg-muted text-muted-foreground"
                          )}>
                            {comp.gapPct > 0 ? "+" : ""}{comp.gapPct.toFixed(1)}%
                          </div>
                        ) : (
                          <span className="text-[11px] font-mono text-muted-foreground px-1.5 py-0.5 bg-muted rounded">{comp.message || "N/A"}</span>
                        )}
                        <p className="text-[10px] text-muted-foreground mt-1">
                          Current gap
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function DiscontinuationBadge({ value }: { value: string | null | undefined }) {
  if (!value) return null;
  const label = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
  return (
    <span className="inline-flex rounded bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold text-destructive mt-1">
      Discontinued from {label}
    </span>
  );
}
