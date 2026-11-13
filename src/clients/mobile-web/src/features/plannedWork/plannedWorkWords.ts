/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-1, L8c-2; founder D-24c, D-24a) - the farmer's words for the
 * plan section and the task record, one language at a time (Marathi mode shows only Marathi, English mode only English).
 *
 * The words the founder named on 2026-10-31 are ported as they are: काम काय / कुठे / कधी / कोणाला / तपशील, "काम सोपवा",
 * and the four steps सोपवलं -> पाहिलं -> स्वीकारलं -> झालं. Lane L8c-2 ports the 25 Oct preview's `PS` words (planModel.ts) AS
 * THEY ARE - रोखीने / ठेक्याने, "तारीख ठरलेली नाही", "जमेल तेव्हा", "ठीक आहे, करतो", "उशीर झाला" - minus its speak / spoken /
 * exampleSaid / mainPage / remindViaLog, and minus "काम झालं — सांगा". Lane L8c-3 adds the done step: "काम झालं", the owner's three words (मंजूर / शंका — मालकाशी बोला /
 * मंजुरी बाकी), "अर्धवट झालं", "कोणत्या प्लॉटवर झालं?", "पूर्ण झालं / काही बाकी आहे", the reopen box - all PROPOSED.
 * Everything the preview does not word is NEW wording, marked `// PROPOSED (Marathi)` / `// PROPOSED (English)`; a Marathi line
 * marked "the preview's" is its own word (itself still PROPOSED there until the founder approves it).
 *
 * No emoji, and no "AI" wording. A headcount, a quantity and a pay choice are WORDS: nothing here says a wage, a cost or an
 * attendance was made from them (D-24a, P4).
 */
import type { PlannedWorkPayModeName, PlannedWorkScopeName, PlannedWorkStatusName } from '../../infrastructure/storage/plannedWorkRow';

/**
 * Lane REM-1 (founder D-78, D-79, D-84 = 1; R14-R17, R21): the words of the reminder list (chips, the card's lines, "ऐका", "काढा" with its
 * undo) and of the owner's screen "आठवणी कोणाला दिसतील". Exact Marathi from the lane's word table; everything not in the table is PROPOSED.
 * One language at a time. No emoji, no "AI" wording.
 */
export interface ReminderWords {
    /** The chips above the lists, and what each filters to. */
    chipsLabel: string;
    chipAll: string;
    chipPlanning: string;
    chipSchedule: string;
    chipLogs: string;
    /** The card's source line: spoken (with the place of its record when it is known) and left unfinished. */
    fromSpoken: (place: string | null) => string;
    leftover: string;
    /** "ऐका": only when the server says this reader may hear the source voice; otherwise the rule line below. */
    listen: string;
    voiceRule: string;
    /** D-84 = 1: the two lines a card may carry. */
    markedMaker: string;
    chosenPeople: string;
    /** One tap removes it; the toast says so for a few seconds with the way back. */
    removedToast: string;
    undo: string;
    // ---- the owner's screen ----
    settingsTitle: string;
    settingsEntry: string;
    settingsHint: string;
    settingsOffline: string;
    settingsLoading: string;
    settingsLoadFailed: string;
    settingsForbidden: string;
    retry: string;
    saved: string;
    saveFailed: string;
    /** One row per category, with its choices. */
    catLogs: string;
    catOwn: string;
    catSchedule: string;
    choiceMakerAndOwner: string;
    choicePlotTeam: string;
    choicePlanners: string;
    /** D-24e1: assigned work is a ShramSafal rule; no choice moves it. */
    assignedLocked: string;
    // D-84 = 1.
    alwaysTitle: string;
    alwaysException: string;
    alwaysNone: string;
    alwaysAdd: string;
    alwaysRemove: string;
    alwaysNoOne: string;
    // R17: who may change it (the primary owner only grants it).
    whoTitle: string;
    whoHint: string;
    whoSwitch: string;
    whoOwnerOnly: string;
    whoYes: string;
    whoNo: string;
}

