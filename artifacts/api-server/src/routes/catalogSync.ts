import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { desc } from "drizzle-orm";
import { catalogSyncAuditsTable, db } from "@workspace/db";
import {
  applyCatalogSyncBundle,
  CATALOG_ADMIN_EMAIL,
  CATALOG_SYNC_CONFIRMATION,
  createCatalogSyncPreflightToken,
  exportCatalogSyncBundle,
  getCatalogSyncSnapshot,
  getCurrentCatalogSyncSummary,
  parseAndValidateCatalogSyncBundle,
  summarizeCatalogSyncBundle,
  verifyCatalogSyncPreflightToken,
} from "../lib/catalogSync";
import { requireAdmin } from "../middlewares/authMiddleware";

const router: IRouter = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024, files: 1 },
});

function isProduction(req: Request): boolean {
  if (process.env.NODE_ENV === "test") {
    return req.header("x-catalog-sync-test-environment") === "production";
  }
  return process.env.NODE_ENV === "production";
}

router.use("/catalog/sync", requireAdmin);

router.get("/catalog/sync/status", async (req, res) => {
  const recentAudits = await db
    .select()
    .from(catalogSyncAuditsTable)
    .orderBy(desc(catalogSyncAuditsTable.startedAt))
    .limit(5);
  res.json({
    environment: isProduction(req) ? "production" : "development",
    confirmationPhrase: CATALOG_SYNC_CONFIRMATION,
    current: await getCurrentCatalogSyncSummary(),
    recentAudits,
  });
});

router.get("/catalog/sync/export", async (req, res) => {
  if (isProduction(req)) {
    res.status(403).json({ error: "Catalog bundles can only be exported from development." });
    return;
  }
  const bundle = await exportCatalogSyncBundle();
  const fileName = `prayag-catalog-sync-${bundle.manifest.createdAt.slice(0, 10)}.json`;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  res.setHeader("X-Catalog-Sync-Sha256", bundle.manifest.payloadSha256);
  res.send(JSON.stringify(bundle));
});

router.post("/catalog/sync/preflight", upload.single("file"), async (req, res) => {
  if (!isProduction(req)) {
    res.status(403).json({ error: "Catalog bundles can only be imported in production." });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: "Select a catalog sync bundle." });
    return;
  }
  try {
    const bundle = parseAndValidateCatalogSyncBundle(req.file.buffer);
    const email = req.user!.email!;
    const current = await getCatalogSyncSnapshot();
    res.json({
      checksum: bundle.manifest.payloadSha256,
      createdAt: bundle.manifest.createdAt,
      incoming: summarizeCatalogSyncBundle(bundle),
      current: current.summary,
      preflightToken: createCatalogSyncPreflightToken(
        bundle,
        email,
        current.checksum,
      ),
      expiresInMinutes: 15,
    });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Catalog sync bundle is invalid.",
    });
  }
});

router.post("/catalog/sync/apply", upload.single("file"), async (req, res) => {
  if (!isProduction(req)) {
    res.status(403).json({ error: "Catalog bundles can only be imported in production." });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: "Select a catalog sync bundle." });
    return;
  }
  if (req.body.confirmation !== CATALOG_SYNC_CONFIRMATION) {
    res.status(400).json({ error: "The production replacement confirmation is incorrect." });
    return;
  }
  if (typeof req.body.preflightToken !== "string") {
    res.status(400).json({ error: "Preview this bundle again before applying it." });
    return;
  }
  let bundle;
  let preflight;
  const email = req.user!.email!;
  try {
    bundle = parseAndValidateCatalogSyncBundle(req.file.buffer);
    preflight = verifyCatalogSyncPreflightToken(
      req.body.preflightToken,
      bundle,
      email,
    );
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Catalog sync bundle is invalid.",
    });
    return;
  }
  try {
    const result = await applyCatalogSyncBundle(
      bundle,
      email,
      preflight.currentChecksum,
    );
    res.json({
      ok: true,
      auditId: result.auditId,
      completedAt: result.completedAt,
      checksum: bundle.manifest.payloadSha256,
      before: result.before,
      after: result.after,
    });
  } catch (error) {
    req.log?.error({ err: error }, "catalog sync failed");
    res.status(500).json({
      error: error instanceof Error ? error.message : "Catalog sync failed.",
    });
  }
});

router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (error instanceof multer.MulterError) {
    res.status(400).json({
      error:
        error.code === "LIMIT_FILE_SIZE"
          ? "Catalog sync bundle exceeds the 30 MB upload limit."
          : "Catalog sync upload is invalid.",
    });
    return;
  }
  next(error);
});

export default router;