import type { ReactNode } from "react";
import { ArrowDown, ArrowUp, Equal } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { formatPriceDate } from "@/components/price-window";

export type PositionDirection = "above" | "below" | "par" | "missing" | string;

/** Colour rules from P058 §3: above = amber, below = red (undercut), par = grey. */
export function PositionBadge({
  direction,
  label,
  className,
  testId,
}: {
  direction: PositionDirection;
  label: string;
  className?: string;
  testId?: string;
}) {
  const Icon = direction === "above" ? ArrowUp : direction === "below" ? ArrowDown : Equal;
  return (
    <span
      data-testid={testId}
      data-direction={direction}
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-bold whitespace-nowrap",
        direction === "above" && "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
        direction === "below" && "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200",
        direction === "par" && "bg-slate-100 text-slate-600 dark:bg-muted dark:text-muted-foreground",
        direction === "missing" && "bg-transparent text-muted-foreground italic font-medium",
        className,
      )}
    >
      {direction !== "missing" && <Icon className="h-3 w-3 shrink-0" aria-hidden />}
      {label}
    </span>
  );
}

export function Cell({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

export function PriceWithDate({ price, date, missing = "No price" }: { price: string | null; date: string | null; missing?: string }) {
  if (price == null) return <span className="text-sm italic text-muted-foreground">{missing}</span>;
  return (
    <>
      <span className="block font-mono text-sm font-semibold tabular-nums">{price}</span>
      {date && <span className="block text-[10px] text-muted-foreground">from {formatPriceDate(date)}</span>}
    </>
  );
}

/** Text input that keeps the raw string so invalid entries show an error instead of being coerced. */
export function NumericField({
  id,
  value,
  onChange,
  error,
  hint,
  suffix,
  ariaLabel,
  testId,
  inputMode = "decimal",
  className,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  error: string | null;
  hint?: string | null;
  suffix?: string;
  ariaLabel: string;
  testId: string;
  inputMode?: "decimal" | "numeric";
  className?: string;
}) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  return (
    <div className={cn("min-w-0", className)}>
      <div className="relative">
        <Input
          id={id}
          value={value}
          inputMode={inputMode}
          onChange={(e) => onChange(e.target.value)}
          aria-label={ariaLabel}
          aria-invalid={!!error}
          aria-describedby={error ? errorId : hint ? hintId : undefined}
          data-testid={testId}
          className={cn(
            "h-8 font-mono text-sm tabular-nums",
            suffix && "pr-6",
            error && "border-destructive focus-visible:ring-destructive",
          )}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{suffix}</span>
        )}
      </div>
      {error ? (
        <p id={errorId} role="alert" className="mt-1 text-[11px] font-medium text-destructive">{error}</p>
      ) : hint ? (
        <p id={hintId} className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