export interface PlannedWorkWords {
    /** Lane REM-1. */
    reminders: ReminderWords;
    // The five questions of the form (founder-named).
    what: string;
    where: string;
    when: string;
    who: string;
    details: string;
    assign: string;
    // The steps of an assigned task (founder-named), by status.
    status: Record<PlannedWorkStatusName, string>;
    // A change made on this phone that the server has not answered yet (P10).
    keptOnPhone: string;
    // Reminder vs work.
    reminder: string;
    // Scope.
    scope: Record<PlannedWorkScopeName, string>;
    // When.
    looseWhen: Record<'Week' | 'Month' | 'Anytime', string>;
    noDate: string;
    // Crew work (D-24c): the मुकादम, the crew words and an expected headcount.
    crew: string;
    expectedHeadcount: string;
    quantity: string;
    // Pay, in words only (D-24a).
    payMode: Record<PlannedWorkPayModeName, string>;
    payIsWordsOnly: string;
    // The answers.
    seen: string;
    accept: string;
    cancelWork: string;
    /** Lane L8c-4 (D-78 = 1): the source line of a reminder made from what he said, and the one tap that removes it. */
    spokenFrom: string;
    removeSpoken: string;
    /** Lane L8c-4 fix 1 (L008): the short button on a to-do row, and its spoken label. */
    removeShort: string;
    removeLabel: string;
    // Refusals the farmer reads (the server's rule, said plainly).
    notAllowedToAssign: string;
    personNotOnFarm: string;
    personNotOnPlots: string;
    changedFirst: string;
    // ---- lane L8c-2: the plan page, the form, the cards ----
    keptOnPhoneLong: string;
    parkedOpen: string;
    parkedUnknown: string;
    noLongerYours: string;
    planTitle: string;
    mineTitle: string;
    you: string;
    newWork: string;
    moreWork: string;
    q1: string;
    q2: string;
    q3: string;
    q4: string;
    q5: string;
    workPh: string;
    typeHere: string;
    commonWork: readonly string[];
    today: string;
    tomorrow: string;
    in8: string;
    pickDate: string;
    ownSelf: string;
    nobody: string;
    reminderOnly: string;
    qtyPh: string;
    pay: string;
    note: string;
    notePh: string;
    crewPh: string;
    crewLine: (team: string, headcount: number | null) => string;
    submitAssign: string;
    submitRemind: string;
    assignedDone: (name: string) => string;
    remindedDone: string;
    list: string;
    empty: string;
    emptyMine: string;
    by: string;
    lateTag: string;
    daysAgo: (n: number) => string;
    daysAway: (n: number) => string;
    back: string;
    understanding: string;
    voiceOffline: string;
    voiceFailed: string;
    heard: string;
    assigneeListOld: string;
    sendFailed: string;
    noWhere: string;
    tooLong: (box: string, max: number) => string;
    /** A person's seat, by the server's role name (display only; the server decides everything). */
    role: Record<string, string>;
    // ---- lane L8c-3 (founder D-24d, D-30): "काम झालं" through the real log, plot by plot, with the owner's word ----
    /** The assignee's button on his card (and on a reminder of his own, which needs no log: D-1). */
    markDone: string;
    /** The owner's word on the logs the work was done with. */
    confirmed: string;
    disputed: string;
    waitingConfirm: string;
    /** Lane L8c-5 (D-24d) - the door on a card waiting for the owner's word: opens the one review sheet. */
    approvalDoor: string;
    /** The whole task when only some plots are done, and a plot's own line. */
    partlyDone: string;
    plotDone: string;
    /** A plot whose name this phone does not hold (never its id): "प्लॉट 1" by order (fix round 1, L006). */
    plot: string;
    plotLeft: string;
    /** After the log is saved: which plots, and is any work left. */
    whichPlot: string;
    allDone: string;
    somethingLeft: string;
    notNow: string;
    finishWaitingFirst: string;
    /** The owner's reopen, with the reason he must give. */
    reopen: string;
    reopenWhy: string;
    reopenReasonPh: string;
    reopenSend: string;
    reopenCancel: string;
    reopenNeedsReason: string;
    // Refusals of the done step, said plainly.
    donePlotsRefused: string;
    doneLogRefused: string;
    reopenOwnerOnly: string;
}

/** 10 -> १० (the farmer's digits in Marathi mode). */
function devanagariDigits(n: number): string {
    return String(n).replace(/[0-9]/g, d => String.fromCharCode(0x0966 + Number(d)));
}

