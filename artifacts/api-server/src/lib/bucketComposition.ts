import { sql, type SQL } from "drizzle-orm";
import { bucketAllowsCode } from "./bucketMembership";
import { competitorAllowed, competitorScopeText, type CompetitorClause } from "./bucketCompetitors";
import { formatBucketExportDisclosure } from "@workspace/formatting";

export type BucketLayer = {
  type: "included" | "excluded"; codes: Set<string>;
  productFilterApplied?: boolean; clauses?: CompetitorClause[];
};
/** P053 Step 4 composition order: catalogue -> enforced layer -> personal
 * layer. Each layer restricts the previous survivors; neither can restore an
 * excluded product or quote. AND, never a union of the two whitelists. */
export function composedProductAllowed(layers: BucketLayer[], code: string | null | undefined) {
  return layers.every(layer => layer.productFilterApplied === false || bucketAllowsCode(layer.type, layer.codes, code));
}
export function composedQuoteAllowed(layers: BucketLayer[], brand: string, code: string | null | undefined) {
  return layers.every(layer => competitorAllowed(layer.type, layer.clauses ?? [], brand, code));
}
function canonical(column: SQL) {
  return sql`regexp_replace(upper(regexp_replace(trim(${column}), '\\s+', '', 'g')), '\\.0$', '')`;
}
export function composedProductSql(layers: BucketLayer[], column: SQL): SQL {
  return sql.join([sql`TRUE`, ...layers.map(layer => {
    if (layer.productFilterApplied === false) return sql`TRUE`;
    if (!layer.codes.size) return layer.type === "included" ? sql`FALSE` : sql`TRUE`;
    const values = sql.join([...layer.codes].map(code => sql`${code}`), sql`, `);
    const code = canonical(column);
    return layer.type === "included" ? sql`(${code} IN (${values}))` : sql`(${code} IS NULL OR ${code} NOT IN (${values}))`;
  })], sql` AND `);
}
export function composedQuoteSql(layers: BucketLayer[], brand: SQL, code: SQL): SQL {
  const normalized = canonical(code);
  return sql.join([sql`TRUE`, ...layers.map(layer => {
    if (!layer.clauses?.length) return sql`TRUE`;
    const matches = layer.clauses.map(clause => {
      if (clause.codes === null) return sql`${brand} = ${clause.competitor}`;
      if (!clause.codes.size) return sql`FALSE`;
      const values = sql.join([...clause.codes].map(value => sql`${value}`), sql`, `);
      return sql`(${brand} = ${clause.competitor} AND coalesce(${normalized} IN (${values}), FALSE))`;
    });
    const union = sql.join(matches, sql` OR `);
    return layer.type === "included" ? sql`(${union})` : sql`NOT (${union})`;
  })], sql` AND `);
}
type DisclosureList = { name: string; type: "included" | "excluded"; count: number; activeCount?: number;
  productFilterApplied?: boolean; competitorRules?: Parameters<typeof competitorScopeText>[0][] };
function disclosure(list: DisclosureList) {
  return formatBucketExportDisclosure({ ...list, count: list.activeCount ?? list.count })
    + (list.competitorRules?.length ? `; ${list.competitorRules.map(rule => competitorScopeText(rule, list.type)).join("; ")}` : "")
    + (list.productFilterApplied === false ? "; no product filter applied" : "");
}
export function composedDisclosure(enforced: DisclosureList | null, personal: DisclosureList | null) {
  if (!enforced) return personal ? disclosure(personal) : "Bucket lists: none applied.";
  const company = `Showing: Enforced by Head Office: ${disclosure(enforced).replace(/^Showing:\s*/, "")}`;
  return company + (personal ? `\nAlso applied: your list ${disclosure(personal).replace(/^Showing:\s*/, "")}` : "");
}
