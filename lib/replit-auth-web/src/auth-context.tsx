/// <reference types="vite/client" />
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { AuthUser } from '@workspace/api-client-react';
import { changePassword as changePasswordRequest, setAuthTokenGetter } from '@workspace/api-client-react';
import { ActivityTracker } from "./activity-tracker";
import { revokeBrowserSession } from "./logout";

export type { AuthUser };

const SID_KEY = 'prayag_sid';

interface LoginResult {
  ok: boolean;
  error?: string;
}

interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  loginWithPassword: (email: string, password: string) => Promise<LoginResult>;
  changePassword: (newPassword: string) => Promise<LoginResult>;
  logout: () => void;
}

function getStoredSid(): string | null {
  try { return localStorage.getItem(SID_KEY); } catch { return null; }
}
function storeSid(sid: string): void {
  try { localStorage.setItem(SID_KEY, sid); } catch { /* ignore */ }
}
function clearStoredSid(): void {
  try { localStorage.removeItem(SID_KEY); } catch { /* ignore */ }
}
function activateBearer(sid: string) { setAuthTokenGetter(() => sid); }
function deactivateBearer() { setAuthTokenGetter(null); }

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({
  children,
  appSlug = "home",
}: {
  children: React.ReactNode;
  appSlug?: string;
}) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const fetchedRef = useRef(false);

  const fetchUser = useCallback(async () => {
    const sid = getStoredSid();
    const headers: Record<string, string> = {};
    if (sid) headers['Authorization'] = `Bearer ${sid}`;
    try {
      const res = await fetch('/api/auth/user', { credentials: 'include', headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { user: AuthUser | null };
      setUser(data.user ?? null);
      if (!data.user) { clearStoredSid(); deactivateBearer(); }
    } catch {
      setUser(null);
      clearStoredSid();
      deactivateBearer();
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    const sid = getStoredSid();
    if (sid) activateBearer(sid);
    fetchUser();
  }, [fetchUser]);

  const loginWithPassword = useCallback(
    async (email: string, password: string): Promise<LoginResult> => {
      try {
        const res = await fetch('/api/login', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          return { ok: false, error: (body as { error?: string }).error ?? 'Invalid email or password' };
        }
        const body = await res.json() as { ok: boolean; user: AuthUser; sid: string };
        if (body.sid) { storeSid(body.sid); activateBearer(body.sid); }
        setUser(body.user ?? null);
        setIsLoading(false);
        return { ok: true };
      } catch {
        return { ok: false, error: 'Network error. Please try again.' };
      }
    },
    [],
  );

  const changePassword = useCallback(
    async (newPassword: string): Promise<LoginResult> => {
      try {
        await changePasswordRequest({ newPassword });
        setUser((current) => current ? { ...current, mustChangePassword: false } : current);
        return { ok: true };
      } catch (error) {
        const message =
          error instanceof Error && error.message
            ? error.message
            : 'Could not change password. Please try again.';
        return { ok: false, error: message };
      }
    },
    [],
  );

  const logout = useCallback(async () => {
    setLogoutError(null);
    try {
      await revokeBrowserSession(fetch, getStoredSid());
    } catch {
      setLogoutError("Server-side logout could not be confirmed. Please retry.");
      return;
    }
    clearStoredSid();
    deactivateBearer();
    setUser(null);
    const base = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL)
      ? import.meta.env.BASE_URL
      : '/';
    window.location.href = base;
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoading, isAuthenticated: !!user, loginWithPassword, changePassword, logout }}>
      <ActivityTracker user={user} appSlug={appSlug} />
      {logoutError && <p role="alert" className="p-3 text-sm text-destructive">{logoutError}</p>}
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

export function PasswordChangeGate({ children }: { children: React.ReactNode }) {
  const { user, changePassword, logout } = useAuth();
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!user?.mustChangePassword) return <>{children}</>;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (newPassword.length < 8) {
      setError('Choose a password with at least 8 characters.');
      return;
    }
    if (newPassword !== confirmation) {
      setError('The password confirmation does not match.');
      return;
    }
    setSaving(true);
    const result = await changePassword(newPassword);
    setSaving(false);
    if (!result.ok) setError(result.error ?? 'Could not change password.');
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <section className="w-full max-w-md rounded-xl border bg-background p-7 shadow-sm sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Password update required</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Choose a new password</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          For your account’s security, replace the temporary password before using the workspace.
        </p>
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="new-password" className="mb-1 block text-sm font-medium">New password</label>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              minLength={8}
              required
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div>
            <label htmlFor="confirm-password" className="mb-1 block text-sm font-medium">Confirm new password</label>
            <input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              minLength={8}
              required
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? 'Saving password…' : 'Save new password'}
          </button>
        </form>
        <button
          type="button"
          onClick={logout}
          className="mt-4 w-full text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Sign out instead
        </button>
      </section>
    </main>
  );
}
