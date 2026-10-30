/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane E1) — the words of the "बदला" screen (the founder's screen 4),
 * one language at a time: Marathi mode shows only Marathi, English mode only English. Each line is PROPOSED
 * (waiting for his review) unless it says REUSED. The word "नोंद" is kept off this screen.
 */
import { RESULT_STR } from '../voiceResult/resultStrings';

export interface CorrectionWords {
    title: string;
    back: string;
    nowTitle: string;
    speakPrompt: string;
    examples: readonly string[];
    mic: string;
    youSaid: string;
    changedTag: string;
    again: string;
    save: string;
    saving: string;
    saveFailed: string;
    nothingChanged: string;
    versionNote: string;
    reconfirm: string;
    labourDoor: string;
    openAttendance: string;
    confirmed: string;
    notConfirmed: string;
    wholeFarm: string;
}

const mr: CorrectionWords = {
    // REUSED — the result screen's "बदला" (confirmation.edit) and "मागे" (common.back).
    title: RESULT_STR.edit,
    back: RESULT_STR.back,
    nowTitle: 'आत्ता जे आहे', // PROPOSED (Marathi) — the founder's screen 4
    speakPrompt: 'जे बदलायचं ते बोलून सांगा', // PROPOSED (Marathi) — the founder's screen 4
    // PROPOSED (Marathi) — the first is the founder's screen 4 example; the second replaces its "पाच बायका पण होत्या",
    // which would read as an ADDITION (a known limit: "पण" replaces the whole part).
    examples: ['उदा. "इथरेल 300 नाही, 350 मिली"', 'उदा. "पाणी 2 नाही, 3 तास दिलं"'],
    mic: 'बोला', // PROPOSED (Marathi) — the big mic's name for a screen reader (screen 4's aria-label)
    youSaid: 'तुम्ही सांगितलं', // PROPOSED (Marathi) — screen 4
    changedTag: 'बदललं', // PROPOSED (Marathi) — screen 4
    again: 'पुन्हा सांगा', // PROPOSED (Marathi) — screen 4
    save: 'जतन करा', // PROPOSED (Marathi) — screen 4
    saving: 'जतन होत आहे…', // PROPOSED (Marathi)
    saveFailed: 'आत्ता जतन करता आलं नाही. काहीही बदललं नाही — पुन्हा दाबा.', // PROPOSED (Marathi)
    nothingChanged: 'यातून बदलायचं काही समजलं नाही. पुन्हा सांगा.', // PROPOSED (Marathi)
    versionNote: 'जतन केल्यावर नवीन आवृत्ती ठेवली जाते — आधीचं पण सर्व्हरवर राहतं.', // PROPOSED (Marathi) — screen 3's note
    reconfirm: 'हे आधी पक्कं केलं होतं. जतन केल्यावर नवीन आवृत्ती "पक्कं नाही" राहील, पुन्हा पक्कं होईपर्यंत.', // PROPOSED (Marathi)
    labourDoor: 'ही हजेरी "हजेरी" पानावरून घेतली आहे. ती तिथेच बदलता येते.', // PROPOSED (Marathi)
    openAttendance: 'हजेरी उघडा', // PROPOSED (Marathi)
    // REUSED — the result screen's status words, with its ✔.
    confirmed: `✔ ${RESULT_STR.confirmedBadge}`,
    notConfirmed: RESULT_STR.notConfirmed,
    wholeFarm: RESULT_STR.wholeFarm, // REUSED
};

const en: CorrectionWords = {
    title: 'Change', // PROPOSED (English)
    back: 'Back', // PROPOSED (English)
    nowTitle: 'What it says now', // PROPOSED (English)
    speakPrompt: 'Say what should change', // PROPOSED (English)
    examples: ['e.g. "Not 300, 350 ml of Ethrel"', 'e.g. "Water was 3 hours, not 2"'], // PROPOSED (English)
    mic: 'Speak', // PROPOSED (English)
    youSaid: 'You said', // PROPOSED (English)
    changedTag: 'Changed', // PROPOSED (English)
    again: 'Say it again', // PROPOSED (English)
    save: 'Save', // PROPOSED (English)
    saving: 'Saving…', // PROPOSED (English)
    saveFailed: 'Could not save just now. Nothing was changed — press again.', // PROPOSED (English)
    nothingChanged: 'Nothing to change was understood from this. Say it again.', // PROPOSED (English)
    versionNote: 'Saving keeps a new version — the earlier one stays on the server too.', // PROPOSED (English)
    reconfirm: 'This was confirmed. After saving, the new version stays "Not confirmed" until it is confirmed again.', // PROPOSED (English)
    labourDoor: 'This attendance was taken on the attendance page. It can be changed there.', // PROPOSED (English)
    openAttendance: 'Open attendance', // PROPOSED (English)
    confirmed: '✔ Confirmed', // PROPOSED (English)
    notConfirmed: 'Not confirmed', // PROPOSED (English)
    wholeFarm: 'Whole farm', // PROPOSED (English)
};

/** English only for 'en'; every other language reads Marathi. */
export const correctionWords = (language: string | null | undefined): CorrectionWords => (language === 'en' ? en : mr);
