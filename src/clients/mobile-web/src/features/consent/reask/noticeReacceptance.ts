// spec: plr-d10-redesign-real-integration-2026-10-25 (I25; founder D-13, D-36)
//
// ASK ONCE, ON THE PHONE, WHEN THE NOTICE CHANGES MATERIALLY.
//
// The tick on the phone-number screen covers everyone who logs in from now on. A farmer who
// is ALREADY signed in never sees that screen again (a session lasts until logout), so when
// the notice changes materially he is asked here, once, the next time he opens the app.
//
// Founder D-13: "Ask everyone missing acceptance … once when they next open the updated app."
// "Save acceptance on the server: verified user, notice version and acceptance time. Changing
// phones or reinstalling must not trigger another request." "Support offline acceptance: show
// the notice, save the acceptance securely on the phone and sync it when connectivity returns.
// Recording must not silently disappear."
//
// So:
//   • NEEDED only when this phone holds no acceptance of the notice in force AND the server
//     does not already hold one for this person (accepted on another phone). An unreadable
//     server answer means ASK — never "already accepted".
//   • ACCEPTING never waits on the network. The acceptance is first written to a queue in HIS
//     database; only once that write has landed is the phone marked (the voice-clip store reads
//     the mark, so no recording is lost while offline) and the sheet released. The queued item
//     is sent to POST /shramsafal/consent-gate/link — which records it against the signed-in
//     account with the notice version and the server's time — in the background, now or when
//     the phone is next online, and removed only after the server acknowledged it (P10).
//   • If the queue cannot be written, ONE direct send is tried, bounded in time. If that fails
//     too, nothing is marked: the phone must never claim an acceptance that exists nowhere.
//   • THE SERVER NEVER REFUSES him for an older acceptance (P11); this is the phone's job.
//
// Its own queue key, not the login link's: a login acceptance still waiting to be linked must
// never be overwritten by this one.

import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import {
    isPendingConsentGateLink,
    type PendingConsentGateLink,
} from '../../../infrastructure/storage/ConsentGateLinkStore';
import { linkConsentGateToUser } from '../../../infrastructure/consent/ConsentGateLinkClient';
import { buildConsentAcceptance, mintPreRegistrationSessionId } from '../gate/consentAcceptance';
import { buildPendingLink } from '../gate/consentGateLinkReconciler';
import type { NoticeLanguage } from '../gate/consentNotice';
import {
    hasCoreConsent,
    isStillCurrentNoticeVersion,
    markCoreConsentOnThisDevice,
} from '../separation/coreConsentGate';
import { withTimeout } from './withTimeout';

/** His own database (the active one): the queued in-app acceptance. */
export const PENDING_REACCEPTANCE_PREF_KEY = 'shramsafal_consent_notice_reacceptance_pending';

/** A local write that has not landed in this long is treated as failed (a wedged IndexedDB). */
export const LOCAL_WRITE_LIMIT_MS = 2_000;
/** The one direct send tried when the queue cannot be written. */
export const DIRECT_SEND_LIMIT_MS = 15_000;

/**
 * `queued` — safely on the phone (and being sent in the background); `sent` — the queue could
 * not be written but the server acknowledged a direct send; `failed` — neither: NOTHING was
 * marked, and he must be able to try again.
 */
export type ReacceptanceOutcome = 'queued' | 'sent' | 'failed';
export type ReacceptanceFlushOutcome = 'nothing-pending' | 'offline' | 'sent' | 'deferred';

/**
 * Does this signed-in person still need to be asked?
 *
 * `readServerAcceptedVersion` returns the server's record of his accepted notice
 * (`GET /consent/me` → acceptedNoticeVersion) or throws. When the server already holds an
 * acceptance of the notice in force (another phone, a reinstall), the mark is written here
 * and he is NOT asked again.
 */
export async function needsNoticeReacceptance(
    readServerAcceptedVersion: () => Promise<string | null | undefined>,
): Promise<boolean> {
    if (await hasCoreConsent()) return false;

    let accepted: string | null | undefined;
    try {
        accepted = await readServerAcceptedVersion();
    } catch {
        return true; // could not tell → ask
    }
    if (isStillCurrentNoticeVersion(accepted)) {
        await markCoreConsentOnThisDevice();
        return false;
    }
    return true;
}

/**
 * He ticked. Never waits on the network unless the phone itself cannot hold the acceptance.
 * Never throws.
 */
export async function recordNoticeReacceptance(language: NoticeLanguage): Promise<ReacceptanceOutcome> {
    const pending = buildPendingLink(buildConsentAcceptance(language), mintPreRegistrationSessionId());

    if (await writeQueued(pending)) {
        await markThisPhone();
        void flushSoon();
        return 'queued';
    }

    try {
        await withTimeout(linkConsentGateToUser(pending), DIRECT_SEND_LIMIT_MS);
    } catch {
        return 'failed'; // not on the phone, not on the server: mark nothing
    }
    await markThisPhone();
    return 'sent';
}

let inFlight: Promise<ReacceptanceFlushOutcome> | null = null;

/**
 * Sends the queued acceptance if there is one and the phone is online. Removes it only after
 * the server answered with both record ids (a replay is also a success — the server is
 * idempotent on the session id). Bounded in time, so a stalled network cannot wedge later
 * attempts. Never throws.
 */
export function flushNoticeReacceptance(): Promise<ReacceptanceFlushOutcome> {
    if (inFlight) return inFlight;
    inFlight = (async (): Promise<ReacceptanceFlushOutcome> => {
        try {
            const pending = await readQueued();
            if (!pending) return 'nothing-pending';
            if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
            await withTimeout(linkConsentGateToUser(pending), DIRECT_SEND_LIMIT_MS);
            await clearQueued(pending.preRegistrationSessionId);
            return 'sent';
        } catch {
            return 'deferred';
        }
    })().finally(() => {
        inFlight = null;
    });
    return inFlight;
}

/** Background send of what was just queued: after any flush already running, never awaited by the sheet. */
async function flushSoon(): Promise<void> {
    try {
        if (inFlight) await inFlight;
        await flushNoticeReacceptance();
    } catch {
        // never surfaces; the item stays queued for the next open / 'online'
    }
}

async function writeQueued(pending: PendingConsentGateLink): Promise<boolean> {
    try {
        await withTimeout(
            getDatabase().uiPrefs.put({ key: PENDING_REACCEPTANCE_PREF_KEY, value: { ...pending } }),
            LOCAL_WRITE_LIMIT_MS,
        );
        return true;
    } catch {
        return false;
    }
}

async function markThisPhone(): Promise<void> {
    // markCoreConsentOnThisDevice never throws; bounded so a wedged IndexedDB cannot hold the sheet.
    await withTimeout(markCoreConsentOnThisDevice(), LOCAL_WRITE_LIMIT_MS).catch(() => undefined);
}

async function readQueued(): Promise<PendingConsentGateLink | null> {
    const row = await getDatabase().uiPrefs.get(PENDING_REACCEPTANCE_PREF_KEY);
    return isPendingConsentGateLink(row?.value) ? row.value : null;
}

async function clearQueued(sessionId: string): Promise<void> {
    const held = await readQueued();
    if (held && held.preRegistrationSessionId !== sessionId) return; // a newer one: keep it
    await getDatabase().uiPrefs.delete(PENDING_REACCEPTANCE_PREF_KEY);
}

export function __resetNoticeReacceptanceForTests(): void {
    inFlight = null;
}
