// spec: voice-diary-e2e-2026-05-17 (D.4)
//
// Voice Diary i18n bundle — mr-IN / hi-IN / en-IN. Per OQ-7 verdict
// (carried over from Phase 06.4 consent translations), every visible
// string ships tagged with the [LEGAL_REVIEW_PENDING] runtime prefix
// via `tagLegalString(...)` (single-arg signature; mirrors
// `consentTranslations.ts` + `piiReviewTranslations.ts`). Counsel removes
// the prefix in one place (legalReviewMarker.ts) or per-string at
// sign-off.

import { tagLegalString } from './legalReviewMarker';

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
    clipBadge: {
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
// LEGAL_REVIEW_PENDING: all values below — Marathi, awaiting counsel.
const mr: VoiceDiaryBundle = {
    page: {
        title: tagLegalString('आवाजी डायरी'),
        subtitle: tagLegalString('Voice Diary · सर्व नोंदी'),
        refresh: tagLegalString('रिफ्रेश'),
        back: tagLegalString('मागे'),
    },
    retentionBanner: {
        grantedTitle: tagLegalString('आवाजी नोंदी क्लाउडमध्ये कायम सुरक्षित'),
        grantedBody: tagLegalString('Voice notes kept forever in your cloud'),
        deniedTitle: tagLegalString('फक्त ३० दिवस — सेटिंग्जमध्ये चालू करा'),
        deniedBody: tagLegalString('30 days only — turn on Full History Journal'),
        deniedCta: tagLegalString('चालू करा'),
    },
    emptyState: {
        headline: tagLegalString('अजून आवाजी नोंदी नाहीत'),
        headlineEn: tagLegalString('No voice notes yet'),
        body: tagLegalString('३० दिवसांपेक्षा जास्त नोंदी ठेवायच्या असतील तर Full History Journal चालू करा.'),
        bodyEn: tagLegalString('Turn on Full History Journal in Settings to keep recordings beyond 30 days.'),
        cta: tagLegalString('सेटिंग्ज उघडा · Open Settings'),
    },
    consentToggle: {
        title: tagLegalString('आवाजी नोंदी ३० दिवसांपेक्षा जास्त ठेवा'),
        titleEn: tagLegalString('Keep voice journal beyond 30 days'),
        helper: tagLegalString('तुमच्या क्लाउडमध्ये कायमस्वरूपी सुरक्षित. कधीही बंद करता येते — जुन्या नोंदी तुम्ही मिटवेपर्यंत राहतील.'),
        helperEn: tagLegalString('Stored encrypted in your private cloud. You can turn off any time — old clips stay until you erase them.'),
        expand: tagLegalString('+ अधिक'),
    },
    firstGrant: {
        headline: tagLegalString('आवाजी इतिहास कायम ठेवा'),
        headlineEn: tagLegalString('Keep your voice history forever'),
        body: tagLegalString('तुमच्या सर्व आवाजी नोंदी एनक्रिप्ट केल्या जातील आणि फक्त तुम्हालाच ऐकता येतील.'),
        bodyEn: tagLegalString('Your voice notes will be encrypted and stored in your private AgriSync cloud. Only you can play them back.'),
        bullet1: tagLegalString('३० दिवसांनंतरही उपलब्ध'),
        bullet2: tagLegalString('कधीही बंद करता येते'),
        bullet3: tagLegalString('मिटवण्याचा हक्क राखलेला आहे (DPDP)'),
        primaryCta: tagLegalString('मी सहमत आहे · I agree'),
        secondaryCta: tagLegalString('नंतर / Not now'),
        attestation: tagLegalString('DPDP §6 — Consent recorded with full attestation'),
    },
    clipBadge: {
        local: tagLegalString('क्लाउड · cloud'),
        cloud: tagLegalString('क्लाउड · cloud'),
        processed: tagLegalString('प्रक्रिया झाली'),
        parsing: tagLegalString('प्रक्रिया चालू'),
        queued: tagLegalString('रांगेत'),
        failed: tagLegalString('पुन्हा प्रयत्न'),
        recorded: tagLegalString('नोंदले'),
    },
    dayHeading: {
        countSingular: tagLegalString('क्लिप'),
        countPlural: tagLegalString('क्लिप'),
        empty: tagLegalString('या दिवशी कोणत्याही नोंदी नाहीत'),
    },
};

// Override: badge.local should read "local" not "cloud".
mr.clipBadge.local = tagLegalString('लोकल · local');

// -- hi-IN --------------------------------------------------------------
// LEGAL_REVIEW_PENDING: all values below — Hindi, awaiting counsel.
const hi: VoiceDiaryBundle = {
    page: {
        title: tagLegalString('आवाज़ डायरी'),
        subtitle: tagLegalString('Voice Diary · सभी क्लिप'),
        refresh: tagLegalString('रिफ्रेश'),
        back: tagLegalString('वापस'),
    },
    retentionBanner: {
        grantedTitle: tagLegalString('आवाज़ रिकॉर्डिंग्स क्लाउड में हमेशा सुरक्षित'),
        grantedBody: tagLegalString('Voice notes kept forever in your cloud'),
        deniedTitle: tagLegalString('केवल ३० दिन — Settings में चालू करें'),
        deniedBody: tagLegalString('30 days only — turn on Full History Journal'),
        deniedCta: tagLegalString('चालू करें'),
    },
    emptyState: {
        headline: tagLegalString('अभी तक कोई आवाज़ नोट नहीं'),
        headlineEn: tagLegalString('No voice notes yet'),
        body: tagLegalString('३० दिनों के बाद भी रिकॉर्डिंग रखने के लिए Full History Journal चालू करें.'),
        bodyEn: tagLegalString('Turn on Full History Journal in Settings to keep recordings beyond 30 days.'),
        cta: tagLegalString('Settings खोलें · Open Settings'),
    },
    consentToggle: {
        title: tagLegalString('आवाज़ रिकॉर्डिंग्स ३० दिनों के बाद भी रखें'),
        titleEn: tagLegalString('Keep voice journal beyond 30 days'),
        helper: tagLegalString('आपके क्लाउड में एनक्रिप्टेड सुरक्षित. किसी भी समय बंद कर सकते हैं — पुरानी क्लिप्स आप तक मिटाने तक रहेंगी.'),
        helperEn: tagLegalString('Stored encrypted in your private cloud. You can turn off any time — old clips stay until you erase them.'),
        expand: tagLegalString('+ और'),
    },
    firstGrant: {
        headline: tagLegalString('आवाज़ इतिहास हमेशा रखें'),
        headlineEn: tagLegalString('Keep your voice history forever'),
        body: tagLegalString('आपकी सभी आवाज़ नोट्स एनक्रिप्ट की जाएंगी और केवल आप ही सुन सकेंगे.'),
        bodyEn: tagLegalString('Your voice notes will be encrypted and stored in your private AgriSync cloud. Only you can play them back.'),
        bullet1: tagLegalString('३० दिनों के बाद भी उपलब्ध'),
        bullet2: tagLegalString('किसी भी समय बंद कर सकते हैं'),
        bullet3: tagLegalString('मिटाने का अधिकार सुरक्षित (DPDP)'),
        primaryCta: tagLegalString('मैं सहमत हूँ · I agree'),
        secondaryCta: tagLegalString('बाद में / Not now'),
        attestation: tagLegalString('DPDP §6 — Consent recorded with full attestation'),
    },
    clipBadge: {
        local: tagLegalString('लोकल · local'),
        cloud: tagLegalString('क्लाउड · cloud'),
        processed: tagLegalString('प्रोसेस हुआ'),
        parsing: tagLegalString('प्रोसेस हो रहा'),
        queued: tagLegalString('कतार में'),
        failed: tagLegalString('फिर से कोशिश'),
        recorded: tagLegalString('रिकॉर्डेड'),
    },
    dayHeading: {
        countSingular: tagLegalString('क्लिप'),
        countPlural: tagLegalString('क्लिप'),
        empty: tagLegalString('इस दिन कोई क्लिप नहीं'),
    },
};

// -- en-IN --------------------------------------------------------------
// LEGAL_REVIEW_PENDING: all values below — English, awaiting counsel.
const en: VoiceDiaryBundle = {
    page: {
        title: tagLegalString('Voice Diary'),
        subtitle: tagLegalString('All clips'),
        refresh: tagLegalString('Refresh'),
        back: tagLegalString('Back'),
    },
    retentionBanner: {
        grantedTitle: tagLegalString('Voice notes kept forever in your cloud'),
        grantedBody: tagLegalString('Encrypted end-to-end. Only you can play them back.'),
        deniedTitle: tagLegalString('30 days only — turn on in Settings'),
        deniedBody: tagLegalString('Voice recordings auto-delete after 30 days. Turn on Full History Journal to keep them.'),
        deniedCta: tagLegalString('Turn on'),
    },
    emptyState: {
        headline: tagLegalString('No voice notes yet'),
        headlineEn: tagLegalString('No voice notes yet'),
        body: tagLegalString('Turn on Full History Journal in Settings to keep recordings beyond 30 days.'),
        bodyEn: tagLegalString('Turn on Full History Journal in Settings to keep recordings beyond 30 days.'),
        cta: tagLegalString('Open Settings'),
    },
    consentToggle: {
        title: tagLegalString('Keep voice journal beyond 30 days'),
        titleEn: tagLegalString('Keep voice journal beyond 30 days'),
        helper: tagLegalString('Stored encrypted in your private cloud. You can turn off any time — old clips stay until you erase them.'),
        helperEn: tagLegalString('Stored encrypted in your private cloud. You can turn off any time — old clips stay until you erase them.'),
        expand: tagLegalString('+ more'),
    },
    firstGrant: {
        headline: tagLegalString('Keep your voice history forever'),
        headlineEn: tagLegalString('Keep your voice history forever'),
        body: tagLegalString('Your voice notes will be encrypted and stored in your private AgriSync cloud. Only you can play them back.'),
        bodyEn: tagLegalString('Your voice notes will be encrypted and stored in your private AgriSync cloud. Only you can play them back.'),
        bullet1: tagLegalString('Available beyond 30 days'),
        bullet2: tagLegalString('Turn off any time'),
        bullet3: tagLegalString('Right to erase preserved (DPDP)'),
        primaryCta: tagLegalString('I agree'),
        secondaryCta: tagLegalString('Not now'),
        attestation: tagLegalString('DPDP §6 — Consent recorded with full attestation'),
    },
    clipBadge: {
        local: tagLegalString('local'),
        cloud: tagLegalString('cloud'),
        processed: tagLegalString('processed'),
        parsing: tagLegalString('parsing'),
        queued: tagLegalString('queued'),
        failed: tagLegalString('retry'),
        recorded: tagLegalString('recorded'),
    },
    dayHeading: {
        countSingular: tagLegalString('clip'),
        countPlural: tagLegalString('clips'),
        empty: tagLegalString('No clips on this day'),
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
