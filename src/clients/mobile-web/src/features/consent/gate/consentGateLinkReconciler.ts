// spec: 2026-08-25-prod-cutover-waves (B1) — the acceptance finds its account, quietly.
//
// The gate's lifecycle, end to end, now reads:
//
//   useConsentGate      mints a pre-registration session id  (pre-login, device-scoped)
//   ConsentGateScreen   shows the notice, takes the tap
//   consentGateApi      POST /consent-gate/accept   → two rows, user_id NULL (orphaned)
//   ConsentGateLinkStore  keeps the displayed facts on the device
//   ── the farmer registers or logs in ──
//   THIS MODULE         POST /consent-gate/link     → two rows carrying the account id
//
// ── IT IS A BACKGROUND RECONCILIATION, AND THAT IS A HARD CONSTRAINT ────────────────
// Doctrine P9 — no optional field may ever reject a record. This may not block, delay or
// interrupt registration, login, or logging work. Concretely, and each of these is a
// property a later change may not quietly drop:
//
//   • `reconcileConsentGateLink` NEVER REJECTS. Every path returns an outcome. It is
//     called from an effect that lives beside the auth state, so a rejection would become
//     an unhandled rejection in the authenticated boot path — and `installGlobalErrorHandlers`
//     would report it as a JS crash for something that is, most of the time, just a farmer
//     standing in a field with no signal.
//   • NOTHING AWAITS IT. The caller fires it and moves on; the farmer's screen never
//     depends on its result.
//   • IT RENDERS NOTHING. Doctrine P4 — no "consent linked" toast, no failure banner, no
//     spinner. A farmer cannot act on this and must not be asked to. It is silent by
//     design, which is also why no user-visible string is introduced anywhere in this
//     change.
//
// ── OFFLINE IS NORMAL, NOT EXCEPTIONAL ─────────────────────────────────────────────
// The APK is sideloaded with no forced update and a farmer can be offline for days, so
// "did not land" is the expected case, not the alarming one. The payload is cleared on
// exactly ONE condition — the server confirmed both linking rows — so a failed attempt and
// an attempt that never happened leave the device in the same state, and the next app
// start cannot tell them apart. That is what makes retrying safe forever: the endpoint is
// idempotent on (user_id, session, event_type) and writes nothing on a replay.
//
// The `navigator.onLine === false` skip is the same posture BackgroundSyncWorker,
// AiJobWorker and AttachmentUploadWorker already take. It is an optimisation, not the
// safety net: `onLine` lies routinely (captive portals), so the real guarantee is the
// paragraph above.

import {
    claimPendingConsentGateLink,
    clearPendingConsentGateLink,
    readPendingConsentGateLink,
    savePendingConsentGateLink,
    type PendingConsentGateLink,
} from '../../../infrastructure/storage/ConsentGateLinkStore';
import { linkConsentGateToUser } from '../../../infrastructure/consent/ConsentGateLinkClient';
import { APP_VERSION } from '../../../infrastructure/api/transport';
import { resolveConsentSource } from './consentGateApi';
import type { ConsentGateAcceptance } from './ConsentGateScreen';

/**
 * Named outcomes, for tests and for reading. Nothing renders them and nothing branches on
 * them in production — the caller ignores the value entirely.
 */
export type ConsentGateLinkOutcome =
    /** No acceptance is waiting for an account. The overwhelmingly common case. */
    | 'nothing-pending'
    /** No signed-in account yet, so there is nothing to attach the acceptance to. */
    | 'no-account'
    /** The device says it has no network. Payload untouched; next start tries again. */
    | 'offline'
    /** A DIFFERENT account is signed in than the one this acceptance was claimed by. */
    | 'other-account'
    /** Both linking rows are confirmed on the server. Payload cleared. */
    | 'linked'
    /** The attempt did not land. Payload untouched; next start tries again. */
    | 'deferred';

