import { Router, type IRouter } from "express";
import {
  requireAuth,
  requireWorkspaceReadAccess,
} from "../middlewares/authMiddleware";
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
import mrpRevisionRouter from "./mrpRevision";
import activityRouter from "./activity";

const router: IRouter = Router();

// Unauthenticated routes
router.use(healthRouter);
router.use(authRouter);

// External API: authenticated with X-API-Key (no session needed)
router.use(externalV1Router);

// Public, read-only product prices. This router has no mutations.
router.use(priceFinderRouter);
router.use(activityRouter);

// Internal routes: every signed-in role may use read endpoints. Each mutation
// is guarded by requireAdmin at its router or route definition.
router.use(requireAuth);
router.use(requireWorkspaceReadAccess);
router.use(adminUsersRouter);
router.use(apiKeysRouter);
router.use(catalogRouter);
router.use(catalogImportExportRouter);
router.use(catalogSyncRouter);
router.use(importBatchesRouter);
router.use(mrpRevisionRouter);
router.use(comparisonRouter);
router.use(analysisRouter);

export default router;
