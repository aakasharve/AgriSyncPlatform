// spec: voice-diary-e2e-2026-05-17 (D.4)
//
// Voice Diary i18n bundle — mr-IN / hi-IN / en-IN. Strings render exactly
// as written here: no visible review prefix is added at runtime. Copy
// review status is tracked in the private review records, not in this file.

/** Locale codes accepted by the Voice Diary feature. */
export type VoiceDiaryLocale = 'mr-IN' | 'hi-IN' | 'en-IN';

/**
 * Map the base app's `Language` ('en' | 'mr') onto Voice Diary locales.
 * Hindi falls through to 'hi-IN' when callers route it manually. Unknown
 * values map to en-IN. Mirrors `toConsentLocale` in consentTranslations.ts.
 */
export function toVoiceDiaryLocale(lang: string | null | undefined): VoiceDiaryLocale {
    if (lang === 'mr' || lang === 'mr-IN') return 'mr-IN';
    if (lang === 'hi' || lang === 'hi-IN') return 'hi-IN';
    return 'en-IN';
}

export interface VoiceDiaryBundle {
    page: {
        title: string;
        subtitle: string;
        refresh: string;
        back: string;
    };
    retentionBanner: {
        grantedTitle: string;
        grantedBody: string;
        deniedTitle: string;
        deniedBody: string;
        deniedCta: string;
    };
    emptyState: {
        headline: string;
        headlineEn: string;
        body: string;
        bodyEn: string;
        cta: string;
    };
    consentToggle: {
        title: string;
        titleEn: string;
        helper: string;
        helperEn: string;
        expand: string;
    };
    firstGrant: {
        headline: string;
        headlineEn: string;
        body: string;
        bodyEn: string;
        bullet1: string;
        bullet2: string;
        bullet3: string;
        primaryCta: string;
        secondaryCta: string;
        attestation: string;
    };
    /**
     * spec: dfes-companion-2026-07-11 (farm-memory) — ADR-DS-017 (c).
     * Turning retention OFF and deleting saved history are two different
     * intentions. The toggle used to post OFF on the first tap with no
     * confirmation and no statement of consequence, which left the farmer
     * with no way to tell which of the two he had just done. These strings
     * back the second confirmation, and their whole job is to say the part
     * that was missing: what is already saved stays.
     */
    stopFutureConfirm: {
        headline: string;
        headlineEn: string;
        body: string;
        bodyEn: string;
        keptNote: string;
        keptNoteEn: string;
        primaryCta: string;
        secondaryCta: string;
    };
    clipBadge: {
        /**
         * spec: dfes-companion-2026-07-11 (farm-memory).
         * Shown on a clip the farmer meant to keep whose upload has not
         * been acknowledged by the server yet. Its job is to make a
         * not-yet-safe recording visible instead of letting him assume
         * everything he records is already kept.
         */
        pendingCloudSave: string;
        local: string;
        cloud: string;
        processed: string;
        parsing: string;
        queued: string;
        failed: string;
        recorded: string;
    };
    dayHeading: {
        countSingular: string;
        countPlural: string;
        empty: string;
    };
}

