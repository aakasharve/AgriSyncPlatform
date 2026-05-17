// spec: data-principle-spine-2026-05-05/06.5
//
// Consent token client — fetches a short-lived HS256 consent token from
// the backend and caches it in-memory for up to ~24h (the backend TTL,
// plan §6.3.2). Mirrors Phase 05's `tenantDekClient.ts` pattern.
//
// **In-memory only.** Persisting to disk would defeat the revocation
// cascade (a revoked toggle must invalidate any cached token on next
// fetch). When the user logs out, `clearCachedConsentToken()` MUST be
// called by the logout path — see AuthProvider.
//
// NOTE: assumes 06.3 backend lands POST /shramsafal/consent/token/issue.
// If that endpoint is not yet live, `getCurrentConsentToken()` rejects
// with the underlying axios error; callers should treat it the same as
// a missing-consent scenario (write paths that depend on consent fail
// closed).

import { agriSyncClient } from '../api/AgriSyncClient';

interface CachedToken {
    token: string;
    expiresAtUtc: Date;
}

/**
 * Module-scoped cache shared by every importer for the session. Reset
 * on logout via `clearCachedConsentToken()`.
 */
let _cached: CachedToken | null = null;

/** Test seam — reset the cache between specs. */
export function __resetForTests(): void {
    _cached = null;
}

/**
 * Refresh threshold — re-fetch when less than 60s remain on the cached
 * token. Matches the 1-minute safety margin used by the DEK cache.
 */
const REFRESH_MARGIN_MS = 60_000;

/**
 * Return a non-expired consent token. Lazy-fetches the first time it's
 * called in a session; refreshes when the cached token is within the
 * margin of expiry.
 *
 * Throws if the backend cannot issue (network down, endpoint missing,
 * consent revoked). Caller should fail closed on rejection.
 */
export async function getCurrentConsentToken(): Promise<string> {
    if (_cached && _cached.expiresAtUtc.getTime() > Date.now() + REFRESH_MARGIN_MS) {
        return _cached.token;
    }
    const resp = await agriSyncClient.issueConsentToken();
    _cached = {
        token: resp.token,
        expiresAtUtc: new Date(resp.expiresAtUtc),
    };
    return _cached.token;
}

/**
 * Extract the `kid` claim from a JWS protected header (RFC 7515 §4.1.4).
 * Used by the clip-seal path to stamp `consentTokenKid` onto the
 * voiceClips row at write time — the kid stays adjacent to the
 * ciphertext so future audits can pin which signing key + consent
 * state the clip was sealed under.
 *
 * Returns null on any parse failure rather than throwing, so the clip
 * write path can degrade gracefully (the row simply lacks the kid).
 */
export function extractKidFromJwt(jwt: string): string | null {
    try {
        const [headerB64] = jwt.split('.');
        if (!headerB64) return null;
        const padded = headerB64.padEnd(headerB64.length + ((4 - (headerB64.length % 4)) % 4), '=');
        const decoded = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
        const header = JSON.parse(decoded) as Record<string, unknown>;
        const kid = header['kid'];
        return typeof kid === 'string' ? kid : null;
    } catch {
        return null;
    }
}

/**
 * Drop the in-memory consent token. MUST be called from the logout
 * path so the next user on the device cannot reuse the previous user's
 * consent grant. Pair with `clearCachedDek()`.
 */
export function clearCachedConsentToken(): void {
    _cached = null;
}
