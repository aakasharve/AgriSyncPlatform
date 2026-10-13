// spec: 2026-08-25-prod-cutover-waves (voice archive path)
//
// WHEN DID CLOUD-SAVE CONSENT TAKE EFFECT, as far as THIS phone can prove?
//
// Consent covers recordings made WHILE it was granted. A clip recorded before
// the grant (or while declined / revoked) is never uploaded automatically.
//
// The server's `grantedAtUtc` cannot be used: it is the first grant of ANY
// purpose and is not reset by a later re-grant, and the client DTO does not even
// map its wire name. So the phone keeps its own marker in the farmer's own
// database (`appMeta`): the moment it first observed `fullHistoryJournal=true`
// (the consent toggle reports it the instant it is granted). The marker is
// cleared the moment consent is observed false. Observation time is never
// earlier than the true grant, so the guard errs closed: an unknown or late
// marker means FEWER clips qualify, never more. No marker => nothing qualifies.

import { getDatabase } from '../storage/DexieDatabase';

export const ARCHIVE_CONSENT_SINCE_KEY = 'voice_archive_consent_since';

export async function getArchiveConsentSince(): Promise<string | null> {
    const entry = await getDatabase().appMeta.get(ARCHIVE_CONSENT_SINCE_KEY);
    return typeof entry?.value === 'string' ? entry.value : null;
}

/**
 * Record what the server just said about cloud-save consent. Returns the
 * marker now in force (null when not granted).
 */
export async function observeArchiveConsent(
    granted: boolean,
    nowIso: string = new Date().toISOString(),
): Promise<string | null> {
    const db = getDatabase();
    const existing = await getArchiveConsentSince();
    if (!granted) {
        if (existing) await db.appMeta.delete(ARCHIVE_CONSENT_SINCE_KEY);
        return null;
    }
    if (existing) return existing;
    await db.appMeta.put({ key: ARCHIVE_CONSENT_SINCE_KEY, value: nowIso, updatedAt: nowIso });
    return nowIso;
}

/** A clip qualifies only if it was recorded at or after the marker. */
export function recordedUnderConsent(recordedAtUtc: string, since: string | null): boolean {
    if (!since) return false;
    const recorded = Date.parse(recordedAtUtc);
    const sinceMs = Date.parse(since);
    return Number.isFinite(recorded) && Number.isFinite(sinceMs) && recorded >= sinceMs;
}
