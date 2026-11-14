/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane CMP-T v4; D-68, D-104, D-139 fifth note / F259; R12, R33, R34; P4, P10)
 *
 * Every word the तुलना screen says, in Marathi and in English (Marathi mode shows Marathi only, English mode English only).
 *
 * Provenance: the plan's words table (`L8-planning-PLAN.md` ~1070-1105, founder D-104 "हो, असंच") is used UNCHANGED where it has the
 * words; the rest are the strings of the founder-picked v4 page (`PLANNING-L8/compare-redesign-v4`), marked PROPOSED (Marathi) for
 * the Marathi reviewer. Every English twin is PROPOSED (English) except where the plan table carries the English.
 *
 * What is never said here: "राहिलं" / "काम झालं नाही" (no record is not "not done"), amber / partial / "day changed" words (R33), a
 * percent, a score, a best schedule. Numbers are written by `n()`: Devanagari digits in Marathi, 0-9 in English (D-128).
 */
import { digitsFor } from '../../shared/utils/marathiDigits';

export type CompareLang = 'mr' | 'en';
export const langOf = (language: string | null | undefined): CompareLang => (language === 'en' ? 'en' : 'mr');
/** A number as the screen writes it. */
export const n = (lang: CompareLang, value: number): string => digitsFor(value, lang);

export type PartKey = 'irrigation' | 'work' | 'nutrition' | 'spray';
export const PART_ORDER: readonly PartKey[] = ['irrigation', 'work', 'nutrition', 'spray'];

export interface CompareWords {
    // --- selector (screen 1)
    askCrop: string; // plan/v4 heading
    askCropHint: string;
    askPlotHint: string;
    cropNoPlots: string;
    noCropsAtAll: string;
    // --- chrome
    change: string;
    help: string;
    previousStage: string;
    nextStage: string;
    stageEnded: string;
    stageNotStarted: string;
    stageNoNumbers: string;
    daysLeft: (days: number) => string;
    freshNow: string;
    offlineAsOf: (when: string) => string;
    offlineAsOfUnknown: string;
    // --- states
    loading: string;
    refused: string;
    offlineNothing: string;
    plotNotInAnswer: string;
    chooseScheduleFirst: string;
    chooseSchedule: string;
    noStages: string;
    noFollowedSchedule: string;
    // --- primary card
    mainOwn: string;
    mainOf: (name: string) => string;
    noRecordYet: string;
    didNotComeToRecord: string;
    sameAsScheduleAll: string;
    noWorkInStage: string;
    cameInRecord: (count: number) => string;
    noRecordWork: (count: number, passed: boolean) => string;
    andSaidNotDone: (count: number) => string;
    saidNotDone: string;
    storyDone: string;
    storyAsked: string;
    storyNoRecord: (passed: boolean) => string;
    storyLabel: (asked: number, done: number) => string;
    plainNoRecord: string;
    // --- other schedules
    otherSchedules: (count: number) => string;
    referenceOnly: string;
    outOfMatched: (asked: number, done: number) => string;
    moreThanSchedule: (count: number) => string;
    orderNote: (schedule: string, first: string, then: string) => string;
    // --- tiles and mirror
    partName: Record<PartKey, string>;
    notInPlan: string;
    inOtherSchedules: string;
    notInScheduleCount: (count: number) => string;
    colSchedule: string;
    colYou: string;
    notInScheduleDidIt: string;
    oneRecord: string;
    // --- sheets
    close: string;
    back: string;
    categoryEmpty: string;
    otherSchedulesSay: string;
    refNote: string;
    understand: string;
    step1: string;
    step2: string;
    step3: string;
    step1Line: (work: string, stage: string, asked: number | null) => string;
    saveFailed: string;
    step2Records: string;
    step2NoRecord: (passed: boolean) => string;
    step2NoDates: string;
    step2CameIn: string;
    why: {
        matched: string;
        open: (days: number | null) => string;
        passedNoRecord: string;
        said: string;
        more: (count: number) => string;
    };
    footerCount: string;
    // --- own work
    ownSentence: string;
    ownWhen: (day: number) => string;
    notRecognised: string;
    optionalWhy: string;
    kinds: { Practice: string; Extra: string; Weather: string };
    reasonGroup: string;
    wordsPlaceholder: string;
    wordsLabel: string;
    saveWords: string;
    pickPictureFirst: string;
    micLabel: string;
    micWorking: string;
    micFailed: string;
    micOfflineNote: string;
    pictureEnough: string;
    spokenTag: string;
    // --- coach
    coach: { title: string; cards: readonly [string, string, string]; next: string; done: string; skip: string };
}

