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

// spec: plr-d10-redesign-real-integration-2026-10-25 (I17, V-2) — one language at a time and one name
// for the place. The `*En` second lines (an English copy printed under the Marathi one) and the doubled
// "मराठी · English" button labels are gone; the page is called what the setup hub calls it, "आवाज नोंदी",
// with no second line ("Voice Diary · सर्व नोंदी"). Its मागे comes from the shared title bar.
export interface VoiceDiaryBundle {
    page: {
        title: string;
        refresh: string;
    };
    /** The play button's spoken label (it was the English "Play" / "Pause" in every language). */
    player: {
        play: string;
        pause: string;
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
        body: string;
        cta: string;
    };
    consentToggle: {
        title: string;
        /** plr-d10 I25 (founder D-31): who may listen — always shown under the title. */
        meaning: string;
        helper: string;
        expand: string;
    };
    /**
     * plr-d10 I25 (founder D-31) — words for lane L6's replay. When the speaker did not keep
     * his original voice, the transcript stays and this line says the recording is not there.
     * (Replay itself is not built in this lane.)
     */
    replay: {
        originalUnavailable: string;
    };
    firstGrant: {
        headline: string;
        body: string;
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
        body: string;
        keptNote: string;
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
        // the setup hub row's own words (ProfilePage settingsMeta 'voice-diary') — one name for the place
        title: 'आवाज नोंदी',
        // PROPOSED (Marathi): plain words for the refresh button (it was the transliteration "रिफ्रेश").
        refresh: 'नव्या नोंदी पाहा',
    },
    player: {
        // PROPOSED (Marathi)
        play: 'ऐका',
        // PROPOSED (Marathi)
        pause: 'थांबवा',
    },
    retentionBanner: {
        grantedTitle: 'आवाजी नोंदी खात्यात जतन करण्याची सोय सुरू आहे.',
        grantedBody: 'प्रत्येक नोंदीची जतन स्थिती खाली पाहा.',
        deniedTitle: 'नवीन आवाजी नोंदी खात्यात जतन करणे बंद आहे.',
        deniedBody: 'यामुळे आधी जतन झालेल्या नोंदी मिटणार नाहीत.',
        deniedCta: 'चालू करा',
    },
    emptyState: {
        headline: 'अजून आवाजी नोंदी नाहीत',
        // PROPOSED (Marathi): the switch now sits on this page — no "Settings", no English setting name.
        // plr-d10 I25: the switch's name is now the founder's D-2 title.
        body: 'आवाजी नोंदी खात्यात जतन करण्यासाठी खालचं "मूळ आवाज ऐकू देणे" चालू करा.',
        // the banner's own "चालू करा" (retentionBanner.deniedCta) — the doubled "· Open Settings" is gone
        cta: 'चालू करा',
    },
    consentToggle: {
        // the गोपनीयता व संमती screen's words for the same consent (consentTranslations fullHistoryJournal)
        // Founder D-2, verbatim.
        title: 'मूळ आवाज ऐकू देणे',
        // PROPOSED (Marathi) rendering of the founder's D-31 meaning.
        meaning: 'माझा मूळ आवाज मला आणि या शेतावरील अधिकृत तपासणाऱ्यांना ऐकू द्या.',
        // Founder D-2 description, verbatim, then the existing "can be turned off" sentence.
        helper: 'श्रमसफलने तुमचे बोलणे समजून घेताना काही चूक केली किंवा माहिती सुटली, तर तुमचा मूळ आवाज पुन्हा ऐकून तुम्ही नेमके काय सांगितले होते ते तपासू शकता. तुमच्या कामाचा संदर्भ टिकून राहण्यासाठी हा आवाज नोंदीसोबत जतन केला जातो. प्रत्येक आवाजाची पुराव्याची प्रत नेहमी जतन केली जाते. हे बटण फक्त ठरवतं की तुमचा मूळ आवाज पुन्हा ऐकता येईल का; बंद केल्यावर ऐकणं थांबतं, पण काहीही मिटवलं जात नाही. कधीही बंद करता येते — आधी जतन झालेल्या नोंदी तुम्ही मिटवेपर्यंत राहतील.',
        expand: '+ अधिक',
    },
    replay: {
        // PROPOSED (Marathi) rendering of the founder's D-31 "Original recording unavailable."
        originalUnavailable: 'मूळ आवाज उपलब्ध नाही.',
    },
    firstGrant: {
        headline: 'आवाजी नोंदी जतन करण्याची परवानगी',
        // PROPOSED (Marathi): "डायरीत" → the place's one name, "आवाज नोंदी" (V-2). The same old name still
        // sits in the legal agreement and the consent screen's copy of it (consentTranslations): legal text,
        // left for the founder.
        // PROPOSED (Marathi), plr-d10 I25: the last sentence follows D-31 — saved recordings may be
        // heard by him AND by authorised reviewers on this farm (it said "only your account").
        body: 'नवीन आवाजी नोंदी तुमच्या खात्यात जतन करण्याची सोय सुरू होईल. प्रत्येक नोंदीची जतन स्थिती "आवाज नोंदी" मध्ये दिसेल. जतन झालेल्या नोंदी तुम्हाला आणि या शेतावरील अधिकृत तपासणाऱ्यांना ऐकता येतील.',
        bullet1: 'प्रत्येक नोंदीची जतन स्थिती दिसते',
        bullet2: 'कधीही बंद करता येते',
        bullet3: 'तुम्ही नोंदी मिटवायला सांगू शकता',
        primaryCta: 'मी सहमत आहे',
        secondaryCta: 'नंतर',
        attestation: 'तुमची संमती नोंदवली जाते.',
    },
    stopFutureConfirm: {
        headline: 'यापुढे नवीन आवाजी नोंदी जतन करणे बंद करायचे?',
        body: 'यापुढच्या नवीन आवाजी नोंदी तुमच्या खात्यात जतन केल्या जाणार नाहीत. आधी जतन झालेल्या नोंदी राहतील.',
        keptNote: 'आधी जतन झालेल्या नोंदी जशाच्या तशा राहतील. त्या मिटवायच्या असतील तर ती वेगळी कृती आहे.',
        primaryCta: 'होय, यापुढे साठवू नका',
        secondaryCta: 'नको',
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
        // PROPOSED (Marathi): "नोंद / नोंदी" for the English loan word "क्लिप" (plain words on farmer screens).
        countSingular: 'नोंद',
        countPlural: 'नोंदी',
        empty: 'या दिवशी कोणत्याही नोंदी नाहीत',
    },
};