const mrReminders: ReminderWords = {
    chipsLabel: 'आठवणी कुठून आल्या', // PROPOSED (Marathi)
    chipAll: 'सगळ्या', // PROPOSED (Marathi)
    chipPlanning: 'नियोजनातून', // the lane's word table (REM-1 chip)
    chipSchedule: 'शेड्यूलमधून', // app word (the old list's FROM_LABEL)
    chipLogs: 'नोंदीतून', // app word (the old list's FROM_LABEL)
    fromSpoken: place => (place ? `बोलण्यातून — ${place}ची नोंद` : 'बोलण्यातून'), // PROPOSED (Marathi); बोलण्यातून is approved in D-78
    leftover: 'अर्धवट राहिलेलं', // the lane's word table (R14)
    listen: 'ऐका', // the lane's word table
    voiceRule: 'श्रमसफलच्या नियमानुसार हा आवाज तुम्हाला ऐकता येत नाही', // the lane's word table (R15)
    markedMaker: 'मालकाच्या मांडणीनुसार ही आठवण या प्लॉटवरच्या सगळ्यांना दिसते.', // the lane's word table (D-84 = 1)
    chosenPeople: 'निवडक लोकांसाठी ठेवलेल्या नोंदीतून आलेली आठवण — त्या नोंदीच्या लोकांपुरतीच राहते.', // the lane's word table (D-84 = 1)
    removedToast: 'आठवण काढली', // the lane's word table
    undo: 'परत आणा', // the lane's word table
    settingsTitle: 'आठवणी कोणाला दिसतील', // the lane's word table
    settingsEntry: 'आठवणी कोणाला दिसतील', // the lane's word table
    settingsHint: 'कोणाच्या आठवणी कोणाला दिसतील, हे तुम्ही ठरवता. नोंदवलेलं काहीही यातून पुसलं जात नाही.', // PROPOSED (Marathi)
    settingsOffline: 'ही मांडणी बदलण्यासाठी नेट लागतं. आत्ता काहीही बदललेलं नाही; नेट आल्यावर पुन्हा उघडा.', // PROPOSED (Marathi) - R21
    settingsLoading: 'माहिती आणत आहोत…', // PROPOSED (Marathi)
    settingsLoadFailed: 'मांडणी आणता आली नाही. पुन्हा करून पाहा.', // PROPOSED (Marathi)
    settingsForbidden: 'ही मांडणी फक्त मालक किंवा त्यांनी ज्याला दिली तोच बदलू शकतो.', // PROPOSED (Marathi)
    retry: 'पुन्हा करा', // PROPOSED (Marathi)
    saved: 'ठेवलं', // PROPOSED (Marathi)
    saveFailed: 'आत्ता बदलता आलं नाही — काहीही बदललेलं नाही. पुन्हा करा.', // PROPOSED (Marathi)
    catLogs: 'नोंदीतून आलेल्या आठवणी', // PROPOSED (Marathi)
    catOwn: 'स्वतःसाठी केलेल्या आठवणी', // PROPOSED (Marathi)
    catSchedule: 'शेड्यूलची कामं', // PROPOSED (Marathi)
    choiceMakerAndOwner: 'बनवणारा आणि मालक', // the lane's word table
    choicePlotTeam: 'प्लॉटवरचे सगळे', // the lane's word table
    choicePlanners: 'नियोजन करणारे', // the lane's word table
    assignedLocked: 'सोपवलेल्या कामाचा नियम श्रमसफलचा आहे: ज्याला सोपवलं, ज्याने सोपवलं आणि मालक यांना ते दिसतं. हा नियम कोणतीही मांडणी बदलत नाही.', // PROPOSED (Marathi) - D-24e1
    alwaysTitle: 'यांच्या आठवणी नेहमी दिसतील', // the lane's word table (D-84 = 1)
    alwaysException: 'लपवलेल्या (फक्त मी) किंवा निवडक लोकांसाठी ठेवलेल्या नोंदीतून आलेली आठवण मात्र त्या नोंदीच्या लोकांपुरतीच राहते.', // the lane's word table (D-84 = 1)
    alwaysNone: 'सध्या कोणीही निवडलेला नाही.', // PROPOSED (Marathi)
    alwaysAdd: 'कोणाला जोडायचं?', // PROPOSED (Marathi)
    alwaysRemove: 'काढा', // the lane's word table
    alwaysNoOne: 'जोडण्यासाठी आणखी कोणी नाही.', // PROPOSED (Marathi)
    whoTitle: 'हे कोण बदलू शकतं', // the lane's word table (R17)
    whoHint: 'हे फक्त मालकच देऊ शकतो. ज्याला दिलं तो मांडणी बदलू शकतो, पण ती दुसऱ्याला देऊ शकत नाही.', // PROPOSED (Marathi) - D-26
    whoSwitch: 'आठवणींची मांडणी बदलणे', // the lane's word table (R17)
    whoOwnerOnly: 'हे फक्त मालकाला दिसतं.', // PROPOSED (Marathi)
    whoYes: 'आहे', // PROPOSED (Marathi)
    whoNo: 'नाही', // PROPOSED (Marathi)
};

