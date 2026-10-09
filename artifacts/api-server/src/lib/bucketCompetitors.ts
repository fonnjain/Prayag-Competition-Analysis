import type { BucketRule } from "@workspace/db";
import { normCode } from "./catalog";
import { normalizeVocabularyKey } from "./priceEditorVocabulary";
import { BucketError, isLiveBucketProduct, type BucketDefinition, type BucketProduct } from "./bucketMembership";

export type CompetitorQuote = { id: number; competitor: string; matchedPrayagCode: string | null; price: number | null };
export type CompetitorClause = { competitor: string; codes: Set<string> | null };
export function resolveCompetitorRules(definition: BucketDefinition, lists: Map<string, BucketDefinition>, visited = new Set<string>()): BucketRule[] {
  const path = new Set(visited);
  if (definition.id) {
    if (path.has(definition.id)) throw new BucketError("A bucket list cannot inherit from itself.", 400, "BUCKET_CYCLE");
    path.add(definition.id);
  }
  const parent = definition.parentId ? lists.get(definition.parentId) : null;
  return [...(parent ? resolveCompetitorRules(parent, lists, path) : []), ...definition.rules.filter(r => !!r.competitor)];
}
export function hasProductDefinition(definition: BucketDefinition, lists: Map<string, BucketDefinition>, visited = new Set<string>()): boolean {
  if (definition.id && visited.has(definition.id)) throw new BucketError("A bucket list cannot inherit from itself.");
  const path = new Set(visited); if (definition.id) path.add(definition.id);
  const parent = definition.parentId ? lists.get(definition.parentId) : null;
  return !!(definition.rules.some(r => !r.competitor || r.retainProductFilter) || definition.addedCodes.length || definition.removedCodes.length
    || definition.observedCodes?.length || (parent && hasProductDefinition(parent, lists, path)));
}
export function compileCompetitorRules(rules: BucketRule[], catalogue: BucketProduct[]): CompetitorClause[] {
  return rules.map(rule => ({
    competitor: rule.competitor!,
    codes: !rule.scope || rule.scope === "everywhere" ? null : new Set(catalogue.filter(product => product.isActive).filter(product =>
      rule.scope === "division" ? rule.divisions?.includes(product.division ?? "")
        : rule.categories?.some(category => normalizeVocabularyKey(category) === normalizeVocabularyKey(product.category ?? "")),
    ).map(product => normCode(product.itemCode))),
  }));
}
export function competitorAllowed(type: "included" | "excluded", clauses: CompetitorClause[], competitor: string, code: string | null | undefined) {
  if (!clauses.length) return true;
  const matches = clauses.some(clause => clause.competitor === competitor
    && (clause.codes === null || (code != null && clause.codes.has(normCode(code)))));
  return type === "included" ? matches : !matches;
}
export function competitorImpact(type: "included" | "excluded", rules: BucketRule[], catalogue: BucketProduct[], quotes: CompetitorQuote[],
  productAllowed: (code: string) => boolean = () => true,
  quoteAllowed?: (competitor: string, code: string) => boolean) {
  const clauses = compileCompetitorRules(rules, catalogue);
  const live = new Set(catalogue.filter(p => isLiveBucketProduct(p)).map(p => normCode(p.itemCode)));
  const before = new Set<string>(), after = new Set<string>(), ignored = new Set<number>();
  for (const quote of quotes) {
    if (!quote.matchedPrayagCode || !(quote.price != null && quote.price > 0)) continue;
    const code = normCode(quote.matchedPrayagCode);
    if (!live.has(code) || !productAllowed(code)) continue;
    before.add(code);
    if (quoteAllowed ? quoteAllowed(quote.competitor, code) : competitorAllowed(type, clauses, quote.competitor, code)) after.add(code);
    else ignored.add(quote.id);
  }
  return { competitorPriceCount: ignored.size, noCompetitorPriceCount: [...before].filter(code => !after.has(code)).length };
}
export function competitorScopeText(rule: BucketRule, type: "included" | "excluded") {
  const scope = !rule.scope || rule.scope === "everywhere" ? "everywhere"
    : `in ${(rule.scope === "division" ? rule.divisions : rule.categories)?.join(", ")}`;
  return `${rule.competitor} ${type === "excluded" ? "excluded" : "included"} ${scope}`;
}
export function competitorOptions(names: string[], catalogue: BucketProduct[], quotes: CompetitorQuote[]) {
  const products = new Map(catalogue.filter(p => isLiveBucketProduct(p)).map(p => [normCode(p.itemCode), p]));
  return names.map(competitor => {
    const divisions = new Map<string, number>(), categories = new Map<string, { value: string; count: number }>();
    let count = 0;
    for (const quote of quotes) {
      const product = quote.matchedPrayagCode ? products.get(normCode(quote.matchedPrayagCode)) : null;
      if (quote.competitor !== competitor || !product || !(quote.price != null && quote.price > 0)) continue;
      count++;
      if (product.division) divisions.set(product.division, (divisions.get(product.division) ?? 0) + 1);
      if (product.category) {
        const key = normalizeVocabularyKey(product.category), entry = categories.get(key) ?? { value: product.category, count: 0 };
        entry.count++; categories.set(key, entry);
      }
    }
    return { competitor, count, divisions: [...divisions].map(([value, count]) => ({ value, count })).sort((a,b) => a.value.localeCompare(b.value)),
      categories: [...categories.values()].sort((a,b) => a.value.localeCompare(b.value)) };
  });
}
