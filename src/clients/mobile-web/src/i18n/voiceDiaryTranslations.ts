// spec: voice-diary-e2e-2026-05-17 (D.4)
//
// Voice Diary i18n bundle — mr-IN / en-IN. Strings render exactly
// as written here: no visible review prefix is added at runtime. Copy
// review status is tracked in the private review records, not in this file.

/** Locale codes accepted by the Voice Diary feature. */
export type VoiceDiaryLocale = 'mr-IN' | 'en-IN';

/**
 * Map the base app's `Language` ('en' | 'mr') onto Voice Diary locales.
 * Hindi is not offered: 'hi' falls back to Marathi. Unknown values map to en-IN. Mirrors `toConsentLocale` in consentTranslations.ts.
 */
export function toVoiceDiaryLocale(lang: string | null | undefined): VoiceDiaryLocale {
    if (lang === 'mr' || lang === 'mr-IN') return 'mr-IN';
    // Hindi is not offered. A stored or server-sent 'hi' falls back to Marathi,
    // the app default (same rule as LanguageContext / LanguageSyncFromServer).
    if (lang === 'hi' || lang === 'hi-IN') return 'mr-IN';
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
        /**
         * spec: 2026-08-25-prod-cutover-waves (voice archive path).
         * An upload is in flight. Still NOT saved - only the server's
         * acknowledgement makes it saved.
         */
        uploading: string;
        /**
         * The last upload failed BECAUSE OF CONNECTIVITY (no answer from the
         * server). The only failure that promises a retry, because the
         * uploader really does retry on a backoff once the internet is back.
         */
        uploadFailed: string;
        /**
         * The last upload failed for a reason that is not connectivity (the
         * server refused or could not take it). Says it is not saved and
         * makes NO promise about a retry.
         */
        uploadRefused: string;
        /** Speech understanding failed for this clip (separate from playback). */
        understandFailed: string;
        /** The recording could not be played (separate from understanding). */
        playbackUnavailable: string;
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
        grantedTitle: 'आवाजी नोंदी जतन केल्या जातात',
        grantedBody: 'तुमच्या नोंदी तुमच्या खात्यात जतन होतात.',
        deniedTitle: 'नोंदी फक्त या फोनमध्ये आहेत — सेटिंग्जमध्ये चालू करा',
        deniedBody: 'Recordings stay only on this phone — turn on Full History Journal',
        deniedCta: 'चालू करा',
    },
    emptyState: {
        headline: 'अजून आवाजी नोंदी नाहीत',
        headlineEn: 'No voice notes yet',
        body: 'आवाजी नोंदी जतन करून ठेवायच्या असतील तर Full History Journal चालू करा.',
        bodyEn: 'Turn on Full History Journal in Settings to keep your recordings saved.',
        cta: 'सेटिंग्ज उघडा · Open Settings',
    },
    consentToggle: {
        title: 'आवाजी नोंदी जतन करून ठेवा',
        titleEn: 'Keep voice recordings saved',
        helper: 'तुमच्या खात्यात जतन केले जाते. कधीही बंद करता येते — जुन्या नोंदी तुम्ही मिटवेपर्यंत राहतील.',
        helperEn: 'Saved to your account. You can turn off any time — old clips stay until you erase them.',
        expand: '+ अधिक',
    },
    firstGrant: {
        headline: 'आवाजी इतिहास जतन करून ठेवा',
        headlineEn: 'Keep your voice history saved',
        body: 'तुमच्या आवाजी नोंदी तुमच्या खात्यात जतन केल्या जातील. फक्त तुमच्या खात्यातूनच त्या ऐकता येतील.',
        bodyEn: 'Your voice recordings will be saved to your account. Only your account can play them back in the app.',
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
        body: 'यापुढच्या नवीन आवाजी नोंदी जतन केल्या जाणार नाहीत.',
        bodyEn: 'New recordings will no longer be saved.',
        keptNote: 'तुमच्या आधीच्या सर्व नोंदी जशाच्या तशा राहतील. त्या मिटवायच्या असतील तर ती वेगळी कृती आहे.',
        keptNoteEn: 'Everything you have already saved stays. Deleting it is a separate action.',
        primaryCta: 'होय, यापुढे साठवू नका',
        secondaryCta: 'नको / Cancel',
    },
    clipBadge: {
        pendingCloudSave: 'अजून जतन झाले नाही — फक्त या फोनमध्ये आहे',
        uploading: 'श्रमसाथी जतन करत आहे.',
        uploadFailed: 'श्रमसाथी जतन करू शकला नाही. इंटरनेट व्यवस्थित झाल्यावर पुन्हा प्रयत्न करेल.',
        uploadRefused: 'श्रमसाथी जतन करू शकला नाही.',
        understandFailed: 'समजून घेऊ शकत नाही.',
        playbackUnavailable: 'ऐकता आले नाही.',
        local: 'फक्त या फोनमध्ये',
        cloud: 'जतन झाले',
        processed: 'प्रक्रिया झाली',
        parsing: 'प्रक्रिया चालू',
        queued: 'रांगेत',
        failed: 'समजून घेऊ शकत नाही.',
        recorded: 'नोंदले',
    },
    dayHeading: {
        countSingular: 'क्लिप',
        countPlural: 'क्लिप',
        empty: 'या दिवशी कोणत्याही नोंदी नाहीत',
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
        grantedTitle: 'Voice recordings are saved',
        grantedBody: 'Saved to your account. Only your account can play them back in the app.',
        deniedTitle: 'Recordings stay only on this phone — turn on in Settings',
        deniedBody: 'Your recordings stay only on this phone. Turn on Full History Journal to keep them saved.',
        deniedCta: 'Turn on',
    },
    emptyState: {
        headline: 'No voice notes yet',
        headlineEn: 'No voice notes yet',
        body: 'Turn on Full History Journal in Settings to keep your recordings saved.',
        bodyEn: 'Turn on Full History Journal in Settings to keep your recordings saved.',
        cta: 'Open Settings',
    },
    consentToggle: {
        title: 'Keep voice recordings saved',
        titleEn: 'Keep voice recordings saved',
        helper: 'Saved to your account. You can turn off any time — old clips stay until you erase them.',
        helperEn: 'Saved to your account. You can turn off any time — old clips stay until you erase them.',
        expand: '+ more',
    },
    firstGrant: {
        headline: 'Keep your voice history saved',
        headlineEn: 'Keep your voice history saved',
        body: 'Your voice recordings will be saved to your account. Only your account can play them back in the app.',
        bodyEn: 'Your voice recordings will be saved to your account. Only your account can play them back in the app.',
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
        body: 'New recordings will no longer be saved.',
        bodyEn: 'New recordings will no longer be saved.',
        keptNote: 'Everything you have already saved stays where it is. Deleting your saved history is a separate action.',
        keptNoteEn: 'Everything you have already saved stays where it is. Deleting your saved history is a separate action.',
        primaryCta: 'Yes, stop saving',
        secondaryCta: 'Cancel',
    },
    clipBadge: {
        pendingCloudSave: 'Not saved yet — only on this phone',
        uploading: 'ShramSathi is saving.',
        uploadFailed: 'ShramSathi could not save. It will try again when the internet is working.',
        uploadRefused: 'ShramSathi could not save.',
        understandFailed: 'Could not understand.',
        playbackUnavailable: 'Could not play.',
        local: 'only on this phone',
        cloud: 'saved',
        processed: 'processed',
        parsing: 'parsing',
        queued: 'queued',
        failed: 'Could not understand.',
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