// -- mr-IN --------------------------------------------------------------
const mr: VoiceDiaryBundle = {
    page: {
        title: 'आवाजी डायरी',
        subtitle: 'Voice Diary · सर्व नोंदी',
        refresh: 'रिफ्रेश',
        back: 'मागे',
    },
    retentionBanner: {
        grantedTitle: 'आवाजी नोंदी तुमच्या क्लाउडमध्ये जतन केल्या जातात',
        grantedBody: 'Voice notes are saved to your cloud',
        deniedTitle: 'क्लाउडमध्ये साठवले जात नाही — सेटिंग्जमध्ये चालू करा',
        deniedBody: 'Not saved to your cloud — turn on Full History Journal',
        deniedCta: 'चालू करा',
    },
    emptyState: {
        headline: 'अजून आवाजी नोंदी नाहीत',
        headlineEn: 'No voice notes yet',
        body: 'आवाजी नोंदी तुमच्या क्लाउडमध्ये ठेवायच्या असतील तर Full History Journal चालू करा.',
        bodyEn: 'Turn on Full History Journal in Settings to keep your recordings in your cloud.',
        cta: 'सेटिंग्ज उघडा · Open Settings',
    },
    consentToggle: {
        title: 'आवाजी नोंदी तुमच्या क्लाउडमध्ये ठेवा',
        titleEn: 'Keep voice journal in your cloud',
        helper: 'तुमच्या खाजगी क्लाउड जागेत जतन केले जाते. कधीही बंद करता येते — जुन्या नोंदी तुम्ही मिटवेपर्यंत राहतील.',
        helperEn: 'Saved in your private cloud space. You can turn off any time — old clips stay until you erase them.',
        expand: '+ अधिक',
    },
    firstGrant: {
        headline: 'आवाजी इतिहास क्लाउडमध्ये ठेवा',
        headlineEn: 'Keep your voice history in your cloud',
        body: 'तुमच्या आवाजी नोंदी तुमच्या खाजगी क्लाउड जागेत साठवल्या जातील. फक्त तुमच्या खात्यातूनच त्या ऐकता येतील.',
        bodyEn: 'Your voice notes will be saved in your private AgriSync cloud space. Only your account can play them back in the app.',
        bullet1: 'पूर्ण इतिहास उपलब्ध',
        bullet2: 'कधीही बंद करता येते',
        bullet3: 'तुम्ही नोंदी मिटवायला सांगू शकता',
        primaryCta: 'मी सहमत आहे · I agree',
        secondaryCta: 'नंतर / Not now',
        attestation: 'तुमची संमती नोंदवली जाते.',
    },
    stopFutureConfirm: {
        headline: 'यापुढे नवीन आवाज साठवणे बंद करायचे?',
        headlineEn: 'Stop saving future voice?',
        body: 'यापुढच्या नवीन आवाजी नोंदी क्लाउडमध्ये साठवल्या जाणार नाहीत.',
        bodyEn: 'New recordings will no longer be saved to your cloud.',
        keptNote: 'तुमच्या आधीच्या सर्व नोंदी जशाच्या तशा राहतील. त्या मिटवायच्या असतील तर ती वेगळी कृती आहे.',
        keptNoteEn: 'Everything you have already saved stays. Deleting it is a separate action.',
        primaryCta: 'होय, यापुढे साठवू नका',
        secondaryCta: 'नको / Cancel',
    },
    clipBadge: {
        pendingCloudSave: 'अजून क्लाउडमध्ये सेव्ह झाले नाही',
        local: 'क्लाउड · cloud',
        cloud: 'क्लाउड · cloud',
        processed: 'प्रक्रिया झाली',
        parsing: 'प्रक्रिया चालू',
        queued: 'रांगेत',
        failed: 'पुन्हा प्रयत्न',
        recorded: 'नोंदले',
    },
    dayHeading: {
        countSingular: 'क्लिप',
        countPlural: 'क्लिप',
        empty: 'या दिवशी कोणत्याही नोंदी नाहीत',
    },
};

// Override: badge.local should read "local" not "cloud".
mr.clipBadge.local = 'लोकल · local';

// -- hi-IN --------------------------------------------------------------
const hi: VoiceDiaryBundle = {
    page: {
        title: 'आवाज़ डायरी',
        subtitle: 'Voice Diary · सभी क्लिप',
        refresh: 'रिफ्रेश',
        back: 'वापस',
    },
    retentionBanner: {
        grantedTitle: 'आवाज़ रिकॉर्डिंग्स आपके क्लाउड में सहेजी जाती हैं',
        grantedBody: 'Voice notes are saved to your cloud',
        deniedTitle: 'क्लाउड में सहेजा नहीं जा रहा — Settings में चालू करें',
        deniedBody: 'Not saved to your cloud — turn on Full History Journal',
        deniedCta: 'चालू करें',
    },
    emptyState: {
        headline: 'अभी तक कोई आवाज़ नोट नहीं',
        headlineEn: 'No voice notes yet',
        body: 'रिकॉर्डिंग अपने क्लाउड में रखने के लिए Full History Journal चालू करें.',
        bodyEn: 'Turn on Full History Journal in Settings to keep your recordings in your cloud.',
        cta: 'Settings खोलें · Open Settings',
    },
    consentToggle: {
        title: 'आवाज़ रिकॉर्डिंग्स अपने क्लाउड में रखें',
        titleEn: 'Keep voice journal in your cloud',
        helper: 'आपके निजी क्लाउड स्थान में सहेजा जाता है. किसी भी समय बंद कर सकते हैं — पुरानी क्लिप्स आप मिटाने तक रहेंगी.',
        helperEn: 'Saved in your private cloud space. You can turn off any time — old clips stay until you erase them.',
        expand: '+ और',
    },
    firstGrant: {
        headline: 'आवाज़ इतिहास क्लाउड में रखें',
        headlineEn: 'Keep your voice history in your cloud',
        body: 'आपकी आवाज़ नोट्स आपके निजी क्लाउड स्थान में सहेजी जाएंगी. इन्हें केवल आपके खाते से ही सुना जा सकेगा.',
        bodyEn: 'Your voice notes will be saved in your private AgriSync cloud space. Only your account can play them back in the app.',
        bullet1: 'पूरा इतिहास उपलब्ध',
        bullet2: 'किसी भी समय बंद कर सकते हैं',
        bullet3: 'आप रिकॉर्डिंग मिटाने को कह सकते हैं',
        primaryCta: 'मैं सहमत हूँ · I agree',
        secondaryCta: 'बाद में / Not now',
        attestation: 'आपकी सहमति दर्ज की जाती है।',
    },
    stopFutureConfirm: {
        headline: 'आगे से नई आवाज़ सहेजना बंद करें?',
        headlineEn: 'Stop saving future voice?',
        body: 'आगे की नई आवाज़ रिकॉर्डिंग्स आपके क्लाउड में सहेजी नहीं जाएंगी.',
        bodyEn: 'New recordings will no longer be saved to your cloud.',
        keptNote: 'आपकी पहले से सहेजी गई सभी रिकॉर्डिंग्स वैसी ही रहेंगी. उन्हें मिटाना एक अलग काम है.',
        keptNoteEn: 'Everything you have already saved stays. Deleting it is a separate action.',
        primaryCta: 'हाँ, आगे से न सहेजें',
        secondaryCta: 'रहने दें / Cancel',
    },
    clipBadge: {
        pendingCloudSave: 'अभी क्लाउड में सेव नहीं हुआ',
        local: 'लोकल · local',
        cloud: 'क्लाउड · cloud',
        processed: 'प्रोसेस हुआ',
        parsing: 'प्रोसेस हो रहा',
        queued: 'कतार में',
        failed: 'फिर से कोशिश',
        recorded: 'रिकॉर्डेड',
    },
    dayHeading: {
        countSingular: 'क्लिप',
        countPlural: 'क्लिप',
        empty: 'इस दिन कोई क्लिप नहीं',
    },
};

