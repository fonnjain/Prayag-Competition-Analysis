import { createHash } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db, apiKeysTable } from "@workspace/db";

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

// Auth middleware for external /v1 endpoints. Expects the full secret in the
// X-API-Key header, matches by SHA-256 hash, rejects revoked keys, and touches
// last_used_at (fire-and-forget) on success.
export async function apiKeyAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const raw = req.header("x-api-key");
  if (!raw || !raw.trim()) {
    res.status(401).json({
      error: "Missing API key. Pass it in the X-API-Key header.",
    });
    return;
  }
  const keyHash = hashApiKey(raw.trim());
  const rows = await db
    .select()
    .from(apiKeysTable)
    .where(eq(apiKeysTable.keyHash, keyHash))
    .limit(1);
  const key = rows[0];
  if (!key || !key.isActive) {
    res.status(401).json({ error: "Invalid or revoked API key." });
    return;
  }
  // Touch last_used_at without blocking the request.
  db.update(apiKeysTable)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeysTable.id, key.id))
    .catch((err) => req.log.warn({ err }, "failed to update api key last_used_at"));
  next();
}