const enReminders: ReminderWords = {
    chipsLabel: 'Where the reminders came from', // PROPOSED (English)
    chipAll: 'All', // PROPOSED (English)
    chipPlanning: 'From planning', // the lane's word table
    chipSchedule: 'From the schedule', // the lane's word table
    chipLogs: 'From records', // the lane's word table
    fromSpoken: place => (place ? `From speech - the record of ${place}` : 'From speech'), // PROPOSED (English)
    leftover: 'Left unfinished', // the lane's word table (R14)
    listen: 'Listen', // the lane's word table
    voiceRule: "By ShramSafal's rule you cannot listen to this voice", // the lane's word table (R15)
    markedMaker: "By the owner's setting, everyone on this plot sees this reminder.", // the lane's word table (D-84 = 1)
    chosenPeople: "A reminder from a record kept for chosen people stays with that record's people.", // the lane's word table (D-84 = 1)
    removedToast: 'Reminder removed', // the lane's word table
    undo: 'Undo', // the lane's word table
    settingsTitle: 'Who sees reminders', // the lane's word table
    settingsEntry: 'Who sees reminders', // the lane's word table
    settingsHint: 'You decide whose reminders who sees. Nothing that was recorded is erased by this.', // PROPOSED (English)
    settingsOffline: 'Changing this needs the internet. Nothing has been changed; open it again when you are online.', // PROPOSED (English) - R21
    settingsLoading: 'Fetching...', // PROPOSED (English)
    settingsLoadFailed: 'Could not fetch the settings. Please try again.', // PROPOSED (English)
    settingsForbidden: 'Only the owner, or the person he gave this to, can change this.', // PROPOSED (English)
    retry: 'Try again', // PROPOSED (English)
    saved: 'Saved', // PROPOSED (English)
    saveFailed: 'Could not change it right now - nothing was changed. Please try again.', // PROPOSED (English)
    catLogs: 'Reminders from records', // PROPOSED (English)
    catOwn: 'Reminders people make for themselves', // PROPOSED (English)
    catSchedule: "The schedule's steps", // PROPOSED (English)
    choiceMakerAndOwner: 'The maker and the owner', // the lane's word table
    choicePlotTeam: 'Everyone on the plot', // the lane's word table
    choicePlanners: 'The planners', // the lane's word table
    assignedLocked: "Work given to a person follows ShramSafal's rule: the person it was given to, the one who gave it and the owner see it. No setting changes this rule.", // PROPOSED (English) - D-24e1
    alwaysTitle: "These people's reminders always show", // the lane's word table (D-84 = 1)
    alwaysException: "But a reminder from a record hidden (only me) or kept for chosen people stays with that record's people.", // the lane's word table (D-84 = 1)
    alwaysNone: 'Nobody is chosen right now.', // PROPOSED (English)
    alwaysAdd: 'Whom to add?', // PROPOSED (English)
    alwaysRemove: 'Remove', // the lane's word table
    alwaysNoOne: 'There is no one else to add.', // PROPOSED (English)
    whoTitle: 'Who can change this', // the lane's word table (R17)
    whoHint: 'Only the owner can give this. The person he gives it to can change the settings but cannot pass that on.', // PROPOSED (English) - D-26
    whoSwitch: 'Change reminder settings', // the lane's word table (R17)
    whoOwnerOnly: 'Only the owner sees this.', // PROPOSED (English)
    whoYes: 'Yes', // PROPOSED (English)
    whoNo: 'No', // PROPOSED (English)
};

