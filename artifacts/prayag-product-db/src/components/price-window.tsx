import { AlertTriangle, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

export function formatPriceDate(value?: string | null): string {
  if (!value) return "date unavailable";
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
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
              ? "text-[10px] text-amber-700"
              : "rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950",
          )}
          data-testid="scheduled-price-revision"
        >
          <DirectionIcon
            aria-hidden="true"
            className={cn("shrink-0", compact ? "mt-0.5 h-3 w-3" : "mt-0.5 h-4 w-4")}
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
                  "ml-2 inline-flex items-center gap-1 rounded-full font-semibold",
                  compact
                    ? "text-amber-800"
                    : "bg-amber-200/70 px-2 py-0.5 text-xs text-amber-900",
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