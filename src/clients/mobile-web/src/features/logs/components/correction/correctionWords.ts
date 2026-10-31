/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane E1) — the words of the "बदला" screen (the founder's screen 4),
 * one language at a time: Marathi mode shows only Marathi, English mode only English. Each line is PROPOSED
 * (waiting for his review) unless it says REUSED. The word "नोंद" is kept off this screen.
 */
import { RESULT_STR } from '../voiceResult/resultStrings';
import { TYPED_WORDS } from '../../../voice/components/recorder/TypedEntry';

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
    /** The labour numbers did not reach the server (they need the internet): nothing was saved on this phone. */
    saveFailedLabour: string;
    nothingChanged: string;
    /** Review B001: what he said about workers is not a change this screen can make. */
    labourInHajeri: string;
    /** Review B004: a change needs the internet; nothing is recorded or kept. */
    offline: string;
    /** Review B002: a change he saved earlier was refused by the server — it is only on this phone. */
    serverRefused: string;
    versionNote: string;
    reconfirm: string;
    labourDoor: string;
    openAttendance: string;
    confirmed: string;
    notConfirmed: string;
    wholeFarm: string;
    // Lane OF (founder D-61 = 5A + rule TAP-1): typing and tapping under the mic.
    typeInstead: string;
    typeTitle: string;
    typeNote: string;
    orTap: string;
    changePlot: string;
    changeDay: string;
    /** The plot / day of a SAVED entry cannot be moved yet (server route pending, `correctionCapabilities`). */
    moveNotYet: string;
    remove: string;
    restore: string;
    removedTag: string;
    newTag: string;
    was: string;
    add: string;
    addWhat: string;
    keepOne: string;
    editTitle: (part: string) => string;
    whatWork: string;
    productName: string;
    amount: string;
    unit: string;
    waterHow: string;
    hours: string;
    people: string;
    cancel: string;
    ok: string;
    nameNeeded: string;
    /** A worker count needs the internet (until the queued route exists). */
    labourNeedsNet: string;
    heard: string;
    /** Lane OF fix 1 (H2): what he typed as an amount is not a number. */
    numberBad: string;
    /** Lane OF fix 2 — 0 typed as an amount: what is wrong with 0 (not "that is not a number"). */
    numberZero: string;
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
    saveFailedLabour: 'जतन झालं नाही: मजुरांचे आकडे पाठवायला इंटरनेट लागतं. या फोनवर काहीही बदललं नाही; मजुरांचा बदल सर्व्हरवर पूर्ण पोचला नसेल. इंटरनेट आल्यावर पुन्हा दाबा.', // PROPOSED (Marathi)
    labourInHajeri: 'मजुरांबद्दल जे सांगितलं ते इथे बदललं नाही. या कामातले मजुरांचे बदल हजेरीत करा.', // PROPOSED (Marathi)
    offline: 'बदल सांगायला इंटरनेट लागतं. आत्ता काहीही रेकॉर्ड केलं नाही — इंटरनेट आलं की पुन्हा दाबा.', // PROPOSED (Marathi)
    serverRefused: 'आधी जतन केलेला बदल सर्व्हरने घेतला नाही. तो फक्त या फोनवर आहे.', // PROPOSED (Marathi)
    nothingChanged: 'यातून बदलायचं काही समजलं नाही. पुन्हा सांगा.', // PROPOSED (Marathi)
    versionNote: 'जतन केल्यावर नवीन आवृत्ती ठेवली जाते — आधीचं पण सर्व्हरवर राहतं.', // PROPOSED (Marathi) — screen 3's note
    reconfirm: 'हे आधी पक्कं केलं होतं. जतन केल्यावर नवीन आवृत्ती "पक्कं नाही" राहील, पुन्हा पक्कं होईपर्यंत.', // PROPOSED (Marathi)
    labourDoor: 'ही हजेरी "हजेरी" पानावरून घेतली आहे. ती तिथेच बदलता येते.', // PROPOSED (Marathi)
    openAttendance: 'हजेरी उघडा', // PROPOSED (Marathi)
    // REUSED — the result screen's status words, with its ✔.
    confirmed: `✔ ${RESULT_STR.confirmedBadge}`,
    notConfirmed: RESULT_STR.notConfirmed,
    wholeFarm: RESULT_STR.wholeFarm, // REUSED
    // PROPOSED (Marathi) — the working phones (5A + TAP-1), unless REUSED.
    typeInstead: TYPED_WORDS.link, // REUSED — the recorder's typing line
    typeTitle: 'जे बदलायचं ते लिहा',
    typeNote: 'साथी हे समजून घेईल — बोलल्यासारखंच.',
    orTap: 'किंवा दाबून बदला',
    changePlot: 'प्लॉट बदला',
    changeDay: 'दिवस बदला',
    moveNotYet: 'जतन झालेल्या कामाचा प्लॉट किंवा दिवस अजून इथून बदलता येत नाही.',
    remove: 'काढा',
    restore: 'परत आणा',
    removedTag: 'काढलं',
    newTag: 'नवीन',
    was: 'आधी',
    add: 'आणखी जोडा',
    addWhat: 'काय जोडायचं?',
    keepOne: 'एक तरी भाग राहू द्या',
    editTitle: part => `${part} — दाबून बदला`,
    whatWork: 'काय काम?',
    productName: 'औषध / खताचं नाव',
    amount: 'मात्रा',
    unit: 'एकक',
    waterHow: 'कसं पाणी?',
    hours: 'किती तास?',
    people: 'किती जण?',
    cancel: 'रद्द',
    ok: 'ठीक',
    nameNeeded: 'नाव लिहा',
    labourNeedsNet: 'मजुरांची संख्या बदलायला इंटरनेट लागतं. इंटरनेट आल्यावर जतन करा.',
    heard: 'बदल ऐकला — बघा आणि जतन करा',
    numberBad: 'हा आकडा नाही — मात्रा आकड्यात लिहा, उदा. 1.5', // PROPOSED (Marathi)
    numberZero: '0 मात्रा ठेवता येत नाही — किती वापरलं ते लिहा, माहीत नसेल तर रिकामं ठेवा', // PROPOSED (Marathi)
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
    saveFailedLabour: 'Not saved: the worker numbers need the internet to be sent. Nothing changed on this phone; the worker change may not all have reached the server. Press again when you are online.', // PROPOSED (English)
    labourInHajeri: 'What you said about workers was not changed here. Worker changes for this entry are made in attendance.', // PROPOSED (English)
    offline: 'A change needs the internet. Nothing was recorded — press again when you are online.', // PROPOSED (English)
    serverRefused: 'The server did not accept the change saved earlier. It is only on this phone.', // PROPOSED (English)
    nothingChanged: 'Nothing to change was understood from this. Say it again.', // PROPOSED (English)
    versionNote: 'Saving keeps a new version — the earlier one stays on the server too.', // PROPOSED (English)
    reconfirm: 'This was confirmed. After saving, the new version stays "Not confirmed" until it is confirmed again.', // PROPOSED (English)
    labourDoor: 'This attendance was taken on the attendance page. It can be changed there.', // PROPOSED (English)
    openAttendance: 'Open attendance', // PROPOSED (English)
    confirmed: '✔ Confirmed', // PROPOSED (English)
    notConfirmed: 'Not confirmed', // PROPOSED (English)
    wholeFarm: 'Whole farm', // PROPOSED (English)
    // PROPOSED (English) — every line below.
    typeInstead: 'If you cannot speak, type here',
    typeTitle: 'Type what should change',
    typeNote: 'Sathi reads this just like speech.',
    orTap: 'Or change by tapping',
    changePlot: 'Change plot',
    changeDay: 'Change day',
    moveNotYet: 'The plot or day of saved work cannot be changed here yet.',
    remove: 'Remove',
    restore: 'Bring back',
    removedTag: 'Removed',
    newTag: 'New',
    was: 'Was',
    add: 'Add more',
    addWhat: 'What to add?',
    keepOne: 'Keep at least one part',
    editTitle: part => `${part} — change by tapping`,
    whatWork: 'What work?',
    productName: 'Product name',
    amount: 'Amount',
    unit: 'Unit',
    waterHow: 'How was it watered?',
    hours: 'How many hours?',
    people: 'How many people?',
    cancel: 'Cancel',
    ok: 'OK',
    nameNeeded: 'Write the name',
    labourNeedsNet: 'Changing the number of workers needs the internet. Save when you are online.',
    heard: 'Change heard — check and save',
    numberBad: 'That is not a number — write the amount as a number, e.g. 1.5', // PROPOSED (English)
    numberZero: 'An amount of 0 cannot be kept — write how much was used, or leave it empty if you do not know', // PROPOSED (English)
};

/** English only for 'en'; every other language reads Marathi. */
export const correctionWords = (language: string | null | undefined): CorrectionWords => (language === 'en' ? en : mr);
