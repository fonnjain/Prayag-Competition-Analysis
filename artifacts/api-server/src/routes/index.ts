import { Router, type IRouter } from "express";
import healthRouter from "./health";
import dashboardRouter from "./dashboard";
import productsRouter from "./products";
import recommendationsRouter from "./recommendations";
import competitorsRouter from "./competitors";
import settingsRouter from "./settings";
import importExportRouter from "./importExport";
import catalogRouter from "./catalog";
import catalogImportExportRouter from "./catalogImportExport";
import comparisonRouter from "./comparison";
import analysisRouter from "./analysis";

const router: IRouter = Router();

router.use(healthRouter);
router.use(dashboardRouter);
router.use(productsRouter);
router.use(recommendationsRouter);
router.use(competitorsRouter);
router.use(settingsRouter);
router.use(importExportRouter);
router.use(catalogRouter);
router.use(catalogImportExportRouter);
router.use(comparisonRouter);
router.use(analysisRouter);

export default router;
