/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lane UPD-1 (founder D-53, register F43) — the words of the "new version" card on आजची कामे and of
 * the version row in सेट-अप केंद्र → अ‍ॅप.
 *
 * One language per screen (founder rule): Marathi mode reads only the `mr` twin, English mode only the
 * `en` twin; nothing is doubled. Calm, never alarming, no emoji. Every string is PROPOSED — written by
 * the UPD-1 builder from the orchestrator's brief, for the founder's ruling in the preview. The card's
 * title and the two buttons are the brief's own words; the rest is new.
 */
import type { Language } from './language';

export interface AppUpdateTranslations {
    /** Card title. */
    cardTitle: string;
    /** The card's one line with the version. */
    cardVersionLine: (latest: string, installed: string) => string;
    /** Below the minimum version: said instead of offering "Later". Never blocks the app (P11). */
    cardMustUpdateLine: string;
    updateButton: string;
    laterButton: string;
    /** सेट-अप केंद्र → अ‍ॅप: always the installed version. */
    hubVersionTitle: (installed: string) => string;
    /** Under it, only when a newer one exists. */
    hubNewVersionLine: (latest: string) => string;
}

export const appUpdateTranslations: Record<Language, AppUpdateTranslations> = {
    mr: {
        // PROPOSED (Marathi) — brief's words.
        cardTitle: 'नवीन आवृत्ती आली आहे',
        // PROPOSED (Marathi)
        cardVersionLine: (latest, installed) => `आवृत्ती ${latest} — तुमच्या फोनवर ${installed} आहे`,
        // PROPOSED (Marathi)
        cardMustUpdateLine: 'ही जुनी आवृत्ती लवकरच चालणं बंद होऊ शकते. कृपया अपडेट करा.',
        // PROPOSED (Marathi) — brief's words.
        updateButton: 'अपडेट करा',
        // PROPOSED (Marathi) — brief's words.
        laterButton: 'नंतर',
        // PROPOSED (Marathi) — brief's words.
        hubVersionTitle: installed => `ॲपची आवृत्ती ${installed}`,
        // PROPOSED (Marathi) — brief's words.
        hubNewVersionLine: latest => `नवीन ${latest} उपलब्ध — अपडेट करा`,
    },
    en: {
        // PROPOSED (English)
        cardTitle: 'A new version is available',
        cardVersionLine: (latest, installed) => `Version ${latest} — your phone has ${installed}`,
        cardMustUpdateLine: 'This old version may stop working soon. Please update.',
        updateButton: 'Update',
        laterButton: 'Later',
        hubVersionTitle: installed => `App version ${installed}`,
        hubNewVersionLine: latest => `New ${latest} available — update`,
    },
};

/** The twin for the screen's language. */
export function appUpdateWords(language: Language): AppUpdateTranslations {
    return appUpdateTranslations[language];
}
