import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
import {
  InspectMultiWorkbookBody, InspectMultiWorkbookResponse, PreviewMultiWorkbookBody,
  ApplyMultiWorkbookBody, UndoMultiWorkbookBody, GetMultiWorkbookBatchResponse,
  ListMultiWorkbookBatchesResponse,
} from "@workspace/api-zod";
import { requireAdmin } from "../middlewares/authMiddleware";
import { parseMultiCompetitorWorkbook, PROTECTED_WORKBOOK_BRANDS } from "../lib/multiCompetitorWorkbook";
import {
  applyWorkbook, getWorkbookBatch, listWorkbookBatches, previewWorkbook, undoWorkbook, WorkbookLoadError,
} from "../lib/multiCompetitorWorkbookLoad";

const router: IRouter = Router();
const base = "/catalog/workbook-loads";
const upload = multer({storage: multer.memoryStorage(), limits: {fileSize: 20 * 1024 * 1024, files: 1}});
const actor = (req: Request) => String(req.user?.id ?? "");
const id = (req: Request) => {
  const v = String(req.params.id ?? "");
  if (!/^[1-9]\d*$/.test(v) || !Number.isSafeInteger(Number(v))) throw new WorkbookLoadError("Invalid batch ID.", 400);
  return Number(v);
};
function file(req: Request) {
  if (!req.file || !/\.xlsx?$/i.test(req.file.originalname)) throw new WorkbookLoadError("Upload an Excel workbook (.xlsx/.xls).", 400);
  return req.file;
}
const handle = (fn: (req: Request, res: Response) => Promise<void>) => async (req: Request, res: Response): Promise<void> => {
  try {await fn(req, res);} catch (e) {
    const cause = e instanceof Error ? e.cause as {code?: string; message?: string} | undefined : undefined;
    const message = cause?.code ? "Database refused the workbook operation; the transaction was rolled back."
      : e instanceof Error ? e.message : "Workbook request failed";
    req.log?.warn({message, databaseCode: cause?.code}, "Multi-competitor workbook request refused");
    res.status(e instanceof WorkbookLoadError ? e.status : cause?.code ? 500 : 422).json({error: message, noPriceWrites: true});
  }
};
function multipart(req: Request) {
  const f = file(req);
  return {...req.body, file: new File([new Uint8Array(f.buffer)], f.originalname)};
}
const detail = (res: Response, value: unknown, status = 200) =>
  res.status(status).json(GetMultiWorkbookBatchResponse.parse(value));
// Every endpoint uses the same P048 admin guard, including history/readback.
router.get(base, requireAdmin, handle(async (_req, res) => {res.json(ListMultiWorkbookBatchesResponse.parse({batches: await listWorkbookBatches()}));}));
router.post(`${base}/inspect`, requireAdmin, upload.single("file"), handle(async (req, res) => {
  InspectMultiWorkbookBody.parse(multipart(req));
  const parsed = parseMultiCompetitorWorkbook(file(req).buffer, []);
  res.json(InspectMultiWorkbookResponse.parse({brands: parsed.brands, sheets: parsed.sheets, protectedBrands: [...PROTECTED_WORKBOOK_BRANDS, "Ashirwad"]}));
}));
router.post(`${base}/preview`, requireAdmin, upload.single("file"), handle(async (req, res) => {
  const body = PreviewMultiWorkbookBody.parse(multipart(req));
  const brands: unknown = JSON.parse(body.brands);
  if (!Array.isArray(brands) || brands.some(b => typeof b !== "string")) throw new WorkbookLoadError("Select brands from the workbook.", 400);
  const f = file(req);
  detail(res, await previewWorkbook(f.buffer, f.originalname, brands, actor(req)), 201);
}));
router.get(`${base}/:id`, requireAdmin, handle(async (req, res) => {detail(res, await getWorkbookBatch(id(req)));}));
router.post(`${base}/:id/apply`, requireAdmin, upload.single("file"), handle(async (req, res) => {
  ApplyMultiWorkbookBody.parse(multipart(req));
  if (typeof req.body.contentFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(req.body.contentFingerprint)) {
    throw new WorkbookLoadError("Preview content fingerprint is required.", 400);
  }
  detail(res, await applyWorkbook(id(req), file(req).buffer, req.body.contentFingerprint, actor(req)));
}));
router.post(`${base}/:id/undo`, requireAdmin, handle(async (req, res) => {
  const body = UndoMultiWorkbookBody.parse(req.body);
  detail(res, await undoWorkbook(id(req), body.reason, actor(req)));
}));
export default router;
