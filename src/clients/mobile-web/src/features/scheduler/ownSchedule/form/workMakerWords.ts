/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 4, mobile Schedule Maker; approved spec plr-d10-schedule-approved-spec-2026-11-23) - every word of
 * the one-work cards and of the plot's own-schedule list, in both languages (Marathi mode Marathi only, Devanagari digits through `digitsFor`; English mode
 * English only). Marathi taken from the approved v7 page (`final-decisions.html`, the "make" deck and MAKERDECK) and the approved maker preview where they
 * say it; every other Marathi line is PROPOSED and listed for the founder in `MARATHI-WORDS.md`. English twins are PROPOSED (English). No emoji, no "AI".
 */
import { digitsFor } from '../../../../shared/utils/marathiDigits';
import type { ScheduleTaskKind } from '../../../../../../../../sync-contract/schemas/schedule-task.zod';
import type { OwnLanguage } from '../ownScheduleWords';

/** The day the schedule counts from: pruning (grapes, pomegranate) or planting (every other crop). */
export type StartWord = 'pruning' | 'planting';

export interface WorkMakerWords {
    kinds: Readonly<Record<ScheduleTaskKind, string>>;
    makerTitle: string;
    editTitle: string;
    // start
    startQ: string;
    startBlank: string;
    startBlankSub: string;
    startChecked: string;
    startCheckedSub: string;
    refsQ: string;
    // kind
    kindQ: string;
    // what
    whatQ: string;
    whatSub: string;
    typeHere: string;
    namePh: string;
    nameChips: readonly string[];
    // stage
    stageQ: string;
    stageOpen: string;
    stageOpenNote: string;
    stageDays: (from: string, to: string) => string;
    stageHint: (from: string, to: string) => string;
    dayN: (shown: number) => string;
    // when
    whenQ: string;
    whenLater: string;
    whenDay: string;
    whenAfter: string;
    whenSign: string;
    laterNote: string;
    sideAfter: (start: StartWord) => string;
    sideBefore: (start: StartWord) => string;
    fromDay: (start: StartWord) => string;
    toDay: string;
    beforeDays: string;
    afterWhich: string;
    afterNone: string;
    usualDays: string;
    earlyLink: string;
    earlyDays: string;
    signQ: string;
    signPh: string;
    repeatQ: string;
    once: string;
    everyN: string;
    perWeek: string;
    everyHow: string;
    weekHow: string;
    days: string;
    times: string;
    // how
    howQ: string;
    product: string;
    productPh: string;
    qtyQ: Readonly<Record<ScheduleTaskKind, string>>;
    qtyUnit: Readonly<Record<ScheduleTaskKind, string>>;
    phiQ: string;
    stepsQ: string;
    stepsPh: string;
    // look, ask
    lookQ: string;
    lookPh: string;
    askQ: string;
    askPh: string;
    askSuggest: (sign: string) => string;
    optional: string;
    // save
    save: string;
    saving: string;
    nameEnough: string;
    needKind: string;
    needName: string;
    saveFailed: string;
    savedWaiting: string;
    // stepper
    less: string;
    more: string;
    // list
    listTitle: (plot: string) => string;
    listSub: string;
    listEmpty: string;
    add: string;
    change: string;
    remove: string;
    removed: (name: string) => string;
    undo: string;
    pending: string;
    refused: string;
    openConflicts: string;
    whenText: {
        later: string;
        day: (from: number, to: number | null) => string;
        before: (start: StartWord, n: number) => string;
        after: (name: string, usual: number | null) => string;
        afterUnknown: string;
        sign: (words: string) => string;
        every: (n: number) => string;
        week: (n: number) => string;
    };
    noPlot: string;
    noSeason: string;
}

/** The dose words a stepper number becomes (P4: kept as the farmer's words, never parsed back). */
export function qtyWords(kind: ScheduleTaskKind, n: number, language: OwnLanguage): string {
    const d = digitsFor(n, language);
    if (language === 'en') {
        return { spray: `${d} g per litre`, nutrition: `${d} kg per acre`, irrigation: `${d} hours`, work: `${d} people`, observe: `${d} vines` }[kind];
    }
    return { spray: `लिटरला ${d} ग्रॅम`, nutrition: `एकरी ${d} किलो`, irrigation: `${d} तास`, work: `${d} माणसं`, observe: `${d} वेली` }[kind];
}

const START_MR: Readonly<Record<StartWord, string>> = { pruning: 'छाटणी', planting: 'लागवड' };
const START_MR_OF: Readonly<Record<StartWord, string>> = { pruning: 'छाटणी', planting: 'लागवडी' };
const START_EN: Readonly<Record<StartWord, string>> = { pruning: 'pruning', planting: 'planting' };

