import React, { useState } from "react";
import { useGetAnalysisOpportunities } from "@workspace/api-client-react";
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
            <TabsList className="grid w-full grid-cols-2 max-w-[400px] mb-4">
              <TabsTrigger value="opportunities" className="data-[state=active]:text-success">
                Margin Headroom ({data.marginHeadroom.length})
              </TabsTrigger>
              <TabsTrigger value="threats" className="data-[state=active]:text-destructive">
                Price Threats ({data.priceThreats.length})
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="opportunities" className="border rounded-md">
              <OpportunityTable items={data.marginHeadroom} isThreat={false} />
            </TabsContent>
            
            <TabsContent value="threats" className="border rounded-md">
              <OpportunityTable items={data.priceThreats} isThreat={true} />
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}

function OpportunityTable({ items, isThreat }: { items: AnalysisOpportunityItem[], isThreat: boolean }) {
  if (items.length === 0) {
    return <div className="p-8 text-center text-muted-foreground text-sm">No items found at this threshold.</div>;
  }

  return (
    <div className="max-h-[400px] overflow-auto">
      <Table>
        <TableHeader className="sticky top-0 bg-card z-10">
          <TableRow>
            <TableHead>SKU Code</TableHead>
            <TableHead>Product Name</TableHead>
            <TableHead>Competitor</TableHead>
            <TableHead className="text-right">Prayag MRP</TableHead>
            <TableHead className="text-right">Comp. Price</TableHead>
            <TableHead className="text-right">Gap %</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id}>
              <TableCell className="font-mono text-xs">{item.prayagCode || '-'}</TableCell>
              <TableCell className="max-w-[200px] truncate" title={item.prayagProductName || ''}>
                {item.prayagProductName || '-'}
              </TableCell>
              <TableCell>
                <Badge variant="outline" className="font-normal">{item.competitor}</Badge>
              </TableCell>
              <TableCell className="text-right">₹{item.prayagMrp?.toFixed(2) ?? '-'}</TableCell>
              <TableCell className="text-right">
                ₹{item.competitorEffectivePrice?.toFixed(2) ?? '-'}
                {item.unit && <span className="text-xs text-muted-foreground ml-1">/{item.unit}</span>}
              </TableCell>
              <TableCell className={`text-right font-bold ${isThreat ? 'text-destructive' : 'text-success'}`}>
                {item.priceDiffPct > 0 ? "+" : ""}{item.priceDiffPct.toFixed(1)}%
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
