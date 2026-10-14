// spec: 2026-08-25-prod-cutover-waves (voice archive path)
//
// WHEN DID CLOUD-SAVE CONSENT TAKE EFFECT, as far as THIS phone can prove?
//
// Consent covers recordings made WHILE it was granted. A clip recorded before
// the grant (or while declined / revoked) is never uploaded automatically.
//
// TWO BOUNDS, THE LATER ONE WINS (`eligibleSince = max(local, server)`):
//
//  1. SERVER: `fullHistoryJournalGrantedSinceUtc` on GET /consent/me - the start
//     of the CURRENT continuous grant, derived by the server from its
//     append-only consent ledger. This is the one that survives a revoke and
//     re-grant made from ANOTHER device, or while this phone was offline /
//     uninstalled / not running, i.e. while it could never observe `false`.
//     (The server's `grantedAtUtc` is NOT usable: first grant of ANY purpose,
//     never reset by a re-grant.)
//  2. LOCAL: the moment this phone first observed `fullHistoryJournal=true`,
//     cleared the moment it observes false. Observation is never earlier than
//     the true grant, so it can only move the bound LATER.
//
// FAIL CLOSED. Consent granted but the server value missing / unparseable (an
// older server, a ledger that cannot show the start) => NO bound => nothing
// qualifies, the clip stays labelled local. An unknown boundary never means
// "everything".

import { getDatabase } from '../storage/DexieDatabase';

export const ARCHIVE_CONSENT_SINCE_KEY = 'voice_archive_consent_since';
/** Last server-reported start of the current grant, kept so labels can use the same bound. */
export const ARCHIVE_SERVER_GRANT_SINCE_KEY = 'voice_archive_server_grant_since';

/** The slice of the consent DTO this module reads. */
export interface ArchiveConsentView {
    fullHistoryJournal: boolean;
    fullHistoryJournalGrantedSinceUtc?: string | null;
}

async function readMeta(key: string): Promise<string | null> {
    const entry = await getDatabase().appMeta.get(key);
    return typeof entry?.value === 'string' ? entry.value : null;
}

function parseableOrNull(value: string | null | undefined): string | null {
    return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
}

function laterOf(a: string, b: string): string {
    return Date.parse(a) >= Date.parse(b) ? a : b;
}

/**
 * The bound labels use: max(local marker, last server value).
 * null when either is missing (fail closed).
 */
export async function getArchiveConsentSince(): Promise<string | null> {
    const local = parseableOrNull(await readMeta(ARCHIVE_CONSENT_SINCE_KEY));
    const server = parseableOrNull(await readMeta(ARCHIVE_SERVER_GRANT_SINCE_KEY));
    return local && server ? laterOf(local, server) : null;
}

/**
 * Maintain the LOCAL marker only (set on first observed true, cleared on
 * false). Returns the local marker now in force (null when not granted).
 * It does not know the server bound: use `observeArchiveConsentView` for that.
 */
export async function observeArchiveConsent(
    granted: boolean,
    nowIso: string = new Date().toISOString(),
): Promise<string | null> {
    const db = getDatabase();
    const existing = await readMeta(ARCHIVE_CONSENT_SINCE_KEY);
    if (!granted) {
        if (existing) await db.appMeta.delete(ARCHIVE_CONSENT_SINCE_KEY);
        return null;
    }
    if (existing) return existing;
    await db.appMeta.put({ key: ARCHIVE_CONSENT_SINCE_KEY, value: nowIso, updatedAt: nowIso });
    return nowIso;
}

/**
 * Record what the server just said about cloud-save consent and return the
 * bound in force: `max(localMarker, serverCurrentGrantStart)`, or null when
 * not granted OR when the server value is missing / unparseable (fail closed).
 */
export async function observeArchiveConsentView(
    view: ArchiveConsentView,
    nowIso: string = new Date().toISOString(),
): Promise<string | null> {
    const db = getDatabase();
    const granted = view.fullHistoryJournal === true;
    const local = await observeArchiveConsent(granted, nowIso);
    const server = granted ? parseableOrNull(view.fullHistoryJournalGrantedSinceUtc) : null;

    if (server) {
        await db.appMeta.put({ key: ARCHIVE_SERVER_GRANT_SINCE_KEY, value: server, updatedAt: nowIso });
    } else if (await readMeta(ARCHIVE_SERVER_GRANT_SINCE_KEY)) {
        await db.appMeta.delete(ARCHIVE_SERVER_GRANT_SINCE_KEY);
    }

    return local && server ? laterOf(local, server) : null;
}

/** A clip qualifies only if it was recorded at or after the bound. */
export function recordedUnderConsent(recordedAtUtc: string, since: string | null): boolean {
    if (!since) return false;
    const recorded = Date.parse(recordedAtUtc);
    const sinceMs = Date.parse(since);
    return Number.isFinite(recorded) && Number.isFinite(sinceMs) && recorded >= sinceMs;
}
