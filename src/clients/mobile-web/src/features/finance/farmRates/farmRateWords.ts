/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane RATE-1 part A (founder D-72 "Own farm prices" = D-17 / D-43).
 *
 * Every word of the farm's own दरपत्रक, Marathi with an English twin, ONE language at a time (Marathi mode shows only
 * Marathi; English mode only English, the back button included). Each line says where it comes from: PROPOSED (lane RATE-1,
 * not yet approved by the founder), or the existing word it reuses. Never "AI", no emoji. Anything held back reads as a
 * ShramSafal rule ("श्रमसफलच्या नियमानुसार …"), never "not shown to you", and a withheld amount is "—", never ₹ 0 (P4).
 */
import type { FarmRateBasis, FarmRateKind } from './farmRateSchema';

export interface FarmRateWords {
    title: string;
    back: string;
    intro: string;
    readOnly: string;
    neverRewrites: string;
    kind: Record<FarmRateKind, string>;
    basis: Record<FarmRateBasis, string>;
    forWhat: string;
    forWhatHint: string;
    unit: string;
    unitHint: string;
    basisLabel: string;
    category: string;
    categoryHint: string;
    amount: string;
    from: string;
    season: string;
    until: string;
    save: string;
    newRate: string;
    change: string;
    changeHint: string;
    cancel: string;
    retire: string;
    retired: string;
    history: string;
    you: string;
    setTo: (amount: string) => string;
    changedTo: (from: string, to: string) => string;
    stopped: string;
    since: (date: string) => string;
    until_: (date: string) => string;
    empty: string;
    emptyKind: string;
    couldNotOpen: string;
    unreadable: string;
    queued: string;
    refused: string;
    refusedKind: string;
    refusedSuggestion: string;
    refusedNotFound: string;
    refusedOther: string;
    workWithheld: string;
    allWithheld: string;
    withheldAmount: string;
    suggested: string;
    suggestedHint: string;
    takeSuggestion: string;
    fromSuggestion: string;
    draftTitle: string;
    draftTake: string;
    all: string;
}

