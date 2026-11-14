import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { authStore, isSessionOverAge, type AdminSession } from '@/lib/auth';
import { endSession, tellServerSignedOut } from '@/lib/api';
import { accessTokenNeedsRenewal, renewSession } from '@/lib/sessionRenewal';

interface AuthCtx {
  session: AdminSession | null;
  /**
   * Local-session status. After the W0-B pivot, admin access is decided
   * server-side by the resolver — use `useAdminScope()` to branch on the
   * four outcomes (Resolved / Unauthorized / Ambiguous / NotInOrg). This
   * provider only tracks whether a session is held at all: one younger than
   * MAX_SESSION_HOURS, whatever the age of its access token.
   */
  status: 'loading' | 'anonymous' | 'authenticated';
  login: (s: AdminSession) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthCtx | null>(null);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [status, setStatus] = useState<AuthCtx['status']>('loading');
  const qc = useQueryClient();

  useEffect(() => {
    const stored = authStore.get();
    if (!stored) {
      setStatus('anonymous');
      return;
    }

    if (isSessionOverAge(stored)) {
      // Stays on the loading screen until the login page opens with its message.
      void endSession('max-age');
      return;
    }

    if (!accessTokenNeedsRenewal(stored)) {
      setSession(stored);
      setStatus('authenticated');
      return;
    }

    // Signed in, but the access token has expired or is about to: renew it before any page
    // asks for data.
    let cancelled = false;
    renewSession().then(
      (renewed) => {
        if (cancelled) return;
        if (!renewed) {
          void endSession('ended');
          return;
        }
        setSession(renewed);
        setStatus('authenticated');
      },
      () => {
        // No verdict on the session (the server could not be reached): the person stays
        // signed in, and each request tries the renewal again.
        if (cancelled) return;
        setSession(stored);
        setStatus('authenticated');
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const ctx = useMemo<AuthCtx>(
    () => ({
      session,
      status,
      login: (s) => {
        authStore.set(s);
        setSession(s);
        setStatus('authenticated');
        // Invalidate the scope so the next render re-fetches with the new JWT.
        qc.invalidateQueries({ queryKey: ['admin', 'me', 'scope'] });
      },
      logout: () => {
        authStore.clear();
        setSession(null);
        setStatus('anonymous');
        qc.removeQueries({ queryKey: ['admin', 'me', 'scope'] });
        // The person chose to sign out: the server is told too, so the refresh cookie it
        // gave this browser stops working.
        void tellServerSignedOut();
      },
    }),
    [session, status, qc]
  );

  return <AuthContext.Provider value={ctx}>{children}</AuthContext.Provider>;
}

export function useAdminAuth(): AuthCtx {
  const c = useContext(AuthContext);
  if (!c) throw new Error('useAdminAuth must be used within AdminAuthProvider');
  return c;
}
