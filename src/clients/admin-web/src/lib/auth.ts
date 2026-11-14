const STORAGE_KEY = 'admin.session.v1';

/**
 * A person is signed in while their stored session is younger than this. Inside that time an
 * expired access token is renewed without asking them anything; after it they sign in again.
 */
export const MAX_SESSION_HOURS = 12;

export interface AdminSession {
  accessToken: string;
  refreshToken: string | null;
  userId: string;
  expiresAtUtc: string;
  /** When the person signed in. Set once at sign-in and kept when the access token is renewed. */
  signedInAtUtc: string;
}

/**
 * JWT decode helper — kept for any debugging / user-info use cases the
 * session may need. NOT used for authorization — admin status is resolved
 * server-side via GET /admin/me/scope (W0-B pivot).
 */
export function decodeJwt(token: string): Record<string, unknown> {
  try {
    const [, payload] = token.split('.');
    const padded = payload + '=='.slice((payload.length + 2) % 4 || 0);
    return JSON.parse(atob(padded.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return {};
  }
}

/**
 * The stored session, whatever the age of its access token: an expired token inside
 * MAX_SESSION_HOURS is a reason to renew it, not a reason to be signed out.
 */
function read(): AdminSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<AdminSession> | null;
    if (!s || typeof s.accessToken !== 'string' || !s.accessToken) return null;
    if (typeof s.userId !== 'string' || !s.userId) return null;
    if (typeof s.expiresAtUtc !== 'string' || !s.expiresAtUtc) return null;
    if (typeof s.signedInAtUtc !== 'string' || Number.isNaN(Date.parse(s.signedInAtUtc))) {
      // Stored before the console kept the sign-in time: it is given the current time, once.
      const stamped = { ...s, signedInAtUtc: new Date().toISOString() } as AdminSession;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stamped));
      return stamped;
    }
    return s as AdminSession;
  } catch {
    return null;
  }
}

/** Milliseconds until the session reaches MAX_SESSION_HOURS. Zero or less once it has. */
export function msUntilSessionOverAge(session: AdminSession, nowMs: number = Date.now()): number {
  return Date.parse(session.signedInAtUtc) + MAX_SESSION_HOURS * 60 * 60 * 1000 - nowMs;
}

/** True when the session has reached MAX_SESSION_HOURS and the person must sign in again. */
export function isSessionOverAge(session: AdminSession, nowMs: number = Date.now()): boolean {
  return msUntilSessionOverAge(session, nowMs) <= 0;
}

/**
 * True when the access token has expired, or will within `withinMs`. An expiry that cannot be
 * read counts as expired.
 */
export function accessTokenExpiresWithin(
  session: AdminSession,
  withinMs: number,
  nowMs: number = Date.now(),
): boolean {
  const expiresAtMs = Date.parse(session.expiresAtUtc);
  return Number.isNaN(expiresAtMs) || expiresAtMs - nowMs <= withinMs;
}

export const authStore = {
  get: read,
  set: (s: AdminSession) => localStorage.setItem(STORAGE_KEY, JSON.stringify(s)),
  clear: () => localStorage.removeItem(STORAGE_KEY),
};
