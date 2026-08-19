import { useRoute } from "wouter";
import { useGetCatalogProduct, getGetCatalogProductQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

export default function ProductDetailPage() {
  const [, params] = useRoute("/product/:itemCode");
  const itemCode = params?.itemCode || "";
  
  const { data, isLoading } = useGetCatalogProduct(itemCode, {
    query: { enabled: !!itemCode, queryKey: getGetCatalogProductQueryKey(itemCode) }
  });

  if (isLoading) {
    return <div className="p-8 text-center">Loading product...</div>;
  }

  if (!data) {
    return <div className="p-8 text-center">Product not found</div>;
  }

  const chartData = [...data.history].reverse().map(h => ({
    date: h.effectiveDate,
    mrp: h.mrp
  }));

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{data.product.productName || data.product.itemCode}</h1>
          <p className="text-lg text-muted-foreground mt-2 font-mono">{data.product.itemCode}</p>
        </div>
        <Button variant="outline" asChild>
          <a href={`/api/catalog/export?type=history&format=xlsx&itemCode=${itemCode}`} download>
            <Download className="w-4 h-4 mr-2" />
            Export History
          </a>
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-1 space-y-6">
          <div className="bg-card border rounded-lg p-6 space-y-4">
            <h3 className="font-semibold border-b pb-2">Product Details</h3>
            <div className="grid grid-cols-2 gap-y-4 text-sm">
              <div className="text-muted-foreground">Division</div>
              <div className="font-medium">{data.product.division || "-"}</div>
              <div className="text-muted-foreground">Category</div>
              <div className="font-medium">{data.product.category || "-"}</div>
              <div className="text-muted-foreground">Size</div>
              <div className="font-medium">{data.product.size || "-"}</div>
              <div className="text-muted-foreground">UOM</div>
              <div className="font-medium">{data.product.uom || "-"}</div>
            </div>
          </div>
        </div>

        <div className="col-span-2 space-y-6">
          {chartData.length > 1 && (
            <div className="bg-card border rounded-lg p-6">
              <h3 className="font-semibold mb-6">Price History</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="date" tick={{fontSize: 12}} />
                    <YAxis domain={['auto', 'auto']} tick={{fontSize: 12}} />
                    <Tooltip />
                    <Line type="stepAfter" dataKey="mrp" stroke="hsl(var(--primary))" strokeWidth={2} dot={{r: 4}} activeDot={{r: 6}} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          <div className="bg-card border rounded-lg overflow-hidden">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-3 font-medium text-muted-foreground">Effective Date</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground text-right">MRP</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground text-right">Net Price</th>
                  <th className="px-4 py-3 font-medium text-muted-foreground">Source</th>
                </tr>
              </thead>
              <tbody>
                {data.history.map((row) => (
                  <tr key={row.id} className={`border-b last:border-0 ${row.isCurrent ? 'bg-primary/5' : ''}`}>
                    <td className="px-4 py-3 font-mono">
                      {row.effectiveDate}
                      {row.isCurrent && (
                        <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-primary/20 text-primary">
                          CURRENT
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-medium">₹{row.mrp?.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                      {row.netPrice ? `₹${row.netPrice.toFixed(2)}` : '-'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground max-w-[200px] truncate" title={row.sourceFile || ''}>
                      {row.sourceFile}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
