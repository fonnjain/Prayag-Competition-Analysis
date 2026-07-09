import { Router, type IRouter } from "express";
import healthRouter from "./health";
import catalogRouter from "./catalog";
import catalogImportExportRouter from "./catalogImportExport";
import comparisonRouter from "./comparison";
import analysisRouter from "./analysis";

const router: IRouter = Router();

router.use(healthRouter);
router.use(catalogRouter);
router.use(catalogImportExportRouter);
router.use(comparisonRouter);
router.use(analysisRouter);

export default router;