// -- en-IN --------------------------------------------------------------
const en: VoiceDiaryBundle = {
    page: {
        title: 'Voice notes',
        refresh: 'Refresh',
    },
    player: {
        play: 'Play',
        pause: 'Pause',
    },
    retentionBanner: {
        grantedTitle: 'Saving of voice recordings to your account is on.',
        grantedBody: "See each recording's saving status below.",
        deniedTitle: 'New voice recordings are not being saved to your account.',
        deniedBody: 'This does not erase recordings saved earlier.',
        deniedCta: 'Turn on',
    },
    emptyState: {
        headline: 'No voice notes yet',
        // plr-d10 I25: the switch's name is now the D-2 title (PROPOSED English).
        body: 'Turn on "Allow playback of my original voice" below to allow saving of recordings to your account.',
        cta: 'Turn on',
    },
    consentToggle: {
        // PROPOSED (English) rendering of the founder's D-2 title.
        title: 'Allow playback of my original voice',
        // Founder D-31, verbatim.
        meaning: 'Allow me and authorized reviewers on this farm to play back my original voice.',
        // PROPOSED (English) rendering of the founder's D-2 description, then the existing sentence.
        helper: 'If Shram Safal misunderstands what you said or misses something, you can listen to your original voice again and check exactly what you said. The voice is kept with the record so the context of your work is not lost. An evidence copy of every recording is always kept as proof. This switch only decides whether your original voice can be played back; turning it off stops playback, but nothing is deleted. You can turn off any time — recordings saved earlier stay until you erase them.',
        expand: '+ more',
    },
    replay: {
        // Founder D-31, verbatim.
        originalUnavailable: 'Original recording unavailable.',
    },
    firstGrant: {
        headline: 'Allow saving of voice recordings',
        // PROPOSED (English), plr-d10 I25: the last sentence follows D-31 (it said "only your account").
        body: 'Saving of new voice recordings to your account will be turned on. Each recording shows its own saving status in "Voice notes". Saved recordings can be played back by you and by authorized reviewers on this farm.',
        bullet1: 'Each recording shows its saving status',
        bullet2: 'Turn off any time',
        bullet3: 'You can ask us to erase them',
        primaryCta: 'I agree',
        secondaryCta: 'Not now',
        attestation: 'Your consent is recorded.',
    },
    stopFutureConfirm: {
        headline: 'Stop saving new voice recordings?',
        body: 'New voice recordings from now on will not be saved to your account. Recordings saved earlier will stay.',
        keptNote: 'Recordings already saved stay as they are. Deleting them is a separate action.',
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
