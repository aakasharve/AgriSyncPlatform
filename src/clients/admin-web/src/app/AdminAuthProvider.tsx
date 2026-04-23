import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { authStore, type AdminSession } from '@/lib/auth';

interface AuthCtx {
  session: AdminSession | null;
  /**
   * Local-session status. After the W0-B pivot, admin access is decided
   * server-side by the resolver — use `useAdminScope()` to branch on the
   * four outcomes (Resolved / Unauthorized / Ambiguous / NotInOrg). This
   * provider only tracks whether we have a valid JWT at all.
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
    const s = authStore.get();
    if (!s) {
      setStatus('anonymous');
      return;
    }
    setSession(s);
    setStatus('authenticated');
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
