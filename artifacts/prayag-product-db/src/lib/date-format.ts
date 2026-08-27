function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Formats a calendar date for people without changing the ISO values used by
 * forms and API calls. ISO date-only strings are read directly to avoid
 * timezone shifts.
 */
export function formatDisplayDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  if (typeof value === "string") {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[3]}-${match[2]}-${match[1]}`;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()}`;
}

export function formatDisplayDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return `${formatDisplayDate(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}