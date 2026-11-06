// spec: data-principle-spine-2026-05-05/06.4
//
// Consent-namespace i18n bundle. Two locales (mr-IN, en-IN) per DPDP §5
// (notice in a regional language the principal understands). Hindi was never
// requested and is not offered; a stored or server-sent 'hi' falls back to
// Marathi (see `toConsentLocale`).
//
// Strings render exactly as written here: no visible review prefix is added at
// runtime. Copy review status is tracked in the private review records.

/** Locale codes accepted by the consent feature. */
export type ConsentLocale = 'mr-IN' | 'en-IN';

/**
 * Map the base app's `Language` ('en' | 'mr') onto consent locales.
 * Hindi is not offered: 'hi' falls back to Marathi. Unknown values map to en-IN.
 */
export function toConsentLocale(lang: string | null | undefined): ConsentLocale {
    if (lang === 'mr' || lang === 'mr-IN') return 'mr-IN';
    // Hindi is not offered. A stored or server-sent 'hi' falls back to Marathi,
    // the app default (same rule as LanguageContext / LanguageSyncFromServer).
    if (lang === 'hi' || lang === 'hi-IN') return 'mr-IN';
    return 'en-IN';
}

export interface ConsentBundle {
    screen: {
        title: string;
        intro: string;
    };
    toggles: {
        /**
         * plr-d10 I25 (founder D-31, D-2): `meaning` is the switch's meaning, ALWAYS shown
         * under the title — it names who may listen (him and authorised reviewers on this farm).
         * The old "improve the app with my de-identified data" switch is gone from this bundle:
         * its place is taken by the improvement permission (features/consent/improvement).
         */
        fullHistoryJournal: { title: string; meaning: string; body: string };
        researchCorpusExport: { title: string; body: string };
        expand: string;
    };
    revoke: {
        button: string;
        confirm: string;
        /**
         * spec: dfes-companion-2026-07-11 (wave-4.3) — DPDP requires withdrawal to be as
         * easy as granting AND requires the CONSEQUENCE to be explained. "Are you sure?"
         * explains nothing; this line names what actually stops (and, just as
         * importantly, what does not — his farm records stay).
         */
        whatStops: string;
    };
    save: {
        button: string;
        success: string;
        error: string;
    };
}

// -- mr-IN --------------------------------------------------------------
import {
    D2_DESCRIPTION_EN,
    D2_DESCRIPTION_MR,
    OFF_CONSEQUENCE_EN,
    OFF_CONSEQUENCE_MR,
    PROOF_KEPT_EN,
    PROOF_KEPT_MR,
    SWITCH_MEANING_EN,
    SWITCH_MEANING_MR,
    SWITCH_TITLE_EN,
    SWITCH_TITLE_MR,
} from './voiceSwitchWords';

const mr: ConsentBundle = {
    screen: {
        title: 'संमती',
        intro: 'तीन वेगळ्या परवानग्या. प्रत्येक स्वतंत्र. कधीही रद्द करता येते.',
    },
    toggles: {
        fullHistoryJournal: {
            // PROPOSED (not the founder's words: he asked for "who may listen"); see voiceSwitchWords.ts.
            title: SWITCH_TITLE_MR,
            // PROPOSED.
            meaning: SWITCH_MEANING_MR,
            // Founder D-2 description, verbatim, then PROPOSED lines (D-50: the founder's own sentence; D-101: the one consequence of OFF).
            body: `${D2_DESCRIPTION_MR} ${PROOF_KEPT_MR} ${OFF_CONSEQUENCE_MR}`,
        },
        researchCorpusExport: {
            title: 'संशोधन/निर्यातीसाठी डी-आयडेंटिफाईड वापर',
            body: 'सरकारी/संशोधन भागीदारांसाठी (नावांशिवाय) सामान्य ट्रेंड शेअर केले जाऊ शकतात.',
        },
        expand: 'अधिक माहिती',
    },
    revoke: {
        button: 'सर्व रद्द करा',
        confirm: 'तुम्ही खात्रीने सर्व परवानग्या रद्द करू इच्छिता?',
        whatStops: 'रद्द केल्यावर: मूळ आवाज ऐकता येणार नाही; पुराव्याची प्रत जतन राहते आणि काहीही मिटवलं जात नाही. सुधारणा व संशोधनाच्या दोन परवानग्या तुम्ही मागे घेता. बाकी सगळं तसंच चालू राहील — तुमचं शेत, तुमची कामं आणि तुमचा हिशोब जिथल्या तिथेच राहतो. हवं तेव्हा पुन्हा परवानगी देता येते.',
    },
    save: {
        button: 'जतन करा',
        success: 'संमती जतन झाली.',
        error: 'जतन करता आले नाही. पुन्हा प्रयत्न करा.',
    },
};

// -- en-IN --------------------------------------------------------------
const en: ConsentBundle = {
    screen: {
        title: 'Consent',
        intro: 'Three independent permissions. Each is separate. You can revoke at any time.',
    },
    toggles: {
        fullHistoryJournal: {
            // PROPOSED.
            title: SWITCH_TITLE_EN,
            // PROPOSED.
            meaning: SWITCH_MEANING_EN,
            // PROPOSED English rendering of the founder's D-2 description, then the founder's D-50 sentence and one PROPOSED line (D-101).
            body: `${D2_DESCRIPTION_EN} ${PROOF_KEPT_EN} ${OFF_CONSEQUENCE_EN}`,
        },
        researchCorpusExport: {
            title: 'De-identified use for research / export',
            body: 'General trends (without names) may be shared with government / research partners.',
        },
        expand: 'Learn more',
    },
    revoke: {
        button: 'Revoke all',
        confirm: 'Are you sure you want to revoke every permission?',
        whatStops: 'If you revoke: your original voice can no longer be played back; the evidence copy is still kept as proof and nothing is deleted. You also withdraw the two permissions for improving the app and for research. Everything else keeps working — your farm, your work and your accounts stay exactly where they are. You can grant permission again whenever you like.',
    },
    save: {
        button: 'Save',
        success: 'Consent saved.',
        error: 'Could not save. Please try again.',
    },
};

export const CONSENT_BUNDLES: Record<ConsentLocale, ConsentBundle> = {
    'mr-IN': mr,
    'en-IN': en,
};

/**
 * Look up a consent string by dot-path. Defensive: returns the key
 * itself if the path is missing (mirrors the base app's `t()` helper).
 * Path examples: `screen.title`, `toggles.fullHistoryJournal.body`.
 */
export function tConsent(locale: ConsentLocale, key: string): string {
    const parts = key.split('.');
    let cur: unknown = CONSENT_BUNDLES[locale];
    for (const p of parts) {
        if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
            cur = (cur as Record<string, unknown>)[p];
        } else {
            return key;
        }
    }
    return typeof cur === 'string' ? cur : key;
}