const MR: CompareWords = {
    askCrop: 'कोणत्या पिकाची तुलना पाहायची ?', // the earlier approved heading (L8-R3, D-68)
    askCropHint: 'आधी पीक निवडा, मग प्लॉट.', // PROPOSED (Marathi)
    askPlotHint: 'प्लॉट निवडला की तुलना उघडेल.', // PROPOSED (Marathi)
    cropNoPlots: 'या पिकाचा अजून प्लॉट नाही.', // PROPOSED (Marathi)
    noCropsAtAll: 'अजून पीक किंवा प्लॉट नोंदलेला नाही. पीक आणि प्लॉट जोडले की इथे शेड्यूलशी तुलना दिसेल.', // the old page's words (PLR-D9 T7)
    change: 'बदला', // PROPOSED (Marathi)
    help: 'कसं वाचायचं',
    previousStage: 'मागची', // PROPOSED (Marathi)
    nextStage: 'पुढची', // PROPOSED (Marathi)
    stageEnded: 'संपलेली स्टेज', // PROPOSED (Marathi)
    stageNotStarted: 'अजून सुरू झालेला नाही', // PROPOSED (Marathi)
    stageNoNumbers: 'या स्टेजचे आकडे इथे दिसत नाहीत.', // PROPOSED (Marathi)
    daysLeft: d => `स्टेज संपायला ${n('mr', d)} दिवस`, // plan word
    freshNow: 'अपडेट: आत्ताच', // PROPOSED (Marathi)
    offlineAsOf: when => `इंटरनेट नाही · शेवटचं अपडेट: ${when}`, // PROPOSED (Marathi)
    offlineAsOfUnknown: 'इंटरनेट नाही · शेवटचं अपडेट कधीचं ते सांगता येत नाही', // PROPOSED (Marathi)
    loading: 'माहिती येत आहे…', // PROPOSED (Marathi)
    refused: 'ही माहिती तुम्हाला सध्या दिसणार नाही.', // PROPOSED (Marathi)
    offlineNothing: 'इंटरनेट नाही, आणि आधी आलेली माहितीही फोनवर नाही.', // PROPOSED (Marathi)
    plotNotInAnswer: 'या प्लॉटची तुलना अजून दाखवायला काही नाही.', // PROPOSED (Marathi)
    chooseScheduleFirst: 'आधी शेड्यूल निवडा', // plan word (D-83 = 1)
    chooseSchedule: 'शेड्यूल निवडा', // plan word
    noStages: 'या शेड्यूलमध्ये स्टेज नाहीत, म्हणून तुलना दाखवता येत नाही.', // PROPOSED (Marathi)
    noFollowedSchedule: 'या प्लॉटवर कोणतंही शेड्यूल लावलेलं नाही.', // PROPOSED (Marathi)
    mainOwn: 'माझं नियोजन · मुख्य', // PROPOSED (Marathi)
    mainOf: name => `${name} · मुख्य`, // PROPOSED (Marathi)
    noRecordYet: 'अजून नोंद नाही', // plan word
    didNotComeToRecord: 'नोंदीत आलं नाही', // plan word
    sameAsScheduleAll: 'सगळं जुळलं', // plan word
    noWorkInStage: 'या स्टेजला या शेड्यूलमध्ये हे काम नाही.', // v4 (plan: "या स्टेजमध्ये या शेड्यूलमध्ये हे काम नाही")
    cameInRecord: c => `नोंदीत आलं: ${n('mr', c)}`, // plan word
    noRecordWork: (c, passed) => (passed
        ? (c === 1 ? 'काम नोंदीत आलं नाही' : 'कामं नोंदीत आली नाहीत') // PROPOSED (Marathi): the plan word made plural
        : (c === 1 ? 'कामाची अजून नोंद नाही' : 'कामांची अजून नोंद नाही')), // PROPOSED (Marathi)
    andSaidNotDone: c => `आणि ${n('mr', c)} नोंदीत: झालं नाही असं सांगितलं`, // PROPOSED (Marathi) around the plan word
    saidNotDone: 'नोंदीत: झालं नाही असं सांगितलं', // plan word
    storyDone: 'केलं', // PROPOSED (Marathi)
    storyAsked: 'सांगितलं', // PROPOSED (Marathi)
    storyNoRecord: passed => (passed ? 'नोंदीत आलं नाही' : 'नोंद नाही'), // PROPOSED (Marathi)
    storyLabel: (a, d) => `सांगितलं ${n('mr', a)}, केलं ${n('mr', d)}`, // PROPOSED (Marathi)
    plainNoRecord: 'नोंद नाही, म्हणजे काम झालं नाही असं नाही.', // v4 exact line
    otherSchedules: c => `इतर ${n('mr', c)} शेड्यूल`, // PROPOSED (Marathi)
    referenceOnly: 'फक्त संदर्भासाठी', // PROPOSED (Marathi)
    outOfMatched: (a, d) => `${n('mr', a)} पैकी ${n('mr', d)} जुळलं`, // plan word (approved D-68)
    moreThanSchedule: c => `शेड्यूलपेक्षा ${n('mr', c)} जास्त`, // plan word
    orderNote: (s, f, t) => `क्रम: ${s} मध्ये आधी ${f}, मग ${t}`, // plan word (the plan's "शेड्यूल ‹N›" is the schedule's name here)
    partName: { irrigation: 'पाणी', work: 'शेतीची कामं', nutrition: 'खते व निविष्टा', spray: 'फवारणी' },
    notInPlan: 'नियोजनात नाही', // PROPOSED (Marathi)
    inOtherSchedules: 'इतर शेड्यूलमध्ये आहे', // PROPOSED (Marathi)
    notInScheduleCount: c => `शेड्यूलमध्ये नव्हतं ${n('mr', c)}`, // PROPOSED (Marathi)
    colSchedule: 'शेड्यूलने सांगितलं',
    colYou: 'तुम्ही केलं',
    notInScheduleDidIt: 'शेड्यूलमध्ये नव्हतं · तुम्ही केलं', // PROPOSED (Marathi)
    oneRecord: 'एक नोंद', // PROPOSED (Marathi)
    close: 'बंद करा',
    back: 'मागे', // PROPOSED (Marathi)
    categoryEmpty: 'या स्टेजला या शेड्यूलमध्ये हे काम नाही.', // v4
    otherSchedulesSay: 'इतर शेड्यूल या स्टेजला काय सांगतात (फक्त संदर्भासाठी)', // PROPOSED (Marathi)
    refNote: 'हे तुमचं मुख्य शेड्यूल नाही. यामुळे तुमच्या नियोजनात काहीही बदलत नाही.', // PROPOSED (Marathi)
    understand: 'समजून घ्या',
    step1: 'शेड्यूलने काय सांगितलं',
    step2: 'काय नोंदवलं',
    step3: 'का वेगळं',
    step1Line: (w, s, a) => (a === null ? `${w} · स्टेज ${s}` : `${w} · स्टेज ${s} मध्ये ${n('mr', a)} वेळा`),
    saveFailed: 'जतन झालं नाही. पुन्हा करा.', // PROPOSED (Marathi)
    step2Records: 'नोंदी:',
    step2NoRecord: passed => (passed ? 'नोंदीत आलं नाही' : 'अजून नोंद नाही'),
    step2NoDates: 'तारखा या तुलनेत दिसत नाहीत, फक्त संख्या.', // PROPOSED (Marathi)
    step2CameIn: 'नोंदीत आलं:',
    why: {
        matched: 'शेड्यूलने सांगितलं तेवढंच नोंदीत आलं. म्हणून जुळलं.',
        open: d => (d === null ? 'स्टेज अजून चालू आहे, अजून वेळ आहे.' : `स्टेज अजून चालू आहे, अजून वेळ आहे. स्टेज संपायला ${n('mr', d)} दिवस.`),
        passedNoRecord: 'या स्टेजमध्ये नोंद आली नाही.', // PROPOSED (Marathi)
        said: 'नोंदीत: झालं नाही असं सांगितलं',
        more: c => `शेड्यूलपेक्षा ${n('mr', c)} जास्त नोंदी आहेत.`,
    },
    footerCount: 'ही फक्त मोजदाद आहे. कोणाचीही चूक काढलेली नाही.', // PROPOSED (Marathi)
    ownSentence: 'तुमच्या कोणत्याच शेड्यूलमध्ये या स्टेजला हे नव्हतं. ही तुमची पद्धत असू शकते.', // plan word
    ownWhen: d => `कधी: दिवस ${n('mr', d)}`, // PROPOSED (Marathi)
    notRecognised: 'हे काम ओळखता आलं नाही', // plan word (R12)
    optionalWhy: 'का केलं? (हवं तर सांगा)', // PROPOSED (Marathi)
    kinds: { Practice: 'माझी पद्धत', Extra: 'जास्तीचं काम', Weather: 'हवामानामुळे बदल' }, // plan words (CMP-D3 kinds)
    reasonGroup: 'का केलं',
    wordsPlaceholder: 'का केलं ते लिहा (हवं तर)', // PROPOSED (Marathi)
    wordsLabel: 'का केलं ते लिहा',
    saveWords: 'जतन करा',
    pickPictureFirst: 'आधी एक चित्र निवडा.', // PROPOSED (Marathi)
    micLabel: 'का केलं ते बोलून सांगा', // plan/PLR-D10 word
    micWorking: 'ऐकत आहे…', // PROPOSED (Marathi)
    micFailed: 'बोललेलं समजलं नाही. पुन्हा सांगा किंवा लिहा.', // PROPOSED (Marathi)
    micOfflineNote: 'इंटरनेट नाही, म्हणून बोलून सांगता येत नाही. चित्र निवडलं की पुरेसं आहे.', // v4
    pictureEnough: 'चित्र निवडलं की पुरेसं आहे.', // v4
    spokenTag: 'बोलून सांगितलं',
    coach: {
        title: 'कसं वाचायचं',
        cards: [
            'हिरवी खूण: शेड्यूलने सांगितलं तेवढं नोंदीत आलं.',
            'राखाडी आकडा: अजून किती कामांची नोंद नाही. नोंद नाही, म्हणजे काम झालं नाही असं नाही.',
            'शेड्यूलमध्ये नव्हतं, तुम्ही केलं: शेड्यूलमध्ये नसलेलं तुमचं स्वतःचं काम. यात काही राहिलेलं नाही.',
        ],
        next: 'पुढे',
        done: 'समजलं',
        skip: 'वगळा',
    },
};

