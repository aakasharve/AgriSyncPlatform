const STORAGE_KEY = 'admin.session.v1';

export interface AdminSession {
  accessToken: string;
  refreshToken: string | null;
  userId: string;
  expiresAtUtc: string;
}

/** Decode JWT payload without verifying signature (verification is server-side). */
function decodeJwt(token: string): Record<string, unknown> {
  try {
    const [, payload] = token.split('.');
    const padded = payload + '=='.slice((payload.length + 2) % 4 || 0);
    return JSON.parse(atob(padded.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return {};
  }
}

/** Check whether the JWT inside session carries shramsafal:admin. */
export function isAdminSession(s: AdminSession | null): boolean {
  if (!s) return false;
  const claims = decodeJwt(s.accessToken);
  const raw = claims['membership'];
  const memberships: string[] = Array.isArray(raw)
    ? (raw as string[])
    : typeof raw === 'string'
    ? [raw]
    : [];
  return memberships.some((m) => m.toLowerCase() === 'shramsafal:admin');
}

function read(): AdminSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as AdminSession;
    if (new Date(s.expiresAtUtc).getTime() <= Date.now()) return null;
    return s;
  } catch {
    return null;
  }
}

export const authStore = {
  get: read,
  set: (s: AdminSession) => localStorage.setItem(STORAGE_KEY, JSON.stringify(s)),
  clear: () => localStorage.removeItem(STORAGE_KEY),
  getAccessToken: () => read()?.accessToken ?? null,
};
