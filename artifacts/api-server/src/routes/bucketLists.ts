import { Router, type Request, type Response } from "express";
import multer from "multer";
import XLSX from "xlsx";
import { RANGE_DIVISIONS } from "@workspace/formatting";
import { isAdminUser, requireWorkspaceReadAccess } from "../middlewares/authMiddleware";
import {
  assertBucketVisible, canReadBucket, describeBucket, detachBucket, deleteBucket,
  getActiveBucket, loadBucketWorld, prepareBucketDraft, saveBucket, setActiveBucket,
  observeBucketMembership,
  type BucketActor,
} from "../lib/bucketLists";
import { BucketError, classifyBucketUpload, resolveBucketCodes } from "../lib/bucketMembership";
import { competitorOptions } from "../lib/bucketCompetitors";
import { changeBucketEnforcement, getBucketEnforcement } from "../lib/bucketEnforcement";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
export function bucketActor(req: Request): BucketActor {
  if (!req.user || req.user.mustChangePassword) throw new BucketError("Sign in to manage bucket lists.", 401, "UNAUTHORIZED");
  return { id: req.user.id, admin: isAdminUser(req.user), label: [req.user.firstName, req.user.lastName].filter(Boolean).join(" ") || req.user.email || req.user.id };
}
function handleError(res: Response, error: unknown) {
  if (error instanceof BucketError) return res.status(error.status).json({ error: error.message, code: error.code, ...error.extra });
  console.error("Bucket operation failed", error);
  return res.status(500).json({ error: "Bucket operation failed. Please retry." });
}
function handler(run: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response) => { try { await run(req, res); } catch (error) { handleError(res, error); } };
}
function sendExcel(res: Response, rows: (string | number | null)[][], name: string) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "Items");
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${name}.xlsx"`);
  res.send(XLSX.write(book, { type: "buffer", bookType: "xlsx" }));
}

