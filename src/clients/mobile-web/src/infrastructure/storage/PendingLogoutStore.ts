// spec: 2026-08-25-prod-cutover-waves
//
// PENDING LOGOUT - a NON-SECRET marker meaning "the farmer signed out on this
// device, but the server was not (yet) told to revoke the refresh credential".
//
// Why it exists: logging out offline used to clear the local token while the
// server-side revoke failed silently. The refresh credential then stayed valid
// for up to 30 days and, on web, the HttpOnly cookie could silently sign the
// user back in at the next online boot. While this marker is set the boot MUST
// NOT refresh or present an offline session: it shows login and finishes the
// revoke on the first reachable moment.
//
// Holds no token and no user data: only a timestamp. The native (Android)
// credential needed for the revoke lives in RefreshSessionStore's separate
// pending-revoke Keystore slot, never here.

const KEY = 'agrisync_pending_logout_v1';

/** Matches the server's 30-day refresh-credential life (AddDays(30) in User.Application handlers). */
export const PENDING_LOGOUT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function storage(): Storage | null {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
        ? window.localStorage
        : null;
}

export function markPendingLogout(): void {
    storage()?.setItem(KEY, JSON.stringify({ requestedAtUtc: new Date().toISOString() }));
}

export function clearPendingLogout(): void {
    storage()?.removeItem(KEY);
}

export function hasPendingLogout(): boolean {
    const s = storage();
    if (!s) {
        return false;
    }
    const raw = s.getItem(KEY);
    if (!raw) {
        return false;
    }
    try {
        const at = Date.parse((JSON.parse(raw) as { requestedAtUtc?: string }).requestedAtUtc ?? '');
        // Unreadable marker: fail CLOSED (still pending). Older than the
        // credential's whole life: nothing is left to revoke, so drop it.
        if (!Number.isNaN(at) && Date.now() - at > PENDING_LOGOUT_MAX_AGE_MS) {
            s.removeItem(KEY);
            return false;
        }
        return true;
    } catch {
        return true;
    }
}