const mr: PlannedWorkWords = {
    reminders: mrReminders,
    what: 'काम काय',
    where: 'कुठे',
    when: 'कधी',
    who: 'कोणाला',
    details: 'तपशील',
    assign: 'काम सोपवा',
    status: {
        Open: 'आठवण', // PROPOSED (Marathi)
        Assigned: 'सोपवलं',
        Seen: 'पाहिलं',
        Accepted: 'स्वीकारलं',
        Done: 'झालं',
        Cancelled: 'रद्द केलं', // PROPOSED (Marathi)
    },
    keptOnPhone: 'फोनवर ठेवलं', // PROPOSED (Marathi)
    reminder: 'आठवण', // PROPOSED (Marathi)
    scope: {
        Plot: 'एक प्लॉट', // PROPOSED (Marathi)
        MultiPlot: 'काही प्लॉट', // PROPOSED (Marathi)
        Farm: 'संपूर्ण शेत', // the preview's WHOLE_FARM and the app's own "संपूर्ण शेत"
        Unspecified: 'अजून ठरवलेलं नाही', // PROPOSED (Marathi)
    },
    looseWhen: {
        Week: 'या आठवड्यात', // the preview's
        Month: 'या महिन्यात', // the preview's
        Anytime: 'जमेल तेव्हा', // the preview's
    },
    noDate: 'तारीख ठरलेली नाही', // the preview's
    crew: 'टीम', // PROPOSED (Marathi)
    expectedHeadcount: 'किती जण', // PROPOSED (Marathi)
    quantity: 'प्रमाण', // the preview's
    payMode: {
        Cash: 'रोखीने', // the preview's
        Daily: 'रोजंदारी', // the preview's
        Contract: 'ठेक्याने', // the preview's
        Later: 'नंतर ठरवू', // the preview's
    },
    payIsWordsOnly: 'हे फक्त शब्द आहेत; यातून हजेरी, मजुरी किंवा खर्च आपोआप होत नाही.', // PROPOSED (Marathi)
    seen: 'पाहिलं',
    accept: 'ठीक आहे, करतो', // the preview's
    cancelWork: 'काम रद्द करा', // PROPOSED (Marathi)
    spokenFrom: 'बोलण्यातून', // PROPOSED (Marathi) - the old list's own word for a spoken reminder
    removeSpoken: 'काढून टाका', // PROPOSED (Marathi)
    removeShort: 'काढा', // PROPOSED (Marathi)
    removeLabel: 'ही आठवण काढून टाका', // PROPOSED (Marathi)
    notAllowedToAssign: 'श्रमसफलच्या नियमानुसार हे काम दुसऱ्याला सोपवता आलं नाही. आठवण म्हणून ठेवता येईल.', // PROPOSED (Marathi)
    personNotOnFarm: 'ही व्यक्ती या शेतावर सध्या नाही, म्हणून तिला काम सोपवता येत नाही.', // PROPOSED (Marathi)
    personNotOnPlots: 'या व्यक्तीकडे यातले सगळे प्लॉट नाहीत, म्हणून तिला हे काम सोपवता येत नाही.', // PROPOSED (Marathi)
    changedFirst: 'हे काम आधी बदललं गेलं, म्हणून हा बदल लागू झाला नाही.', // PROPOSED (Marathi)
    keptOnPhoneLong: 'फोनवर ठेवलं — नेट आल्यावर पाठवलं जाईल', // PROPOSED (Marathi)
    parkedOpen: 'अडचण बघा', // PROPOSED (Marathi)
    parkedUnknown: 'हा बदल पाठवता आला नाही.', // PROPOSED (Marathi)
    noLongerYours: 'हे काम आता तुमच्यावर सोपवलेलं नाही.', // PROPOSED (Marathi)
    planTitle: 'कामाचे नियोजन', // the preview's
    mineTitle: 'तुमच्यावर सोपवलेली कामे', // the preview's
    you: 'तुम्ही', // the preview's
    newWork: 'नवीन काम ठरवा', // the preview's
    moreWork: 'आणखी काम ठरवा', // the preview's
    q1: '१. काम काय आहे?', // the preview's
    q2: '२. कुठे?', // the preview's
    q3: '३. कधी?', // the preview's
    q4: '४. कोणाला सोपवायचं?', // the preview's
    q5: '५. तपशील (ऐच्छिक)', // the preview's
    workPh: 'उदा. युरिया टाकणे', // the preview's
    typeHere: 'बोलता येत नसेल तर इथे लिहा', // the log recorder's own link words
    commonWork: ['खत टाकणे', 'फवारणी', 'पाणी सोडणे', 'छाटणी', 'तण काढणे'], // the preview's COMMON_WORK
    today: 'आज', // the preview's
    tomorrow: 'उद्या', // the preview's
    in8: '8 दिवसांनी', // the preview's
    pickDate: 'तारीख निवडा', // the preview's
    ownSelf: 'स्वतः',
    nobody: 'फक्त आठवण (कोणालाही नाही)', // the preview's
    reminderOnly: 'फक्त आठवण', // the preview's
    qtyPh: 'उदा. प्रत्येक ओळीला ३ पोती', // the preview's
    pay: 'मजुरी / कसं करायचं', // the preview's
    note: 'सूचना', // the preview's
    notePh: 'आणखी काही सांगायचं असेल तर…', // the preview's
    crewPh: 'उदा. रोकडेची टीम', // PROPOSED (Marathi)
    crewLine: (team, headcount) => (headcount === null ? team : `${team} · ${devanagariDigits(headcount)} जण`), // PROPOSED (Marathi)
    submitAssign: 'काम सोपवा',
    submitRemind: 'आठवण ठेवा', // the preview's
    assignedDone: name => `${name} यांना काम सोपवलं. ते अॅप उघडतील तेव्हा त्यांना दिसेल.`, // the preview's
    remindedDone: 'आठवण ठेवली. ठरलेल्या वेळी दिसेल.', // the preview's
    list: 'ठरलेली कामे', // the preview's
    empty: 'अजून कोणतंही काम ठरवलेलं नाही', // the preview's
    emptyMine: 'तुमच्यावर अजून कोणतंही काम सोपवलेलं नाही', // the preview's
    by: 'ठरवलं', // the preview's
    lateTag: 'उशीर झाला', // the preview's
    daysAgo: n => `${n} दिवसांपूर्वी`, // the preview's
    daysAway: n => `${n} दिवसांनी`, // the preview's
    back: 'मागे', // the preview's
    understanding: 'तुम्ही जे बोललात ते समजून घेत आहे…', // PROPOSED (Marathi)
    voiceOffline: 'नेट नाही, म्हणून बोललेलं समजून घेता आलं नाही. खाली लिहा.', // PROPOSED (Marathi)
    voiceFailed: 'बोललेलं समजलं नाही. खाली लिहा किंवा पुन्हा बोला.', // PROPOSED (Marathi)
    heard: 'तुम्ही म्हणालात', // PROPOSED (Marathi)
    assigneeListOld: 'ही यादी नेट असताना घेतली होती.', // PROPOSED (Marathi)
    sendFailed: 'हे जतन करता आलं नाही. पुन्हा प्रयत्न करा.', // PROPOSED (Marathi)
    noWhere: 'प्लॉट निवडा किंवा संपूर्ण शेत', // PROPOSED (Marathi)
    tooLong: (box, max) => `"${box}" खूप मोठं आहे — जास्तीत जास्त ${max} अक्षरे. ते लहान करा.`, // PROPOSED (Marathi)
    role: {
        PrimaryOwner: 'मालक', // the preview's
        SecondaryOwner: 'सहमालक', // the design's word (MU §2)
        Mukadam: 'मुकादम', // the preview's
        Worker: 'कामगार', // the preview's
    },
    markDone: 'काम झालं', // PROPOSED (Marathi) - the founder's own words for the step
    confirmed: 'मंजूर', // PROPOSED (Marathi) - the review sheet's own word
    disputed: 'शंका — मालकाशी बोला', // PROPOSED (Marathi)
    waitingConfirm: 'मंजुरी बाकी', // PROPOSED (Marathi)
    approvalDoor: 'मंजुरी बाकी — तपासा', // PROPOSED (Marathi)
    partlyDone: 'अर्धवट झालं', // PROPOSED (Marathi)
    plotDone: 'झालं', // PROPOSED (Marathi)
    plot: 'प्लॉट', // PROPOSED (Marathi)
    plotLeft: 'बाकी', // PROPOSED (Marathi)
    whichPlot: 'कोणत्या प्लॉटवर झालं?', // PROPOSED (Marathi)
    allDone: 'पूर्ण झालं', // PROPOSED (Marathi)
    somethingLeft: 'काही बाकी आहे', // PROPOSED (Marathi)
    notNow: 'आत्ता नाही', // PROPOSED (Marathi)
    finishWaitingFirst: 'आधी चालू असलेली नोंद पूर्ण करा, मग काम झालं म्हणून सांगा.', // PROPOSED (Marathi)
    reopen: 'पुन्हा उघडा', // PROPOSED (Marathi)
    reopenWhy: 'काम पुन्हा का उघडताय? कारण लिहा', // PROPOSED (Marathi)
    reopenReasonPh: 'उदा. काम नीट झालेलं नाही', // PROPOSED (Marathi)
    reopenSend: 'पुन्हा उघडा', // PROPOSED (Marathi)
    reopenCancel: 'नको', // PROPOSED (Marathi)
    reopenNeedsReason: 'कारण लिहा', // PROPOSED (Marathi)
    donePlotsRefused: 'यातले काही प्लॉट या कामाचे नाहीत, म्हणून काम झालं हे नोंदवता आलं नाही.', // PROPOSED (Marathi)
    doneLogRefused: 'काम ज्या प्लॉटवर झालं त्या प्लॉटची नोंद लागते, म्हणून काम झालं हे नोंदवता आलं नाही.', // PROPOSED (Marathi)
    reopenOwnerOnly: 'काम पुन्हा उघडण्याचा अधिकार फक्त मालकाला आहे.', // PROPOSED (Marathi)
};

