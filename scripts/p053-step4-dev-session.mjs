// Genuine, temporary development logins only. Never log credentials or SIDs.
import { writeFile } from "node:fs/promises";
const base = "http://localhost:8080/api";
const result = {};
for (const [role, emailKey, passwordKey] of [
  ["admin", "ADMIN_EMAIL", "ADMIN_PASSWORD"],
  ["nonAdmin", "P053_NON_ADMIN_EMAIL", "P053_NON_ADMIN_PASSWORD"],
]) {
  const response = await fetch(`${base}/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: process.env[emailKey], password: process.env[passwordKey] }),
  });
  const data = await response.json();
  if (!response.ok || !data.sid || data.user?.mustChangePassword)
    throw new Error(`${role}: genuine login unavailable or password replacement required`);
  const check = await fetch(`${base}/auth/user`, { headers: { Authorization: `Bearer ${data.sid}` } });
  const verified = await check.json();
  console.log({ role, loginRole: data.user?.role, verifiedRole: verified.user?.role ?? null, authenticated: !!verified.user });
  if (!verified.user || (role === "admin" && verified.user.role !== "admin") || (role === "nonAdmin" && verified.user.role === "admin"))
    {
      await fetch(`${base}/logout`, { headers: { Authorization: `Bearer ${data.sid}` }, redirect: "manual" });
      if (role === "nonAdmin" && verified.user?.role === "admin") {
        result.nonAdminBlocked = "The configured non-admin login authenticates as admin; no account or role was changed.";
        continue;
      }
      throw new Error(`${role}: identity/role verification failed`);
    }
  result[role] = { sid: data.sid, userId: verified.user.id };
}
await writeFile("/tmp/p053-step4-dev-sessions.json", JSON.stringify(result), { mode: 0o600 });
console.log("Private genuine development session handoff ready; non-admin verification may be blocked. No passwords/account details changed.");