const EN: CompareWords = {
    askCrop: 'Which crop do you want to compare?', // PROPOSED (English)
    askCropHint: 'Choose the crop first, then the plot.', // PROPOSED (English)
    askPlotHint: 'The comparison opens when you choose a plot.', // PROPOSED (English)
    cropNoPlots: 'This crop has no plot yet.', // PROPOSED (English)
    noCropsAtAll: 'No crop or plot is recorded yet. Once you add a crop and a plot, the comparison with the schedule shows here.', // PROPOSED (English)
    change: 'Change', // PROPOSED (English)
    help: 'How to read this',
    previousStage: 'Previous', // PROPOSED (English)
    nextStage: 'Next', // PROPOSED (English)
    stageEnded: 'Stage is over', // PROPOSED (English)
    stageNotStarted: 'Not started yet', // PROPOSED (English)
    stageNoNumbers: 'The numbers for this stage are not shown here.', // PROPOSED (English)
    daysLeft: d => `${n('en', d)} days left in the stage`, // plan table English
    freshNow: 'Updated: just now', // PROPOSED (English)
    offlineAsOf: when => `No internet · last updated: ${when}`, // PROPOSED (English)
    offlineAsOfUnknown: 'No internet · cannot say when this was last updated', // PROPOSED (English)
    loading: 'Getting the information…', // PROPOSED (English)
    refused: 'You will not see this information right now.', // PROPOSED (English)
    offlineNothing: 'No internet, and nothing from before is kept on this phone.', // PROPOSED (English)
    plotNotInAnswer: 'There is nothing to compare for this plot yet.', // PROPOSED (English)
    chooseScheduleFirst: 'Choose a schedule first', // plan table English
    chooseSchedule: 'Choose a schedule', // plan table English
    noStages: 'This schedule has no stages, so the comparison cannot be shown.', // PROPOSED (English)
    noFollowedSchedule: 'No schedule is followed on this plot.', // PROPOSED (English)
    mainOwn: 'My plan · Main', // PROPOSED (English)
    mainOf: name => `${name} · Main`, // PROPOSED (English)
    noRecordYet: 'No record yet', // plan table English
    didNotComeToRecord: 'Did not come to the record', // plan table English
    sameAsScheduleAll: 'All matched', // PROPOSED (English)
    noWorkInStage: 'This schedule has no such work in this stage.', // plan table English
    cameInRecord: c => `Came to the record: ${n('en', c)}`, // PROPOSED (English)
    noRecordWork: (c, passed) => (passed
        ? (c === 1 ? 'work did not come to the record' : 'works did not come to the record') // PROPOSED (English)
        : (c === 1 ? 'work has no record yet' : 'works have no record yet')), // PROPOSED (English)
    andSaidNotDone: c => `and ${n('en', c)} where the record says it was not done`, // PROPOSED (English)
    saidNotDone: 'The record says it was not done', // plan table English
    storyDone: 'Done', // PROPOSED (English)
    storyAsked: 'Asked', // PROPOSED (English)
    storyNoRecord: passed => (passed ? 'Did not come to the record' : 'No record'), // PROPOSED (English)
    storyLabel: (a, d) => `Asked ${n('en', a)}, done ${n('en', d)}`, // PROPOSED (English)
    plainNoRecord: 'No record does not mean the work was not done.', // PROPOSED (English)
    otherSchedules: c => `${n('en', c)} other ${c === 1 ? 'schedule' : 'schedules'}`, // PROPOSED (English)
    referenceOnly: 'For reference only', // PROPOSED (English)
    outOfMatched: (a, d) => `${n('en', d)} of ${n('en', a)} matched`, // plan table English
    moreThanSchedule: c => `${n('en', c)} more than the schedule`, // plan table English
    orderNote: (s, f, t) => `Order: ${s} has ${f} first, then ${t}`, // plan table English (the schedule's name stands for "schedule ‹N›")
    partName: { irrigation: 'Water', work: 'Farm work', nutrition: 'Fertilisers and inputs', spray: 'Spraying' }, // PROPOSED (English)
    notInPlan: 'Not in the plan', // PROPOSED (English)
    inOtherSchedules: 'In other schedules', // PROPOSED (English)
    notInScheduleCount: c => `Not in the schedule ${n('en', c)}`, // PROPOSED (English)
    colSchedule: 'Schedule says', // PROPOSED (English)
    colYou: 'You did', // PROPOSED (English)
    notInScheduleDidIt: 'Not in the schedule · you did it', // PROPOSED (English)
    oneRecord: 'One record', // PROPOSED (English)
    close: 'Close', // PROPOSED (English)
    back: 'Back', // PROPOSED (English)
    categoryEmpty: 'This schedule has no such work in this stage.', // plan table English
    otherSchedulesSay: 'What the other schedules say about this stage (for reference only)', // PROPOSED (English)
    refNote: 'This is not your main schedule. Nothing in your plan changes because of it.', // PROPOSED (English)
    understand: 'Understand this', // PROPOSED (English)
    step1: 'What the schedule said', // PROPOSED (English)
    step2: 'What was recorded', // PROPOSED (English)
    step3: 'Why it differs', // PROPOSED (English)
    step1Line: (w, s, a) => (a === null ? `${w} · stage ${s}` : `${w} · ${n('en', a)} ${a === 1 ? 'time' : 'times'} in stage ${s}`), // PROPOSED (English)
    saveFailed: 'Not saved. Try again.', // PROPOSED (English)
    step2Records: 'Records:', // PROPOSED (English)
    step2NoRecord: passed => (passed ? 'Did not come to the record' : 'No record yet'),
    step2NoDates: 'Dates are not shown in this comparison, only counts.', // PROPOSED (English)
    step2CameIn: 'Came to the record:', // PROPOSED (English)
    why: {
        matched: 'The record has as many as the schedule asked. So it matched.', // PROPOSED (English)
        open: d => (d === null ? 'The stage is still running, there is still time.' : `The stage is still running, there is still time. ${n('en', d)} days left in the stage.`), // PROPOSED (English)
        passedNoRecord: 'No record came in this stage.', // PROPOSED (English)
        said: 'The record says it was not done',
        more: c => `${n('en', c)} more records than the schedule asked.`, // PROPOSED (English)
    },
    footerCount: 'This is only a count. Nobody is being faulted.', // PROPOSED (English)
    ownSentence: 'None of your schedules had this in this stage. It may be your own practice.', // plan table English
    ownWhen: d => `When: day ${n('en', d)}`, // PROPOSED (English)
    notRecognised: 'This work could not be recognised', // plan table English
    optionalWhy: 'Why did you do it? (tell us if you like)', // PROPOSED (English)
    kinds: { Practice: 'My method', Extra: 'Extra work', Weather: 'Changed for weather' }, // PROPOSED (English)
    reasonGroup: 'Why you did it', // PROPOSED (English)
    wordsPlaceholder: 'Write why you did it (if you like)', // PROPOSED (English)
    wordsLabel: 'Write why you did it', // PROPOSED (English)
    saveWords: 'Save', // PROPOSED (English)
    pickPictureFirst: 'Choose a picture first.', // PROPOSED (English)
    micLabel: 'Say why you did it', // PROPOSED (English)
    micWorking: 'Listening…', // PROPOSED (English)
    micFailed: 'The words were not understood. Say it again or write it.', // PROPOSED (English)
    micOfflineNote: 'No internet, so you cannot say it by voice. Choosing a picture is enough.', // PROPOSED (English)
    pictureEnough: 'Choosing a picture is enough.', // PROPOSED (English)
    spokenTag: 'Said by voice', // PROPOSED (English)
    coach: {
        title: 'How to read this', // PROPOSED (English)
        cards: [
            'Green tick: the record has what the schedule asked.', // PROPOSED (English)
            'Grey number: how many works have no record yet. No record does not mean the work was not done.', // PROPOSED (English)
            'Not in the schedule, you did it: your own work that is not in a schedule. Nothing is left undone here.', // PROPOSED (English)
        ],
        next: 'Next', // PROPOSED (English)
        done: 'Got it', // PROPOSED (English)
        skip: 'Skip', // PROPOSED (English)
    },
};

export const compareWords = (language: string | null | undefined): CompareWords => (langOf(language) === 'en' ? EN : MR);
