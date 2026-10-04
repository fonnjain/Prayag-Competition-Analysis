import { AsyncLocalStorage } from "node:async_hooks";
import { sql, type SQL } from "drizzle-orm";
import type { Request, Response, NextFunction } from "express";
import { getActiveBucket } from "./bucketLists";
import { bucketAllowsCode } from "./bucketMembership";
import { isAdminUser } from "../middlewares/authMiddleware";
import { normCode } from "./catalog";
import { formatBucketExportDisclosure } from "@workspace/formatting";

type Context = { type: "included" | "excluded"; codes: Set<string>; banner: string; exportBanner?: string };
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
  if (!bucketRouteApplies(req.method, req.path) || !req.user || req.user.mustChangePassword) {
    storage.run(null, next);
    return;
  }
  try {
    const active = await getActiveBucket({ id: req.user.id, admin: isAdminUser(req.user), label: req.user.id });
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Vary", "Cookie, Authorization");
    const context: Context | null = active.list && active.banner
      ? {
        type: active.list.type, codes: new Set(active.codes.map(normCode)), banner: active.banner,
        exportBanner: formatBucketExportDisclosure({
          name: active.list.name, type: active.list.type,
          count: active.list.activeCount ?? active.list.count,
        }),
      } : null;
    // A direct detail/history request must not reveal a filtered product.
    const directPath = /^(?:\/catalog\/products\/|\/price-finder\/product\/)(.+)$/.exec(req.path);
    const directQuery = ["/catalog/product", "/price-finder/product", "/analysis/price-history"].includes(req.path);
    const code = directPath ? decodeURIComponent(directPath[1]) : directQuery && typeof req.query.itemCode === "string" ? req.query.itemCode : null;
    if (context && code && !bucketAllowsCode(context.type, context.codes, code)) {
      res.status(404).json({ error: "This product is hidden by your active bucket list. Clear the bucket to view it.", code: "BUCKET_FILTERED", banner: context.banner });
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
  return !context || bucketAllowsCode(context.type, context.codes, code);
}
export function filterBucketRows<T>(rows: T[], code: (row: T) => string | null | undefined): T[] {
  return rows.filter(row => bucketCodeAllowed(code(row)));
}
export function bucketSql(column: SQL): SQL {
  const context = storage.getStore();
  if (!context) return sql`TRUE`;
  if (!context.codes.size) return context.type === "included" ? sql`FALSE` : sql`TRUE`;
  const values = sql.join([...context.codes].map(code => sql`${code}`), sql`, `);
  // Match the existing catalogue join identity (normCode), including legacy
  // competitor codes with different case/whitespace. Never edit stored codes.
  const canonical = sql`regexp_replace(upper(regexp_replace(trim(${column}), '\\s+', '', 'g')), '\\.0$', '')`;
  return context.type === "included" ? sql`${canonical} IN (${values})` : sql`(${canonical} IS NULL OR ${canonical} NOT IN (${values}))`;
}
export function bucketExportBanner() {
  const context = storage.getStore();
  return context?.exportBanner ?? context?.banner ?? "Bucket lists: none applied.";
}
export function hasBucketFilter() {
  return !!storage.getStore();
}
export function bucketExportRows<T extends (string | number | null)[]>(rows: T[]): (string | number | null)[][] {
  return [[bucketExportBanner()], ["Display-only product filter; no source product or price data changed."], [], ...rows];
}
export function withBucketContext<T>(context: Context | null, run: () => T): T {
  return storage.run(context, run);
}