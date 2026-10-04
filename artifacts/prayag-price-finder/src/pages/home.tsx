import { formatMoney, formatCount } from "@workspace/formatting";
import React, { useState, useEffect, useRef, useCallback } from "react";
import { useBrowse } from "@/lib/browseContext";
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
  Palette,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import {
  formatPriceDate,
  PriceWindowDetails,
  UpcomingGapDetails,
} from "@/components/price-window";
import { buildSpokenPriceSummary } from "@/lib/priceSpeech";
import { getPriceFinderSearchDisplay } from "@/lib/priceFinderSearchState";
import { useSelection } from "@/lib/useSelection";
import {
  localPriceFinderUrl,
  normalizePriceFinderParams,
} from "@/lib/priceFinderRouteState";
import {
  useGetPriceFinderBrowse,
  useGetPriceHistory,
  useGetPriceFinderProduct,
  useGetPriceFinderSearch,
  type PriceFinderCompetitor,
  type PriceFinderSearchResult,
} from "@workspace/api-client-react";
import { useAuth } from "@workspace/replit-auth-web";
import { BucketFilteredNotice, isBucketFiltered } from "@workspace/api-client-react";

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
        Closest: {brand} {formatMoney(price)}
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
  const [isStarting, setIsStarting] = useState(false);
  const [supported, setSupported] = useState(false);
  const [supportChecked, setSupportChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);
  const listeningRef = useRef(false);
  const startPendingRef = useRef(false);
  const callbacksRef = useRef({ onFinalResult, onTranscript });

  useEffect(() => {
    callbacksRef.current = { onFinalResult, onTranscript };
  }, [onFinalResult, onTranscript]);

  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setSupported(false);
      setSupportChecked(true);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-IN";

    recognition.onstart = () => {
      startPendingRef.current = false;
      listeningRef.current = true;
      setIsStarting(false);
      setIsListening(true);
    };

    recognition.onresult = (event: any) => {
      let finalTranscript = "";
      let interimTranscript = "";
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          interimTranscript += event.results[i][0].transcript;
        }
      }

      if (interimTranscript) {
        callbacksRef.current.onTranscript(interimTranscript);
      }

      if (finalTranscript) {
        callbacksRef.current.onFinalResult(finalTranscript.trim());
        setError(null);
      }
    };

    recognition.onerror = (event: any) => {
      startPendingRef.current = false;
      setIsStarting(false);
      if (event.error === "aborted") return;

      const messages: Record<string, string> = {
        "not-allowed":
          "Microphone permission is blocked. Allow microphone access in your browser settings, then try again.",
        "audio-capture":
          "No microphone was found. Check that a microphone is connected and available to your browser.",
        "no-speech": "No speech detected. Try again or type the product.",
        network:
          "Voice recognition needs a network connection. Check your connection and try again.",
        "service-not-allowed":
          "This browser does not allow voice recognition. You can continue with text search.",
        "language-not-supported":
          "English (India) voice recognition is not supported here. You can continue with text search.",
      };
      setError(
        messages[event.error] ??
          "Voice search stopped unexpectedly. Try again or use text search.",
      );
      setIsListening(false);
      listeningRef.current = false;
    };

    recognition.onend = () => {
      startPendingRef.current = false;
      listeningRef.current = false;
      setIsStarting(false);
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    setSupported(true);
    setSupportChecked(true);

    return () => {
      startPendingRef.current = false;
      listeningRef.current = false;
      setIsStarting(false);
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.onstart = null;
      recognition.abort();
      recognitionRef.current = null;
    };
  }, []);

  const toggle = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) {
      setError("Voice search is not supported in this browser.");
      return;
    }

    if (listeningRef.current || startPendingRef.current) {
      startPendingRef.current = false;
      listeningRef.current = false;
      setIsStarting(false);
      try {
        recognition.stop();
      } catch {
        recognition.abort();
      }
      setIsListening(false);
      return;
    }

    try {
      setError(null);
      startPendingRef.current = true;
      setIsStarting(true);
      recognition.start();
    } catch (error: any) {
      startPendingRef.current = false;
      setIsStarting(false);
      setIsListening(false);
      setError(
        error?.name === "InvalidStateError"
          ? "Voice search is already starting. Try again in a moment."
          : "Voice search could not start. Check microphone permission and try again.",
      );
    }
  }, []);

  return { isListening, isStarting, supported, supportChecked, error, toggle };
}

