/** Return the final calendar day before the next revision starts. */
export function validToFromNextDate(nextEffectiveDate: string | null): string | null {
  if (!nextEffectiveDate) return null;
  const date = new Date(`${nextEffectiveDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/** One-decimal percentage change, including a real 0 for unchanged revisions. */
export function priceChangePct(
  currentPrice: number | null,
  nextPrice: number | null,
): number | null {
  if (
    currentPrice == null ||
    nextPrice == null ||
    !Number.isFinite(currentPrice) ||
    !Number.isFinite(nextPrice) ||
    currentPrice <= 0
  ) {
    return null;
  }
  return Math.round((((nextPrice - currentPrice) / currentPrice) * 100) * 10) / 10;
}