const en: PlannedWorkWords = {
    reminders: enReminders,
    what: 'What work', // PROPOSED (English)
    where: 'Where', // PROPOSED (English)
    when: 'When', // PROPOSED (English)
    who: 'For whom', // PROPOSED (English)
    details: 'Details', // PROPOSED (English)
    assign: 'Hand over the work', // PROPOSED (English)
    status: {
        Open: 'Reminder', // PROPOSED (English)
        Assigned: 'Handed over', // PROPOSED (English)
        Seen: 'Seen', // PROPOSED (English)
        Accepted: 'Accepted', // PROPOSED (English)
        Done: 'Done', // PROPOSED (English)
        Cancelled: 'Cancelled', // PROPOSED (English)
    },
    keptOnPhone: 'Kept on this phone', // PROPOSED (English)
    reminder: 'Reminder', // PROPOSED (English)
    scope: {
        Plot: 'One plot', // PROPOSED (English)
        MultiPlot: 'Some plots', // PROPOSED (English)
        Farm: 'Whole farm', // PROPOSED (English)
        Unspecified: 'Not decided yet', // PROPOSED (English)
    },
    looseWhen: {
        Week: 'This week', // PROPOSED (English)
        Month: 'This month', // PROPOSED (English)
        Anytime: 'Whenever it can be done', // PROPOSED (English)
    },
    noDate: 'No date fixed', // PROPOSED (English)
    crew: 'Team', // PROPOSED (English)
    expectedHeadcount: 'How many people', // PROPOSED (English)
    quantity: 'Quantity', // PROPOSED (English)
    payMode: {
        Cash: 'In cash', // PROPOSED (English)
        Daily: 'Daily wage', // PROPOSED (English)
        Contract: 'On contract', // PROPOSED (English)
        Later: 'Decide later', // PROPOSED (English)
    },
    payIsWordsOnly: 'These are only words; nothing here makes an attendance, a wage or a cost by itself.', // PROPOSED (English)
    seen: 'Seen', // PROPOSED (English)
    accept: 'Okay, I will do it', // PROPOSED (English)
    cancelWork: 'Cancel the work', // PROPOSED (English)
    spokenFrom: 'From what you said', // PROPOSED (English)
    removeSpoken: 'Remove', // PROPOSED (English)
    removeShort: 'Remove', // PROPOSED (English)
    removeLabel: 'Remove this reminder', // PROPOSED (English)
    notAllowedToAssign: "By ShramSafal's rules this work could not be handed to someone else. It can be kept as a reminder.", // PROPOSED (English)
    personNotOnFarm: 'This person is not on the farm now, so the work cannot be handed to him.', // PROPOSED (English)
    personNotOnPlots: 'This person does not cover all the plots of this work, so it cannot be handed to him.', // PROPOSED (English)
    changedFirst: 'This work was changed first, so this change did not apply.', // PROPOSED (English)
    keptOnPhoneLong: 'Kept on this phone - it will be sent when the net is back', // PROPOSED (English)
    parkedOpen: 'See the problem', // PROPOSED (English)
    parkedUnknown: 'This change could not be sent.', // PROPOSED (English)
    noLongerYours: 'This work is no longer handed to you.', // PROPOSED (English)
    planTitle: 'Plan the work', // PROPOSED (English)
    mineTitle: 'Work handed to you', // PROPOSED (English)
    you: 'You', // PROPOSED (English)
    newWork: 'Plan new work', // PROPOSED (English)
    moreWork: 'Plan more work', // PROPOSED (English)
    q1: '1. What is the work?', // PROPOSED (English)
    q2: '2. Where?', // PROPOSED (English)
    q3: '3. When?', // PROPOSED (English)
    q4: '4. Who is it for?', // PROPOSED (English)
    q5: '5. Details (optional)', // PROPOSED (English)
    workPh: 'e.g. Spread urea', // PROPOSED (English)
    typeHere: 'If you cannot speak, write here', // PROPOSED (English)
    commonWork: ['Fertiliser', 'Spraying', 'Irrigation', 'Pruning', 'Weeding'], // PROPOSED (English)
    today: 'Today', // PROPOSED (English)
    tomorrow: 'Tomorrow', // PROPOSED (English)
    in8: 'In 8 days', // PROPOSED (English)
    pickDate: 'Pick a date', // PROPOSED (English)
    ownSelf: 'Myself', // PROPOSED (English)
    nobody: 'Reminder only (nobody)', // PROPOSED (English)
    reminderOnly: 'Reminder only', // PROPOSED (English)
    qtyPh: 'e.g. 3 bags per row', // PROPOSED (English)
    pay: 'Wage / how it is done', // PROPOSED (English)
    note: 'Instructions', // PROPOSED (English)
    notePh: 'Anything else to say...', // PROPOSED (English)
    crewPh: "e.g. Rokade's team", // PROPOSED (English)
    crewLine: (team, headcount) => (headcount === null ? team : `${team} · ${headcount} people`), // PROPOSED (English)
    submitAssign: 'Hand over the work', // PROPOSED (English)
    submitRemind: 'Keep a reminder', // PROPOSED (English)
    assignedDone: name => `The work was handed to ${name}. They will see it when they open the app.`, // PROPOSED (English)
    remindedDone: 'The reminder is kept. It will show at the time you chose.', // PROPOSED (English)
    list: 'Planned work', // PROPOSED (English)
    empty: 'No work is planned yet', // PROPOSED (English)
    emptyMine: 'No work has been handed to you yet', // PROPOSED (English)
    by: 'Planned by', // PROPOSED (English)
    lateTag: 'Late', // PROPOSED (English)
    daysAgo: n => `${n} days ago`, // PROPOSED (English)
    daysAway: n => `In ${n} days`, // PROPOSED (English)
    back: 'Back', // PROPOSED (English)
    understanding: 'Understanding what you said...', // PROPOSED (English)
    voiceOffline: 'No net, so what you said could not be understood. Write it below.', // PROPOSED (English)
    voiceFailed: 'What you said was not understood. Write it below or say it again.', // PROPOSED (English)
    heard: 'You said', // PROPOSED (English)
    assigneeListOld: 'This list was taken when the net was on.', // PROPOSED (English)
    sendFailed: 'This could not be saved. Try again.', // PROPOSED (English)
    noWhere: 'Choose a plot or the whole farm', // PROPOSED (English)
    tooLong: (box, max) => `"${box}" is too long - at most ${max} letters. Make it shorter.`, // PROPOSED (English)
    role: {
        PrimaryOwner: 'Owner', // PROPOSED (English)
        SecondaryOwner: 'Co-owner', // PROPOSED (English)
        Mukadam: 'Mukadam', // PROPOSED (English)
        Worker: 'Worker', // PROPOSED (English)
    },
    markDone: 'Work done', // PROPOSED (English)
    confirmed: 'Approved', // PROPOSED (English)
    disputed: 'Doubt - talk to the owner', // PROPOSED (English)
    waitingConfirm: 'Approval pending', // PROPOSED (English)
    approvalDoor: 'Approval pending - review', // PROPOSED (English)
    partlyDone: 'Partly done', // PROPOSED (English)
    plotDone: 'Done', // PROPOSED (English)
    plot: 'Plot', // PROPOSED (English)
    plotLeft: 'Left', // PROPOSED (English)
    whichPlot: 'On which plot was it done?', // PROPOSED (English)
    allDone: 'All done', // PROPOSED (English)
    somethingLeft: 'Some is left', // PROPOSED (English)
    notNow: 'Not now', // PROPOSED (English)
    finishWaitingFirst: 'Finish the record that is open first, then say the work is done.', // PROPOSED (English)
    reopen: 'Open it again', // PROPOSED (English)
    reopenWhy: 'Why open this work again? Write the reason', // PROPOSED (English)
    reopenReasonPh: 'e.g. the work was not done properly', // PROPOSED (English)
    reopenSend: 'Open it again', // PROPOSED (English)
    reopenCancel: 'No', // PROPOSED (English)
    reopenNeedsReason: 'Write the reason', // PROPOSED (English)
    donePlotsRefused: 'Some of these plots are not plots of this work, so it could not be recorded as done.', // PROPOSED (English)
    doneLogRefused: 'A record made on the plot where the work was done is needed, so it could not be recorded as done.', // PROPOSED (English)
    reopenOwnerOnly: 'Only the owner can open the work again.', // PROPOSED (English)
};

/** English only for 'en'; every other language (Marathi, and Hindi which is not offered) reads Marathi. */
export function plannedWorkWords(language: string | null | undefined): PlannedWorkWords {
    return language === 'en' ? en : mr;
}