/** The farm's own price list — Marathi. */
const mr: FarmRateWords = {
    title: 'दरपत्रक', // existing (FINANCE_TITLE['finance-price-book'])
    back: 'मागे', // existing (PageBar's default)
    intro: 'तुमच्या शेताचे दर — खत-औषधाचे भाव आणि कामाचे दर. प्रत्येक दर कशासाठी ते लिहा.', // PROPOSED
    readOnly: 'श्रमसफलच्या नियमानुसार शेताचे दर शेताचे मुख्य खातेदार ठरवतात.', // PROPOSED
    neverRewrites: 'नवा दर जुनी बिलं, जुना खर्च किंवा दिलेली मजुरी बदलत नाही.', // PROPOSED
    kind: {
        Input: 'वस्तूचा भाव', // PROPOSED
        Work: 'कामाचा दर', // PROPOSED
    },
    basis: {
        PerUnit: 'मापाला', // PROPOSED
        PerDay: 'दिवसाला', // PROPOSED
        PerHour: 'तासाला', // PROPOSED
        PerAcre: 'एकरी', // PROPOSED
        PerTrip: 'खेपेला', // PROPOSED
        PerTask: 'कामाला', // PROPOSED
    },
    forWhat: 'कशासाठी?', // PROPOSED (brief: "कशासाठी")
    forWhatHint: 'उदा. युरिया, फवारणी', // PROPOSED
    unit: 'कोणत्या मापाने?', // PROPOSED
    unitHint: 'पोते, किलो, लिटर', // PROPOSED
    basisLabel: 'दर कशाप्रमाणे?', // PROPOSED
    category: 'कोणासाठी? (हवं तर)', // PROPOSED
    categoryHint: 'मजूर प्रकार किंवा टोळी', // PROPOSED
    amount: 'दर (₹)', // existing (the old दरपत्रक form)
    from: 'कधीपासून', // existing (the old दरपत्रक form)
    season: 'हंगाम (हवं तर)', // PROPOSED
    until: 'कधीपर्यंत (हवं तर)', // PROPOSED
    save: 'दर जतन करा', // PROPOSED
    newRate: 'नवीन दर', // existing (the old दरपत्रक form)
    change: 'दर बदला', // existing (the old दरपत्रक form)
    changeHint: 'नवा दर लिहा. आधीचा दर इतिहासात तसाच राहील.', // PROPOSED
    cancel: 'रद्द करा', // existing
    retire: 'हा दर बंद करा', // PROPOSED
    retired: 'बंद', // PROPOSED
    history: 'इतिहास', // PROPOSED
    you: 'तुम्ही', // PROPOSED
    setTo: amount => `${amount} ठरवला`, // PROPOSED
    changedTo: (from, to) => `${from} → ${to}`, // PROPOSED
    stopped: 'दर बंद केला', // PROPOSED
    since: date => `${date} पासून`, // existing ("… पासून" on the old दरपत्रक)
    until_: date => `${date} पर्यंत`, // PROPOSED
    empty: 'अजून एकही दर लिहिलेला नाही.', // existing (the old दरपत्रक)
    emptyKind: 'या प्रकारचा दर अजून लिहिलेला नाही.', // existing (the old दरपत्रक)
    couldNotOpen: 'दरपत्रक आत्ता उघडता आलं नाही. पुन्हा उघडा.', // PROPOSED
    unreadable: 'काही दर या फोनवर दाखवता आले नाहीत — अॅप अपडेट करा.', // PROPOSED (fix round 1, F5)
    queued: 'फोनवर लिहिला — इंटरनेट आल्यावर जतन होईल.', // PROPOSED
    refused: 'हा दर जतन झाला नाही: श्रमसफलच्या नियमानुसार शेताचे दर फक्त मुख्य खातेदार ठरवतात.', // PROPOSED
    refusedKind: 'हा दर जतन झाला नाही: ठरलेल्या दराचा प्रकार बदलता येत नाही. नवीन दर लिहा.', // PROPOSED (fix round 1, F2/F3)
    refusedSuggestion: 'हा दर जतन झाला नाही: तो श्रमसफल सुचवलेला दर नाही. दर पुन्हा लिहा.', // PROPOSED (fix round 1, F3)
    refusedNotFound: 'हा बदल जतन झाला नाही: हा दर शेताच्या यादीत सापडला नाही.', // PROPOSED (fix round 1, F3)
    refusedOther: 'हा दर जतन झाला नाही. तो तपासून पुन्हा लिहा.', // PROPOSED
    workWithheld: 'श्रमसफलच्या नियमानुसार कामाचे (मजुरीचे) दर इथे दिसत नाहीत.', // PROPOSED
    allWithheld: 'श्रमसफलच्या नियमानुसार शेताचे दर इथे दिसत नाहीत.', // PROPOSED (fix round 1, F1)
    withheldAmount: '—', // the house rule for a withheld amount (never ₹ 0)
    suggested: 'श्रमसफल सुचवलेला दर', // PROPOSED (brief's word)
    suggestedHint: 'हवा असेल तर तुमच्या यादीत घ्या. माप आणि प्रकार तुम्ही निवडा.', // PROPOSED
    takeSuggestion: 'माझ्या यादीत घ्या', // PROPOSED
    fromSuggestion: 'श्रमसफल सुचवलेल्या दरावरून', // PROPOSED
    draftTitle: 'या फोनवर आधी लिहिलेला दर — तुमच्या यादीत घ्यायचा?', // PROPOSED
    draftTake: 'तपासून घ्या', // PROPOSED
    all: 'सर्व', // existing (the old दरपत्रक chips)
};

