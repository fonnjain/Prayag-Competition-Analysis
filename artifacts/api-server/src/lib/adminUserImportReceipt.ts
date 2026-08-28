import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const RECEIPT_TTL_MS = 15 * 60 * 1000;

interface ReceiptPayload {
  adminId: string;
  workbookSha256: string;
  expiresAt: string;
  nonce: string;
}

function receiptSecret(): string {
  const secret = process.env["SESSION_SECRET"];
  if (!secret) throw new Error("SESSION_SECRET is required for user import confirmation.");
  return secret;
}

export function workbookSha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function createAdminUserImportReceipt(adminId: string, buffer: Buffer): {
  previewToken: string;
  expiresAt: string;
} {
  const expiresAt = new Date(Date.now() + RECEIPT_TTL_MS).toISOString();
  const payload: ReceiptPayload = {
    adminId,
    workbookSha256: workbookSha256(buffer),
    expiresAt,
    nonce: randomUUID(),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", receiptSecret()).update(encoded).digest("base64url");
  return { previewToken: `${encoded}.${signature}`, expiresAt };
}

export function verifyAdminUserImportReceipt(
  token: string,
  adminId: string,
  buffer: Buffer,
): boolean {
  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra) return false;

  const expected = createHmac("sha256", receiptSecret()).update(encoded).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(signature, "base64url");
  } catch {
    return false;
  }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return false;

  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as Partial<ReceiptPayload>;
    return (
      payload.adminId === adminId &&
      payload.workbookSha256 === workbookSha256(buffer) &&
      typeof payload.expiresAt === "string" &&
      Date.parse(payload.expiresAt) > Date.now()
    );
  } catch {
    return false;
  }
}