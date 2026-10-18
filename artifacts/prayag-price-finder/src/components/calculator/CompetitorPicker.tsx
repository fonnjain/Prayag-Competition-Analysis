import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { formatPriceDate } from "@/components/price-window";
import { competitorIdentity } from "@/lib/calculatorState";
import { AdHocBadge } from "./MrpField";

export type KnownCompetitor = { competitor: string; pricedProducts: number; effectiveDate: string | null };

/**
 * Known brands come first and prominently for any matching text. A one-off name is
 * always a deliberate, separate choice and is never merged with a recorded brand.
 */
export function CompetitorPicker({
  id, known, loading, error, onRetry, taken, onPick, onCancel, autoFocus,
}: {
  id: string;
  known: KnownCompetitor[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  taken: Set<string>;
  onPick: (name: string, adHoc: boolean) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState("");
  const q = text.toLocaleLowerCase();
  const matches = useMemo(() => {
    const list = q.trim() ? known.filter((k) => k.competitor.toLocaleLowerCase().includes(q.trim())) : known;
    return [...list].sort((a, b) => {
      const ea = a.competitor.toLocaleLowerCase() === q.trim() ? 0 : 1, eb = b.competitor.toLocaleLowerCase() === q.trim() ? 0 : 1;
      return ea - eb || a.competitor.localeCompare(b.competitor);
    }).slice(0, 8);
  }, [known, q]);
  const name = text.trim() ? text : "";
  const knownTwin = known.find((k) => k.competitor.toLocaleLowerCase() === text.trim().toLocaleLowerCase());
  const adHocTaken = !!name && taken.has(competitorIdentity({ competitor: name, adHoc: true }));

  return (
    <div className="space-y-1.5 rounded-md border bg-background p-2" data-testid={`picker-competitor-${id}`}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          autoFocus={autoFocus}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape" && onCancel) onCancel(); }}
          placeholder="Type a competitor name…"
          aria-label="Competitor name"
          data-testid={`input-competitor-name-${id}`}
          className="h-8 pl-7 text-sm"
        />
      </div>
      {error ? (
        <button type="button" onClick={onRetry} className="text-[11px] font-semibold text-destructive underline underline-offset-2">
          Could not load recorded competitors. Retry
        </button>
      ) : loading ? (
        <div className="space-y-1"><span className="block h-6 rounded bg-muted animate-pulse" /><span className="block h-6 w-2/3 rounded bg-muted animate-pulse" /></div>
      ) : matches.length > 0 ? (
        <ul className="max-h-48 overflow-y-auto" role="listbox" aria-label="Recorded competitors">
          {matches.map((k, i) => {
            const isTaken = taken.has(competitorIdentity({ competitor: k.competitor }));
            return (
              <li key={k.competitor}>
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  disabled={isTaken}
                  onClick={() => onPick(k.competitor, false)}
                  data-testid={`option-known-competitor-${id}-${k.competitor}`}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-indigo-950/40 ${i === 0 && text.trim() ? "bg-indigo-50/70 font-bold dark:bg-indigo-950/30" : "font-semibold"}`}
                >
                  <span className="truncate">{k.competitor}</span>
                  <span className="ml-auto shrink-0 text-[10px] font-medium text-muted-foreground">
                    {isTaken ? "already added" : k.pricedProducts > 0 ? `${k.pricedProducts} priced${k.effectiveDate ? ` · ${formatPriceDate(k.effectiveDate)}` : ""}` : "recorded, no prices"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="px-1 text-[11px] text-muted-foreground">{known.length === 0 ? "No competitors recorded yet." : "No recorded competitor matches."}</p>
      )}
      {name && (
        <button
          type="button"
          disabled={adHocTaken}
          onClick={() => onPick(name, true)}
          data-testid={`button-add-adhoc-competitor-${id}`}
          className="flex w-full items-center gap-1.5 rounded border border-dashed border-fuchsia-300 px-2 py-1.5 text-left text-[11px] font-semibold text-fuchsia-800 hover:bg-fuchsia-50 disabled:opacity-50 dark:text-fuchsia-200 dark:hover:bg-fuchsia-950/30"
        >
          <Plus className="h-3 w-3 shrink-0" />
          <span className="min-w-0">
            {knownTwin ? `Add '${name}' as a one-off anyway — kept separate from recorded ${knownTwin.competitor}` : `Add '${name}' as a one-off competitor`}
          </span>
          <span className="ml-auto"><AdHocBadge /></span>
        </button>
      )}
      {adHocTaken && <p className="px-1 text-[10px] text-muted-foreground">This one-off name is already in this block.</p>}
      {onCancel && (
        <button type="button" onClick={onCancel} className="px-1 text-[11px] text-muted-foreground underline-offset-2 hover:underline">Cancel</button>
      )}
    </div>
  );
}
