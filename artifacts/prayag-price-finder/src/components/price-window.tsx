import { AlertTriangle, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

export function formatPriceDate(value?: string | null): string {
  if (!value) return "date unavailable";
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[3]}-${match[2]}-${match[1]}`;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${String(date.getUTCDate()).padStart(2, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${date.getUTCFullYear()}`;
}

export function validityText(
  validFrom?: string | null,
  validTo?: string | null,
): string | null {
  if (!validFrom) return null;
  return validTo
    ? `Valid ${formatPriceDate(validFrom)} – ${formatPriceDate(validTo)}`
    : `Valid from ${formatPriceDate(validFrom)}`;
}

export function isRevisionImminent(
  effectiveDate?: string | null,
  now = new Date(),
): boolean {
  if (!effectiveDate) return false;
  const target = Date.parse(`${effectiveDate}T00:00:00.000Z`);
  if (Number.isNaN(target)) return false;
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.ceil((target - today) / 86_400_000);
  return days >= 0 && days <= 30;
}

type PriceWindowDetailsProps = {
  currentPrice?: number | null;
  validFrom?: string | null;
  validTo?: string | null;
  upcomingPrice?: number | null;
  upcomingEffectiveDate?: string | null;
  upcomingChangePct?: number | null;
  compact?: boolean;
  className?: string;
};

export function PriceWindowDetails({
  currentPrice,
  validFrom,
  validTo,
  upcomingPrice,
  upcomingEffectiveDate,
  upcomingChangePct,
  compact = false,
  className,
}: PriceWindowDetailsProps) {
  const validity = validityText(validFrom, validTo);
  const hasRevision =
    currentPrice != null &&
    upcomingPrice != null &&
    upcomingEffectiveDate != null;
  const unchanged = hasRevision && upcomingPrice === currentPrice;
  const imminent = hasRevision && isRevisionImminent(upcomingEffectiveDate);
  const direction =
    !hasRevision || unchanged
      ? "unchanged"
      : upcomingPrice > currentPrice
        ? "increase"
        : "decrease";

  const DirectionIcon =
    direction === "increase"
      ? TrendingUp
      : direction === "decrease"
        ? TrendingDown
        : Minus;

  return (
    <div className={cn(compact ? "space-y-0.5" : "space-y-2", className)}>
      {validity && (
        <p
          className={cn(
            "text-muted-foreground",
            compact ? "text-[10px]" : "text-sm",
          )}
        >
          {validity}
        </p>
      )}
      {hasRevision && (
        <div
          className={cn(
            "flex items-start gap-1.5",
            compact
              ? "text-[10px] text-primary"
              : "rounded bg-primary/10 p-2 text-xs text-primary font-medium",
          )}
          data-testid="scheduled-price-revision"
        >
          <DirectionIcon
            aria-hidden="true"
            className={cn("shrink-0", compact ? "mt-0.5 h-3 w-3" : "mt-0.5 h-3.5 w-3.5")}
          />
          <span>
            {unchanged ? (
              <>
                No price change on {formatPriceDate(upcomingEffectiveDate)} (₹
                {upcomingPrice.toFixed(2)})
              </>
            ) : (
              <>
                {direction === "increase" ? "Increases" : "Decreases"} to ₹
                {upcomingPrice.toFixed(2)} on {formatPriceDate(upcomingEffectiveDate)}
                {upcomingChangePct != null
                  ? ` (${upcomingChangePct > 0 ? "+" : ""}${upcomingChangePct.toFixed(1)}%)`
                  : ""}
              </>
            )}
            {imminent && (
              <span
                className={cn(
                  "ml-2 inline-flex items-center gap-1 rounded-sm font-semibold",
                  compact
                    ? "text-primary"
                    : "bg-primary/20 px-1.5 py-0.5 text-[10px] text-primary uppercase tracking-wider",
                )}
                aria-label="Price revision within 30 days"
                data-testid="imminent-price-revision"
              >
                <AlertTriangle aria-hidden="true" className="h-3 w-3" />
                Changes soon
              </span>
            )}
          </span>
        </div>
      )}
    </div>
  );
}

type UpcomingGapDetailsProps = {
  effectiveDate?: string | null;
  prayagPrice?: number | null;
  competitorPrice?: number | null;
  gapPct?: number | null;
  direction?: string | null;
  isReversal?: boolean;
  compact?: boolean;
  className?: string;
};

export function UpcomingGapDetails({
  effectiveDate,
  prayagPrice,
  competitorPrice,
  gapPct,
  direction,
  isReversal = false,
  compact = false,
  className,
}: UpcomingGapDetailsProps) {
  if (
    !effectiveDate ||
    prayagPrice == null ||
    competitorPrice == null ||
    gapPct == null ||
    !direction
  ) {
    return null;
  }
  const signedGap = `${gapPct > 0 ? "+" : ""}${gapPct.toFixed(1)}%`;
  return (
    <div
      className={cn(
        "border border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100",
        compact
          ? "mt-1 rounded px-2 py-1 text-[10px]"
          : "mt-2 rounded-lg p-2.5 text-xs",
        className,
      )}
      data-testid="upcoming-competitive-gap"
    >
      <div className="font-semibold">
        From {formatPriceDate(effectiveDate)}: ₹{prayagPrice.toFixed(2)} vs ₹
        {competitorPrice.toFixed(2)} → {signedGap}
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
        <span>{direction}</span>
        {isReversal && (
          <span
            className="inline-flex items-center gap-1 rounded bg-amber-200 px-1.5 py-0.5 font-bold uppercase tracking-wide text-amber-900 dark:bg-amber-800 dark:text-amber-100"
            data-testid="competitive-gap-reversal"
          >
            <AlertTriangle aria-hidden="true" className="h-3 w-3" />
            Reversal
          </span>
        )}
      </div>
    </div>
  );
}