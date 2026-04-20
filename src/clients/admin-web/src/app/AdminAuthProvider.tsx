import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { authStore, isAdminSession, type AdminSession } from '@/lib/auth';

interface AuthCtx {
  session: AdminSession | null;
  status: 'loading' | 'anonymous' | 'non-admin' | 'admin';
  login: (s: AdminSession) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthCtx | null>(null);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [status, setStatus] = useState<AuthCtx['status']>('loading');

  useEffect(() => {
    const s = authStore.get();
    if (!s) {
      setStatus('anonymous');
      return;
    }
    if (!isAdminSession(s)) {
      setStatus('non-admin');
      setSession(s);
      return;
    }
    setSession(s);
    setStatus('admin');
  }, []);

  const ctx = useMemo<AuthCtx>(
    () => ({
      session,
      status,
      login: (s) => {
        authStore.set(s);
        if (!isAdminSession(s)) {
          setStatus('non-admin');
          setSession(s);
          return;
        }
        setSession(s);
        setStatus('admin');
      },
      logout: () => {
        authStore.clear();
        setSession(null);
        setStatus('anonymous');
      },
    }),
    [session, status]
  );

  return <AuthContext.Provider value={ctx}>{children}</AuthContext.Provider>;
}

export function useAdminAuth(): AuthCtx {
  const c = useContext(AuthContext);
  if (!c) throw new Error('useAdminAuth must be used within AdminAuthProvider');
  return c;
}
