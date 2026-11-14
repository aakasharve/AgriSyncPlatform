import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { flushSync } from 'react-dom';
import { accessTokenExpiresWithin, authStore, isSessionOverAge, type AdminSession } from '@/lib/auth';
import {
  clearOwedSignOut,
  endSession,
  onSessionForgotten,
  settleOwedSignOut,
  signOut,
  watchSessionAge,
} from '@/lib/api';
import { queryClient } from '@/lib/queryClient';
import { accessTokenNeedsRenewal, renewSession } from '@/lib/sessionRenewal';

interface AuthCtx {
  /** The session this page holds. Kept while `status` is 'unreachable': nothing has ended it. */
  session: AdminSession | null;
  /**
   * Local-session status. After the W0-B pivot, admin access is decided
   * server-side by the resolver — use `useAdminScope()` to branch on the
   * four outcomes (Resolved / Unauthorized / Ambiguous / NotInOrg). This
   * provider only tracks whether a session is held at all: one younger than
   * MAX_SESSION_HOURS, whatever the age of its access token.
   *
   * 'unreachable': a session is stored, its access token has expired, and the server gave no
   * verdict on renewing it. The person is neither let in nor signed out; `retry` asks again.
   */
  status: 'loading' | 'anonymous' | 'authenticated' | 'unreachable';
  /**
   * Stores the session and lets the person in. Throws when the browser refuses to store it;
   * nothing has changed then, and the caller says so.
   */
  login: (s: AdminSession) => void;
  /**
   * The person's own sign-out, from any page: the server is told and waited for, the session
   * and everything loaded are forgotten, and the login page opens.
   */
  logout: () => void;
  /** True from the first press of a Sign out control until the page leaves. Disables them all. */
  signingOut: boolean;
  /** From 'unreachable': tries once more to renew the stored session. */
  retry: () => void;
}

const AuthContext = createContext<AuthCtx | null>(null);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [status, setStatus] = useState<AuthCtx['status']>('loading');
  const [signingOut, setSigningOut] = useState(false);
  // Counts the presses of "Try again": each one opens the stored session afresh.
  const [attempt, setAttempt] = useState(0);

  // Opens the stored session: at page load, and again at every "Try again".
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
          // A definite refusal, or a held sign-in: the session is over.
          void endSession('ended');
          return;
        }
        setSession(renewed);
        setStatus('authenticated');
      },
      () => {
        // No verdict on the session (no answer, too many calls, a server error): it is kept.
        if (cancelled) return;
        setSession(stored);
        // A token that still has time left opens the pages as it is, and each request tries
        // the renewal again. An expired one opens nothing: every page would fail, and the
        // person would be told "Access denied" for what is only an unreachable server. So the
        // page says the server could not be reached, and offers to try again.
        setStatus(accessTokenExpiresWithin(stored, 0) ? 'unreachable' : 'authenticated');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // The 12-hour limit also ends a page that sits open and idle. The watch is stopped and
  // started again whenever the session this page holds changes.
  useEffect(() => (session ? watchSessionAge() : undefined), [session]);

  useEffect(() => {
    // Every start of the app: a sign-out the server could not be told about last time is told
    // now, if the server can be reached. (The login page does the same when it opens, and says
    // how it went; the two share one call.)
    void settleOwedSignOut();

    // At every end of a session the signed-in screens come down before the page is left.
    // In a microtask: the end can begin in the middle of React's own work, where React cannot
    // be told to draw at once, and a microtask still runs before the browser can leave the page.
    const forget = onSessionForgotten(() => {
      queueMicrotask(() => {
        flushSync(() => {
          setSession(null);
          setStatus('loading');
        });
      });
    });

    // A page the browser kept and brings back on "Back" or "Forward" is the console as it was
    // when it was left. It is loaded again, so it shows what the person signed in now may see.
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) window.location.reload();
    };
    window.addEventListener('pageshow', onPageShow);

    return () => {
      forget();
      window.removeEventListener('pageshow', onPageShow);
    };
  }, []);

  const login = useCallback((s: AdminSession) => {
    // First, and alone when it throws: a browser that will not store the session lets nobody in.
    authStore.set(s);
    // A sign-out still owed to the server is owed no longer: the server replaced this browser's
    // old session when it accepted the sign-in.
    clearOwedSignOut();
    // Nothing loaded for whoever was here before is shown to the person signing in now.
    queryClient.clear();
    setSession(s);
    setStatus('authenticated');
  }, []);

  const logout = useCallback(() => {
    setSigningOut(true);
    void signOut();
  }, []);

  const retry = useCallback(() => {
    setStatus('loading');
    setAttempt((n) => n + 1);
  }, []);

  const ctx = useMemo<AuthCtx>(
    () => ({ session, status, login, logout, signingOut, retry }),
    [session, status, login, logout, signingOut, retry],
  );

  return <AuthContext.Provider value={ctx}>{children}</AuthContext.Provider>;
}

export function useAdminAuth(): AuthCtx {
  const c = useContext(AuthContext);
  if (!c) throw new Error('useAdminAuth must be used within AdminAuthProvider');
  return c;
}
