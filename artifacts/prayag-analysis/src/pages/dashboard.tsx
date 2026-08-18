import React, { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { useGetAnalysisFilters, useGetAnalysisPeriods, getExportAnalysisUrl } from "@workspace/api-client-react";
import { 
  Card,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  DropdownMenu, 
  DropdownMenuCheckboxItem, 
  DropdownMenuContent, 
  DropdownMenuLabel, 
  DropdownMenuSeparator, 
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import { Download, RefreshCw, Filter, ChevronDown, Settings, Scale, LogOut, Home, Database, CalendarDays } from "lucide-react";
import { useAuth } from "@workspace/replit-auth-web";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { OverviewCards } from "@/components/dashboard/OverviewCards";
import { BrandComparison } from "@/components/dashboard/BrandComparison";
import { PositioningChart } from "@/components/dashboard/PositioningChart";
import { CategoryComparison } from "@/components/dashboard/CategoryComparison";
import { CoverageMatrix } from "@/components/dashboard/CoverageMatrix";
import { OpportunitiesThreats } from "@/components/dashboard/OpportunitiesThreats";

export type CompareMode = "mrp" | "net";

export type DashboardFilters = {
  competitor?: string[];
  division?: string;
  category?: string;
  matchConfidence?: string;
  matchStatus?: string;
  mode?: CompareMode;
  effectivePeriod?: string;
};

export default function Dashboard() {
  const { user, logout } = useAuth();
  const [mode, setMode] = useState<CompareMode>("mrp");
  const [baseFilters, setBaseFilters] = useState<DashboardFilters>({});
  const [prayagMrpDate, setPrayagMrpDate] = useState<string | null>(null);
  // undefined = overview data not yet received; null = loaded but no competitor
  // rows exist for this period; string = the resolved period date.
  const [competitorPeriodDate, setCompetitorPeriodDate] = useState<string | null | undefined>(undefined);
  // Mode rides along inside the filters object so every child hook + the export
  // URL pick it up automatically. "mrp" is the default and is omitted.
  const filters: DashboardFilters =
    mode === "net" ? { ...baseFilters, mode } : baseFilters;

  const handleExport = (format: "xlsx" | "csv") => {
    const url = getExportAnalysisUrl({ ...filters, format });
    window.open(url, "_blank");
  };

  const handlePrayagMrpDate = useCallback((date: string | null) => {
    setPrayagMrpDate(date);
  }, []);

  const handleCompetitorPeriodDate = useCallback((date: string | null | undefined) => {
    // undefined = still loading, null = loaded but no data, string = resolved date
    setCompetitorPeriodDate(date);
  }, []);

  return (
    <div className="flex flex-col min-h-screen bg-muted/20">
      <header className="border-b bg-card text-card-foreground px-6 py-4 flex items-center justify-between sticky top-0 z-10 shadow-xs">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 pr-4 border-r border-border">
            <a
              href="/"
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              title="Home"
            >
              <Home className="h-4 w-4" />
              <span className="hidden sm:inline">Home</span>
            </a>
            <span className="text-border">/</span>
            <a
              href="/product-db/"
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              title="Product Database"
            >
              <Database className="h-4 w-4" />
              <span className="hidden sm:inline">Product DB</span>
            </a>
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Competition Analysis</h1>
            <p className="text-sm text-muted-foreground font-mono mt-1">Prayag Pricing Cockpit</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <ModeToggle mode={mode} onChange={setMode} />
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => handleExport("csv")}>
              <Download className="h-4 w-4 mr-2" />
              CSV
            </Button>
            <Button size="sm" onClick={() => handleExport("xlsx")}>
              <Download className="h-4 w-4 mr-2" />
              Excel Export
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/settings/discounts">
                <Settings className="h-4 w-4 mr-2" />
                Discounts
              </Link>
            </Button>
          </div>
          <div className="flex items-center gap-2 pl-2 border-l border-border">
            {user && (
              <span className="text-sm text-muted-foreground hidden md:block">{[user.firstName, user.lastName].filter(Boolean).join(" ") || user.email || "User"}</span>
            )}
            <Button variant="ghost" size="sm" onClick={logout} title="Log out">
              <LogOut className="h-4 w-4 mr-2" />
              Log out
            </Button>
          </div>
        </div>
      </header>
      
      <main className="flex-1 p-6 space-y-6 max-w-[1600px] mx-auto w-full">
        <FilterBar filters={baseFilters} onChange={setBaseFilters} prayagMrpDate={prayagMrpDate} competitorPeriodDate={competitorPeriodDate} />
        
        <OverviewCards filters={filters} onPrayagMrpDate={handlePrayagMrpDate} onCompetitorPeriodDate={handleCompetitorPeriodDate} />
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="h-[400px]">
            <BrandComparison filters={filters} />
          </div>
          <div className="h-[400px]">
            <PositioningChart filters={filters} />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="min-h-[400px]">
            <CategoryComparison filters={filters} />
          </div>
          <div className="min-h-[400px]">
            <CoverageMatrix filters={filters} />
          </div>
        </div>

        <div className="min-h-[400px]">
          <OpportunitiesThreats filters={filters} />
        </div>
      </main>
    </div>
  );
}

function ModeToggle({ mode, onChange }: { mode: CompareMode; onChange: (m: CompareMode) => void }) {
  const options: { value: CompareMode; label: string }[] = [
    { value: "mrp", label: "MRP-to-MRP" },
    { value: "net", label: "Net-to-Net" },
  ];
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider flex items-center gap-1">
        <Scale className="h-3 w-3" /> Comparison Basis
      </span>
      <div className="inline-flex rounded-md border bg-muted/40 p-0.5" role="group" aria-label="Comparison basis">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={mode === o.value}
            data-testid={`mode-${o.value}`}
            className={cn(
              "px-3 py-1 text-xs font-medium rounded-[5px] transition-colors",
              mode === o.value
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function FilterBar({
  filters,
  onChange,
  prayagMrpDate,
  competitorPeriodDate,
}: {
  filters: DashboardFilters;
  onChange: (f: DashboardFilters) => void;
  prayagMrpDate?: string | null;
  // undefined = overview not yet loaded; null = loaded but no competitor data;
  // string = the resolved competitor period date.
  competitorPeriodDate?: string | null | undefined;
}) {
  const { data, isLoading } = useGetAnalysisFilters();
  const { data: periodsData } = useGetAnalysisPeriods();

  if (isLoading || !data) {
    return <Skeleton className="h-16 w-full" />;
  }

  const handleClear = () => onChange({});

  const toggleCompetitor = (comp: string) => {
    const current = filters.competitor || [];
    const updated = current.includes(comp) 
      ? current.filter(c => c !== comp) 
      : [...current, comp];
    
    onChange({ ...filters, competitor: updated.length > 0 ? updated : undefined });
  };

  return (
    <Card className="shadow-xs border-muted">
      <div className="p-3 flex flex-wrap gap-4 items-end">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground mr-2 h-8">
          <Filter className="h-4 w-4" />
          Filters
        </div>

        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider px-1">Competitors</label>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="w-[180px] h-8 justify-between text-sm font-normal">
                {filters.competitor && filters.competitor.length > 0 
                  ? `${filters.competitor.length} Selected` 
                  : "All Competitors"}
                <ChevronDown className="h-4 w-4 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-[200px]">
              <DropdownMenuLabel>Brands</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {data.competitors.map(c => (
                <DropdownMenuCheckboxItem 
                  key={c} 
                  checked={(filters.competitor || []).includes(c)}
                  onCheckedChange={() => toggleCompetitor(c)}
                >
                  {c}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        
        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider px-1">Division</label>
          <Select 
            value={filters.division || "all"} 
            onValueChange={(v) => onChange({ ...filters, division: v === "all" ? undefined : v })}
          >
            <SelectTrigger className="w-[180px] h-8 text-sm bg-background">
              <SelectValue placeholder="All Divisions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Divisions</SelectItem>
              {data.divisions.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider px-1">Category</label>
          <Select 
            value={filters.category || "all"} 
            onValueChange={(v) => onChange({ ...filters, category: v === "all" ? undefined : v })}
          >
            <SelectTrigger className="w-[180px] h-8 text-sm bg-background">
              <SelectValue placeholder="All Categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {data.categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider px-1">Confidence</label>
          <Select 
            value={filters.matchConfidence || "all"} 
            onValueChange={(v) => onChange({ ...filters, matchConfidence: v === "all" ? undefined : v })}
          >
            <SelectTrigger className="w-[150px] h-8 text-sm bg-background">
              <SelectValue placeholder="All Confidences" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Confidences</SelectItem>
              {data.matchConfidences.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <label className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider px-1">Status</label>
          <Select 
            value={filters.matchStatus || "all"} 
            onValueChange={(v) => onChange({ ...filters, matchStatus: v === "all" ? undefined : v })}
          >
            <SelectTrigger className="w-[150px] h-8 text-sm bg-background">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              {data.matchStatuses.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {periodsData && periodsData.periods.length > 1 && (
          <div className="space-y-1">
            <label className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider px-1">Period</label>
            <Select
              value={filters.effectivePeriod || "__latest__"}
              onValueChange={(v) =>
                onChange({ ...filters, effectivePeriod: v === "__latest__" ? undefined : v })
              }
            >
              <SelectTrigger className="w-[160px] h-8 text-sm bg-background" data-testid="period-select-trigger">
                <SelectValue placeholder="Latest" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__latest__">Latest (auto)</SelectItem>
                {periodsData.periods.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                    {periodsData.isFuturePeriod[p] ? " ⏳" : p === periodsData.defaultPeriod ? " ✓" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="flex-1" />

        {prayagMrpDate && (
          <div className="flex items-center gap-1.5 h-8 px-3 rounded-md border border-border bg-muted/40 text-xs text-muted-foreground font-medium whitespace-nowrap" title="Prayag MRP revision used for this comparison">
            <CalendarDays className="h-3.5 w-3.5 shrink-0" />
            Prayag MRP as of {prayagMrpDate}
          </div>
        )}

        {/* competitorPeriodDate === undefined means overview data is still loading;
            null means data loaded but no competitor rows exist for this period. */}
        {competitorPeriodDate !== undefined && (
          competitorPeriodDate === null ? (
            <div
              className="flex items-center gap-1.5 h-8 px-3 rounded-md border border-amber-200 bg-amber-50 text-xs text-amber-700 font-medium whitespace-nowrap dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-400"
              title="No competitor prices have been imported for this period"
              data-testid="competitor-period-no-data"
            >
              <CalendarDays className="h-3.5 w-3.5 shrink-0" />
              No competitor data for this period
            </div>
          ) : (
            <div
              className="flex items-center gap-1.5 h-8 px-3 rounded-md border border-border bg-muted/40 text-xs text-muted-foreground font-medium whitespace-nowrap"
              title="Latest competitor price date used for this comparison"
              data-testid="competitor-period-date"
            >
              <CalendarDays className="h-3.5 w-3.5 shrink-0" />
              Competitor prices as of {competitorPeriodDate}
            </div>
          )
        )}

        {Object.keys(filters).some(k => (filters as any)[k] !== undefined) && (
          <Button variant="ghost" size="sm" onClick={handleClear} className="h-8 text-muted-foreground">
            <RefreshCw className="h-3 w-3 mr-2" />
            Clear
          </Button>
        )}
      </div>
    </Card>
  );
}
