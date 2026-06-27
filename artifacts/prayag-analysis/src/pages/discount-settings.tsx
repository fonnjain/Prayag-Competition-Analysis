import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  useGetDiscountSettings,
  useUpdateDiscountSettings,
  getGetDiscountSettingsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Scale } from "lucide-react";

function isValidPct(s: string): boolean {
  if (s.trim() === "") return false;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n <= 100;
}

export default function DiscountSettings() {
  const { data, isLoading } = useGetDiscountSettings();
  const update = useUpdateDiscountSettings();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [prayag, setPrayag] = useState("");
  const [comps, setComps] = useState<Record<string, string>>({});

  useEffect(() => {
    if (data) {
      setPrayag(String(data.prayagDiscountPct));
      const next: Record<string, string> = {};
      for (const c of data.competitors) next[c.scope] = String(c.discountPct);
      setComps(next);
    }
  }, [data]);

  const invalidPrayag = !isValidPct(prayag);
  const invalidComps = Object.values(comps).some((v) => !isValidPct(v));
  const hasErrors = invalidPrayag || invalidComps;

  const handleSave = () => {
    if (hasErrors) return;
    update.mutate(
      {
        data: {
          prayagDiscountPct: Number(prayag),
          competitors: Object.entries(comps).map(([scope, v]) => ({
            scope,
            discountPct: Number(v),
          })),
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetDiscountSettingsQueryKey() });
          // The dashboard's Net-to-Net figures depend on these discounts.
          queryClient.invalidateQueries();
          toast({ description: "Discount settings saved." });
        },
        onError: () => {
          toast({
            variant: "destructive",
            description: "Could not save discount settings.",
          });
        },
      },
    );
  };

  const lastUpdated = data?.updatedAt
    ? new Date(data.updatedAt).toLocaleString()
    : "never";

  return (
    <div className="flex flex-col min-h-screen bg-muted/20">
      <header className="border-b bg-card text-card-foreground px-6 py-4 flex items-center justify-between sticky top-0 z-10 shadow-xs">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/" aria-label="Back to dashboard">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
              <Scale className="h-5 w-5" /> Discount Settings
            </h1>
            <p className="text-sm text-muted-foreground font-mono mt-1">
              Used only by the Net-to-Net comparison
            </p>
          </div>
        </div>
        <Button onClick={handleSave} disabled={update.isPending || hasErrors}>
          {update.isPending ? "Saving…" : "Save Changes"}
        </Button>
      </header>

      <main className="flex-1 p-6 space-y-6 max-w-3xl mx-auto w-full">
        <Card>
          <CardHeader>
            <CardTitle>How Net-to-Net works</CardTitle>
            <CardDescription>
              Net price = MRP × (1 − discount%). The dashboard compares Prayag's net
              against each competitor's net. MRP-to-MRP mode ignores these values.
              Last saved: {lastUpdated}.
            </CardDescription>
          </CardHeader>
          {isLoading ? (
            <CardContent className="space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-40 w-full" />
            </CardContent>
          ) : (
            <CardContent className="space-y-6">
              <div className="space-y-2 max-w-sm">
                <Label htmlFor="prayag-discount">Prayag Discount (%)</Label>
                <Input
                  id="prayag-discount"
                  type="number"
                  min={0}
                  max={100}
                  step="0.1"
                  value={prayag}
                  onChange={(e) => setPrayag(e.target.value)}
                  aria-invalid={invalidPrayag}
                  data-testid="input-prayag-discount"
                  className={invalidPrayag ? "border-destructive" : ""}
                />
                {invalidPrayag && (
                  <p className="text-xs text-destructive">Enter a number from 0 to 100.</p>
                )}
              </div>

              <div className="space-y-2">
                <Label>Competitor Discounts (%)</Label>
                <div className="border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Competitor</TableHead>
                        <TableHead className="w-[180px] text-right">Discount (%)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data?.competitors.map((c) => {
                        const val = comps[c.scope] ?? "";
                        const invalid = !isValidPct(val);
                        return (
                          <TableRow key={c.scope}>
                            <TableCell className="font-medium">{c.scope}</TableCell>
                            <TableCell className="text-right">
                              <Input
                                type="number"
                                min={0}
                                max={100}
                                step="0.1"
                                value={val}
                                onChange={(e) =>
                                  setComps((prev) => ({ ...prev, [c.scope]: e.target.value }))
                                }
                                aria-invalid={invalid}
                                data-testid={`input-discount-${c.scope}`}
                                className={`h-8 text-right ml-auto max-w-[140px] ${invalid ? "border-destructive" : ""}`}
                              />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </CardContent>
          )}
        </Card>
      </main>
    </div>
  );
}
