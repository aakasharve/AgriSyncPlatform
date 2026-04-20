const STORAGE_KEY = 'admin.session.v1';

export interface Membership {
  app: string;
  role: string;
}

export interface AdminSession {
  accessToken: string;
  refreshToken: string | null;
  userId: string;
  phone: string;
  displayName: string | null;
  memberships: Membership[];
  expiresAt: string;
}

function read(): AdminSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AdminSession;
    if (new Date(parsed.expiresAt).getTime() <= Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

function write(s: AdminSession) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

export function isAdminSession(s: AdminSession | null): boolean {
  if (!s) return false;
  return s.memberships.some(
    (m) =>
      m.app.toLowerCase() === 'shramsafal' &&
      m.role.toLowerCase() === 'admin'
  );
}

export const authStore = {
  get: read,
  set: write,
  clear: () => localStorage.removeItem(STORAGE_KEY),
  getAccessToken: () => read()?.accessToken ?? null,
};
