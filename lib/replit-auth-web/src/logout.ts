/** Do not discard the only session identity until server revocation succeeds. */
export async function revokeBrowserSession(fetcher: typeof fetch, sid: string | null): Promise<void> {
  const headers: Record<string, string> = {};
  if (sid) headers.Authorization = `Bearer ${sid}`;
  const response = await fetcher("/api/logout", { credentials: "include", headers });
  if (!response.ok) throw new Error("Server-side logout could not be confirmed. Please retry.");
}