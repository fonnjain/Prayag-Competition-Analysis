/**
 * Pure identity and matching primitives for Apollo pipe imports (P045).
 *
 * This module deliberately has no database or route dependencies. Callers can
 * use the result to decide whether to update a row or create one in a
 * transaction.
 */

export type CodeSource = "supplier" | "locally_assigned";

export interface ApolloPipeRow {
  id: string | number;
  competitorCode: string | null;
  codeSource: CodeSource | null;
  description: string | null;
  size: string | null;
}

export interface ApolloPipeInput {
  codeSource: CodeSource;
  competitorCode?: string | null;
  description: string | null;
  size: string | null;
}

export type ApolloPipeMatch =
  | { kind: "matched"; row: ApolloPipeRow; by: "code" | "identity" }
  | { kind: "ambiguous"; rows: ApolloPipeRow[]; by: "code" | "identity" }
  | { kind: "new"; reason: "no-match" };

const UNIT_ALIASES: Readonly<Record<string, string>> = {
  millimeter: "mm",
  millimeters: "mm",
  millimetre: "mm",
  millimetres: "mm",
  mm: "mm",
  centimetre: "cm",
  centimetres: "cm",
  centimeter: "cm",
  centimeters: "cm",
  cm: "cm",
  metre: "m",
  metres: "m",
  meter: "m",
  meters: "m",
  mtr: "m",
  mtrs: "m",
  m: "m",
  inch: "in",
  inches: "in",
  in: "in",
  "\"": "in",
  foot: "ft",
  feet: "ft",
  ft: "ft",
};

function unicodeWords(value: string | null | undefined): string[] {
  // NFKC handles compatibility forms (including full-width digits); NFKD
  // makes accented spellings compare consistently without locale assumptions.
  const decomposed = String(value ?? "")
    .normalize("NFKC")
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .toLocaleLowerCase("en-US");
  return decomposed
    .replace(/["″]/gu, " inch ")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .map((word) => UNIT_ALIASES[word] ?? word);
}

/** Normalized description: case-folded, Unicode-normalized, punctuation-safe. */
export function normalizeApolloDescription(value: string | null | undefined): string {
  return unicodeWords(value).join(" ");
}

/**
 * Normalized size. Unit synonyms are canonicalized but numeric values are not
 * converted: 1 m and 100 cm are different declared sizes, not guesses.
 */
export function normalizeApolloSize(value: string | null | undefined): string {
  const normalized = String(value ?? "")
    .normalize("NFKC")
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/["″]/gu, " inch ");
  // Keep decimal and fractional separators: punctuation is noise in names,
  // but changing 1/2 or 1.5 would change the declared pipe size.
  return (normalized.match(/\d+(?:[./]\d+)*|[\p{Letter}]+/gu) ?? [])
    .map((token) => UNIT_ALIASES[token] ?? token)
    .join("");
}

/** Stable identity key used only for locally-assigned Apollo pipe codes. */
export function apolloPipeIdentity(
  description: string | null | undefined,
  size: string | null | undefined,
): string | null {
  const descriptionKey = normalizeApolloDescription(description);
  const sizeKey = normalizeApolloSize(size);
  if (!descriptionKey || !sizeKey) return null;
  return `${descriptionKey}|${sizeKey}`;
}

/** Alias with a descriptive name for importers and tests. */
export const normalizeApolloPipeIdentity = apolloPipeIdentity;

function normalizeCode(value: string | null | undefined): string {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleUpperCase("en-US")
    .replace(/[\s._-]+/gu, "");
}

/**
 * Match supplier-origin codes by code and locally-assigned codes by
 * description+size. A missing or unverifiable code source is never guessed.
 * Multiple identity matches are explicitly ambiguous.
 */
export function matchApolloPipe(
  input: ApolloPipeInput,
  existing: readonly ApolloPipeRow[],
): ApolloPipeMatch {
  const inputCode = normalizeCode(input.competitorCode);
  if (input.codeSource === "supplier") {
    if (!inputCode) return { kind: "new", reason: "no-match" };
    const codeMatches = existing.filter(
      (row) =>
        row.codeSource === "supplier" &&
        normalizeCode(row.competitorCode) === inputCode,
    );
    if (codeMatches.length === 1) return { kind: "matched", row: codeMatches[0], by: "code" };
    // A duplicate supplier code is unsafe too; do not select arbitrarily.
    if (codeMatches.length > 1) return { kind: "ambiguous", rows: codeMatches, by: "code" };
    return { kind: "new", reason: "no-match" };
  }

  const identity = apolloPipeIdentity(input.description, input.size);
  if (!identity) return { kind: "new", reason: "no-match" };
  const identityMatches = existing.filter(
    (row) =>
      row.codeSource === "locally_assigned" &&
      apolloPipeIdentity(row.description, row.size) === identity,
  );
  if (identityMatches.length === 1) return { kind: "matched", row: identityMatches[0], by: "identity" };
  if (identityMatches.length > 1) return { kind: "ambiguous", rows: identityMatches, by: "identity" };
  return { kind: "new", reason: "no-match" };
}

export const resolveApolloPipeMatch = matchApolloPipe;

/** Throws before persistence if a minted code exists anywhere in the set. */
export function assertApolloCodeAvailable(
  mintedCode: string,
  allCompetitorCodes: readonly (string | null | undefined)[],
): void {
  const candidate = normalizeCode(mintedCode);
  if (!candidate) throw new Error("Cannot mint an empty Apollo competitor code");
  if (allCompetitorCodes.some((code) => normalizeCode(code) === candidate)) {
    throw new Error(`Apollo competitor code already exists: ${mintedCode}`);
  }
}