const mr = (n: number) => digitsFor(n, 'mr');

const MR: WorkMakerWords = {
    kinds: { spray: 'फवारणी', nutrition: 'खत', irrigation: 'पाणी', work: 'शेतकाम', observe: 'पाहणी' }, // v7 page (K)
    makerTitle: 'माझं शेड्यूल', // maker preview
    editTitle: 'काम बदला', // maker preview
    startQ: 'कसं सुरू करायचं?', // v7 MAKERDECK
    startBlank: 'रिकाम्यापासून सुरू करा', // v7 MAKERDECK
    startBlankSub: 'कामं तुम्ही एक एक करून जोडता.', // v7 MAKERDECK
    startChecked: 'तपासलेल्या शेड्यूलवरून सुरू करा', // v7 MAKERDECK
    startCheckedSub: 'एक काम निवडा; ते तुमचं होतं, मग बदला.', // PROPOSED
    refsQ: 'कोणतं काम घ्यायचं?', // PROPOSED
    kindQ: 'कोणतं काम जोडायचं?', // v7 "make" deck
    whatQ: 'काम काय?', // v7 MAKERDECK
    whatSub: 'बोलण्यातून काम भरतं; दिवस, कामानंतर किंवा खूण सांगितली तर तीही भरते. बाकी पुढच्या कार्डांवर.', // PROPOSED (slice 16)
    typeHere: 'बोलता येत नसेल तर इथे लिहा', // app word (planning)
    namePh: 'उदा. वांज काढणे', // maker preview
    nameChips: ['खत टाकणे', 'फवारणी', 'पाणी सोडणे', 'छाटणी', 'तण काढणे'], // v7 MAKERDECK
    stageQ: 'पीक कोणत्या अवस्थेत असताना?', // maker preview
    stageOpen: 'नंतर ठरवू', // PROPOSED
    stageOpenNote: 'हा प्लॉट अजून कोणतंही शेड्यूल पाळत नाही, म्हणून अवस्था नंतर ठरवू. काम आत्ताही ठेवता येतं.', // PROPOSED
    stageDays: (a, b) => (a === b ? a : `${a} – ${b}`), // v7 MAKERDECK ("दिवस २–४१")
    stageHint: (a, b) => `ही अवस्था ${a} ते ${b}. कामाचा दिवस तुम्ही ठरवा.`, // PROPOSED
    dayN: n => `दिवस ${mr(n)}`, // v7
    whenQ: 'कधी करायचं?', // v7 "make" deck
    whenLater: 'नंतर सांगतो', // v7
    whenDay: 'दिवस मोजून', // v7
    whenAfter: 'कामानंतर', // v7
    whenSign: 'दिसलं की', // v7
    laterNote: 'कधी ते नंतर सांगता येईल. तोपर्यंत या कामाला तारीख नाही.', // PROPOSED
    sideAfter: s => `${START_MR_OF[s]}पासून`, // maker preview ("छाटणीपासून")
    sideBefore: s => `${START_MR_OF[s]}आधी`, // maker preview ("छाटणीआधी")
    fromDay: s => `कितवा दिवस? (${START_MR[s]} = दिवस ${mr(1)})`, // maker preview
    toDay: 'पर्यंत (ऐच्छिक)', // v7 "पर्यंत" + PROPOSED
    beforeDays: 'किती दिवस आधी?', // maker preview
    afterWhich: 'कोणत्या कामानंतर?', // maker preview
    afterNone: 'या प्लॉटच्या शेड्यूलमध्ये आधी एक काम ठेवा; मग "कामानंतर" निवडता येईल.', // PROPOSED
    usualDays: 'साधारण किती दिवसांनी?', // maker preview
    earlyLink: 'कधी लवकर होतं का?', // maker preview
    earlyDays: 'लवकर झालं तर किती दिवसांत?', // maker preview
    signQ: 'काय दिसलं की?', // v7
    signPh: 'उदा. तिसरं पान उघडलं', // maker preview
    repeatQ: 'किती वेळा?', // v7 MAKERDECK
    once: 'एकदाच', // v7
    everyN: 'दर काही दिवसांनी', // PROPOSED (v7 "दर N दिवसांनी" without a letter)
    perWeek: 'आठवड्यातून काही वेळा', // PROPOSED (v7 "आठवड्यातून N वेळा" without a letter)
    everyHow: 'दर किती दिवसांनी?', // v7 MAKERDECK sub
    weekHow: 'आठवड्यातून किती वेळा?', // v7 MAKERDECK sub
    days: 'दिवस',
    times: 'वेळा',
    howQ: 'कसं करायचं?', // maker preview
    product: 'काय वापरता?', // maker preview
    productPh: 'पाकिटावरचं नाव', // maker preview
    qtyQ: { spray: 'लिटरला किती?', nutrition: 'एकरी किती?', irrigation: 'किती तास?', work: 'किती माणसं?', observe: 'किती वेली पाहायच्या?' }, // v7 "make" deck
    qtyUnit: { spray: 'ग्रॅम', nutrition: 'किलो', irrigation: 'तास', work: 'माणसं', observe: 'वेली' }, // v7 "make" deck
    phiQ: 'काढणीआधी किती दिवस थांबायचं?', // maker preview
    stepsQ: 'तुम्ही कसं करता?', // PROPOSED
    stepsPh: 'तुम्ही कसं करता ते लिहा', // maker preview
    lookQ: 'काय पाहायचं?', // maker preview
    lookPh: 'शेतात काय बघायचं', // maker preview
    askQ: 'श्रमसाथीने काय विचारावं?', // maker preview
    askPh: 'तुम्हाला विचारायचा प्रश्न', // maker preview
    askSuggest: sign => `"${sign}" असं दिसलं का?`, // maker preview
    optional: 'ऐच्छिक', // app word
    save: 'माझ्या शेड्यूलमध्ये ठेवा', // v7 "make" deck
    saving: 'ठेवत आहे…', // PROPOSED
    nameEnough: 'फक्त काम पुरेसं आहे. बाकी नंतरही सांगता येतं.', // maker preview
    needKind: 'आधी वर कामाचा प्रकार निवडा.', // PROPOSED
    needName: 'काम काय ते बोला किंवा लिहा.', // PROPOSED
    saveFailed: 'काम फोनवर ठेवता आलं नाही. पुन्हा दाबा.', // PROPOSED
    savedWaiting: 'माझ्या शेड्यूलमध्ये ठेवलं. नेट आल्यावर पाठवलं जाईल.', // maker preview (offline banner), PROPOSED join
    less: 'कमी',
    more: 'जास्त',
    listTitle: plot => `माझं शेड्यूल · ${plot}`, // maker preview ("माझं शेड्यूल", "द्राक्ष · G1")
    listSub: 'बनत आहे · अजून मुख्य नाही', // maker preview
    listEmpty: 'अजून काम नाही. एक काम सांगा.', // maker preview
    add: 'काम जोडा', // maker preview
    change: 'बदला', // maker preview
    remove: 'काढा', // maker preview
    removed: name => `"${name}" काढलं.`, // maker preview ("काढलं.")
    undo: 'काढलेलं परत आणा', // maker preview
    pending: 'फोनवर ठेवलं. नेट आल्यावर पाठवलं जाईल.', // app line (planning)
    refused: 'हा बदल पाठवता आला नाही.', // PROPOSED
    openConflicts: 'कारण पाहा', // PROPOSED
    whenText: {
        later: 'कधी ते नंतर सांगतो', // maker preview
        day: (a, b) => (b === null || b === a ? `दिवस ${mr(a)}` : `दिवस ${mr(a)} ते ${mr(b)}`), // maker preview / v7
        before: (s, n) => `${START_MR_OF[s]}आधी ${mr(n)} दिवस`, // build plan ("छाटणीआधी N दिवस")
        after: (name, usual) => `${name} झाल्यावर${usual === null ? '' : ` साधारण ${mr(usual)} दिवसांनी`}`, // maker preview
        afterUnknown: 'दुसरं काम झाल्यावर', // PROPOSED
        sign: w => `${w}, की`, // maker preview
        every: n => `दर ${mr(n)} दिवसांनी`, // maker preview
        week: n => `आठवड्यातून ${mr(n)} वेळा`, // v7
    },
    noPlot: 'माझं शेड्यूल एका प्लॉटचं असतं: वर "कुठे?" मध्ये एकच प्लॉट निवडा.', // PROPOSED
    noSeason: 'या प्लॉटचा हंगाम अजून फोनवर आलेला नाही. नेट चालू असताना ॲप उघडा.', // PROPOSED
};

