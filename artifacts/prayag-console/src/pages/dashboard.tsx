import { useGetDashboard, useGetCategories, useGetProducts, useUpdateProduct, getGetDashboardQueryKey, getGetProductsQueryKey, getGetRecommendationsQueryKey, getGetCompetitorsQueryKey } from "@workspace/api-client-react";
import { useState, useRef, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, Legend, CartesianGrid, Cell } from "recharts";
import { formatPrice, formatPct, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Download, Pencil, Check, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

function StatusBadge({ status }: { status: string }) {
  const colors = {
    leader: "bg-success/20 text-success border-success/30",
    competitive: "bg-success/20 text-success border-success/30",
    above_market: "bg-warning/20 text-warning border-warning/30",
    overpriced: "bg-destructive/20 text-destructive border-destructive/30",
    no_data: "bg-muted text-muted-foreground border-border",
  };
  const labels = {
    leader: "Leader",
    competitive: "Competitive",
    above_market: "Above Market",
    overpriced: "Overpriced",
    no_data: "No Data",
  };
  return (
    <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-medium border uppercase tracking-wider", colors[status as keyof typeof colors])}>
      {labels[status as keyof typeof labels] || status}
    </span>
  );
}

function EditablePrice({ value, onSave, isEditing, setEditing }: { value: number | null, onSave: (val: number | null) => void, isEditing: boolean, setEditing: (editing: boolean) => void }) {
  const [val, setVal] = useState(value ? value.toString() : "");

  useEffect(() => {
    if (!isEditing) setVal(value ? value.toString() : "");
  }, [value, isEditing]);

  if (isEditing) {
    return (
      <div className="flex items-center gap-1">
        <Input 
          autoFocus
          className="h-6 w-20 text-xs px-1 py-0 text-right font-mono" 
          value={val} 
          onChange={e => setVal(e.target.value)} 
          onKeyDown={e => {
            if (e.key === 'Enter') {
              const num = parseFloat(val);
              onSave(isNaN(num) ? null : num);
            }
            if (e.key === 'Escape') {
              setEditing(false);
            }
          }}
        />
        <Button variant="ghost" size="icon" className="h-5 w-5 hover:bg-success/20 text-success" onClick={() => {
          const num = parseFloat(val);
          onSave(isNaN(num) ? null : num);
        }}>
          <Check className="h-3 w-3" />
        </Button>
        <Button variant="ghost" size="icon" className="h-5 w-5 hover:bg-destructive/20 text-destructive" onClick={() => setEditing(false)}>
          <X className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  return (
    <div className="group flex items-center justify-end gap-1 cursor-pointer" onClick={() => setEditing(true)}>
      <span className="font-mono text-xs">{formatPrice(value)}</span>
      <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-100 text-muted-foreground transition-opacity" />
    </div>
  );
}

export default function Dashboard() {
  const [category, setCategory] = useState<string>("");
  const [search, setSearch] = useState("");
  const [onlyRivalCheaper, setOnlyRivalCheaper] = useState(false);
  
  const { data: dashboard, isLoading: isLoadingDashboard } = useGetDashboard();
  const { data: categories } = useGetCategories();
  
  const queryParams = {
    category: category && category !== "all" ? category : undefined,
    search: search || undefined,
    onlyRivalCheaper: onlyRivalCheaper || undefined,
  };
  
  const { data: productsData, isLoading: isLoadingProducts } = useGetProducts(queryParams, { query: { queryKey: getGetProductsQueryKey(queryParams) } });
  
  const updateProduct = useUpdateProduct();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [editingCell, setEditingCell] = useState<{ itemCode: string, field: 'prayagMrp' | 'prayagNet' | 'kgCost' } | null>(null);

  const handleSavePrice = (itemCode: string, field: 'prayagMrp' | 'prayagNet' | 'kgCost', val: number | null) => {
    updateProduct.mutate({ itemCode, data: { [field]: val } }, {
      onSuccess: () => {
        toast({ description: "Price updated. Recalculating matrix..." });
        queryClient.invalidateQueries({ queryKey: getGetProductsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetRecommendationsQueryKey() });
        setEditingCell(null);
      },
      onError: (err) => {
        toast({ title: "Failed to update price", description: err.message, variant: "destructive" });
      }
    });
  };

  const exportUrl = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/export?type=comparison&format=xlsx`;

  return (
    <div className="flex-1 p-6 space-y-6 overflow-y-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-primary">Competition Dashboard</h2>
          <p className="text-muted-foreground text-sm">Real-time market positioning and price intelligence.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <a href={exportUrl} download>
              <Download className="w-4 h-4 mr-2" />
              Export Matrix
            </a>
          </Button>
        </div>
      </div>

      {isLoadingDashboard ? (
        <div className="grid gap-4 md:grid-cols-4">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-32 rounded-xl" />)}
        </div>
      ) : dashboard ? (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-4">
            <Card className="border-primary/20 bg-primary/5">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-primary">Competitive Share</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-primary">{formatPct(dashboard.competitiveShare * 100)}</div>
                <p className="text-xs text-muted-foreground mt-1">Of {formatNumber(dashboard.comparedProducts)} compared products</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Leader / Competitive</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-success">{formatNumber(dashboard.leaderCount + dashboard.competitiveCount)}</div>
                <p className="text-xs text-muted-foreground mt-1">Winning on price</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Above Market</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-warning">{formatNumber(dashboard.aboveMarketCount)}</div>
                <p className="text-xs text-muted-foreground mt-1">Slightly higher than median</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Overpriced</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-destructive">{formatNumber(dashboard.overpricedCount)}</div>
                <p className="text-xs text-muted-foreground mt-1">More expensive than all rivals</p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Win Rates by Competitor</CardTitle>
              </CardHeader>
              <CardContent className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dashboard.competitorWinRates} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                    <XAxis type="number" tickFormatter={(v) => `${v}%`} tick={{fontSize: 12, fill: 'hsl(var(--muted-foreground))'}} />
                    <YAxis dataKey="competitor" type="category" tick={{fontSize: 12, fill: 'hsl(var(--foreground))'}} width={100} />
                    <RechartsTooltip 
                      formatter={(val: number) => [`${val.toFixed(1)}%`, 'Win Rate']}
                      contentStyle={{ borderRadius: '8px', border: '1px solid hsl(var(--border))', backgroundColor: 'hsl(var(--card))', color: 'hsl(var(--card-foreground))' }}
                    />
                    <Bar dataKey="prayagCheaperPct" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]}>
                      {dashboard.competitorWinRates.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.prayagCheaperPct && entry.prayagCheaperPct > 50 ? 'hsl(var(--success))' : 'hsl(var(--primary))'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Category Breakdown</CardTitle>
              </CardHeader>
              <CardContent className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dashboard.categoryBreakdown} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis dataKey="category" tick={{fontSize: 12, fill: 'hsl(var(--muted-foreground))'}} />
                    <YAxis tick={{fontSize: 12, fill: 'hsl(var(--muted-foreground))'}} />
                    <RechartsTooltip 
                      contentStyle={{ borderRadius: '8px', border: '1px solid hsl(var(--border))', backgroundColor: 'hsl(var(--card))', color: 'hsl(var(--card-foreground))' }}
                    />
                    <Legend wrapperStyle={{fontSize: '12px'}} />
                    <Bar dataKey="leader" stackId="a" fill="hsl(var(--success))" name="Leader" />
                    <Bar dataKey="competitive" stackId="a" fill="hsl(var(--success))" fillOpacity={0.6} name="Competitive" />
                    <Bar dataKey="aboveMarket" stackId="a" fill="hsl(var(--warning))" name="Above Market" />
                    <Bar dataKey="overpriced" stackId="a" fill="hsl(var(--destructive))" name="Overpriced" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Comparison Matrix</CardTitle>
          <div className="flex flex-col sm:flex-row gap-4 pt-4">
            <div className="w-full sm:w-64">
              <Input 
                placeholder="Search code or size..." 
                value={search} 
                onChange={(e) => setSearch(e.target.value)} 
              />
            </div>
            <div className="w-full sm:w-48">
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue placeholder="All Categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {categories?.map(c => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center space-x-2 border rounded-md px-3 border-border">
              <Switch id="rival-cheaper" checked={onlyRivalCheaper} onCheckedChange={setOnlyRivalCheaper} />
              <Label htmlFor="rival-cheaper" className="text-sm font-medium cursor-pointer">Show only where rival is cheaper</Label>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto relative">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="sticky left-0 bg-muted/95 backdrop-blur z-20 w-[120px] font-semibold border-r">Item Code</TableHead>
                  <TableHead className="w-[100px] font-semibold">Size</TableHead>
                  <TableHead className="w-[100px] font-semibold">Status</TableHead>
                  <TableHead className="w-[100px] text-right font-semibold">Prayag MRP</TableHead>
                  <TableHead className="w-[100px] text-right font-semibold">Prayag Net</TableHead>
                  {productsData?.competitors.map(comp => (
                    <TableHead key={comp.name} className="text-right whitespace-nowrap min-w-[120px] font-semibold">
                      {comp.name} <span className="text-[10px] text-muted-foreground ml-1">({comp.basis})</span>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoadingProducts ? (
                  Array.from({length: 5}).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={10}><Skeleton className="h-8 w-full" /></TableCell>
                    </TableRow>
                  ))
                ) : productsData?.rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-12 text-muted-foreground">No products found matching filters.</TableCell>
                  </TableRow>
                ) : productsData?.rows.map((row) => (
                  <TableRow key={row.itemCode} className={cn(row.edited && "bg-accent/10")}>
                    <TableCell className="font-mono text-xs font-medium sticky left-0 bg-background z-10 border-r">{row.itemCode}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{row.size || '—'}</TableCell>
                    <TableCell><StatusBadge status={row.status} /></TableCell>
                    <TableCell className="text-right">
                      <EditablePrice 
                        value={row.prayagMrp} 
                        isEditing={editingCell?.itemCode === row.itemCode && editingCell?.field === 'prayagMrp'}
                        setEditing={(e) => setEditingCell(e ? { itemCode: row.itemCode, field: 'prayagMrp' } : null)}
                        onSave={(v) => handleSavePrice(row.itemCode, 'prayagMrp', v)}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <EditablePrice 
                        value={row.prayagNet} 
                        isEditing={editingCell?.itemCode === row.itemCode && editingCell?.field === 'prayagNet'}
                        setEditing={(e) => setEditingCell(e ? { itemCode: row.itemCode, field: 'prayagNet' } : null)}
                        onSave={(v) => handleSavePrice(row.itemCode, 'prayagNet', v)}
                      />
                    </TableCell>
                    {productsData.competitors.map(comp => {
                      const cell = row.competitors.find(c => c.competitor === comp.name);
                      if (!cell || cell.price == null) return <TableCell key={comp.name} className="text-right text-muted-foreground">—</TableCell>;
                      const isBad = cell.diffPct && cell.diffPct < 0;
                      const isGood = cell.diffPct && cell.diffPct > 0;
                      return (
                        <TableCell key={comp.name} className={cn("text-right font-mono text-xs border-l border-border/50", cell.isCheapest && "bg-muted/30")}>
                          <div className={cn(
                            "flex flex-col items-end",
                            isBad ? "text-destructive font-medium" : isGood ? "text-success" : ""
                          )}>
                            <span>{formatPrice(cell.price)}</span>
                            {cell.diffPct != null && (
                              <span className={cn(
                                "text-[10px] mt-0.5 px-1 rounded-sm",
                                isBad ? "bg-destructive/10" : isGood ? "bg-success/10" : ""
                              )}>
                                {cell.diffPct > 0 ? '+' : ''}{cell.diffPct.toFixed(1)}%
                              </span>
                            )}
                          </div>
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
