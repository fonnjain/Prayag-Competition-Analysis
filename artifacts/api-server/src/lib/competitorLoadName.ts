import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import type { Request, Response, NextFunction } from "express";
import { normalizeVocabularyKey } from "./priceEditorVocabulary";

/** Reuse P048/P051 comparison. Ashirwad is an explicit known brand alias,
 * not a fuzzy normalizer: never merge unrelated new suppliers such as Jindal. */
export function resolveStoredCompetitorName(input: string, stored: string[]) {
  const requested = input.normalize("NFKC").trim().replace(/\s+/g, " ");
  const key = normalizeVocabularyKey(requested);
  const aliasKey = key === normalizeVocabularyKey("Ashirwad") ? normalizeVocabularyKey("Ashirvad") : key;
  const candidates = stored.filter(name => normalizeVocabularyKey(name) === aliasKey);
  if (candidates.length > 1) throw new Error("More than one stored competitor spelling has this normalized name. Review the existing brands before loading.");
  const competitor = candidates[0] ?? requested;
  const reusedStoredSpelling = !!candidates.length && competitor !== input.trim();
  return { requested: input.trim(), competitor, reusedStoredSpelling,
    message: reusedStoredSpelling ? `“${input.trim()}” reuses stored competitor spelling “${competitor}”; no second brand spelling will be created.` : null };
}

/** Admin load routes only. Reads brand authority; never renames existing rows. */
export async function resolveCompetitorLoadName(req: Request, res: Response, next: NextFunction) {
  if (typeof req.body?.competitor !== "string" || !req.body.competitor.trim()) { next(); return; }
  try {
    const names = await db.execute<{ competitor: string }>(sql`SELECT DISTINCT competitor FROM competitor_prices ORDER BY competitor`);
    const resolution = resolveStoredCompetitorName(req.body.competitor, names.rows.map(row => row.competitor));
    req.body.competitor = resolution.competitor;
    res.locals.competitorNameResolution = resolution;
    const sendJson = res.json.bind(res);
    res.json = (body: unknown) => sendJson(body && typeof body === "object" && !Array.isArray(body)
      ? { ...body, competitorNameResolution: resolution } : body);
    next();
  } catch (error) { next(error); }
}
