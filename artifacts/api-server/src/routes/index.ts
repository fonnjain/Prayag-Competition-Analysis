import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/authMiddleware";
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
import catalogSyncRouter from "./catalogSync";
import adminUsersRouter from "./adminUsers";

const router: IRouter = Router();

// Unauthenticated routes
router.use(healthRouter);
router.use(authRouter);

// External API: authenticated with X-API-Key (no session needed)
router.use(externalV1Router);

// Public, read-only product prices. This router has no mutations.
router.use(priceFinderRouter);

// Internal routes: require a valid session
router.use(requireAuth);
router.use(adminUsersRouter);
router.use(apiKeysRouter);
router.use(catalogRouter);
router.use(catalogImportExportRouter);
router.use(catalogSyncRouter);
router.use(importBatchesRouter);
router.use(comparisonRouter);
router.use(analysisRouter);

export default router;
