/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I12, PLR-D5) — every word the mic card says.
 *
 * Plain Marathi only, whatever the app's language (founder rule 2026-10-25: no English on the
 * farmer's log screens). Three kinds, kept apart on purpose:
 *   - the FOUNDER'S OWN words (2026-10-24, kept exactly as he said them);
 *   - EXISTING approved strings from `i18n/translations.ts` (read with `t(key, 'mr')`);
 *   - PROPOSED words, each marked `// PROPOSED (Marathi)`, shown in the preview but not yet ruled.
 */
import { t } from '../../../../i18n/translations';
import { OFFLINE_NOT_KEPT_MESSAGE, OFFLINE_SAVED_MESSAGE } from '../../../../infrastructure/ai/offlineVoiceQueue';

/** The founder's own sentence for the idle mic (2026-10-24). It replaces "नोंद सुरू करा" on this screen. */
export const MIC_INSTRUCTION = 'हिरव्या रंगाचा माइक चे बटन एकदा दाबून बोलायला सुरवात करा';

export const REC_WORDS = {
    /** The founder's own words for cancel (PLR-D5, set well apart from stop). */
    cancel: 'काही चुकीचे बोलले गेले असेल तर रद्द करा',
    /** The founder's own text, with standard spelling and full stops (MicRecorderUI, 2026-10-24). */
    stopHint: 'सर्व कामे व्यवस्थित सांगून झाली असतील तरच लाल बटन दाबा. तोपर्यंत सविस्तर बोलत राहा. श्रम सफल तुमचे शेत अजून नीट समजून घेऊ शकतो.',
    // PROPOSED (Marathi) — dismisses the stop hint.
    gotIt: 'समजलं',
    // PROPOSED (Marathi) — said for a moment after cancel, so he knows the recording is gone.
    cancelled: 'बोलणं रद्द केलं',
    // PROPOSED (Marathi) — shown instead of an English error from the parse service.
    genericError: 'काहीतरी चुकलं. पुन्हा बोलून पाहा किंवा लिहून सांगा.',
    /** Existing approved strings. */
    listening: t('logPage.listening', 'mr'),
    tapToStop: t('voice.tapToStop', 'mr'),
    checkInput: t('voice.checkInput', 'mr'),
    selectCropFirst: t('voice.selectCropFirst', 'mr'),
    autoStopping: (secondsLeft: number) => t('voice.autoStopping', 'mr').replace('{seconds}', String(secondsLeft)),
    /**
     * The mic's OWN failures, in Marathi whatever the app language (I12-V1-m3). The technical cause
     * (NotReadableError, no-mediaDevices, ...) is NOT appended to the words any more: it travels on
     * the error box as `data-error-code` and in the console, where a diagnosis can read it.
     */
    micError: t('voice.micError', 'mr'),
    micDenied: t('voice.micDeniedTypeInstead', 'mr'),
} as const;

/** The stop hint appears after this many seconds of speaking and stays this long unless dismissed. */
export const STOP_HINT_AFTER_SEC = 10;
export const STOP_HINT_FOR_SEC = 16;
/**
 * The recorder's ONE length limit, read by both recorders (`AudioRecorder`, `AudioRecorderStreaming`), and the
 * countdown that announces it. The countdown says "{n} सेकंदात आपोआप थांबेल", so the stop must be real (P5).
 *
 * Register F18 / lane V-1: the founder wants "a minute to as long as you want". It stays 60 s FOR NOW because the
 * path behind the mic cannot yet take more: Sarvam's speech-to-text REST call (both server voice paths) accepts
 * 30 s of audio per request, and the structurer's answer is capped at 2048 tokens by default. Lifting this is one
 * constant once the server transcribes in chunks and the answer fits (lane V-1 plan in the PLR register).
 */
export const AUTO_STOP_SEC = 60;
export const AUTO_STOP_WARN_SEC = AUTO_STOP_SEC - 10;

/**
 * Lane RF2 fix pass (review B004) — the two offline outcomes the parse reports as stable codes, in his language (the
 * one place the recorder follows the app's language: the old English toast reached a Marathi screen).
 */
const OFFLINE_WORDS: Record<string, { mr: string; en: string }> = {
    [OFFLINE_SAVED_MESSAGE]: {
        mr: 'इंटरनेट नाही. तुमचं बोलणं फोनवर ठेवलं आहे — इंटरनेट आलं की समजून घेतलं जाईल.', // PROPOSED (Marathi)
        en: 'No internet. Your words are kept on this phone and will be understood when you are online.', // PROPOSED (English)
    },
    [OFFLINE_NOT_KEPT_MESSAGE]: {
        mr: 'बदल सांगायला इंटरनेट लागतं. आत्ता काहीही ठेवलं नाही — इंटरनेट आलं की पुन्हा सांगा.', // PROPOSED (Marathi)
        en: 'A change needs the internet. Nothing was kept — say it again when you are online.', // PROPOSED (English)
    },
};

const DEVANAGARI = /[ऀ-ॿ]/;
/** An error the farmer can read: the offline outcomes in his language, Marathi as it is, anything else the plain Marathi line. */
export const readableError = (message: string, language?: string | null): string => {
    const offline = OFFLINE_WORDS[message];
    if (offline) return language === 'en' ? offline.en : offline.mr;
    return DEVANAGARI.test(message) ? message : REC_WORDS.genericError;
};

export const formatClock = (s: number): string => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
