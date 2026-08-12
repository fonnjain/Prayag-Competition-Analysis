import {
  Router,
  type IRouter,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { apiKeyAuth } from "../middlewares/apiKeyAuth";
import catalogRouter from "./catalog";
import comparisonRouter from "./comparison";
import analysisRouter from "./analysis";

// External read-only API, authenticated with X-API-Key. Each /v1 endpoint is
// an explicit GET-only rewrite onto an existing internal handler — nothing
// outside this allowlist is reachable with an API key.
const router: IRouter = Router();

router.use(apiKeyAuth);

function forward(
  req: Request,
  res: Response,
  next: NextFunction,
  target: string,
  handler: IRouter,
): void {
  const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  req.url = target + qs;
  handler(req, res, next);
}

router.get("/v1/products", (req, res, next) =>
  forward(req, res, next, "/catalog/products", catalogRouter),
);
router.get("/v1/products/:itemCode", (req, res, next) =>
  forward(
    req,
    res,
    next,
    `/catalog/products/${encodeURIComponent(req.params.itemCode)}`,
    catalogRouter,
  ),
);
router.get("/v1/comparison", (req, res, next) =>
  forward(req, res, next, "/catalog/comparison", comparisonRouter),
);
router.get("/v1/analysis/overview", (req, res, next) =>
  forward(req, res, next, "/analysis/overview", analysisRouter),
);

export default router;
