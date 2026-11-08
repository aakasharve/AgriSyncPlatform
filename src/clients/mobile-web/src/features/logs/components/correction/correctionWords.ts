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
import type { RefusedReason } from './refusedRevision';
import type { MoneyNotFollowedReason } from '../../../finance/editMoney';

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
    /** Lane OF-S: a move of the plot / day was refused; the entry was put back as the server has it. */
    refusedMove: string;
    /** Lane OF-S: a worker-count change was refused; the entry was put back as the server has it. */
    refusedWorkers: string;
    /** Lane OF-S: why the server refused it, in plain words ('' = the server gave no reason we can say). */
    refusedReason: Readonly<Record<RefusedReason, string>>;
    /** Lane OF-M (F89): an edit he saved changed a price, but that money could not follow — why, in plain words. */
    moneyNotFollowed: Readonly<Record<MoneyNotFollowedReason, string>>;
    /** Lane OF-M fix pass 3 (call 1): he did not make this entry and does not check money — its prices stay as saved. */
    pricesLocked: string;
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
    // PROPOSED (Marathi) — lane OF-S. "नोंद" stays off this screen, so the brief's "या नोंदीवर" reads "या कामावर".
    refusedMove: 'प्लॉट / दिवस बदलला नाही — सर्व्हरवर आहे तसंच ठेवलं.',
    refusedWorkers: 'मजुरांचा बदल झाला नाही — सर्व्हरवर आहे तसंच ठेवलं.',
    refusedReason: {
        stale: 'तुम्ही पाहिल्यानंतर दुसऱ्या कोणी हे बदललं.',
        futureDay: 'तो दिवस अजून आलेला नाही.',
        noSeason: 'त्या दिवशी त्या प्लॉटवर कोणतंही पीक नव्हतं.',
        // Lane OF-S fix pass 2 (item 9) — one plain reason per cause, none says "change it first" (nothing he can do
        // changes these). PROPOSED (Marathi).
        attendance: 'या दिवसाच्या हजेरीत यातील लोक आहेत, त्यामुळे हे काम हलवता येत नाही.',
        jobCard: 'या कामाला काम कार्ड जोडलेलं आहे, त्यामुळे हे काम हलवता येत नाही.',
        moneyShared: 'या कामाचे पैसे आधीच प्लॉटमध्ये वाटले आहेत, त्यामुळे हे काम हलवता येत नाही.',
        moneyNotFound: 'या कामाचे पैसे जुन्या पद्धतीने जतन झाले आहेत किंवा अजून पोहोचले नाहीत, त्यामुळे हे काम हलवता येत नाही.',
        // Lane OF-S fix pass 3 (R2-3, R2-1) — the real state of the money on this phone; details not here. PROPOSED (Marathi).
        moneyKept: 'या कामाचे पैसे अजून या फोनवरच आहेत. ते "खरेदी" मधून पाठवा, मग हे काम हलवा.',
        moneyKeptStuck: 'या कामाचे पैसे या फोनवरच आहेत आणि त्यांचा प्लॉट अजून सर्व्हरवर नाही, त्यामुळे हे काम हलवता येत नाही.',
        moneyRemoved: 'या कामाचे पैसे काढून टाकले आहेत, त्यामुळे हे काम कधीच हलवता येणार नाही.',
        // Lane OF-S fix pass 4 (R3-3, R3-4). PROPOSED (Marathi).
        moneyNeedsReview: 'या कामाचे पैसे सर्व्हरने अजून स्वीकारलेले नाहीत. आधी ते सिंक पानावर पाहा, मग हे काम हलवा.',
        moneyStuck: 'या कामाचे पैसे अनेक वेळा पाठवूनही पोहोचले नाहीत. सिंक पानावरून ते पुन्हा पाठवा, मग हे काम हलवा.',
        detailsNotHeld: 'हे काम ॲपच्या जुन्या आवृत्तीतून जतन झालं आहे किंवा त्याचा तपशील सर्व्हरवर पोहोचला नाही, त्यामुळे हे काम हलवता येत नाही.',
        notAllowed: 'हे तुम्हाला बदलता येत नाही — मालकाला सांगा.',
        // Lane OF-M fix pass 3 (call 1). PROPOSED (Marathi).
        pricesNotYours: 'किंमती फक्त ही नोंद करणारे किंवा पैशांच्या नोंदी तपासणारे बदलू शकतात.',
        // lane PRV (D-26). PROPOSED (Marathi), in the rule's voice (never "not shown to you", never the owner).
        recordClosed: 'श्रमसफलच्या नियमानुसार हा बदल या नोंदीवर लागू झाला नाही. तुमचा बदल या फोनवर ठेवला आहे.',
        // lane MU-4 — a write naming a plot outside his plots. PROPOSED (Marathi), in the rule's voice.
        plotClosed: 'श्रमसफलच्या नियमानुसार हे काम या प्लॉटवर नोंदवता आलं नाही. तुमचं काम या फोनवर ठेवलं आहे.',
        other: '',
    },
    // PROPOSED (Marathi) — lane OF-M. Each says what did not change (the money's amount) and why; none asks him to do
    // something he cannot.
    moneyNotFollowed: {
        notFound: 'या कामाचे आधीचे पैसे सापडले नाहीत (जुन्या पद्धतीने जतन झाले किंवा अजून पोहोचले नाहीत), त्यामुळे त्यांची रक्कम बदलली नाही.',
        shared: 'या कामाचे पैसे आधीच प्लॉटमध्ये वाटले आहेत, त्यामुळे त्यांची रक्कम बदलली नाही.',
        jobCard: 'या कामाचे पैसे काम कार्डचे आहेत, त्यामुळे त्यांची रक्कम बदलली नाही.',
        detailsNotHeld: 'हे काम ॲपच्या जुन्या आवृत्तीतून जतन झालं आहे किंवा त्याचा तपशील सर्व्हरवर पोहोचला नाही, त्यामुळे पैशांची रक्कम बदलली नाही.',
        notAllowed: 'शेताची योजना आत्ता चालू नाही, त्यामुळे पैशांची रक्कम बदलली नाही.',
        idTaken: 'या कामाचे नवे पैसे पैशांच्या हिशोबात लिहिता आले नाहीत.',
        // PROPOSED (Marathi) — lane OF-M fix pass 1.
        tooLong: 'या कामाचा तपशील खूप मोठा असल्याने त्याचे पैसे हिशोबात लिहिता आले नाहीत.',
        // PROPOSED (Marathi) — lane OF-M fix pass 4.
        moneyBook: 'या कामाचे पैसे पैशांच्या हिशोबात दुरुस्त केले आहेत, त्यामुळे या बदलाने त्यांची रक्कम बदलली नाही.',
        // PROPOSED (Marathi) — lane OF-M fix pass 5 (N4).
        oldMoneyKept: 'या कामाचे आधीचे पैसे हिशोबात तसेच ठेवले आहेत, त्यामुळे नवी रक्कम वेगळी जोडली नाही.',
        // PROPOSED (Marathi) — lane BILL-1b (founder D-105 (b)): an approved bill's price is the main owner's alone.
        approvedPriceLocked: 'या कामाचे पैसे मंजूर बिल आहेत आणि मंजूर बिलाची किंमत फक्त मुख्य मालक बदलू शकतात, त्यामुळे त्यांची रक्कम बदलली नाही.',
    },
    pricesLocked: 'किंमती आहेत तशाच राहतील: त्या फक्त ही नोंद करणारे किंवा पैशांच्या नोंदी तपासणारे बदलू शकतात.', // PROPOSED (Marathi) — lane OF-M fix pass 3
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
    // PROPOSED (English) — lane OF-S.
    refusedMove: 'The plot / day was not changed — it is kept as the server has it.',
    refusedWorkers: 'The workers change was not made — it is kept as the server has it.',
    refusedReason: {
        stale: 'Someone changed this after you saw it.',
        futureDay: 'That day has not come yet.',
        noSeason: 'No crop was on that plot on that day.',
        // Lane OF-S fix pass 2 (item 9). PROPOSED (English).
        attendance: 'People on this work are in that day\'s attendance, so it cannot be moved.',
        jobCard: 'A job card is linked to this work, so it cannot be moved.',
        moneyShared: 'This work\'s money is already shared out across plots, so it cannot be moved.',
        moneyNotFound: 'This work\'s money was saved the old way or has not arrived yet, so it cannot be moved.',
        // Lane OF-S fix pass 3 (R2-3, R2-1). PROPOSED (English).
        moneyKept: 'This work\'s money is still only on this phone. Send it from Procure, then move this work.',
        moneyKeptStuck: 'This work\'s money is kept on this phone and its plot is not on the server yet, so this work cannot be moved.',
        moneyRemoved: 'This work\'s money was removed, so this work can never be moved.',
        // Lane OF-S fix pass 4 (R3-3, R3-4). PROPOSED (English).
        moneyNeedsReview: 'The server has not accepted this work\'s money yet. Look at it on the sync page first, then move this work.',
        moneyStuck: 'This work\'s money did not get through after many tries. Send it again from the sync page, then move this work.',
        detailsNotHeld: 'This work was saved by an older version of the app, or its details did not reach the server, so it cannot be moved.',
        notAllowed: 'You cannot change this — tell the owner.',
        // Lane OF-M fix pass 3 (call 1). PROPOSED (English).
        pricesNotYours: 'Only the person who made this entry, or someone who checks money entries, can change its prices.',
        // lane PRV (D-26). PROPOSED (English).
        recordClosed: "By ShramSafal's rules, this change could not be applied to this record. Your change is kept on this phone.",
        // lane MU-4. PROPOSED (English).
        plotClosed: "By ShramSafal's rules, this work could not be saved on this plot. Your work is kept on this phone.",
        other: '',
    },
    // PROPOSED (English) — lane OF-M.
    moneyNotFollowed: {
        notFound: 'This work\'s earlier money was not found (saved the old way, or not arrived yet), so its amount was not changed.',
        shared: 'This work\'s money is already shared out across plots, so its amount was not changed.',
        jobCard: 'This work\'s money belongs to a job card, so its amount was not changed.',
        detailsNotHeld: 'This work was saved by an older version of the app, or its details did not reach the server, so the money amount was not changed.',
        notAllowed: 'The farm\'s plan is not active right now, so the money amount was not changed.',
        idTaken: 'The new money for this work could not be written in the money accounts.',
        // PROPOSED (English) — lane OF-M fix pass 1.
        tooLong: 'This work\'s details are too long, so its money could not be written in the money accounts.',
        // PROPOSED (English) — lane OF-M fix pass 4.
        moneyBook: 'This work\'s money was corrected in the money accounts, so this change did not change its amount.',
        // PROPOSED (English) — lane OF-M fix pass 5 (N4).
        oldMoneyKept: 'This work\'s earlier money is kept in the money accounts as it is, so the new amount was not added separately.',
        // PROPOSED (English) — lane BILL-1b (founder D-105 (b)): an approved bill's price is the main owner's alone.
        approvedPriceLocked: 'This work\'s money is an approved bill, and only the main owner can change an approved bill\'s price, so its amount was not changed.',
    },
    pricesLocked: 'Prices stay as they are: only the person who made this entry, or someone who checks money entries, can change them.', // PROPOSED (English) — lane OF-M fix pass 3
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
