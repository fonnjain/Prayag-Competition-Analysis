import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";

export type CompetitorRuleLike = {
  competitor?: string | null;
  scope?: "everywhere" | "division" | "category";
  divisions?: string[];
  categories?: string[];
};
type Opt = { value: string; count: number };
export type CompetitorOption = { competitor: string; count: number; divisions: Opt[]; categories: Opt[] };

export function competitorScopeLabel(r: CompetitorRuleLike): string {
  const s = r.scope ?? "everywhere";
  if (s === "division") return `${r.competitor} in divisions: ${(r.divisions ?? []).join(", ")}`;
  if (s === "category") return `${r.competitor} in categories: ${(r.categories ?? []).join(", ")}`;
  return `${r.competitor} everywhere`;
}

type Row = { on: boolean; scope: "everywhere" | "division" | "category"; vals: Set<string> };
const blank = (): Row => ({ on: false, scope: "everywhere", vals: new Set() });

export function CompetitorsTab({ options, loading, error, retry, onAdd }: {
  options: CompetitorOption[]; loading: boolean; error: boolean; retry: () => void;
  onAdd: (rules: CompetitorRuleLike[]) => void;
}) {
  const [rows, setRows] = useState<Record<string, Row>>({});
  if (loading) return <Skeleton className="h-32 w-full" />;
  if (error) return <div className="text-sm"><span className="text-destructive">Could not load competitors.</span> <button type="button" className="underline" onClick={retry}>Retry</button></div>;
  // Competitors are text on price rows, with no brand master. Database-provided
  // choices and no free-text entry are the guard against a second spelling.
  if (options.length === 0) return <p className="text-sm text-muted-foreground" data-testid="text-no-competitors">No competitor prices are attached to active products yet.</p>;

  const get = (n: string) => rows[n] ?? blank();
  const patch = (n: string, p: Partial<Row>) => setRows((r) => ({ ...r, [n]: { ...(r[n] ?? blank()), ...p } }));
  const valid = (r: Row) => r.on && (r.scope === "everywhere" || r.vals.size > 0);
  const addOne = (o: CompetitorOption) => {
    const r = get(o.competitor);
    if (!valid(r)) return;
    const allowed = new Set((r.scope === "division" ? o.divisions : o.categories).map((x) => x.value));
    const picked = Array.from(r.vals).filter((v) => allowed.has(v));
    if (r.scope !== "everywhere" && picked.length === 0) return;
    onAdd([{ competitor: o.competitor, scope: r.scope, divisions: r.scope === "division" ? picked : [], categories: r.scope === "category" ? picked : [] }]);
    setRows((x) => ({ ...x, [o.competitor]: blank() }));
  };

  return (
    <div className="space-y-2" data-testid="panel-competitors">
      <p className="text-sm font-semibold">Competitors to ignore</p>
      {options.map((o) => {
        const r = get(o.competitor);
        const opts = r.scope === "division" ? o.divisions : o.categories;
        return (
          <div key={o.competitor} className="rounded border p-2" data-testid={`row-competitor-${o.competitor}`}>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <label className="flex flex-1 items-center gap-2">
                <Checkbox checked={r.on} onCheckedChange={(v) => patch(o.competitor, { on: v === true })} data-testid={`checkbox-competitor-${o.competitor}`} />
                <span className="font-medium">{o.competitor}</span>
                <span className="font-mono text-xs text-muted-foreground">{o.count.toLocaleString()} prices</span>
              </label>
              <select aria-label={`Scope for ${o.competitor}`} disabled={!r.on} value={r.scope}
                onChange={(e) => patch(o.competitor, { scope: e.target.value as Row["scope"], vals: new Set() })}
                className="h-8 rounded-md border bg-background px-2 text-sm" data-testid={`select-scope-${o.competitor}`}>
                <option value="everywhere">Everywhere</option>
                <option value="division">Only in divisions</option>
                <option value="category">Only in categories</option>
              </select>
              <Button type="button" size="sm" disabled={!valid(r)} onClick={() => addOne(o)} data-testid={`button-add-competitor-rule-${o.competitor}`}>Add rule</Button>
            </div>
            {r.on && r.scope !== "everywhere" && (
              <fieldset className="mt-2">
                <legend className="text-xs font-semibold text-muted-foreground">{r.scope === "division" ? "Divisions" : "Categories"} with {o.competitor} prices</legend>
                <div className="mt-1 grid max-h-40 gap-1 overflow-y-auto sm:grid-cols-2">
                  {opts.map((x) => (
                    <label key={x.value} className="flex items-center gap-2 rounded border px-2 py-1 text-sm">
                      <Checkbox checked={r.vals.has(x.value)} onCheckedChange={() => { const n = new Set(r.vals); if (n.has(x.value)) n.delete(x.value); else n.add(x.value); patch(o.competitor, { vals: n }); }} data-testid={`checkbox-scope-${o.competitor}-${x.value}`} />
                      <span className="flex-1">{x.value}</span><span className="font-mono text-xs text-muted-foreground">{x.count}</span>
                    </label>
                  ))}
                </div>
                {r.vals.size === 0 && <p className="mt-1 text-xs text-muted-foreground">Choose at least one to add this rule.</p>}
              </fieldset>
            )}
          </div>
        );
      })}
    </div>
  );
}
