// spec: plr-d10-redesign-real-integration-2026-10-25 (I25; founder D-36, D-31)
//
// The words of the two voice switches whose MEANING the founder fixed in round 2, and the
// version strings that travel with a choice so the server can tell which words were agreed.
// One string names exactly one text: change a word here and the version moves.
//
// Language-strict: Marathi mode shows only the Marathi, English mode only the English.

export type SwitchLanguage = 'mr' | 'en';

/**
 * The optional improvement permission (founder D-36). Mirrors
 * `CurrentConsentWording.ImprovementPermissionVersion` on the server; an ON sent with any
 * other version is stored as sent and does not count.
 */
export const IMPROVEMENT_WORDING_VERSION = 'improve-2026-10-30.1';

export interface ImprovementCopy {
    title: string;
    body: string;
    /** Shown when the choice could not be saved. The switch goes back to what is stored. */
    saveFailed: string;
}

export const IMPROVEMENT_COPY: Record<SwitchLanguage, ImprovementCopy> = {
    mr: {
        // Founder D-36, verbatim.
        title: 'माझ्या अनुभवातून श्रमसफल अधिक सक्षम होऊ द्या',
        // Founder D-36, verbatim.
        body: 'माझ्या आवाजाच्या नोंदी, मी केलेल्या दुरुस्त्या आणि संबंधित कामाचा संदर्भ वापरून श्रमसफलला शेतीची भाषा व कामाच्या पद्धती अधिक अचूक समजण्यास मदत करू द्या. ही परवानगी ऐच्छिक आहे. ती बंद केली तरी कामाच्या नोंदी करणे आणि मूळ आवाज पुन्हा ऐकणे सुरू राहील.',
        // PROPOSED (Marathi)
        saveFailed: 'ही निवड आत्ता जतन झाली नाही. इंटरनेट सुरू असताना पुन्हा प्रयत्न करा.',
    },
    en: {
        // PROPOSED (English) rendering of the founder's D-36 title.
        title: 'Let Shram Safal grow more capable from my experience',
        // PROPOSED (English) rendering of the founder's D-36 supporting text.
        body: 'Let Shram Safal use my voice recordings, the corrections I make and the related work context to understand farming language and work practices more accurately. This permission is optional. Even if you turn it off, you can keep recording your work and listening to your original voice.',
        // PROPOSED (English)
        saveFailed: 'This choice was not saved. Try again when you are online.',
    },
};

/**
 * The "keep my original voice" switch (founder D-31, with D-2's title). Its meaning now
 * explicitly includes authorised reviewers on this farm, so a choice made against these words
 * is sent with this version; the server keeps it beside the choice
 * (`user_consent_state.full_history_journal_wording_version`). Lane L6's reviewer playback
 * must honour only a choice made against these words.
 */
export const VOICE_RETENTION_WORDING_VERSION = 'voice-keep-2026-10-30.1';
