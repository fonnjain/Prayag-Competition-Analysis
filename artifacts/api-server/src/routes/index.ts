import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import catalogRouter from "./catalog";
import catalogImportExportRouter from "./catalogImportExport";
import comparisonRouter from "./comparison";
import analysisRouter from "./analysis";
import apiKeysRouter from "./apiKeys";
import externalV1Router from "./externalV1";
import importBatchesRouter from "./importBatches";
import priceFinderRouter from "./priceFinder";

const router: IRouter = Router();

// Unauthenticated routes
router.use(healthRouter);
router.use(authRouter);

// External API: authenticated with X-API-Key (no session needed)
router.use(externalV1Router);

// Internal routes: require a valid session
function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

router.use(requireAuth);
router.use(apiKeysRouter);
router.use(priceFinderRouter);
router.use(catalogRouter);
router.use(catalogImportExportRouter);
router.use(importBatchesRouter);
router.use(comparisonRouter);
router.use(analysisRouter);

export default router;