// -- en-IN --------------------------------------------------------------
const en: VoiceDiaryBundle = {
    page: {
        title: 'Voice Diary',
        subtitle: 'All clips',
        refresh: 'Refresh',
        back: 'Back',
    },
    retentionBanner: {
        grantedTitle: 'Voice notes are saved to your cloud',
        grantedBody: 'Saved in your private cloud space. Only your account can play them back in the app.',
        deniedTitle: 'Not saved to your cloud — turn on in Settings',
        deniedBody: 'Your recordings are not saved to your cloud. Turn on Full History Journal to keep them there.',
        deniedCta: 'Turn on',
    },
    emptyState: {
        headline: 'No voice notes yet',
        headlineEn: 'No voice notes yet',
        body: 'Turn on Full History Journal in Settings to keep your recordings in your cloud.',
        bodyEn: 'Turn on Full History Journal in Settings to keep your recordings in your cloud.',
        cta: 'Open Settings',
    },
    consentToggle: {
        title: 'Keep voice journal in your cloud',
        titleEn: 'Keep voice journal in your cloud',
        helper: 'Saved in your private cloud space. You can turn off any time — old clips stay until you erase them.',
        helperEn: 'Saved in your private cloud space. You can turn off any time — old clips stay until you erase them.',
        expand: '+ more',
    },
    firstGrant: {
        headline: 'Keep your voice history in your cloud',
        headlineEn: 'Keep your voice history in your cloud',
        body: 'Your voice notes will be saved in your private AgriSync cloud space. Only your account can play them back in the app.',
        bodyEn: 'Your voice notes will be saved in your private AgriSync cloud space. Only your account can play them back in the app.',
        bullet1: 'Full history available',
        bullet2: 'Turn off any time',
        bullet3: 'You can ask us to erase them',
        primaryCta: 'I agree',
        secondaryCta: 'Not now',
        attestation: 'Your consent is recorded.',
    },
    stopFutureConfirm: {
        headline: 'Stop saving future voice?',
        headlineEn: 'Stop saving future voice?',
        body: 'New recordings will no longer be saved to your cloud.',
        bodyEn: 'New recordings will no longer be saved to your cloud.',
        keptNote: 'Everything you have already saved stays where it is. Deleting your saved history is a separate action.',
        keptNoteEn: 'Everything you have already saved stays where it is. Deleting your saved history is a separate action.',
        primaryCta: 'Yes, stop saving',
        secondaryCta: 'Cancel',
    },
    clipBadge: {
        pendingCloudSave: 'Not saved to cloud yet',
        local: 'local',
        cloud: 'cloud',
        processed: 'processed',
        parsing: 'parsing',
        queued: 'queued',
        failed: 'retry',
        recorded: 'recorded',
    },
    dayHeading: {
        countSingular: 'clip',
        countPlural: 'clips',
        empty: 'No clips on this day',
    },
};

export const VOICE_DIARY_BUNDLES: Record<VoiceDiaryLocale, VoiceDiaryBundle> = {
    'mr-IN': mr,
    'hi-IN': hi,
    'en-IN': en,
};

/**
 * Look up a Voice Diary string by dot-path. Defensive: returns the key
 * itself if the path is missing (mirrors `tConsent` in
 * consentTranslations.ts).
 */
export function tVoiceDiary(locale: VoiceDiaryLocale, key: string): string {
    const parts = key.split('.');
    let cur: unknown = VOICE_DIARY_BUNDLES[locale];
    for (const p of parts) {
        if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
            cur = (cur as Record<string, unknown>)[p];
        } else {
            return key;
        }
    }
    return typeof cur === 'string' ? cur : key;
}
