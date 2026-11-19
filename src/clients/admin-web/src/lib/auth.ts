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
 *
 * It has one production caller as of Task 10: the shell reads the
 * `display_name` and `phone` claims to name the signed-in admin (D12). That
 * is a DISPLAY use, not an authorization one, and D15 stays intact — nothing
 * anywhere decides what an admin may see from a claim in this object.
 *
 * ── Why the TextDecoder ───────────────────────────────────────────────────
 * `atob` returns one CHARACTER PER BYTE. A JWT payload is UTF-8, so a claim
 * containing anything outside ASCII — a Marathi display name, which is the
 * expected case for FPO staff, not an edge case — decodes to mojibake and
 * `JSON.parse` then either throws or hands back a corrupted string. Decoding
 * the bytes as UTF-8 is what makes the claim usable. ASCII payloads are
 * byte-identical through both paths, so this changes nothing for a Latin
 * name; it only stops a Devanagari one arriving as rubbish.
 */
export function decodeJwt(token: string): Record<string, unknown> {
  try {
    const [, payload] = token.split('.');
    const padded = payload + '=='.slice((payload.length + 2) % 4 || 0);
    const binary = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
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
