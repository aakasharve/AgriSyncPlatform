// spec: dfes-companion-2026-07-11 (wave-4.3)
//
// "NEVER STORE A VOICE CLIP BEFORE CORE CONSENT" — the readable form of that rule.
//
// The gate screen (wave-4.1) writes the accepted notice version into Dexie's uiPrefs
// after both legal records land (wave-4.2). This is the same value, read from outside
// React so a non-component boundary — the one place a voice clip becomes durable on the
// device — can refuse.
//
// Why a hook would not do: the rule has to hold at the STORE, not at the screen. A screen
// check is a check a future caller can route around by calling the store directly, and
// the store is exactly what a background retry, a drain worker or an offline queue calls.

import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { NOTICE_VERSION } from '../gate/consentNotice';

/** Same key `useConsentGate` writes. One name, declared once. */
export const ACCEPTED_NOTICE_PREF_KEY = 'shramsafal_consent_gate_accepted_notice';

/**
 * True only when this device has recorded an acceptance of the CURRENT notice.
 *
 * Fails CLOSED: an unreadable database, a missing row, or an acceptance of an older
 * notice all return false. "We could not tell" and "he has not consented" get the same
 * answer here on purpose — the cost of a false negative is a clip we do not keep, and the
 * cost of a false positive is holding a farmer's voice with no lawful basis.
 */
export async function hasCoreConsent(): Promise<boolean> {
    try {
        const row = await getDatabase().uiPrefs.get(ACCEPTED_NOTICE_PREF_KEY);
        return row?.value === NOTICE_VERSION;
    } catch {
        return false;
    }
}

/** Thrown, not returned, so a caller cannot ignore it by forgetting to check a boolean. */
export class CoreConsentMissingError extends Error {
    constructor(what: string) {
        super(`Refused to store ${what}: core DPDP consent has not been recorded on this device.`);
        this.name = 'CoreConsentMissingError';
    }
}

/**
 * Guard for any durable write of the farmer's raw voice. Throws
 * {@link CoreConsentMissingError} when consent is absent.
 *
 * Note what this does NOT gate: the parse itself, or the structured log that comes out of
 * it. Core consent covers "voice processing necessary to create work information"
 * (§W4.3 step 3) — it is the RAW CLIP outliving that processing that needs a basis, and
 * keeping the clip beyond the working window needs a second, separate, default-off
 * permission on top (Voice Diary retention).
 */
export async function assertCoreConsentForVoiceStorage(what = 'a voice capture'): Promise<void> {
    if (!(await hasCoreConsent())) throw new CoreConsentMissingError(what);
}
