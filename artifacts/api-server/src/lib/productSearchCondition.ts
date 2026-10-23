import { sql } from "drizzle-orm";
import { PRODUCT_SEARCH_FIELDS, normaliseProductSearch, productSearchVariants } from "@workspace/formatting";

/** Shared candidate fields/variants, not scope. Each handler supplies its own
 * eligibility and bucket conditions separately. p is its catalogue alias.
 */
export function productSearchCondition(term: string) {
  const conditions = productSearchVariants(term).flatMap(variant => {
    const like = `%${variant}%`;
    const normalizedLike = `%${normaliseProductSearch(variant)}%`;
    return PRODUCT_SEARCH_FIELDS.flatMap(field => {
      const column = sql`${sql.identifier("p")}.${sql.identifier(field)}`;
      const value = field === "item_code" ? column : sql`coalesce(${column}, '')`;
      return [
        sql`lower(${value}) LIKE ${like}`,
        sql`regexp_replace(lower(${value}), '[^a-z0-9]', '', 'g') LIKE ${normalizedLike}`,
      ];
    });
  });
  return conditions.length ? sql`(${sql.join(conditions, sql` OR `)})` : sql`FALSE`;
}
