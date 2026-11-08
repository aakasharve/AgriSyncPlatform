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
 * exampleSaid / mainPage / remindViaLog, and minus "काम झालं — सांगा" (the done step is lane L8c-3, so it is not drawn).
 * Everything the preview does not word is NEW wording, marked `// PROPOSED (Marathi)` / `// PROPOSED (English)`; a Marathi line
 * marked "the preview's" is its own word (itself still PROPOSED there until the founder approves it).
 *
 * No emoji, and no "AI" wording. A headcount, a quantity and a pay choice are WORDS: nothing here says a wage, a cost or an
 * attendance was made from them (D-24a, P4).
 */
import type { PlannedWorkPayModeName, PlannedWorkScopeName, PlannedWorkStatusName } from '../../infrastructure/storage/plannedWorkRow';

export interface PlannedWorkWords {
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
}

/** 10 -> १० (the farmer's digits in Marathi mode). */
function devanagariDigits(n: number): string {
    return String(n).replace(/[0-9]/g, d => String.fromCharCode(0x0966 + Number(d)));
}

const mr: PlannedWorkWords = {
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
};

const en: PlannedWorkWords = {
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
};

/** English only for 'en'; every other language (Marathi, and Hindi which is not offered) reads Marathi. */
export function plannedWorkWords(language: string | null | undefined): PlannedWorkWords {
    return language === 'en' ? en : mr;
}
