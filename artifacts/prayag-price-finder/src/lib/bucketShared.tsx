import { useState } from "react";
import { useAuth } from "@workspace/replit-auth-web";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface Member {
  itemCode: string;
  productName: string;
  division: string;
  category: string;
  seriesRange?: string | null;
  isActive?: boolean;
  discontinuedFrom?: string | null;
  missing?: boolean;
}

export type UploadStatus = "matched" | "space_matched" | "duplicate" | "not_found" | "inactive";
export interface UploadRow {
  row: number;
  inputCode: string;
  itemCode: string | null;
  status: UploadStatus;
  productName?: string | null;
  reason?: string | null;
}
export interface UploadResult {
  rows: UploadRow[];
  counts: Record<UploadStatus, number>;
  addableCodes: string[];
}

export const normName = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

export function errMessage(err: unknown): string {
  const e = err as { data?: { error?: string; message?: string }; message?: string } | null;
  return e?.data?.error ?? e?.data?.message ?? e?.message ?? "Request failed";
}

export function useBucketUser() {
  const { user, isLoading } = useAuth();
  // A user who must replace their password is not treated as signed in (PasswordChangeGate shows first).
  const ok = !!user && !user.mustChangePassword;
  return { user: ok ? user : null, isLoading, mustChange: !!user?.mustChangePassword };
}

export function SignInRequired({ title }: { title: string }) {
  const { loginWithPassword, isLoading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (isLoading) return <div className="p-8 text-sm text-muted-foreground">Loading...</div>;
  return (
    <div className="mx-auto mt-16 w-full max-w-sm rounded-xl border bg-card p-6 shadow-sm" data-testid="bucket-sign-in">
      <h1 className="text-lg font-bold">{title}</h1>
      <p className="mb-4 mt-1 text-sm text-muted-foreground">
        Sign in to use bucket lists. Prices stay public; your selected products stay in the address and are kept.
      </p>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          const r = await loginWithPassword(email, password);
          setBusy(false);
          if (!r.ok) setError(r.error ?? "Invalid credentials");
        }}
      >
        <Input type="email" autoComplete="username" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required data-testid="input-email" />
        <Input type="password" autoComplete="current-password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required data-testid="input-password" />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={busy} className="w-full" data-testid="button-sign-in">Sign in</Button>
      </form>
    </div>
  );
}

/** Live = raw active flag AND not retired as of today. */
export function isLive(m: { isActive?: boolean; discontinuedFrom?: string | null }): boolean {
  if (m.isActive === false) return false;
  if (m.discontinuedFrom) {
    const today = new Date().toISOString().slice(0, 10);
    if (String(m.discontinuedFrom).slice(0, 10) <= today) return false;
  }
  return true;
}
