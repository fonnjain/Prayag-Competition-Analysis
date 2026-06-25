import React, { useState } from "react";
import { useGetAnalysisFilters, getExportAnalysisUrl } from "@workspace/api-client-react";
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
import { Download, RefreshCw, Filter, ChevronDown } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

import { OverviewCards } from "@/components/dashboard/OverviewCards";
import { BrandComparison } from "@/components/dashboard/BrandComparison";
import { PositioningChart } from "@/components/dashboard/PositioningChart";
import { CategoryComparison } from "@/components/dashboard/CategoryComparison";
import { CoverageMatrix } from "@/components/dashboard/CoverageMatrix";
import { OpportunitiesThreats } from "@/components/dashboard/OpportunitiesThreats";

export type DashboardFilters = {
  competitor?: string[];
  division?: string;
  category?: string;
  matchConfidence?: string;
  matchStatus?: string;
};

export default function Dashboard() {
  const [filters, setFilters] = useState<DashboardFilters>({});
  
  const handleExport = (format: "xlsx" | "csv") => {
    const url = getExportAnalysisUrl({ ...filters, format });
    window.open(url, "_blank");
  };

  return (
    <div className="flex flex-col min-h-screen bg-muted/20">
      <header className="border-b bg-card text-card-foreground px-6 py-4 flex items-center justify-between sticky top-0 z-10 shadow-xs">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Competition Analysis</h1>
          <p className="text-sm text-muted-foreground font-mono mt-1">Prayag Pricing Cockpit</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => handleExport("csv")}>
            <Download className="h-4 w-4 mr-2" />
            CSV
          </Button>
          <Button size="sm" onClick={() => handleExport("xlsx")}>
            <Download className="h-4 w-4 mr-2" />
            Excel Export
          </Button>
        </div>
      </header>
      
      <main className="flex-1 p-6 space-y-6 max-w-[1600px] mx-auto w-full">
        <FilterBar filters={filters} onChange={setFilters} />
        
        <OverviewCards filters={filters} />
        
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

function FilterBar({ filters, onChange }: { filters: DashboardFilters, onChange: (f: DashboardFilters) => void }) {
  const { data, isLoading } = useGetAnalysisFilters();

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

        <div className="flex-1" />
        
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
