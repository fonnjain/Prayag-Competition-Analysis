import React, { useState } from "react";
import { useGetAnalysisOpportunities, useGetPriceHistory, useGetMrpIncreases } from "@workspace/api-client-react";
import type { AnalysisOpportunityItem } from "@workspace/api-client-react";
import type { DashboardFilters } from "@/pages/dashboard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChevronDown, ChevronRight, TrendingUp, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

function shortDate(value?: string | null): string {
  if (!value) return "date unavailable";
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function validityLabel(from?: string | null, to?: string | null): string | null {
  if (!from) return null;
  return to
    ? `Valid ${shortDate(from)} – ${shortDate(to)}`
    : `Valid from ${shortDate(from)}`;
}

function RevisionLine({
  current,
  next,
  nextDate,
  changePct,
}: {
  current?: number | null;
  next?: number | null;
  nextDate?: string | null;
  changePct?: number | null;
}) {
  if (current == null || next == null || !nextDate) return null;
  const unchanged = current === next;
  return (
    <div className="mt-0.5 whitespace-nowrap text-[10px] font-normal text-orange-600">
      {unchanged
        ? `No change on ${shortDate(nextDate)}`
        : `${next > current ? "↑" : "↓"} ₹${next.toFixed(2)} on ${shortDate(nextDate)}${
            changePct == null
              ? ""
              : ` (${changePct > 0 ? "+" : ""}${changePct.toFixed(1)}%)`
          }`}
    </div>
  );
}

export function OpportunitiesThreats({ filters }: { filters: DashboardFilters }) {
  const [thresholdPct, setThresholdPct] = useState(10);

  const { data, isLoading } = useGetAnalysisOpportunities({ ...filters, thresholdPct } as any);

  return (
    <Card className="h-full flex flex-col col-span-1 lg:col-span-2">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          Opportunities & Threats
        </CardTitle>
        <div className="flex items-center gap-2">
          <Label htmlFor="threshold" className="text-xs text-muted-foreground">Threshold %</Label>
          <Input
            id="threshold"
            type="number"
            value={thresholdPct}
            onChange={(e) => setThresholdPct(Number(e.target.value) || 0)}
            className="w-20 h-8 text-sm"
          />
        </div>
      </CardHeader>
      <CardContent className="flex-1">
        {isLoading || !data ? (
          <Skeleton className="h-[400px] w-full" />
        ) : (
          <Tabs defaultValue="opportunities" className="w-full">
            <TabsList className="grid w-full grid-cols-3 max-w-[560px] mb-4">
              <TabsTrigger value="opportunities" className="data-[state=active]:text-success">
                Margin Headroom ({data.marginHeadroom.length})
              </TabsTrigger>
              <TabsTrigger value="threats" className="data-[state=active]:text-destructive">
                Price Threats ({data.priceThreats.length})
              </TabsTrigger>
              <TabsTrigger value="mrp-increases" className="data-[state=active]:text-orange-600">
                <TrendingUp className="h-3.5 w-3.5 mr-1" />
                MRP Increases
              </TabsTrigger>
            </TabsList>

            <TabsContent value="opportunities" className="border rounded-md">
              <OpportunityTable items={data.marginHeadroom} isThreat={false} prayagMrpDate={data.prayagMrpDate} />
            </TabsContent>

            <TabsContent value="threats" className="border rounded-md">
              <OpportunityTable items={data.priceThreats} isThreat={true} prayagMrpDate={data.prayagMrpDate} />
            </TabsContent>

            <TabsContent value="mrp-increases" className="border rounded-md">
              <BiggestMrpIncreasesTab filters={filters} />
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Expandable opportunity/threat table ────────────────────────────────────

function OpportunityTable({ items, isThreat, prayagMrpDate }: { items: AnalysisOpportunityItem[]; isThreat: boolean; prayagMrpDate?: string }) {
  const [expandedCode, setExpandedCode] = useState<string | null>(null);

  if (items.length === 0) {
    return <div className="p-8 text-center text-muted-foreground text-sm">No items found at this threshold.</div>;
  }

  return (
    <div className="max-h-[500px] overflow-auto">
      <Table>
        <TableHeader className="sticky top-0 bg-card z-10">
          <TableRow>
            <TableHead className="w-6" />
            <TableHead>SKU Code</TableHead>
            <TableHead>Product Name</TableHead>
            <TableHead>Competitor</TableHead>
            <TableHead className="text-right">
              Prayag MRP{prayagMrpDate ? <span className="font-normal text-muted-foreground ml-1">(as of {prayagMrpDate})</span> : null}
            </TableHead>
            <TableHead className="text-right">Comp. Price</TableHead>
            <TableHead className="text-right">Gap %</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => {
            const isExpanded = expandedCode === item.prayagCode;
            return (
              <React.Fragment key={item.id}>
                <TableRow
                  className={cn(
                    "cursor-pointer hover:bg-muted/40 transition-colors",
                    isExpanded && "bg-muted/30"
                  )}
                  onClick={() => setExpandedCode(isExpanded ? null : (item.prayagCode ?? null))}
                >
                  <TableCell className="pr-0">
                    {item.prayagCode ? (
                      isExpanded
                        ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                        : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                    ) : null}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{item.prayagCode || '-'}</TableCell>
                  <TableCell className="max-w-[200px] truncate" title={item.prayagProductName || ''}>
                    {item.prayagProductName || '-'}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="font-normal">{item.competitor}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div>₹{item.prayagMrp?.toFixed(2) ?? '-'}</div>
                    <div className="mt-0.5 whitespace-nowrap text-[10px] font-normal text-muted-foreground">
                      {validityLabel(item.prayagEffectiveDate, item.prayagValidTo)}
                    </div>
                    <RevisionLine
                      current={item.prayagMrp}
                      next={item.upcomingPrayagMrp}
                      nextDate={item.upcomingPrayagMrpDate}
                      changePct={item.upcomingPrayagChangePct}
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <div>
                      ₹{item.competitorEffectivePrice?.toFixed(2) ?? '-'}
                      {item.unit && <span className="text-xs text-muted-foreground ml-1">/{item.unit}</span>}
                    </div>
                    <div className="mt-0.5 whitespace-nowrap text-[10px] font-normal text-muted-foreground">
                      {validityLabel(item.competitorEffectiveDate, item.competitorValidTo)}
                    </div>
                    <RevisionLine
                      current={item.competitorEffectivePrice}
                      next={item.upcomingCompetitorEffectivePrice}
                      nextDate={item.upcomingCompetitorPriceDate}
                      changePct={item.upcomingCompetitorChangePct}
                    />
                  </TableCell>
                  <TableCell className={`text-right font-bold ${isThreat ? 'text-destructive' : 'text-success'}`}>
                    {item.priceDiffPct > 0 ? "+" : ""}{item.priceDiffPct.toFixed(1)}%
                  </TableCell>
                </TableRow>
                {isExpanded && item.prayagCode && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={7} className="p-0 border-b">
                      <PriceHistoryPanel itemCode={item.prayagCode} />
                    </TableCell>
                  </TableRow>
                )}
              </React.Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

// ─── Per-product price history panel ────────────────────────────────────────

function PriceHistoryPanel({ itemCode }: { itemCode: string }) {
  const { data, isLoading } = useGetPriceHistory(itemCode);
  const todayStr = new Date().toISOString().slice(0, 10);

  if (isLoading || !data) {
    return (
      <div className="p-4 bg-muted/20 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading price history…
      </div>
    );
  }

  const hasAnyHistory =
    data.prayagHistory.length > 0 || data.competitorHistory.length > 0;

  if (!hasAnyHistory) {
    return (
      <div className="p-4 bg-muted/20 text-sm text-muted-foreground">
        No price history available for {itemCode}.
      </div>
    );
  }

  return (
    <div className="bg-muted/10 border-t px-4 py-3 space-y-4">
      {/* Prayag MRP history */}
      {data.prayagHistory.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Prayag MRP History
          </p>
          <div className="rounded border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="h-7 py-1 text-xs">Effective Date</TableHead>
                  <TableHead className="h-7 py-1 text-xs">Basis</TableHead>
                  <TableHead className="h-7 py-1 text-xs text-right">MRP</TableHead>
                  <TableHead className="h-7 py-1 text-xs text-right">Change</TableHead>
                  <TableHead className="h-7 py-1 text-xs">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.prayagHistory.map((p) => (
                  <TableRow key={p.effectiveDate} className="text-xs">
                    <TableCell className="py-1.5 font-mono">{p.effectiveDate}</TableCell>
                    <TableCell className="py-1.5 text-muted-foreground">{p.priceBasis ?? '—'}</TableCell>
                    <TableCell className="py-1.5 text-right font-medium">
                      {p.mrp != null ? `₹${p.mrp.toFixed(2)}` : '—'}
                    </TableCell>
                    <TableCell className="py-1.5 text-right">
                      {p.changePct != null ? (
                        <span className={cn(
                          "font-semibold",
                          p.changePct > 0 ? "text-orange-600" : p.changePct < 0 ? "text-success" : "text-muted-foreground"
                        )}>
                          {p.changePct > 0 ? "+" : ""}{p.changePct.toFixed(1)}%
                        </span>
                      ) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="py-1.5">
                      {p.effectiveDate > todayStr ? (
                        <Badge variant="outline" className="text-[10px] h-4 px-1 border-orange-400 text-orange-600">Upcoming</Badge>
                      ) : p.isCurrent ? (
                        <Badge variant="secondary" className="text-[10px] h-4 px-1">Current</Badge>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Competitor price history */}
      {data.competitorHistory.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Competitor Price History
          </p>
          <div className="space-y-3">
            {data.competitorHistory.map((comp) => (
              <div key={comp.competitor}>
                <p className="text-xs font-medium mb-1">
                  <Badge variant="outline" className="font-normal text-xs">{comp.competitor}</Badge>
                </p>
                <div className="rounded border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/30">
                        <TableHead className="h-7 py-1 text-xs">Effective Date</TableHead>
                        <TableHead className="h-7 py-1 text-xs text-right">Listed Price</TableHead>
                        <TableHead className="h-7 py-1 text-xs text-right">Effective Price</TableHead>
                        <TableHead className="h-7 py-1 text-xs text-right">Change</TableHead>
                        <TableHead className="h-7 py-1 text-xs">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {comp.periods.map((p) => (
                        <TableRow key={p.effectiveDate} className="text-xs">
                          <TableCell className="py-1.5 font-mono">{p.effectiveDate}</TableCell>
                          <TableCell className="py-1.5 text-right">
                            {p.price != null ? `₹${p.price.toFixed(2)}` : '—'}
                            {p.unit && <span className="text-muted-foreground ml-1">/{p.unit}</span>}
                          </TableCell>
                          <TableCell className="py-1.5 text-right font-medium">
                            ₹{p.effectivePrice.toFixed(2)}
                          </TableCell>
                          <TableCell className="py-1.5 text-right">
                            {p.changePct != null ? (
                              <span className={cn(
                                "font-semibold",
                                p.changePct > 0 ? "text-orange-600" : p.changePct < 0 ? "text-success" : "text-muted-foreground"
                              )}>
                                {p.changePct > 0 ? "+" : ""}{p.changePct.toFixed(1)}%
                              </span>
                            ) : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell className="py-1.5">
                            {p.isCurrent && (
                              <Badge variant="secondary" className="text-[10px] h-4 px-1">Current</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Biggest MRP Increases tab ───────────────────────────────────────────────

function BiggestMrpIncreasesTab({ filters }: { filters: { division?: string; category?: string; effectivePeriod?: string } }) {
  const { data, isLoading } = useGetMrpIncreases({
    division: filters.division,
    category: filters.category,
    effectivePeriod: filters.effectivePeriod,
    limit: 100,
  });

  if (isLoading || !data) {
    return (
      <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading MRP increase data…
      </div>
    );
  }

  if (data.items.length === 0) {
    return (
      <div className="p-8 text-center text-muted-foreground text-sm">
        No MRP increases found for the current period. All products are at or below their previous MRP.
      </div>
    );
  }

  return (
    <div className="max-h-[500px] overflow-auto">
      <Table>
        <TableHeader className="sticky top-0 bg-card z-10">
          <TableRow>
            <TableHead>SKU Code</TableHead>
            <TableHead>Product Name</TableHead>
            <TableHead>Category</TableHead>
            <TableHead className="text-right">Previous MRP</TableHead>
            <TableHead className="text-right">Current MRP</TableHead>
            <TableHead className="text-right">Increase</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.items.map((row) => (
            <TableRow key={row.itemCode}>
              <TableCell className="font-mono text-xs">{row.itemCode}</TableCell>
              <TableCell
                className="max-w-[200px] truncate text-sm"
                title={row.productName ?? ''}
              >
                {row.productName || '—'}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {row.category || '—'}
              </TableCell>
              <TableCell className="text-right text-muted-foreground">
                ₹{row.prevMrp.toFixed(2)}
                <span className="text-xs ml-1">({row.prevDate})</span>
              </TableCell>
              <TableCell className="text-right font-medium">
                ₹{row.currentMrp.toFixed(2)}
                <span className="text-xs text-muted-foreground ml-1">({row.currentDate})</span>
              </TableCell>
              <TableCell className="text-right">
                <span className="font-bold text-orange-600">
                  +{row.changePct.toFixed(1)}%
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
