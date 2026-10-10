import { AsyncLocalStorage } from "node:async_hooks";
import { sql, type SQL } from "drizzle-orm";
import type { Request, Response, NextFunction } from "express";
import { getActiveBucket } from "./bucketLists";
import { bucketAllowsCode } from "./bucketMembership";
import { isAdminUser } from "../middlewares/authMiddleware";
import { normCode } from "./catalog";
import { formatBucketExportDisclosure } from "@workspace/formatting";
import { competitorAllowed, competitorScopeText, type CompetitorClause } from "./bucketCompetitors";
import { composedProductAllowed, composedProductSql, composedQuoteAllowed, composedQuoteSql, type BucketLayer } from "./bucketComposition";

type Context = { type: "included" | "excluded"; codes: Set<string>; banner: string; exportBanner?: string;
  productFilterApplied?: boolean; clauses?: CompetitorClause[]; noCompetitorPriceCount?: number; layers?: BucketLayer[] };
const storage = new AsyncLocalStorage<Context | null>();

/** Explicit screen-source allowlist. Never infer scope from shared helper calls. */
export function bucketRouteApplies(method: string, path: string): boolean {
  if (path.startsWith("/v1/") || path.startsWith("/bucket-lists")) return false;
  if (method === "POST") return path === "/mrp-generator/scenarios/preview";
  if (method !== "GET") return false;
  return path === "/catalog/products" || path.startsWith("/catalog/products/")
    || path === "/catalog/product" || path === "/catalog/filters" || path === "/catalog/export"
    || path.startsWith("/catalog/comparison") || path === "/catalog/mapping-review"
    || path === "/catalog/mapping-review/export" || path === "/catalog/mapping-review/auto-accept-preview"
    || path.startsWith("/price-finder/") || path.startsWith("/analysis/")
    || path.startsWith("/mrp-generator/");
}
export async function bucketFilterMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!bucketRouteApplies(req.method, req.path)) {
    storage.run(null, next);
    return;
  }
  try {
    // Public Price Finder must not become a sign-out bypass of the company rule.
    const active = await getActiveBucket(req.user && !req.user.mustChangePassword
      ? { id: req.user.id, admin: isAdminUser(req.user), label: req.user.id } : null, true);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Vary", "Cookie, Authorization");
    const primary = active.enforced ?? active.list;
    const context: Context | null = primary && active.banner
      ? {
        type: primary.type, codes: new Set(active.codes.map(normCode)), banner: active.banner,
        layers: active.layers, noCompetitorPriceCount: active.noCompetitorPriceCount,
        exportBanner: active.banner,
      } : null;
    // A direct detail/history request must not reveal a filtered product.
    const directPath = /^(?:\/catalog\/products\/|\/price-finder\/product\/)(.+)$/.exec(req.path);
    const directQuery = ["/catalog/product", "/price-finder/product", "/analysis/price-history"].includes(req.path);
    const code = directPath ? decodeURIComponent(directPath[1]) : directQuery && typeof req.query.itemCode === "string" ? req.query.itemCode : null;
    if (context && code && !composedProductAllowed(context.layers ?? [context], code)) {
      res.status(404).json({ error: active.enforced
        ? "This product is hidden by the Head Office and/or personal restrictions. The enforced layer cannot be cleared here."
        : "This product is hidden by your active bucket list. Clear your personal list to view it.", code: "BUCKET_FILTERED", banner: context.banner });
      return;
    }
    storage.run(context, next);
  } catch (error) {
    // Never silently fall back to unfiltered numbers on a resolver/storage error.
    next(error);
  }
}
export function bucketCodeAllowed(code: string | null | undefined): boolean {
  const context = storage.getStore();
  return !context || composedProductAllowed(context.layers ?? [context], code);
}
export function filterBucketRows<T>(rows: T[], code: (row: T) => string | null | undefined): T[] {
  return rows.filter(row => bucketCodeAllowed(code(row)));
}
export function bucketSql(column: SQL, competitorColumn?: SQL): SQL {
  const context = storage.getStore();
  if (!context) return sql`TRUE`;
  const competitor = competitorColumn ? bucketCompetitorSql(competitorColumn, column) : sql`TRUE`;
  return sql`(${composedProductSql(context.layers ?? [context], column)}) AND (${competitor})`;
}
/** Quote predicate, never a product-universe predicate. Scoped category codes
 * are compiled with the existing P051 function, not a second SQL normalizer. */
export function bucketCompetitorSql(brand: SQL, code: SQL): SQL {
  const context = storage.getStore();
  return context ? composedQuoteSql(context.layers ?? [context], brand, code) : sql`TRUE`;
}
export function bucketCompetitorAllowed(competitor: string, code: string | null | undefined) {
  const context = storage.getStore();
  return !context || composedQuoteAllowed(context.layers ?? [context], competitor, code);
}
export function filterBucketCompetitorRows<T>(rows: T[], brand: (row: T) => string, code: (row: T) => string | null | undefined): T[] {
  return rows.filter(row => bucketCompetitorAllowed(brand(row), code(row)));
}
export function bucketExportBanner() {
  const context = storage.getStore();
  return context?.exportBanner ?? context?.banner ?? "Bucket lists: none applied.";
}
export function hasBucketFilter() {
  return !!storage.getStore();
}
export function hasBucketCompetitorFilter() {
  const context = storage.getStore();
  return !!context && (context.layers ?? [context]).some(layer => !!layer.clauses?.length);
}
export function bucketExportRows<T extends (string | number | null)[]>(rows: T[]): (string | number | null)[][] {
  if (!storage.getStore()) return rows;
  const count = storage.getStore()?.noCompetitorPriceCount ?? 0;
  return [[bucketExportBanner()], ...(count > 0 ? [[`${count} products have no competitor price under this filter`]] : []),
    ["Display-only product and competitor filter; no source product or price data changed."], [], ...rows];
}
export function withBucketContext<T>(context: Context | null, run: () => T): T {
  return storage.run(context, run);
}