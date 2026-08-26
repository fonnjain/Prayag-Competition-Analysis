export const PRICE_FINDER_SELECTION_LIMIT = 50;

export type SelectionUpdate =
  | { ok: true; codes: string[] }
  | { ok: false; codes: string[]; reason: "limit" };

export function selectedCodesFromParams(params: URLSearchParams): string[] {
  return [...new Set(params.getAll("code").map((code) => code.trim()).filter(Boolean))].slice(
    0,
    PRICE_FINDER_SELECTION_LIMIT,
  );
}

export function toggleSelectedCode(codes: string[], code: string): SelectionUpdate {
  const normalized = code.trim();
  const current = [...new Set(codes.map((item) => item.trim()).filter(Boolean))];
  if (!normalized) return { ok: true, codes: current };
  if (current.includes(normalized)) {
    return { ok: true, codes: current.filter((item) => item !== normalized) };
  }
  if (current.length >= PRICE_FINDER_SELECTION_LIMIT) {
    return { ok: false, codes: current, reason: "limit" };
  }
  return { ok: true, codes: [...current, normalized] };
}

export function writeSelectedCodes(params: URLSearchParams, codes: string[]): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete("code");
  codes.forEach((code) => next.append("code", code));
  return next;
}