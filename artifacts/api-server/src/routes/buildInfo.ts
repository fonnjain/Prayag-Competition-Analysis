import { Router } from "express";
import { GetBuildInfoResponse } from "@workspace/api-zod";

declare const __BUILD_INFO__: {
  commitSha: string;
  branch: string;
  builtAt: string;
};

const buildInfoRouter = Router();
const buildInfo = GetBuildInfoResponse.parse(__BUILD_INFO__);
// Mounted before authentication: even an expired cookie cannot trigger DB access.
buildInfoRouter.get("/_build", (_req, res) => {
  res.set("Cache-Control", "no-store").json(buildInfo);
});

export default buildInfoRouter;