/** The farm's own price list — English twin. */
const en: FarmRateWords = {
    title: 'Rate list', // PROPOSED
    back: 'Back', // PROPOSED (MoneyWithheldPage's English twin)
    intro: "Your farm's rates — input prices and work rates. Write what each rate is for.", // PROPOSED
    readOnly: "By ShramSafal's rules, the farm's primary account holder sets its rates.", // PROPOSED
    neverRewrites: 'A new rate never changes old bills, old costs or wages already paid.', // PROPOSED
    kind: {
        Input: 'Input price', // PROPOSED
        Work: 'Work rate', // PROPOSED
    },
    basis: {
        PerUnit: 'per unit', // PROPOSED
        PerDay: 'per day', // PROPOSED
        PerHour: 'per hour', // PROPOSED
        PerAcre: 'per acre', // PROPOSED
        PerTrip: 'per trip', // PROPOSED
        PerTask: 'per task', // PROPOSED
    },
    forWhat: 'What is it for?', // PROPOSED
    forWhatHint: 'e.g. urea, spraying', // PROPOSED
    unit: 'Which unit?', // PROPOSED
    unitHint: 'bag, kg, litre', // PROPOSED
    basisLabel: 'Rate per what?', // PROPOSED
    category: 'For whom? (optional)', // PROPOSED
    categoryHint: 'worker type or crew', // PROPOSED
    amount: 'Rate (₹)', // PROPOSED
    from: 'From when', // PROPOSED
    season: 'Season (optional)', // PROPOSED
    until: 'Until when (optional)', // PROPOSED
    save: 'Save rate', // PROPOSED
    newRate: 'New rate', // PROPOSED
    change: 'Change rate', // PROPOSED
    changeHint: 'Write the new rate. The old rate stays in the history.', // PROPOSED
    cancel: 'Cancel', // PROPOSED
    retire: 'Stop this rate', // PROPOSED
    retired: 'Stopped', // PROPOSED
    history: 'History', // PROPOSED
    you: 'You', // PROPOSED
    setTo: amount => `set ${amount}`, // PROPOSED
    changedTo: (from, to) => `${from} → ${to}`, // PROPOSED
    stopped: 'rate stopped', // PROPOSED
    since: date => `from ${date}`, // PROPOSED
    until_: date => `until ${date}`, // PROPOSED
    empty: 'No rate written yet.', // PROPOSED
    emptyKind: 'No rate of this kind yet.', // PROPOSED
    couldNotOpen: 'The rate list could not be opened just now. Open it again.', // PROPOSED
    unreadable: 'Some rates could not be shown on this phone — update the app.', // PROPOSED (fix round 1, F5)
    queued: 'Written on this phone — saved when online.', // PROPOSED
    refused: "This rate was not saved: by ShramSafal's rules, only the farm's primary account holder sets its rates.", // PROPOSED
    refusedKind: "This rate was not saved: a rate's kind cannot change. Write a new rate.", // PROPOSED (fix round 1, F2/F3)
    refusedSuggestion: 'This rate was not saved: it is not a ShramSafal suggested rate. Write the rate again.', // PROPOSED (fix round 1, F3)
    refusedNotFound: "This change was not saved: the rate is not on the farm's list.", // PROPOSED (fix round 1, F3)
    refusedOther: 'This rate was not saved. Check it and write it again.', // PROPOSED
    workWithheld: "By ShramSafal's rules, work (wage) rates are not shown here.", // PROPOSED
    allWithheld: "By ShramSafal's rules, the farm's rates are not shown here.", // PROPOSED (fix round 1, F1)
    withheldAmount: '—', // the house rule for a withheld amount (never ₹ 0)
    suggested: 'ShramSafal suggested rate', // PROPOSED
    suggestedHint: 'Add it to your list if you want. You choose the unit and the kind.', // PROPOSED
    takeSuggestion: 'Add to my list', // PROPOSED
    fromSuggestion: 'from a ShramSafal suggested rate', // PROPOSED
    draftTitle: 'A rate written on this phone earlier — add it to your list?', // PROPOSED
    draftTake: 'Check and add', // PROPOSED
    all: 'All', // PROPOSED
};

/** English only for 'en'; every other language reads Marathi (the app's default). */
export function farmRateWords(language: string | null | undefined): FarmRateWords {
    return language === 'en' ? en : mr;
}

/**
 * fix round 1 (review F3) — the line a change this phone holds reads as. A change still waiting says so; one the server
 * refused, or one that gave up after its retries, says it was NOT saved and why — never "saved when online".
 */
export function queuedRateLine(state: 'waiting' | 'refused', errorCode: string | undefined, words: FarmRateWords): string {
    if (state === 'waiting') return words.queued;
    switch (errorCode) {
        case 'ShramSafal.FarmRate.Forbidden': return words.refused;
        case 'ShramSafal.FarmRate.KindChangeNotAllowed': return words.refusedKind;
        case 'ShramSafal.FarmRate.UnknownSuggestion': return words.refusedSuggestion;
        case 'ShramSafal.FarmRate.LineNotFound': return words.refusedNotFound;
        default: return words.refusedOther;
    }
}
