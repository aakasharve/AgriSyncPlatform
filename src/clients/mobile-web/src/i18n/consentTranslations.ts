// spec: data-principle-spine-2026-05-05/06.4
//
// Consent-namespace i18n bundle. Three locales (mr-IN, hi-IN, en-IN)
// per DPDP §5 (notice in a regional language the principal understands)
// and per Phase 06.4 — Marathi/Hindi/English consent screen.
//
// The base app's `translations.ts` is en/mr only; Hindi is added here
// as a feature-scoped bundle to avoid forcing a full-app Hindi swap in
// the same envelope. When the rest of the app gains Hindi, this bundle
// folds into `translations.ts` under the canonical `consent` namespace.
//
// Per OQ-7 verdict (i18n convention): every value MUST be prefixed with
// the `[LEGAL_REVIEW_PENDING] ` marker via `tagLegalString(...)` so the
// dev/CI runtime UI surfaces the tag visibly until counsel removes it.
// Counsel removes by either (a) editing the shared constant
// (`legalReviewMarker.ts`) for bulk strip, OR (b) per-string swap.

import { tagLegalString } from './legalReviewMarker';

/** Locale codes accepted by the consent feature. */
export type ConsentLocale = 'mr-IN' | 'hi-IN' | 'en-IN';

/**
 * Map the base app's `Language` ('en' | 'mr') onto consent locales.
 * Hindi falls through to 'hi-IN' when callers route it manually
 * (e.g. via the future language picker). Unknown values map to en-IN.
 */
export function toConsentLocale(lang: string | null | undefined): ConsentLocale {
    if (lang === 'mr' || lang === 'mr-IN') return 'mr-IN';
    if (lang === 'hi' || lang === 'hi-IN') return 'hi-IN';
    return 'en-IN';
}

export interface ConsentBundle {
    screen: {
        title: string;
        intro: string;
    };
    toggles: {
        fullHistoryJournal: { title: string; body: string };
        crossFarmAggregation: { title: string; body: string };
        researchCorpusExport: { title: string; body: string };
        expand: string;
    };
    revoke: {
        button: string;
        confirm: string;
    };
    save: {
        button: string;
        success: string;
        error: string;
    };
}

// -- mr-IN --------------------------------------------------------------
// LEGAL_REVIEW_PENDING: all values below — Marathi, awaiting counsel.
const mr: ConsentBundle = {
    screen: {
        title: tagLegalString('संमती'),
        intro: tagLegalString('तीन वेगळ्या परवानग्या. प्रत्येक स्वतंत्र. कधीही रद्द करता येते.'),
    },
    toggles: {
        fullHistoryJournal: {
            title: tagLegalString('३० दिवसांपेक्षा जास्त आवाज नोंद ठेवा'),
            body: tagLegalString('होकार दिल्यास तुमचे आवाज कायम सेव्ह राहतील. नकार दिल्यास ३० दिवसांनंतर मिटवले जातात.'),
        },
        crossFarmAggregation: {
            title: tagLegalString('माझ्या डी-आयडेंटिफाईड डेटाने अॅप सुधारा'),
            body: tagLegalString('तुमच्या नावाशिवाय शिकवण्यासाठी वापरलं जाईल — इतर शेतकर्‍यांसाठी अॅप अधिक चांगलं होईल.'),
        },
        researchCorpusExport: {
            title: tagLegalString('संशोधन/निर्यातीसाठी डी-आयडेंटिफाईड वापर'),
            body: tagLegalString('सरकारी/संशोधन भागीदारांसाठी (नावांशिवाय) सामान्य ट्रेंड शेअर केले जाऊ शकतात.'),
        },
        expand: tagLegalString('अधिक माहिती'),
    },
    revoke: {
        button: tagLegalString('सर्व रद्द करा'),
        confirm: tagLegalString('तुम्ही खात्रीने सर्व परवानग्या रद्द करू इच्छिता?'),
    },
    save: {
        button: tagLegalString('जतन करा'),
        success: tagLegalString('संमती जतन झाली.'),
        error: tagLegalString('जतन करता आले नाही. पुन्हा प्रयत्न करा.'),
    },
};

// -- hi-IN --------------------------------------------------------------
// LEGAL_REVIEW_PENDING: all values below — Hindi, awaiting counsel.
const hi: ConsentBundle = {
    screen: {
        title: tagLegalString('सहमति'),
        intro: tagLegalString('तीन अलग-अलग अनुमतियाँ। हर एक स्वतंत्र। किसी भी समय रद्द कर सकते हैं।'),
    },
    toggles: {
        fullHistoryJournal: {
            title: tagLegalString('३० दिनों के बाद भी आवाज़ रिकॉर्डिंग रखें'),
            body: tagLegalString('हाँ कहने पर आपकी आवाज़ें हमेशा सेव रहेंगी। ना कहने पर ३० दिन बाद अपने आप मिटा दी जाती हैं।'),
        },
        crossFarmAggregation: {
            title: tagLegalString('मेरे डी-आइडेंटिफ़ाइड डेटा से ऐप बेहतर बनाएँ'),
            body: tagLegalString('आपके नाम के बिना सीखने के लिए उपयोग होगा — दूसरे किसानों के लिए ऐप बेहतर बनेगा।'),
        },
        researchCorpusExport: {
            title: tagLegalString('अनुसंधान/निर्यात के लिए डी-आइडेंटिफ़ाइड उपयोग'),
            body: tagLegalString('सरकारी/अनुसंधान भागीदारों के साथ (नाम के बिना) सामान्य रुझान साझा किए जा सकते हैं।'),
        },
        expand: tagLegalString('और जानें'),
    },
    revoke: {
        button: tagLegalString('सब रद्द करें'),
        confirm: tagLegalString('क्या आप वाकई सभी अनुमतियाँ रद्द करना चाहते हैं?'),
    },
    save: {
        button: tagLegalString('सहेजें'),
        success: tagLegalString('सहमति सहेज ली गई।'),
        error: tagLegalString('सहेजा नहीं जा सका। फिर से कोशिश करें।'),
    },
};

// -- en-IN --------------------------------------------------------------
// LEGAL_REVIEW_PENDING: all values below — English, awaiting counsel.
const en: ConsentBundle = {
    screen: {
        title: tagLegalString('Consent'),
        intro: tagLegalString('Three independent permissions. Each is separate. You can revoke at any time.'),
    },
    toggles: {
        fullHistoryJournal: {
            title: tagLegalString('Keep voice recordings beyond 30 days'),
            body: tagLegalString('If yes, your clips are saved forever. If no, they are deleted automatically after 30 days.'),
        },
        crossFarmAggregation: {
            title: tagLegalString('Improve the app using my de-identified data'),
            body: tagLegalString('Used (without your name) for learning — makes the app better for other farmers.'),
        },
        researchCorpusExport: {
            title: tagLegalString('De-identified use for research / export'),
            body: tagLegalString('General trends (without names) may be shared with government / research partners.'),
        },
        expand: tagLegalString('Learn more'),
    },
    revoke: {
        button: tagLegalString('Revoke all'),
        confirm: tagLegalString('Are you sure you want to revoke every permission?'),
    },
    save: {
        button: tagLegalString('Save'),
        success: tagLegalString('Consent saved.'),
        error: tagLegalString('Could not save. Please try again.'),
    },
};

export const CONSENT_BUNDLES: Record<ConsentLocale, ConsentBundle> = {
    'mr-IN': mr,
    'hi-IN': hi,
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