const en = (n: number) => String(n);

const EN: WorkMakerWords = {
    kinds: { spray: 'Spray', nutrition: 'Fertiliser', irrigation: 'Water', work: 'Farm work', observe: 'Observation' },
    makerTitle: 'My schedule',
    editTitle: 'Change the work',
    startQ: 'How do you want to start?',
    startBlank: 'Start empty',
    startBlankSub: 'You add the works one by one.',
    startChecked: 'Start from a checked schedule',
    startCheckedSub: 'Pick one work; it becomes yours, then change it.',
    refsQ: 'Which work do you take?',
    kindQ: 'Which kind of work?',
    whatQ: 'What is the work?',
    whatSub: 'Speaking fills the work; a day, a work it follows or a sign you say is filled too. The rest is on the next cards.',
    typeHere: 'Cannot speak? Type here',
    namePh: 'e.g. remove extra shoots',
    nameChips: ['Give fertiliser', 'Spray', 'Water', 'Pruning', 'Weeding'],
    stageQ: 'At which stage of the crop?',
    stageOpen: 'Decide later',
    stageOpenNote: 'This plot follows no schedule yet, so the stage is decided later. You can keep the work now.',
    stageDays: (a, b) => (a === b ? a : `${a} – ${b}`),
    stageHint: (a, b) => `This stage runs ${a} to ${b}. You choose the work's day.`,
    dayN: n => `day ${en(n)}`,
    whenQ: 'When?',
    whenLater: 'Tell later',
    whenDay: 'By the day',
    whenAfter: 'After a work',
    whenSign: 'When seen',
    laterNote: 'You can say when later. Until then this work has no date.',
    sideAfter: s => `From ${START_EN[s]}`,
    sideBefore: s => `Before ${START_EN[s]}`,
    fromDay: s => `Which day? (${START_EN[s]} = day 1)`,
    toDay: 'Until (optional)',
    beforeDays: 'How many days before?',
    afterWhich: 'After which work?',
    afterNone: 'Keep one work in this plot\'s schedule first; then "after a work" can be chosen.',
    usualDays: 'About how many days after?',
    earlyLink: 'Does it sometimes come early?',
    earlyDays: 'If early, within how many days?',
    signQ: 'When what is seen?',
    signPh: 'e.g. third leaf opened',
    repeatQ: 'How often?',
    once: 'Once',
    everyN: 'Every few days',
    perWeek: 'Some times a week',
    everyHow: 'Every how many days?',
    weekHow: 'How many times a week?',
    days: 'days',
    times: 'times',
    howQ: 'How is it done?',
    product: 'What do you use?',
    productPh: 'Name on the packet',
    qtyQ: { spray: 'How much per litre?', nutrition: 'How much per acre?', irrigation: 'How many hours?', work: 'How many people?', observe: 'How many vines to look at?' },
    qtyUnit: { spray: 'g', nutrition: 'kg', irrigation: 'hours', work: 'people', observe: 'vines' },
    phiQ: 'Days to wait before harvest?',
    stepsQ: 'How do you do it?',
    stepsPh: 'Write how you do it',
    lookQ: 'What to look at?',
    lookPh: 'What to check in the field',
    askQ: 'What should ShramSathi ask?',
    askPh: 'The question to ask you',
    askSuggest: sign => `Did you see "${sign}"?`,
    optional: 'optional',
    save: 'Keep in my schedule',
    saving: 'Keeping…',
    nameEnough: 'The work alone is enough. The rest can be told later.',
    needKind: 'First choose the kind of work above.',
    needName: 'Say or type the work.',
    saveFailed: 'The work could not be kept on the phone. Tap again.',
    savedWaiting: 'Kept in my schedule. It is sent when the internet is back.',
    less: 'less',
    more: 'more',
    listTitle: plot => `My schedule · ${plot}`,
    listSub: 'Being made · not main yet',
    listEmpty: 'No work yet. Tell one work.',
    add: 'Add a work',
    change: 'Change',
    remove: 'Remove',
    removed: name => `"${name}" removed.`,
    undo: 'Bring it back',
    pending: 'Kept on the phone. Sent when the internet is back.',
    refused: 'This change could not be sent.',
    openConflicts: 'See why',
    whenText: {
        later: 'When: tell later',
        day: (a, b) => (b === null || b === a ? `Day ${en(a)}` : `Days ${en(a)} to ${en(b)}`),
        before: (s, n) => `${en(n)} days before ${START_EN[s]}`,
        after: (name, usual) => `After ${name}${usual === null ? '' : `, about ${en(usual)} days`}`,
        afterUnknown: 'After another work',
        sign: w => `When ${w}`,
        every: n => `every ${en(n)} days`,
        week: n => `${en(n)} times a week`,
    },
    noPlot: 'My schedule belongs to one plot: choose one plot under "Where?" above.',
    noSeason: 'This plot\'s season is not on the phone yet. Open the app with the internet on.',
};

export const WORK_MAKER_WORDS: Readonly<Record<OwnLanguage, WorkMakerWords>> = { mr: MR, en: EN };
