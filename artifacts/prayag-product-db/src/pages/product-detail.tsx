import { formatMoney } from "@workspace/formatting";
import { BucketPageHeader } from "@/components/BucketSlot";
import { useRoute } from "wouter";
import { useAuth } from "@workspace/replit-auth-web";
import { BucketFilteredNotice, isBucketFiltered, useGetCatalogProduct, getGetCatalogProductQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { formatDisplayDate } from "@/lib/date-format";
import {
  itemCodeFromLocation,
  productHistoryExportHref,
} from "@/lib/product-links";

function statusBadgeClass(status: string): string {
  if (status === "Current") return "bg-primary/20 text-primary";
  if (status === "Upcoming") return "border border-orange-400 text-orange-600";
  return "bg-muted text-muted-foreground";
}

export default function ProductDetailPage() {
  const [, params] = useRoute("/product/:itemCode");
  const itemCode = itemCodeFromLocation(window.location.search, params?.itemCode);
  const productParams = { itemCode };
  
  const { user } = useAuth();
  const { data, isLoading, error } = useGetCatalogProduct(productParams, {
    query: {
      enabled: !!itemCode,
      queryKey: getGetCatalogProductQueryKey(productParams),
    },
  });

  if (isLoading) {
    return <div className="p-4 sm:p-6"><BucketPageHeader title={<h1 className="text-2xl font-bold">Product Details</h1>} />Loading product...</div>;
  }

  if (!data && isBucketFiltered(error)) {
    return <div className="p-4 sm:p-6"><BucketPageHeader title={<h1 className="text-2xl font-bold">Product Details</h1>} /><BucketFilteredNotice userId={user?.id} /></div>;
  }

  if (!data) {
    return <div className="p-4 sm:p-6"><BucketPageHeader title={<h1 className="text-2xl font-bold">Product Details</h1>} />Product not found</div>;
  }

  const chartData = [...data.history].reverse().map(h => ({
    date: formatDisplayDate(h.effectiveDate),
    mrp: h.mrp
  }));

  return (
    <div className="px-3 py-4 sm:px-5 lg:px-6 max-w-5xl mx-auto space-y-4">
      <BucketPageHeader title={<h1 className="text-2xl md:text-3xl font-bold tracking-tight">{data.product.productName || data.product.itemCode}</h1>} />
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground mt-1 font-mono">{data.product.itemCode}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" asChild>
          <a href={productHistoryExportHref(itemCode)} download>
            <Download className="w-4 h-4 mr-2" />
            Export History
          </a>
        </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-1">
          <div className="bg-card border rounded-lg p-4 space-y-3">
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

        <div className="space-y-4 lg:col-span-2">
          {chartData.length > 1 && (
            <div className="bg-card border rounded-lg p-4">
              <h3 className="font-semibold mb-3">Price History</h3>
              <div className="h-56 md:h-64">
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

          <div className="bg-card border rounded-lg overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm text-left">
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
                  <tr key={row.id} className={`border-b last:border-0 ${row.status === 'Current' ? 'bg-primary/5' : ''}`}>
                    <td className="px-4 py-3 font-mono">
                      {formatDisplayDate(row.effectiveDate)}
                      <span className={`ml-2 inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${statusBadgeClass(row.status)}`}>
                        {row.status.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-medium">{row.mrp == null ? "—" : formatMoney(row.mrp)}</td>
                    <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                      {row.netPrice != null ? `${formatMoney(row.netPrice)}` : '—'}
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