export default function PriceFinderPage() {
  const [, navigate] = useLocation();
  const { codes, toggleCode, clearCodes, removeCode } = useSelection();
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [filters, setFilters] = useState<string[]>(() =>
    new URLSearchParams(window.location.search).getAll("filter").filter(Boolean),
  );
  const [selectedItemCode, setSelectedItemCode] = useState<string | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  // When a suggestion is selected from the dropdown, we clear searchInput which
  // triggers the debounce → queryKey change → the effect below would normally
  // reset selectedItemCode.  This ref suppresses that single reset.
  const suppressSelectionResetRef = useRef(false);
  const {
    browseDivision,
    browseCategory,
    selectDivision,
    selectCategory,
    divisionsData,
    isDivisionsLoading,
    categoriesData,
    isCategoriesLoading,
  } = useBrowse();
  const [selectionSequence, setSelectionSequence] = useState(0);
  const [speechRequested, setSpeechRequested] = useState(false);
  const [speechAvailable, setSpeechAvailable] = useState(false);
  const [speechEnabled, setSpeechEnabled] = useState(false);

  useEffect(() => {
    setSelectedItemCode(null);
  }, [browseDivision, browseCategory]);

  const comparisonHref = localPriceFinderUrl(
    "/comparison",
    normalizePriceFinderParams(
      new URLSearchParams(window.location.search),
      "comparison",
    ),
  );

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

  // Reset keyboard cursor whenever the query changes
  useEffect(() => {
    setActiveSuggestion(-1);
  }, [debouncedQ]);

  // True while the user has typed but the debounce hasn't settled yet.
  // During this window show a loading indicator and block stale-result selection.
  const isDebouncing = searchInput.trim() !== debouncedQ;

  const writeFiltersToUrl = useCallback((nextFilters: string[]) => {
    const params = new URLSearchParams(window.location.search);
    params.delete("filter");
    nextFilters.forEach((filter) => params.append("filter", filter));
    navigate(
      localPriceFinderUrl(
        "/",
        normalizePriceFinderParams(params, "search"),
      ),
    );
  }, [navigate]);

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
    isStarting: isVoiceStarting,
    supported: voiceSupported,
    supportChecked: voiceSupportChecked,
    error: voiceError,
    toggle: toggleVoice,
  } = useVoiceSearch(handleVoiceResult, handleVoiceTranscript);
  const voiceActive = isListening || isVoiceStarting;

  const queryFilters = [
    ...filters,
    ...(debouncedQ ? [debouncedQ] : []),
  ];
  const queryKey = queryFilters.join("\u0001");

  useEffect(() => {
    if (suppressSelectionResetRef.current) {
      suppressSelectionResetRef.current = false;
      return;
    }
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
  const toggleComparisonCode = useCallback((itemCode: string) => {
    const updated = toggleCode(itemCode);
    setSelectionNotice(
      updated
        ? null
        : "You can compare up to 50 products. Remove a product before adding another.",
    );
  }, [toggleCode]);

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

  return (
    <div
      className="mx-auto w-full max-w-5xl px-3 py-3 sm:px-4 md:px-6 md:py-4 space-y-4"
      onPointerDownCapture={cancelSpeech}
    >
      <div className="mb-4">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">Price Finder</h1>
        <p className="text-muted-foreground mt-0.5 text-sm max-w-lg">
          Fast counter-side lookup for Prayag prices and market position.
        </p>
      </div>

      <div
        className={cn(
          "sticky top-14 z-30 flex flex-wrap items-center justify-between gap-2.5 rounded-lg border px-3 py-2.5 shadow-sm backdrop-blur transition-colors",
          codes.length
            ? "border-primary/30 bg-primary/5"
            : "border-border bg-card/90",
        )}
        data-testid="comparison-selection-bar"
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-tight">
            {codes.length
              ? `${codes.length} product${codes.length === 1 ? "" : "s"} selected`
              : "Select products to compare"}
          </p>
          <p className="text-xs text-muted-foreground">
            Choose up to 50 products from search results or the catalogue.
          </p>
          {codes.length > 0 && (
            <div className="mt-1.5 flex max-h-14 max-w-full flex-wrap gap-1 overflow-y-auto pr-1" aria-label="Selected products">
              {codes.map((code) => (
                <span
                  key={code}
                  className="inline-flex items-center gap-1 rounded border border-primary/20 bg-background px-1.5 py-0.5 font-mono text-[11px] text-primary"
                >
                  {code}
                  <button
                    type="button"
                    className="rounded-sm p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    onClick={() => {
                      removeCode(code);
                      setSelectionNotice(null);
                    }}
                    aria-label={`Remove ${code} from comparison`}
                    title={`Remove ${code} from comparison`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {codes.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                clearCodes();
                setSelectionNotice(null);
              }}
            >
              Clear selection
            </Button>
          )}
          {codes.length ? (
            <Link href={comparisonHref}>
              <Button type="button" size="sm" className="h-8 px-3 text-xs" data-activity="price_finder.compare_selected">Compare selected</Button>
            </Link>
          ) : (
            <Button type="button" size="sm" disabled>Compare selected</Button>
          )}
        </div>
      </div>
      {selectionNotice && (
        <p className="text-sm text-amber-700" role="status">{selectionNotice}</p>
      )}

      {voiceError && (
        <p className="text-sm text-amber-700" role="status">
          {voiceError}
        </p>
      )}
      {voiceSupportChecked && !voiceSupported && (
        <p className="text-sm text-muted-foreground" role="status">
          Voice search is available in Chrome or Edge when microphone access is allowed.
        </p>
      )}

      {speechAvailable && (
       <div className="flex items-center justify-end gap-2">
          {speechEnabled ? (
            <Volume2 aria-hidden="true" className="h-4 w-4 text-primary" />
          ) : (
            <VolumeX aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
          )}
          <Label htmlFor="spoken-output" className="text-xs font-medium">
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
      <div className="space-y-2.5">
      <div className="relative flex items-center shadow-sm group">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground group-focus-within:text-primary transition-colors" />
        <Input
          value={searchInput}
          onChange={(e) => {
            cancelSpeech();
            setSelectedItemCode(null);
            setSpeechRequested(false);
            setSearchInput(e.target.value);
          }}
          onFocus={() => setIsFocused(true)}
          onBlur={() => {
            // Delay so click on a suggestion registers first
            setTimeout(() => setIsFocused(false), 150);
          }}
          onKeyDown={(event) => {
            const suggestionList = results.slice(0, 8);
            const dropdownOpen = isFocused && debouncedQ.length >= 2 && suggestionList.length > 0;

            if (event.key === "ArrowDown") {
              // Block navigation while debounce is unsettled — results are stale
              if (!dropdownOpen || isDebouncing) return;
              event.preventDefault();
              setActiveSuggestion((i) => Math.min(i + 1, suggestionList.length - 1));
              return;
            }
            if (event.key === "ArrowUp") {
              if (!dropdownOpen || isDebouncing) return;
              event.preventDefault();
              setActiveSuggestion((i) => Math.max(i - 1, -1));
              return;
            }
            if (event.key === "Escape") {
              setIsFocused(false);
              setActiveSuggestion(-1);
              return;
            }
            if (event.key === "Enter") {
              event.preventDefault();
              // Only select a suggestion when the debounce has settled and a row is highlighted
              if (dropdownOpen && !isDebouncing && activeSuggestion >= 0) {
                const chosen = suggestionList[activeSuggestion];
                if (chosen) {
                  suppressSelectionResetRef.current = true;
                  confirmProduct(chosen.itemCode);
                  setSearchInput("");
                  setIsFocused(false);
                  setActiveSuggestion(-1);
                }
              } else {
                addFilter(searchInput);
              }
            }
          }}
          placeholder={filters.length ? "Say or type the next narrowing term…" : "Say or type a product term…"}
          className="pl-10 pr-20 h-12 text-base bg-card border-2 border-primary/20 focus-visible:ring-primary focus-visible:border-primary rounded-lg"
          autoFocus
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {searchInput && (
            <Button
              variant="ghost"
              size="icon"
               className="w-8 h-8 text-muted-foreground hover:text-foreground rounded-md"
              onClick={() => {
                cancelSpeech();
                setSearchInput("");
                setSelectedItemCode(null);
                setSpeechRequested(false);
                setIsFocused(false);
              }}
              title="Clear search"
            >
               <X className="w-4 h-4" />
            </Button>
          )}
          {voiceSupported && (
            <Button
              variant={voiceActive ? "default" : "ghost"}
              size="icon"
              className={cn(
                "w-8 h-8 rounded-md transition-colors",
                voiceActive ? "bg-red-500 hover:bg-red-600 text-white animate-pulse" : "text-muted-foreground hover:text-foreground hover:bg-accent"
              )}
              aria-label={voiceActive ? "Stop voice search" : "Start voice search"}
              aria-pressed={voiceActive}
              data-testid="voice-search-toggle"
              onClick={() => {
                cancelSpeech();
                setSpeechRequested(false);
                toggleVoice();
              }}
              title={
                isVoiceStarting
                  ? "Starting voice search…"
                  : isListening
                    ? "Stop listening"
                    : "Voice search"
              }
            >
              {voiceActive ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </Button>
          )}
        </div>

        {/* ── Predictive suggestions dropdown ── */}
        {isFocused && (isDebouncing || debouncedQ.length >= 2) && searchInput.trim().length >= 2 && (
          <div className="absolute top-full left-0 right-0 z-50 mt-1 rounded-lg border bg-card shadow-xl overflow-hidden">
            {/* Show loading while debounce is pending OR request is in flight */}
            {isDebouncing || isSearchLoading ? (
              <div className="flex items-center gap-2 px-3 py-2.5 text-sm text-muted-foreground animate-pulse">
                <Search className="w-4 h-4 shrink-0" />
                Searching…
              </div>
            ) : results.length === 0 ? null : (
              <>
                {results.slice(0, 8).map((res, idx) => {
                  const isActive = idx === activeSuggestion;
                  return (
                    <button
                      key={res.itemCode}
                      type="button"
                      className={cn(
                         "flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left transition-colors border-b last:border-b-0",
                        isActive ? "bg-primary/10" : "hover:bg-muted/50",
                      )}
                      onMouseEnter={() => setActiveSuggestion(idx)}
                      onMouseLeave={() => setActiveSuggestion(-1)}
                      onClick={() => {
                        suppressSelectionResetRef.current = true;
                        confirmProduct(res.itemCode);
                        setSearchInput("");
                        setIsFocused(false);
                        setActiveSuggestion(-1);
                      }}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="font-mono text-xs font-bold text-primary shrink-0">{res.itemCode}</span>
                          {res.division && (
                            <span className="text-[11px] text-muted-foreground truncate">
                              {res.division}{res.category ? ` · ${res.category}` : ""}
                            </span>
                          )}
                        </div>
                         <p className="font-semibold text-sm text-foreground leading-snug truncate">{res.productName}</p>
                        <CompetitorLine
                          brand={res.bestCompetitorBrand}
                          price={res.bestCompetitorPrice}
                          gapPct={res.bestCompetitorGapPct}
                        />
                      </div>
                      <div className="shrink-0 text-right ml-2">
                        {res.currentMrp != null ? (
                          <span className="font-mono font-bold text-sm text-foreground">{formatMoney(res.currentMrp)}</span>
                        ) : (
                          <span className="text-xs font-medium text-amber-600">Pending</span>
                        )}
                        <ChevronRight className="w-4 h-4 text-muted-foreground mt-0.5 ml-auto" />
                      </div>
                    </button>
                  );
                })}
                {results.length > 8 && (
                  <div className="px-4 py-2.5 text-xs text-muted-foreground bg-muted/30 flex items-center gap-1">
                    <Tag className="w-3 h-3 shrink-0" />
                    {results.length - 8} more — press Enter or add a filter to narrow
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
      {/* Results Picker — keep search results immediately below the search field */}
      {!selectedItemCode && (hasSearch || searchInput.trim().length > 0) && (
        <div
          className="bg-card border rounded-lg overflow-hidden shadow-sm animate-in fade-in slide-in-from-top-2 motion-reduce:animate-none"
          data-testid="search-results"
        >
          {isDebouncing || isSearchLoading ? (
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
              <p className="px-3 py-2 text-xs text-muted-foreground">
                  Showing the first {formatCount(results.length)} of {formatCount(totalCount)} matching products. Add another filter to narrow the list.
                </p>
              )}
              {results.map((res) => (
                <div
                  key={res.itemCode}
                  className={cn(
                    "w-full flex items-stretch group border-b last:border-b-0 border-border/50",
                    codes.includes(res.itemCode) && "bg-primary/5 ring-1 ring-inset ring-primary/20",
                  )}
                >
                  <div
                     className="w-11 shrink-0 flex items-center justify-center border-r border-border/50 bg-muted/10 hover:bg-primary/5 transition-colors cursor-pointer"
                  >
                    <Checkbox
                      checked={codes.includes(res.itemCode)}
                      onCheckedChange={() => toggleComparisonCode(res.itemCode)}
                      aria-label={`${codes.includes(res.itemCode) ? "Remove" : "Select"} ${res.itemCode} from comparison`}
                       className="w-4 h-4 rounded border-primary/30 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                    />
                  </div>
                  <button
                    onClick={() => confirmProduct(res.itemCode)}
                     className="flex-1 min-w-0 text-left px-3 py-2.5 hover:bg-primary/5 focus:bg-primary/5 focus:outline-none transition-colors flex items-center justify-between gap-3"
                  >
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-sm font-bold text-primary">{res.itemCode}</span>
                    </div>
                     <p className="text-foreground font-semibold text-base leading-snug">{res.productName}</p>
                    <DiscontinuationBadge value={res.discontinuedFrom} />
                       <p className="text-[11px] font-medium text-muted-foreground mt-0.5">
                      {[res.division, res.category].filter(Boolean).join(" • ")}
                    </p>
                    <CompetitorLine
                      brand={res.bestCompetitorBrand}
                      price={res.bestCompetitorPrice}
                      gapPct={res.bestCompetitorGapPct}
                    />
                    {res.colourVariantCount != null && res.colourVariantCount > 0 && (
                      <p className="mt-1 flex items-center gap-1 text-xs text-indigo-600 font-medium">
                        <Palette className="w-3 h-3 shrink-0" />
                        +{res.colourVariantCount} colour option{res.colourVariantCount > 1 ? "s" : ""}
                      </p>
                    )}
                  </div>
                     <div className="flex items-center gap-2 text-right">
                    <div className="hidden sm:block">
                      {res.currentMrp != null ? (
                         <p className="font-black text-lg text-foreground">{formatMoney(res.currentMrp)}</p>
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
                         className="mt-0.5 max-w-[220px]"
                      />
                    </div>
                     <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                  </div>
                </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
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
          {isSearchLoading ? "Narrowing products…" : `${formatCount(totalCount)} products`}
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

      {/* Selected product result stays above catalogue browsing */}
      {selectedItemCode && (
        <ProductView
          itemCode={selectedItemCode}
          speechEnabled={speechEnabled}
          speakRequestId={speechRequested ? selectionSequence : 0}
          isSelected={codes.includes(selectedItemCode)}
          onToggleSelection={toggleComparisonCode}
        />
      )}

      <section className="rounded-lg border bg-card p-3.5 md:p-4">
        <div className="mb-3 flex items-start justify-between gap-3">
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
                <p className="mt-0.5 text-sm text-muted-foreground">
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
                selectDivision(null);
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
            <div className="grid gap-1.5 sm:grid-cols-2">
              {(divisionsData?.divisions ?? []).map((item) => (
                <button
                  key={item.division}
                  type="button"
                  onClick={() => {
                    selectDivision(item.division);
                    setSelectedItemCode(null);
                  }}
                  className="flex items-center justify-between rounded-md border px-3 py-2.5 text-left text-sm transition-colors hover:border-primary hover:bg-primary/5 focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <span className="font-medium">{item.division}</span>
                  <span className="font-mono text-xs text-muted-foreground">{item.count}</span>
                </button>
              ))}
            </div>
          )
        ) : (
          /* Category tabs + product list */
          <div>
            {/* Product list for selected category */}
            {browseCategory && (
              isProductsLoading ? (
                <p className="text-sm text-muted-foreground">Loading products…</p>
              ) : (productsData?.products ?? []).length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No products in this category.</p>
              ) : (
                <div className="divide-y rounded-lg border">
                  {(productsData?.products ?? []).map((item) => (
                    <div
                      key={item.itemCode}
                      className={cn(
                        "w-full flex items-stretch group border-b last:border-b-0 border-border/50",
                        codes.includes(item.itemCode) && "bg-primary/5 ring-1 ring-inset ring-primary/20",
                      )}
                    >
                      <div
                           className="w-11 shrink-0 flex items-center justify-center border-r border-border/50 bg-muted/10 hover:bg-primary/5 transition-colors cursor-pointer"
                      >
                        <Checkbox
                          checked={codes.includes(item.itemCode)}
                          onCheckedChange={() => toggleComparisonCode(item.itemCode)}
                          aria-label={`${codes.includes(item.itemCode) ? "Remove" : "Select"} ${item.itemCode} from comparison`}
                           className="w-4 h-4 rounded border-primary/30 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => confirmProduct(item.itemCode)}
                         className="flex-1 min-w-0 flex items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-primary/5 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary"
                      >
                      <span>
                         <span className="block font-mono text-xs font-semibold text-primary">{item.itemCode}</span>
                        <span className="block font-medium">{item.productName ?? "Unnamed product"}</span>
                        <DiscontinuationBadge value={item.discontinuedFrom} />
                      </span>
                      <span className="shrink-0 text-right">
                           <span className="block font-mono text-sm font-semibold">
                          {item.currentMrp != null ? `${formatMoney(item.currentMrp)}` : "Pending"}
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
                        {item.colourVariantCount != null && item.colourVariantCount > 0 && (
                          <span className="mt-1 flex items-center justify-end gap-1 text-xs text-indigo-600 font-medium">
                            <Palette className="w-3 h-3 shrink-0" />
                            +{item.colourVariantCount} colour option{item.colourVariantCount > 1 ? "s" : ""}
                          </span>
                        )}
                      </span>
                    </button>
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        )}
      </section>

    </div>
  );
}

function formatHistoryDate(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return value;
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`));
}

function formatHistoryChange(
  amount: number | null,
  percent: number | null | undefined,
): string {
  if (amount == null || percent == null || amount === 0) return "—";
  const sign = amount > 0 ? "+" : amount < 0 ? "−" : "";
  const signedPercent = `${percent > 0 ? "+" : percent < 0 ? "−" : ""}${Math.abs(percent).toFixed(1)}%`;
  return `${sign}${formatMoney(Math.abs(amount))}  ${signedPercent}`;
}

function ProductPriceHistory({ itemCode }: { itemCode: string }) {
  const { isAuthenticated, user: histUser } = useAuth();
  const { data, isLoading, isError, error: histError } = useGetPriceHistory(
    { itemCode },
    {
      query: {
        queryKey: ["price-history", itemCode],
        enabled: isAuthenticated && !!itemCode,
        staleTime: 1000 * 60,
      },
    },
  );

  if (!isAuthenticated) return null;

  const rows = (data?.prayagHistory ?? [])
    .map((row, index, history) => ({
      ...row,
      changeAmount:
        index > 0 && row.mrp != null && history[index - 1]?.mrp != null
          ? row.mrp - history[index - 1]!.mrp!
          : null,
    }))
    .reverse();

  return (
    <details className="group border-t pt-4" data-testid="price-history">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-1 py-2 text-sm font-bold text-foreground hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        <span>Price history</span>
        <ChevronRight
          aria-hidden="true"
          className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-90"
        />
      </summary>
      <div className="mt-2 overflow-x-auto rounded-lg border">
        {isLoading ? (
          <p className="p-4 text-sm text-muted-foreground">Loading price history…</p>
        ) : isError && isBucketFiltered(histError) ? (
          <div className="p-3"><BucketFilteredNotice userId={histUser?.id} /></div>
        ) : isError ? (
          <p className="p-4 text-sm text-destructive">Price history could not be loaded.</p>
        ) : (
          <table className="w-full min-w-[680px] text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Effective from</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">MRP</th>
                <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Change</th>
                <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-muted/20">
                  <td className="whitespace-nowrap px-3 py-2">{formatHistoryDate(row.effectiveDate)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono font-semibold">{formatMoney(row.mrp)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono">
                    {formatHistoryChange(row.changeAmount, row.changePct)}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{row.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </details>
  );
}

function ProductView({
  itemCode,
  speechEnabled,
  speakRequestId,
  isSelected,
  onToggleSelection,
}: {
  itemCode: string;
  speechEnabled: boolean;
  speakRequestId: number;
  isSelected: boolean;
  onToggleSelection: (itemCode: string) => void;
}) {
  const { user: detailUser } = useAuth();
  const { data, isLoading, isError, error: detailError } = useGetPriceFinderProduct({ itemCode }, {
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
      <div className="mt-4 bg-card border rounded-xl p-6 shadow-sm flex flex-col items-center justify-center min-h-[180px] animate-pulse">
        <div className="w-12 h-12 rounded-full bg-muted mb-4" />
        <div className="h-6 w-1/3 bg-muted rounded mb-2" />
        <div className="h-4 w-1/4 bg-muted rounded" />
      </div>
    );
  }

  if (isError && isBucketFiltered(detailError)) {
    return <div className="mt-4"><BucketFilteredNotice userId={detailUser?.id} /></div>;
  }

  if (isError || !data?.product) {
    return (
      <div className="mt-4 bg-destructive/5 border border-destructive/20 rounded-xl p-5 flex items-center justify-center gap-2 text-destructive">
        <AlertCircle className="w-5 h-5" />
        <span className="font-medium">Failed to load product details for {itemCode}.</span>
      </div>
    );
  }

  const { product, competitors, variants } = data;

  return (
    <div className="mt-4 space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-300 motion-reduce:animate-none">
      <div className="bg-card border rounded-xl p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono font-medium text-muted-foreground uppercase tracking-wide">
              <span className="bg-primary/10 text-primary px-1.5 py-0.5 rounded">{product.itemCode}</span>
              {product.division && <span>• {product.division}</span>}
              {product.category && <span>• {product.category}</span>}
              {product.discontinuedFrom && (
                  <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-destructive font-semibold">
                  Discontinued from {formatPriceDate(product.discontinuedFrom)}
                </span>
              )}
            </div>
            <h2 className="text-xl md:text-2xl font-bold tracking-tight text-foreground mt-1">{product.productName}</h2>
          </div>
          <Button
            type="button"
            variant={isSelected ? "outline" : "default"}
            className="shrink-0 h-8 px-3 text-xs"
            onClick={() => onToggleSelection(product.itemCode)}
            aria-pressed={isSelected}
          >
            {isSelected ? "Remove from comparison" : "Add to comparison"}
          </Button>
        </div>

        <div className="mt-4 grid grid-cols-1 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-3">
          {/* Prayag MRP Card */}
          <div className="border bg-muted/20 rounded-lg p-4 flex flex-col justify-center relative">
            <p className="text-[11px] font-bold text-muted-foreground mb-1 uppercase tracking-wide">Current MRP</p>
            {product.currentMrp != null ? (
              <div className="flex items-baseline gap-2">
                <span className="text-3xl md:text-4xl font-bold tracking-tight text-foreground">{formatMoney(product.currentMrp)}</span>
              </div>
            ) : (
              <span className="text-xl font-bold text-muted-foreground">Price Pending</span>
            )}
            <PriceWindowDetails
              currentPrice={product.currentMrp}
              validFrom={product.currentEffectiveDate}
              validTo={product.currentValidTo}
              upcomingPrice={product.upcomingMrp}
              upcomingEffectiveDate={product.upcomingEffectiveDate}
              upcomingChangePct={product.upcomingChangePct}
               className="mt-3"
            />
          </div>

          {/* Competitor Data */}
          <div className="border rounded-lg p-4 bg-card flex flex-col">
            <p className="text-[11px] font-bold text-muted-foreground mb-2 uppercase tracking-wide">Market Context</p>

            {!competitors || competitors.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center py-4">
                <Info className="w-8 h-8 text-muted-foreground/40 mb-2" />
                <p className="text-sm font-semibold text-foreground">No competitor data</p>
                <p className="text-xs text-muted-foreground mt-1">This product has no mapped rivals.</p>
              </div>
            ) : (
              <div className="space-y-1.5 flex-1 overflow-y-auto">
                {competitors.map((comp: PriceFinderCompetitor) => {
                  const isPrayagCheaper = comp.gapPct != null && comp.gapPct > 0;
                  const isCompetitorCheaper = comp.gapPct != null && comp.gapPct < 0;

                  return (
                    <div key={comp.competitor} className="flex items-start justify-between gap-2 p-2.5 bg-muted/30 border-b last:border-b-0 rounded-md">
                      <div className="min-w-0">
                        <p className="font-bold text-foreground text-sm flex flex-wrap items-center gap-1.5">
                          {comp.competitor}
                          {comp.competitor === "Ashirvad" && (
                            <span className="inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 normal-case tracking-normal">
                              <AlertCircle className="h-3 w-3 shrink-0" />
                              Valid from 01 Mar 2025 · 18+ months old
                            </span>
                          )}
                        </p>
                        <p className="text-xs font-mono text-muted-foreground mt-0.5">
                          {formatMoney(comp.price)} {comp.priceBasis ? `(${comp.priceBasis})` : ""}
                        </p>
                        <PriceWindowDetails
                          compact
                          currentPrice={comp.price}
                          validFrom={comp.effectiveDate}
                          validTo={comp.validTo}
                          upcomingPrice={comp.upcomingPrice}
                          upcomingEffectiveDate={comp.upcomingEffectiveDate}
                          upcomingChangePct={comp.upcomingChangePct}
                          className="mt-0.5 max-w-[260px]"
                        />
                      </div>
                      <div className="text-right flex flex-col items-end">
                        {comp.gapPct != null ? (
                          <div className={cn(
                              "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold font-mono",
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
                        <UpcomingGapDetails
                          compact
                          effectiveDate={comp.upcomingGapDate}
                          prayagPrice={comp.upcomingGapPrayagPrice}
                          competitorPrice={comp.upcomingGapCompetitorPrice}
                          gapPct={comp.upcomingGapPct}
                          direction={comp.upcomingGapDirection}
                          isReversal={comp.upcomingGapIsReversal}
                          className="max-w-[260px] text-left"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Colour variant pricing table */}
        {variants && variants.length > 0 && (
          <div className="border-t pt-4">
            <p className="text-[11px] font-bold text-muted-foreground mb-2 uppercase tracking-wide flex items-center gap-1.5">
              <Palette className="w-3.5 h-3.5 text-indigo-500" />
              Colour Variant Pricing
            </p>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold text-muted-foreground text-xs uppercase tracking-wide">Variant</th>
                    <th className="text-right px-3 py-2 font-semibold text-muted-foreground text-xs uppercase tracking-wide">Current MRP</th>
                    <th className="text-right px-3 py-2 font-semibold text-muted-foreground text-xs uppercase tracking-wide">Upcoming</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {variants.map((v) => (
                   <tr key={v.variant} className="hover:bg-muted/20 transition-colors">
                     <td className="px-3 py-2 font-medium text-foreground flex items-center gap-1.5">
                        <Palette className="w-3 h-3 text-indigo-400 shrink-0" />
                        {v.variant}
                      </td>
                     <td className="px-3 py-2 text-right font-mono font-semibold">
                        {v.currentMrp != null ? `${formatMoney(v.currentMrp)}` : "—"}
                      </td>
                     <td className="px-3 py-2 text-right font-mono">
                        {v.upcomingMrp != null ? (
                          <span className="text-amber-700 dark:text-amber-400">
                            {formatMoney(v.upcomingMrp)}
                            {v.upcomingChangePct != null && (
                              <span className="ml-1 text-[10px]">({v.upcomingChangePct > 0 ? "+" : ""}{v.upcomingChangePct.toFixed(1)}%)</span>
                            )}
                          </span>
                        ) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <ProductPriceHistory itemCode={product.itemCode} />
      </div>
    </div>
  );
}

function DiscontinuationBadge({ value }: { value: string | null | undefined }) {
  if (!value) return null;
  return (
    <span className="inline-flex rounded bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold text-destructive mt-1">
      Discontinued from {formatPriceDate(value)}
    </span>
  );
}
