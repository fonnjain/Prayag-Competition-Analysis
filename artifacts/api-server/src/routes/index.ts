import { Router, type IRouter } from "express";
import healthRouter from "./health";
import catalogRouter from "./catalog";
import catalogImportExportRouter from "./catalogImportExport";
import comparisonRouter from "./comparison";
import analysisRouter from "./analysis";
import apiKeysRouter from "./apiKeys";
import externalV1Router from "./externalV1";

const router: IRouter = Router();

router.use(healthRouter);
router.use(apiKeysRouter);
router.use(externalV1Router);
router.use(catalogRouter);
router.use(catalogImportExportRouter);
router.use(comparisonRouter);
router.use(analysisRouter);

export default router;
