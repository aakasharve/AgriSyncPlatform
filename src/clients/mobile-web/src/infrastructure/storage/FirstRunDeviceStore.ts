/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I16 — FR-1, LANG-1)
 *
 * Two facts that belong to THIS PHONE, not to a farmer:
 *   - whether the स्वागत screen (the first screen, before login) has been seen here;
 *   - the language a person last CHOSE here (on स्वागत, in सेट-अप केंद्र, or on the notice).
 *
 * Why not Dexie `uiPrefs` (where the language used to live alone): the app keeps one database
 * per farmer plus a pre-login one (`AgriLogDB_unidentified`, see `preLoginDatabase.ts`). A
 * choice made on स्वागत is written while the pre-login database is open; the moment the farmer
 * signs in, his own database opens and that row is no longer there — the app fell back to
 * Marathi and the choice he had just made was gone. Both facts are also needed SYNCHRONOUSLY
 * at first paint (which screen, which language), before any IndexedDB read can finish.
 *
 * The language is the PHONE's, by decision (see LanguageContext.tsx — "DECISION FOR THE FOUNDER"):
 * on a shared phone a second account opens in the language last chosen here.
 *
 * Literal keys, never namespaced: demo mode must not answer "has this phone seen स्वागत"
 * differently from real mode. No personal data. Every read and write is fenced: a phone with
 * blocked storage simply shows स्वागत again and opens in Marathi.
 */

const WELCOME_SEEN_KEY = 'shramsafal_first_run_welcome_seen_v1';
const LANGUAGE_KEY = 'shramsafal_device_language_v1';

/** The two languages the app offers (mirrors `i18n/language.ts`; kept local so storage imports no UI module). */
export type DeviceLanguage = 'mr' | 'en';

const store = (): Storage | null => {
    try {
        return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
        return null;
    }
};

/** The language last chosen on this phone, or null when nobody has chosen one here. */
export function readDeviceLanguage(): DeviceLanguage | null {
    try {
        const v = store()?.getItem(LANGUAGE_KEY);
        return v === 'mr' || v === 'en' ? v : null;
    } catch {
        return null;
    }
}

/** Records an explicit choice. Never throws. */
export function writeDeviceLanguage(language: DeviceLanguage): void {
    try {
        store()?.setItem(LANGUAGE_KEY, language);
    } catch {
        /* storage blocked: the choice still holds for this visit */
    }
}

/** True once स्वागत has been passed on this phone. */
export function hasSeenFirstRunWelcome(): boolean {
    try {
        return store()?.getItem(WELCOME_SEEN_KEY) === '1';
    } catch {
        return false;
    }
}

/** Marks स्वागत as seen on this phone. Never throws. */
export function markFirstRunWelcomeSeen(): void {
    try {
        store()?.setItem(WELCOME_SEEN_KEY, '1');
    } catch {
        /* storage blocked: स्वागत shows again next time, which is harmless */
    }
}
