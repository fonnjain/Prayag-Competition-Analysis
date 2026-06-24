import { Router, type IRouter } from "express";
import healthRouter from "./health";
import dashboardRouter from "./dashboard";
import productsRouter from "./products";
import recommendationsRouter from "./recommendations";
import competitorsRouter from "./competitors";
import settingsRouter from "./settings";
import importExportRouter from "./importExport";

const router: IRouter = Router();

router.use(healthRouter);
router.use(dashboardRouter);
router.use(productsRouter);
router.use(recommendationsRouter);
router.use(competitorsRouter);
router.use(settingsRouter);
router.use(importExportRouter);

export default router;