// Anonymous reads have only the company layer, never a personal preference.
router.get("/bucket-lists/active", handler(async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Vary", "Cookie, Authorization");
  const actor = req.user && !req.user.mustChangePassword ? bucketActor(req) : null;
  const active = await getActiveBucket(actor);
  if (!actor && active.enforced) {
    // Public header disclosure, not a membership/identity/history endpoint.
    const l = active.enforced;
    return res.json({ ...active, codes: [], enforced: {
      id: l.id, name: l.name, type: l.type, visibility: l.visibility,
      count: l.count, activeCount: l.activeCount, competitorCount: l.competitorCount,
      competitorPriceCount: l.competitorPriceCount, productFilterApplied: l.productFilterApplied,
      competitorRules: l.competitorRules, members: [], canEdit: false,
    } });
  }
  return res.json(active);
}));
router.use("/bucket-lists", requireWorkspaceReadAccess, (req, res, next) => {
  if (!req.user) { res.status(401).json({ error: "Sign in to manage bucket lists." }); return; }
  res.setHeader("Cache-Control", "private, no-store");
  next();
});
router.get("/bucket-lists", handler(async (req, res) => {
  const actor = bucketActor(req), world = await loadBucketWorld();
  const visible = world.lists.filter(list => canReadBucket(list, actor));
  for (const list of visible) await observeBucketMembership(world.byId.get(list.id)!, world);
  res.json(visible.map(list => describeBucket(world.byId.get(list.id)!, world, actor)));
}));
router.get("/bucket-lists/catalogue", handler(async (_req, res) => {
  const world = await loadBucketWorld();
  res.json({ products: world.catalogue.map(p => ({ ...p, missing: false })), rangeDivisions: RANGE_DIVISIONS,
    competitors: competitorOptions(world.competitorNames ?? [], world.catalogue, world.quotes ?? []) });
}));
router.post("/bucket-lists/preview", handler(async (req, res) => {
  const actor = bucketActor(req), world = await loadBucketWorld();
  res.json(describeBucket(prepareBucketDraft(req.body, actor, world), world, actor));
}));
router.post("/bucket-lists/upload-preview", upload.single("file"), handler(async (req, res) => {
  if (!req.file || !/\.(xlsx|csv)$/i.test(req.file.originalname)) throw new BucketError("Upload an .xlsx or .csv file.");
  const actor = bucketActor(req), world = await loadBucketWorld();
  let rawDraft: unknown;
  try { rawDraft = JSON.parse(req.body.draft ?? "{}"); } catch { throw new BucketError("The draft must be valid JSON."); }
  const draft = prepareBucketDraft(rawDraft, actor, world);
  let workbook: XLSX.WorkBook;
  try { workbook = XLSX.read(req.file.buffer, { type: "buffer", raw: true }); }
  catch { throw new BucketError("This spreadsheet could not be read."); }
  let input: { row: number; code: string }[] | null = null;
  for (const name of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, defval: "", raw: false });
    const header = rows.findIndex(row => row.some(cell => String(cell).trim().toLowerCase() === "item_code"));
    if (header < 0) continue;
    const column = rows[header].findIndex(cell => String(cell).trim().toLowerCase() === "item_code");
    input = rows.slice(header + 1).flatMap((row, offset) => row.every(cell => String(cell).trim() === "")
      ? [] : [{ row: header + offset + 2, code: String(row[column] ?? "") }]);
    break;
  }
  if (!input) throw new BucketError("No item_code column was found. Use the downloadable template.");
  if (input.length > 25000) throw new BucketError("Upload at most 25,000 rows at a time.");
  res.json(classifyBucketUpload(input, world.catalogue, resolveBucketCodes(draft, world.byId, world.catalogue)));
}));
router.get("/bucket-lists/template", handler(async (_req, res) => {
  const world = await loadBucketWorld();
  const examples = world.catalogue.slice(0, 3).map(p => [p.itemCode]);
  sendExcel(res, [["item_code"], ...examples], "bucket-list-template");
}));
router.put("/bucket-lists/active", handler(async (req, res) => {
    if (Object.keys(req.body ?? {}).some(key => key !== "listId" && key !== "active"))
    throw new BucketError("This selector changes only your personal list, not Head Office enforcement.");
  const value = req.body?.listId;
  if (value !== null && (typeof value !== "string" || !/^[0-9a-f-]{36}$/i.test(value))) throw new BucketError("listId must be a list ID or null.");
  if (req.body.active !== undefined && typeof req.body.active !== "boolean") throw new BucketError("active must be true or false.");
  res.json(await setActiveBucket(bucketActor(req), value, req.body.active ?? true));
}));
router.post("/bucket-lists", handler(async (req, res) => {
  res.status(201).json(await saveBucket(req.body, bucketActor(req)));
}));
router.get("/bucket-lists/enforcement", handler(async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  return res.json(await getBucketEnforcement(bucketActor(req)));
}));
router.post("/bucket-lists/enforcement", handler(async (req, res) => {
  return res.json(await changeBucketEnforcement(req.body, bucketActor(req)));
}));
router.post("/bucket-lists/enforcement/release", handler(async (req, res) => {
  return res.json(await changeBucketEnforcement(req.body, bucketActor(req), true));
}));
router.get("/bucket-lists/:id", handler(async (req, res) => {
  const actor = bucketActor(req), world = await loadBucketWorld();
  const list = assertBucketVisible(String(req.params.id), actor, world);
  await observeBucketMembership(list, world);
  res.json(describeBucket(world.byId.get(list.id)!, world, actor));
}));
router.patch("/bucket-lists/:id", handler(async (req, res) => {
  res.json(await saveBucket(req.body, bucketActor(req), String(req.params.id)));
}));
router.delete("/bucket-lists/:id", handler(async (req, res) => {
  res.json(await deleteBucket(String(req.params.id), bucketActor(req)));
}));
router.post("/bucket-lists/:id/detach", handler(async (req, res) => {
  res.json(await detachBucket(String(req.params.id), bucketActor(req), req.body));
}));
router.get("/bucket-lists/:id/export", handler(async (req, res) => {
  const actor = bucketActor(req), world = await loadBucketWorld();
  const list = describeBucket(assertBucketVisible(String(req.params.id), actor, world), world, actor);
  sendExcel(res, [
    [`Bucket list: ${list.name} — ${list.type === "excluded" ? "Excluded" : "Included"} · ${list.count} members`],
    ["Membership export; no other bucket filter is applied. No product or price data is changed."], [],
    ["item_code", "product_name", "division", "category", "range", "status"],
    ...list.members.map(p => [p.itemCode, p.productName, p.division, p.category, p.seriesRange, p.missing ? "No longer active/in catalogue" : "Active"]),
  ], `bucket-list-${list.id}`);
}));
export default router;