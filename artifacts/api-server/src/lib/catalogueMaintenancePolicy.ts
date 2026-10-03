import type { RequestHandler } from "express";

/** Server-owned deployment configuration. No request input participates. */
export function isProductionCatalogueRuntime(): boolean {
  return process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1";
}

export class ProductionCatalogueReplacementError extends Error {
  readonly code = "PRODUCTION_CATALOGUE_REPLACEMENT_DISABLED";
  constructor(operation: string) {
    super(`${operation} is disabled in production. Use targeted corrections or normal price loaders; an empty production catalogue is an incident, not permission to reseed.`);
    this.name = "ProductionCatalogueReplacementError";
  }
}

export function assertCatalogueReplacementAllowed(operation: string): void {
  if (isProductionCatalogueRuntime()) throw new ProductionCatalogueReplacementError(operation);
}

/** Runs before upload parsing, fingerprint checking or catalogue database work. */
export const refuseProductionCatalogueReplacement: RequestHandler = (_req, res, next) => {
  try {
    assertCatalogueReplacementAllowed("Catalogue reset, seed and whole-catalogue replacement");
    next();
  } catch (error) {
    if (!(error instanceof ProductionCatalogueReplacementError)) return next(error);
    res.status(403).json({ error: error.message, code: error.code });
  }
};

/** Install before authentication too: a refusal must not even load a DB session. */
export const earlyCatalogueReplacementBoundary: RequestHandler = (req, res, next) => {
  const path = req.path.toLowerCase().replace(/\/+$/, "");
  const blocked = (req.method === "POST" &&
    ["/api/catalog/reset", "/api/catalog/sync/apply", "/api/catalog/sync/preflight"].includes(path)) ||
    (["GET", "HEAD"].includes(req.method) && path === "/api/catalog/reset/preview");
  if (blocked && isProductionCatalogueRuntime()) {
    refuseProductionCatalogueReplacement(req, res, next);
    return;
  }
  next();
};

export function catalogueMaintenanceActions(role: string | null | undefined): Array<"resetCatalog"> {
  return !isProductionCatalogueRuntime() && role === "admin" ? ["resetCatalog"] : [];
}