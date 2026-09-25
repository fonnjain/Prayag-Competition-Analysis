import type { Request } from "express";
import { sql } from "drizzle-orm";

export const normalizeVocabularyKey = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ")
  .toLocaleLowerCase("en").replace(/[\p{P}\p{S}]/gu, " ").trim().replace(/\s+/g, " ")
  .split(" ").filter(Boolean).map((word) => {
    if (word.length > 3 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
    if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
    return word;
  }).join(" ");

export function vocabularyReason(body: unknown): string {
  const candidate = (body as { reason?: unknown } | null)?.reason;
  return typeof candidate === "string" ? candidate.trim() : "";
}

export function priceEditorActor(req: Request) {
  return req.user?.email ?? req.user?.id ?? "unknown";
}

export function vocabularyAudit(req: Request, reason: string) {
  return { actor: priceEditorActor(req), reason };
}

export async function lockPriceEditorVocabulary(tx: { execute: (...args: any[]) => Promise<any> }): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"price-editor:vocabulary"}))`);
}

export function duplicateVocabulary(existingValue: string) {
  return { code: "VOCABULARY_DUPLICATE", existingValue };
}

/**
 * Pick one deterministic spelling for a normalized collision. An exact input
 * spelling wins; otherwise a conventional Title Case spelling is preferred
 * before a case-sensitive lexical tie-break.
 */
export function chooseVocabularyCollision<T extends { name: string; count?: number }>(
  input: string,
  candidates: T[],
): T | undefined {
  const exact = candidates.find((candidate) => candidate.name === input);
  if (exact) return exact;
  return [...candidates].sort((a, b) => {
    if ((a.count ?? 0) !== (b.count ?? 0)) return (b.count ?? 0) - (a.count ?? 0);
    const titleCase = (value: string) => value.length > 0 && value[0] === value[0]!.toLocaleUpperCase("en") &&
      value.slice(1) === value.slice(1)!.toLocaleLowerCase("en");
    if (titleCase(a.name) !== titleCase(b.name)) return titleCase(a.name) ? -1 : 1;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  })[0];
}