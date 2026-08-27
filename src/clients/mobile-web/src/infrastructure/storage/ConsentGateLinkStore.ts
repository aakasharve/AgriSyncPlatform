// spec: 2026-08-25-prod-cutover-waves (B1) — what the gate displayed, kept until it has an owner.
//
// THE DEFECT THIS EXISTS FOR. The consent gate renders only when `!isAuthenticated`, so
// the acceptance is recorded on the server with no user attached. Both ledgers FORCE row
// level security with `USING (user_id IS NOT NULL AND user_id = <GUC>)`, and UPDATE /
// DELETE / TRUNCATE are revoked — so that row is readable by nobody and attachable to
// nobody. Consent was recorded and silently orphaned.
//
// The server side (63104792) closes it with `POST /shramsafal/consent-gate/link`, which
// writes a NEW linking row carrying the full facts. It does not take a pointer to the
// orphan, because nothing can dereference one: the linking row has to RESTATE what was
// shown. So the client has to still HAVE those facts minutes — or days — later, and that
// is this module's whole job.
//
// ── WHY uiPrefs, AND WHY NO NEW TABLE ──────────────────────────────────────────────
// `uiPrefs` already exists (Dexie v14 onward, re-listed verbatim through v23) so nothing
// here needs a schema version bump. A bump is a one-way door on every farmer's device —
// Dexie never re-runs a version a device has already applied — and this branch's v23 is
// already contended with feat/server-authoritative-architecture (see versions/v23.ts).
//
// `uiPrefs` rather than `appMeta` is deliberate and load-bearing:
// DataSourceProvider.resetAuthenticatedUserCacheIfNeeded CLEARS appMeta on a user switch.
// A pending consent link that evaporates when the account it is waiting for finally
// appears would be a defect wearing the shape of a fix. uiPrefs is not in that clear list,
// which is also why the gate already keeps its accepted-notice marker and its
// pre-registration session id there.
//
// ── NOTHING HERE THROWS ─────────────────────────────────────────────────────────────
// Doctrine P9: no optional field may ever reject a record. Every function below swallows
// its own storage failure and reports "nothing" — because the alternative is an exception
// travelling up into the gate's accept handler or the authenticated boot path, where it
// would stop a farmer from registering, logging in, or logging work. A lost payload costs
// us one unlinked acceptance, which is exactly the state we are already in. A thrown error
// costs the farmer his app.
//
// @module infrastructure/storage/ConsentGateLinkStore

import { getDatabase } from './DexieDatabase';

/** One key, declared once. Same namespace as the gate's other two uiPrefs keys. */
export const PENDING_CONSENT_GATE_LINK_PREF_KEY = 'shramsafal_consent_gate_pending_link';

/**
 * The exact facts the gate put on screen, in the wire shape the link endpoint takes.
 *
 * `appVersion` and `source` are the values AT ACCEPTANCE TIME, not at link time. The
 * linking row is a restatement of what was displayed; stamping it with today's app
 * version would describe a screen the farmer never saw.
 */
export interface PendingConsentGateLink {
    preRegistrationSessionId: string;
    noticeVersion: string;
    privacyPolicyVersion: string;
    termsVersion: string;
    displayedLanguage: string;
    acceptedPurposeCodes: readonly string[];
    dataCategoryCodes: readonly string[];
    source: 'app' | 'web';
    appVersion: string;
    displayedNoticeText: string;
    /**
     * The FIRST account that authenticated on this device after the acceptance — recorded
     * on the first link attempt, never overwritten.
     *
     * The gate runs pre-login, so "whose acceptance is this?" has exactly one honest
     * answer: the account that came out of it. If a DIFFERENT account later signs in on
     * this device while the link is still pending, we refuse to send rather than write a
     * ledger row stating that person was shown a notice he was not shown. Unlinked is a
     * gap; mis-linked is a false statement about a named individual (doctrine P4).
     */
    claimedByUserId?: string;
}

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

const isStringArray = (v: unknown): v is string[] =>
    Array.isArray(v) && v.length > 0 && v.every(isNonEmptyString);

/**
 * A stored row is JSON that survived an app upgrade — it is not trusted, it is checked.
 * The bar is the server's own completeness bar: a payload missing any of these would be
 * refused with "incomplete evidence" anyway, so holding it forever would mean retrying a
 * request that can never succeed.
 */
function isPendingConsentGateLink(value: unknown): value is PendingConsentGateLink {
    if (typeof value !== 'object' || value === null) return false;
    const v = value as Record<string, unknown>;
    return isNonEmptyString(v.preRegistrationSessionId)
        && isNonEmptyString(v.noticeVersion)
        && isNonEmptyString(v.privacyPolicyVersion)
        && isNonEmptyString(v.termsVersion)
        && isNonEmptyString(v.displayedLanguage)
        && isStringArray(v.acceptedPurposeCodes)
        && isStringArray(v.dataCategoryCodes)
        && (v.source === 'app' || v.source === 'web')
        && isNonEmptyString(v.appVersion)
        && isNonEmptyString(v.displayedNoticeText)
        && (v.claimedByUserId === undefined || isNonEmptyString(v.claimedByUserId));
}

/** Records that an acceptance is waiting for its account. Never throws. */
export async function savePendingConsentGateLink(pending: PendingConsentGateLink): Promise<void> {
    try {
        await getDatabase().uiPrefs.put({
            key: PENDING_CONSENT_GATE_LINK_PREF_KEY,
            value: {
                ...pending,
                acceptedPurposeCodes: [...pending.acceptedPurposeCodes],
                dataCategoryCodes: [...pending.dataCategoryCodes],
            },
        });
    } catch {
        // See the header: a storage failure here leaves the acceptance unlinked, which is
        // the state we are already in. It may not become the farmer's problem.
    }
}

/** The pending payload, or null when there is none / it is unreadable. Never throws. */
export async function readPendingConsentGateLink(): Promise<PendingConsentGateLink | null> {
    try {
        const row = await getDatabase().uiPrefs.get(PENDING_CONSENT_GATE_LINK_PREF_KEY);
        return isPendingConsentGateLink(row?.value) ? row.value : null;
    } catch {
        return null;
    }
}

/**
 * Binds the pending acceptance to the first account that authenticated after it, and
 * returns the payload as it now stands. A second call with a different id does NOT
 * re-bind — see `claimedByUserId`. Never throws.
 */
export async function claimPendingConsentGateLink(
    userId: string,
): Promise<PendingConsentGateLink | null> {
    const pending = await readPendingConsentGateLink();
    if (!pending) return null;
    if (pending.claimedByUserId) return pending;
    if (!isNonEmptyString(userId)) return pending;

    const claimed: PendingConsentGateLink = { ...pending, claimedByUserId: userId };
    await savePendingConsentGateLink(claimed);
    return claimed;
}

/**
 * Drops the payload. Called on ONE condition only — the server confirmed both linking
 * rows. Every other outcome (offline, 4xx, 5xx, a half response, a different account)
 * leaves it exactly where it was, so the next attempt cannot tell a failed try from a try
 * that never happened. Never throws.
 */
export async function clearPendingConsentGateLink(): Promise<void> {
    try {
        await getDatabase().uiPrefs.delete(PENDING_CONSENT_GATE_LINK_PREF_KEY);
    } catch {
        // A payload we failed to delete is re-sent on the next start; the endpoint is
        // idempotent on (user_id, session, event_type) and writes nothing on a replay.
    }
}