/**
 * Captures what the gate displayed, so it can be restated when an account exists.
 *
 * Called AFTER the accepting write returns, never before: a payload stored for an
 * acceptance that never landed would eventually produce a linking row asserting a notice
 * acceptance that does not exist. The cost of that ordering is a vanishing window in which
 * the app dies between the 200 and this write — and the cost of losing that race is one
 * unlinked acceptance, which is exactly the defect we are already living with. A false
 * ledger entry is not.
 *
 * NEVER REJECTS — and the try/catch below is not belt-and-braces over the store's own
 * swallow. This is `void`-ed from the gate's accept handler, so a rejection would land as
 * an unhandled rejection, which `installGlobalErrorHandlers` reports as a JS crash. A
 * farmer whose phone has a wedged IndexedDB would get a crash report filed about him for
 * successfully consenting.
 */
export async function rememberConsentGateAcceptanceForLinking(
    acceptance: ConsentGateAcceptance,
    preRegistrationSessionId: string,
): Promise<void> {
    try {
        await savePendingConsentGateLink(buildPendingLink(acceptance, preRegistrationSessionId));
    } catch {
        // An acceptance we could not remember stays unlinked — the state we are already
        // in. It may not become the farmer's problem.
    }
}

function buildPendingLink(
    acceptance: ConsentGateAcceptance,
    preRegistrationSessionId: string,
): PendingConsentGateLink {
    return {
        preRegistrationSessionId,
        noticeVersion: acceptance.noticeVersion,
        privacyPolicyVersion: acceptance.privacyPolicyVersion,
        termsVersion: acceptance.termsVersion,
        displayedLanguage: acceptance.displayedLanguage,
        acceptedPurposeCodes: [...acceptance.purposeCodes],
        dataCategoryCodes: [...acceptance.dataCategoryCodes],
        // The SAME two values the accepting call sent, captured now rather than re-derived
        // at link time — by then the app may have been updated and `web` may have become
        // `app`, and the linking row would describe a screen the farmer never saw.
        source: resolveConsentSource(),
        appVersion: APP_VERSION,
        displayedNoticeText: acceptance.canonicalNotice,
    };
}

/**
 * Module-level, deliberately. React StrictMode double-invokes effects in development and
 * the `online` listener can fire while a start-up attempt is still in flight; two
 * concurrent requests would both be harmless (the endpoint is idempotent) but the second
 * would race the first's `clear`. One attempt at a time, always.
 */
let inFlight: Promise<ConsentGateLinkOutcome> | null = null;

/**
 * Attempts to attach a pending acceptance to `userId`. Safe to call on every app start,
 * on every login, and on every registration — the endpoint is idempotent and a replay
 * writes nothing.
 *
 * NEVER REJECTS. Every failure is an outcome, not an exception.
 */
export function reconcileConsentGateLink(userId: string | null | undefined): Promise<ConsentGateLinkOutcome> {
    if (inFlight) return inFlight;
    const attempt = runReconciliation(userId).catch((): ConsentGateLinkOutcome => 'deferred');
    inFlight = attempt.finally(() => { inFlight = null; });
    return inFlight;
}

/** Test seam. Clears the in-flight guard between cases; not used in production. */
export function __resetConsentGateLinkReconcilerForTests(): void {
    inFlight = null;
}

async function runReconciliation(userId: string | null | undefined): Promise<ConsentGateLinkOutcome> {
    if (!userId) return 'no-account';

    const pending = await readPendingConsentGateLink();
    if (!pending) return 'nothing-pending';

    if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';

    // Refuse rather than mis-attribute. See `claimedByUserId` on the stored payload: a
    // linking row naming the wrong person is a false statement in a legal ledger, and
    // unlike an unlinked acceptance it cannot be corrected — the ledgers have UPDATE and
    // DELETE revoked. The payload is left in place, so if the account it belongs to signs
    // back in on this device the link still completes.
    if (pending.claimedByUserId && pending.claimedByUserId !== userId) return 'other-account';

    const claimed = (await claimPendingConsentGateLink(userId)) ?? pending;

    try {
        await linkConsentGateToUser(claimed);
    } catch {
        // Offline, 4xx, 5xx, a lost response, a half response — all the same answer here:
        // not linked yet. Nothing is cleared and nothing is shown.
        return 'deferred';
    }

    // Only now, and only here.
    await clearPendingConsentGateLink();
    return 'linked';
}
