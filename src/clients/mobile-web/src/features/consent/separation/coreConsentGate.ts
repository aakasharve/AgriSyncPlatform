// spec: dfes-companion-2026-07-11 (wave-4.3)
//
// "NEVER STORE A VOICE CLIP BEFORE CORE CONSENT" — the readable form of that rule.
//
// The consent tick on the phone-number screen writes the accepted notice version into
// Dexie's uiPrefs after both legal records land (`markCoreConsentOnThisDevice` below).
// This reads the same value from outside React so a non-component boundary — the one
// place a voice clip becomes durable on the device — can refuse.
//
// Why a hook would not do: the rule has to hold at the STORE, not at the screen. A screen
// check is a check a future caller can route around by calling the store directly, and
// the store is exactly what a background retry, a drain worker or an offline queue calls.

import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { withPreLoginDatabase } from '../../../infrastructure/storage/preLoginDatabase';
import { NOTICE_VERSION } from '../gate/consentNotice';

/** The device's consent mark. One name, declared once. */
export const ACCEPTED_NOTICE_PREF_KEY = 'shramsafal_consent_gate_accepted_notice';

const isCurrent = (row: { value?: unknown } | undefined): boolean => row?.value === NOTICE_VERSION;

/**
 * True only when this device has recorded an acceptance of the CURRENT notice.
 *
 * WHERE IT LOOKS (spec plr-d10-redesign-real-integration, I1 — X6). The tick is given on
 * the phone-number screen, usually BEFORE sign-in, so the mark lands in the pre-login
 * database; a signed-in visitor on the QR page writes it into his own. This checks the
 * active database and then the pre-login one. Reading only the active database made this
 * false for every signed-in farmer, and his offline voice capture was discarded.
 *
 * Why the pre-login mark may speak for the signed-in farmer: the tick is asked on EVERY
 * login, and an acceptance counts only for the phone number it was given for (a second
 * number on the same screen is asked again — useConsentBeforeOtp), so the latest
 * acceptance on this phone was given by whoever signed in after it. A session that began
 * before the current notice finds an older version and gets false.
 *
 * Fails CLOSED: an unreadable database, a missing row, or an acceptance of an older
 * notice all return false. "We could not tell" and "he has not consented" get the same
 * answer here on purpose — the cost of a false negative is a clip we do not keep, and the
 * cost of a false positive is holding a farmer's voice with no lawful basis.
 */
export async function hasCoreConsent(): Promise<boolean> {
    try {
        if (isCurrent(await getDatabase().uiPrefs.get(ACCEPTED_NOTICE_PREF_KEY))) return true;
    } catch {
        // fall through to the pre-login database
    }
    return withPreLoginDatabase(
        async (db) => isCurrent(await db.uiPrefs.get(ACCEPTED_NOTICE_PREF_KEY)),
        false,
    );
}

/**
 * Records on this device that the current notice was accepted — into the ACTIVE database
 * (the pre-login one on the login screen, his own on the QR page when signed in). Awaited
 * by the tick before the phone number is sent. Never throws: a mark we failed to write
 * costs one clip we will not keep, never the farmer's login.
 */
export async function markCoreConsentOnThisDevice(): Promise<void> {
    try {
        await getDatabase().uiPrefs.put({ key: ACCEPTED_NOTICE_PREF_KEY, value: NOTICE_VERSION });
    } catch {
        // see above
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
