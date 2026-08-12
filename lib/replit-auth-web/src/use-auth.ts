/// <reference types="vite/client" />
import { useCallback, useEffect, useState } from 'react';
import type { AuthUser } from '@workspace/api-client-react';
import { setAuthTokenGetter } from '@workspace/api-client-react';

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
  logout: () => void;
}

function getStoredSid(): string | null {
  try {
    return localStorage.getItem(SID_KEY);
  } catch {
    return null;
  }
}

function storeSid(sid: string): void {
  try {
    localStorage.setItem(SID_KEY, sid);
  } catch {
    // ignore
  }
}

function clearStoredSid(): void {
  try {
    localStorage.removeItem(SID_KEY);
  } catch {
    // ignore
  }
}

// Wire up the shared customFetch to attach Authorization: Bearer <sid>
// for every API call, eliminating reliance on cookie forwarding.
function activateBearer(sid: string) {
  setAuthTokenGetter(() => sid);
}

function deactivateBearer() {
  setAuthTokenGetter(null);
}

export function useAuth(): AuthState {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchUser = useCallback(async () => {
    const sid = getStoredSid();
    const headers: Record<string, string> = {};
    if (sid) headers['Authorization'] = `Bearer ${sid}`;

    try {
      const res = await fetch('/api/auth/user', { credentials: 'include', headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { user: AuthUser | null };
      setUser(data.user ?? null);
      if (!data.user) {
        clearStoredSid();
        deactivateBearer();
      }
    } catch {
      setUser(null);
      clearStoredSid();
      deactivateBearer();
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // Restore bearer token from storage on mount
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
          return {
            ok: false,
            error: (body as { error?: string }).error ?? 'Invalid email or password',
          };
        }

        const body = await res.json() as { ok: boolean; user: AuthUser; sid: string };

        if (body.sid) {
          storeSid(body.sid);
          activateBearer(body.sid);
        }

        setUser(body.user ?? null);
        setIsLoading(false);
        return { ok: true };
      } catch {
        return { ok: false, error: 'Network error. Please try again.' };
      }
    },
    [],
  );

  const logout = useCallback(() => {
    clearStoredSid();
    deactivateBearer();
    setUser(null);
    // Tell the server to clear the session too
    fetch('/api/logout', { credentials: 'include' }).catch(() => {});
    const base = import.meta.env.BASE_URL.replace(/\/+$/, '') || '/';
    window.location.href = base;
  }, []);

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    loginWithPassword,
    logout,
  };
}
