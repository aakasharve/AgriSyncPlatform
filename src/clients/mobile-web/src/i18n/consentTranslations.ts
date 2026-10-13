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
// Strings render exactly as written here: no visible review prefix is added at
// runtime. Copy review status is tracked in the private review records.

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
const mr: ConsentBundle = {
    screen: {
        title: 'संमती',
        intro: 'तीन वेगळ्या परवानग्या. प्रत्येक स्वतंत्र. कधीही रद्द करता येते.',
    },
    toggles: {
        fullHistoryJournal: {
            title: '३० दिवसांपेक्षा जास्त आवाज नोंद ठेवा',
            body: 'होकार दिल्यास तुमचे आवाज तुम्ही मिटवेपर्यंत तुमच्या क्लाउडमध्ये सेव्ह राहतील. नकार दिल्यास ते आवाजी डायरीच्या क्लाउडमध्ये ठेवले जात नाहीत.',
        },
        crossFarmAggregation: {
            title: 'माझ्या डी-आयडेंटिफाईड डेटाने अॅप सुधारा',
            body: 'तुमच्या नावाशिवाय शिकवण्यासाठी वापरलं जाईल — इतर शेतकर्‍यांसाठी अॅप अधिक चांगलं होईल.',
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
        whatStops: 'रद्द केल्यावर: यापुढे नवीन आवाज क्लाउडमध्ये साठवला जाणार नाही, आणि सुधारणा व संशोधनाच्या दोन परवानग्या तुम्ही मागे घेता. आधी साठवलेले आवाज तुम्ही मिटवेपर्यंत राहतील. बाकी सगळं तसंच चालू राहील — तुमचं शेत, तुमची कामं आणि तुमचा हिशोब जिथल्या तिथेच राहतो. हवं तेव्हा पुन्हा परवानगी देता येते.',
    },
    save: {
        button: 'जतन करा',
        success: 'संमती जतन झाली.',
        error: 'जतन करता आले नाही. पुन्हा प्रयत्न करा.',
    },
};

// -- hi-IN --------------------------------------------------------------
const hi: ConsentBundle = {
    screen: {
        title: 'सहमति',
        intro: 'तीन अलग-अलग अनुमतियाँ। हर एक स्वतंत्र। किसी भी समय रद्द कर सकते हैं।',
    },
    toggles: {
        fullHistoryJournal: {
            title: '३० दिनों के बाद भी आवाज़ रिकॉर्डिंग रखें',
            body: 'हाँ कहने पर आपकी आवाज़ें आप मिटाएँ तब तक आपके क्लाउड में सेव रहेंगी। ना कहने पर वे आवाज़ डायरी के क्लाउड में नहीं रखी जातीं।',
        },
        crossFarmAggregation: {
            title: 'मेरे डी-आइडेंटिफ़ाइड डेटा से ऐप बेहतर बनाएँ',
            body: 'आपके नाम के बिना सीखने के लिए उपयोग होगा — दूसरे किसानों के लिए ऐप बेहतर बनेगा।',
        },
        researchCorpusExport: {
            title: 'अनुसंधान/निर्यात के लिए डी-आइडेंटिफ़ाइड उपयोग',
            body: 'सरकारी/अनुसंधान भागीदारों के साथ (नाम के बिना) सामान्य रुझान साझा किए जा सकते हैं।',
        },
        expand: 'और जानें',
    },
    revoke: {
        button: 'सब रद्द करें',
        confirm: 'क्या आप वाकई सभी अनुमतियाँ रद्द करना चाहते हैं?',
        whatStops: 'रद्द करने पर: आगे से नई आवाज़ आपके क्लाउड में सहेजी नहीं जाएगी, और सुधार व अनुसंधान की दोनों अनुमतियाँ आप वापस लेते हैं। पहले सहेजी गई आवाज़ें आप मिटाएँ तब तक रहेंगी। बाकी सब वैसा ही चलता रहेगा — आपका खेत, आपके काम और आपका हिसाब वहीं रहते हैं। जब चाहें दोबारा अनुमति दे सकते हैं।',
    },
    save: {
        button: 'सहेजें',
        success: 'सहमति सहेज ली गई।',
        error: 'सहेजा नहीं जा सका। फिर से कोशिश करें।',
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
            title: 'Keep voice recordings beyond 30 days',
            body: 'If yes, your clips are kept in your cloud until you erase them. If no, they are not kept in the Voice Diary cloud.',
        },
        crossFarmAggregation: {
            title: 'Improve the app using my de-identified data',
            body: 'Used (without your name) for learning — makes the app better for other farmers.',
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
        whatStops: 'If you revoke: no new voice will be saved to your cloud, and you withdraw the two permissions for improving the app and for research. Recordings already saved stay until you erase them. Everything else keeps working — your farm, your work and your accounts stay exactly where they are. You can grant permission again whenever you like.',
    },
    save: {
        button: 'Save',
        success: 'Consent saved.',
        error: 'Could not save. Please try again.',
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
