import { Undo2 } from "lucide-react";
import { formatMoney } from "@workspace/formatting";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type PriceState = "App" | "Edited" | "Entered";

/** One vocabulary everywhere (P067 §2): App / Edited / Entered. */
export function PriceStateBadge({ state, className, testId }: { state: PriceState; className?: string; testId?: string }) {
  return (
    <span
      data-testid={testId}
      data-state={state}
      title={state === "App" ? "App value, unedited" : state === "Edited" ? "App value existed; changed by hand" : "No app value; typed by hand"}
      className={cn(
        "inline-flex items-center rounded px-1 py-px text-[9px] font-black uppercase tracking-wider",
        state === "App" && "bg-slate-100 text-slate-600 dark:bg-muted dark:text-muted-foreground",
        state === "Edited" && "bg-violet-100 text-violet-800 ring-1 ring-violet-300 dark:bg-violet-950/50 dark:text-violet-200",
        state === "Entered" && "bg-fuchsia-100 text-fuchsia-800 ring-1 ring-fuchsia-300 dark:bg-fuchsia-950/50 dark:text-fuchsia-200",
        className,
      )}
    >
      {state}
    </span>
  );
}

export function AdHocBadge({ label = "Ad-hoc", testId }: { label?: string; testId?: string }) {
  return (
    <span data-testid={testId} className="inline-flex items-center rounded border border-dashed border-fuchsia-400 px-1 py-px text-[9px] font-black uppercase tracking-wider text-fuchsia-700 dark:text-fuchsia-300">
      {label}
    </span>
  );
}

const appText = (n: number) => n.toFixed(2);

/**
 * Editable MRP, prefilled with the app value. `value === undefined` means unedited (App);
 * an explicit string is the user's raw entry, kept verbatim (blank = missing required price).
 */
export function MrpField({
  id, value, appPrice, state, error, onChange, ariaLabel, testId, date,
}: {
  id: string;
  value: string | undefined;
  appPrice: number | null;
  state: PriceState;
  error: string | null | undefined;
  onChange: (value: string | undefined) => void;
  ariaLabel: string;
  testId: string;
  date?: string | null;
}) {
  const shown = value ?? (appPrice != null ? appText(appPrice) : "");
  const errorId = `${id}-error`;
  return (
    <div className="min-w-0">
      <Input
        id={id}
        value={shown}
        inputMode="decimal"
        placeholder={appPrice == null ? "Enter MRP" : undefined}
        onChange={(e) => onChange(e.target.value)}
        aria-label={`${ariaLabel} (${state})`}
        aria-invalid={!!error}
        aria-describedby={error ? errorId : undefined}
        data-testid={testId}
        className={cn(
          "h-8 font-mono text-sm tabular-nums",
          state === "Edited" && "border-violet-300 bg-violet-50/50 dark:bg-violet-950/20",
          state === "Entered" && "border-fuchsia-300 bg-fuchsia-50/40 dark:bg-fuchsia-950/20",
          error && "border-destructive focus-visible:ring-destructive",
        )}
      />
      <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
        <PriceStateBadge state={state} testId={`${testId}-state`} />
        {state === "Edited" && appPrice != null && (
          <>
            <span data-testid={`${testId}-app`}>(app: {appText(appPrice)})</span>
            <button
              type="button"
              onClick={() => onChange(undefined)}
              className="inline-flex items-center gap-0.5 font-semibold text-violet-700 underline-offset-2 hover:underline dark:text-violet-300 print:hidden"
              data-testid={`${testId}-revert`}
              aria-label={`Revert to app value ${formatMoney(appPrice)}`}
            >
              <Undo2 className="h-3 w-3" /> Revert
            </button>
          </>
        )}
        {state === "App" && date && <span>from {date}</span>}
      </div>
      {error && <p id={errorId} role="alert" className="mt-1 text-[11px] font-medium text-destructive">{error}</p>}
    </div>
  );
}
