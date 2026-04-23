const STORAGE_KEY = 'admin.session.v1';

export interface AdminSession {
  accessToken: string;
  refreshToken: string | null;
  userId: string;
  expiresAtUtc: string;
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
