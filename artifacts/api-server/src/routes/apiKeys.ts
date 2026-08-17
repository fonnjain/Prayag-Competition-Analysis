import { randomBytes } from "node:crypto";
import { Router, type IRouter, type Request } from "express";
import { desc, eq } from "drizzle-orm";
import { CreateApiKeyBody } from "@workspace/api-zod";
import { db, apiKeysTable, type ApiKeyRow } from "@workspace/db";
import { hashApiKey } from "../middlewares/apiKeyAuth";

const router: IRouter = Router();

function serializeKey(k: ApiKeyRow) {
  return {
    id: k.id,
    name: k.name,
    keyPrefix: k.keyPrefix,
    isActive: k.isActive,
    lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
    createdAt: k.createdAt.toISOString(),
    revokedAt: k.revokedAt ? k.revokedAt.toISOString() : null,
  };
}

// GET /keys — list all keys (metadata only, never the secret).
router.get("/keys", async (_req, res) => {
  const rows = await db
    .select()
    .from(apiKeysTable)
    .orderBy(desc(apiKeysTable.createdAt));
  res.json({ keys: rows.map(serializeKey) });
});

// POST /keys — generate a new key. Full secret returned once, only hash stored.
router.post("/keys", async (req, res) => {
  const parsed = CreateApiKeyBody.safeParse(req.body);
  if (!parsed.success || !parsed.data.name.trim()) {
    res.status(400).json({ error: "A key name (1-100 characters) is required." });
    return;
  }
  const secret = `pryg_${randomBytes(24).toString("base64url")}`;
  const [row] = await db
    .insert(apiKeysTable)
    .values({
      name: parsed.data.name,
      keyPrefix: secret.slice(0, 11),
      keyHash: hashApiKey(secret),
    })
    .returning();
  res.status(201).json({ key: secret, apiKey: serializeKey(row) });
});

// POST /keys/:id/revoke — deactivate immediately, keep for audit.
router.post("/keys/:id/revoke", async (req: Request<{ id: string }>, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(404).json({ error: "Key not found." });
    return;
  }
  const [row] = await db
    .update(apiKeysTable)
    .set({ isActive: false, revokedAt: new Date() })
    .where(eq(apiKeysTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Key not found." });
    return;
  }
  res.json(serializeKey(row));
});

// DELETE /keys/:id — permanent removal.
router.delete("/keys/:id", async (req: Request<{ id: string }>, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(404).json({ error: "Key not found." });
    return;
  }
  const [row] = await db
    .delete(apiKeysTable)
    .where(eq(apiKeysTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Key not found." });
    return;
  }
  res.json({ ok: true });
});

export default router;
