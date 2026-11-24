/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 11, "Season end and next year") - the words of the season-end review, one language at a time (Marathi mode
 * Marathi only, English mode English only; Devanagari digits on Marathi screens). Lines marked DESIGN are the approved design's own words (final-decisions.html, scene
 * "5. My schedule"); every other Marathi line is PROPOSED (G:\agrisync-scratch\sched11\MARATHI-WORDS.md) until the founder approves it. No emoji, no "AI" wording, and a
 * work with no record is never called "not done".
 */
import { toDevanagariDigits } from '../../../shared/utils/marathiDigits';
import type { OwnLanguage } from './ownScheduleWords';

export interface SeasonReviewWords {
    entryTitle: string;
    entrySub: string;
    entryOpen: string;
    entryQueued: string;
    entryAnswered: string;
    entryRead: string;
    title: string;
    chip: string;
    originLine: (origin: string | null) => string;
    askLine: (name: string) => string;
    scheduleLabel: string;
    mineLabel: string;
    skipLabel: string;
    expectedLine: (from: number, to: number | null) => string;
    recordedLine: (day: number, date: string) => string;
    partLine: string;
    noRecordLine: string;
    sourceOwn: string;
    sourceRecord: string;
    planOnlyTitle: string;
    planOnlySub: string;
    planOnlyTake: string;
    keptTitle: (n: number) => string;
    keptNote: string;
    closeTitle: string;
    closeSub: string;
    finish: string;
    queued: string;
    readTitle: string;
    readKept: string;
    choiceWords: Record<'schedule' | 'mine' | 'skip' | 'planonly', string>;
    back: string;
}

const MR: SeasonReviewWords = {
    entryTitle: 'हंगाम संपला', // PROPOSED (Marathi)
    entrySub: 'पुढच्या हंगामासाठी तुमचं शेड्यूल ठरवा. एकदाच विचारतो.', // PROPOSED (Marathi)
    entryOpen: 'पुढच्या वर्षीचं शेड्यूल', // PROPOSED (Marathi)
    entryQueued: 'तुमची उत्तरं फोनवर ठेवली आहेत. नेट आल्यावर पाठवली जातील.', // PROPOSED (Marathi)
    entryAnswered: 'पुढच्या हंगामाचं शेड्यूल ठरलं आहे.', // PROPOSED (Marathi)
    entryRead: 'उत्तरं पाहा', // PROPOSED (Marathi)
    title: 'माझं शेड्यूल', // DESIGN
    chip: 'हंगामाच्या शेवटी', // DESIGN
    originLine: origin => `मूळ: ${origin ?? 'तुम्ही स्वतः'} · मालक: तुम्ही`, // DESIGN
    askLine: name => `${name}: पुढच्या वर्षी?`, // DESIGN
    scheduleLabel: 'शेड्यूलप्रमाणे', // DESIGN
    mineLabel: 'मी केलं तसं', // DESIGN
    skipLabel: 'नको', // DESIGN
    expectedLine: (from, to) => (to !== null && to !== from ? `शेड्यूलमध्ये: दिवस ${toDevanagariDigits(from)} ते ${toDevanagariDigits(to)}` : `शेड्यूलमध्ये: दिवस ${toDevanagariDigits(from)}`), // PROPOSED (Marathi)
    recordedLine: (day, date) => `तुमच्या नोंदीत: दिवस ${toDevanagariDigits(day)} (${toDevanagariDigits(date)})`, // PROPOSED (Marathi)
    partLine: 'हे काम काही वेळा झालं, सगळ्या वेळा नाही.', // PROPOSED (Marathi)
    noRecordLine: 'याची नोंद नाही.', // PROPOSED (Marathi)
    sourceOwn: 'स्रोत: तुमचं शेड्यूल', // PROPOSED (Marathi)
    sourceRecord: 'स्रोत: तुमची नोंद', // PROPOSED (Marathi)
    planOnlyTitle: 'फक्त नियोजन केलं होतं', // PROPOSED (Marathi)
    planOnlySub: 'ही कामं तुमच्या शेड्यूलमध्ये नव्हती. तुम्ही निवडलीत तरच पुढे घेतली जातील.', // PROPOSED (Marathi)
    planOnlyTake: 'पुढे घ्या', // PROPOSED (Marathi)
    keptTitle: n => `उत्तर न दिलेली कामं: ${toDevanagariDigits(n)}`, // PROPOSED (Marathi)
    keptNote: 'ती शेड्यूलप्रमाणेच पुढे घेतली जातील.', // PROPOSED (Marathi)
    closeTitle: 'हेच माझं शेड्यूल', // DESIGN
    closeSub: 'पुढच्या वर्षी यातूनच नियोजन.', // DESIGN
    finish: 'पुढे घ्या', // PROPOSED (Marathi)
    queued: 'ठेवलं. नेट आल्यावर पाठवलं जाईल.', // PROPOSED (Marathi)
    readTitle: 'तुम्ही दिलेली उत्तरं', // PROPOSED (Marathi)
    readKept: 'उत्तर न दिल्यामुळे शेड्यूलप्रमाणे घेतलं', // PROPOSED (Marathi)
    choiceWords: { schedule: 'शेड्यूलप्रमाणे', mine: 'मी केलं तसं', skip: 'नको', planonly: 'पुढे घेतलं' },
    back: 'मागे', // PROPOSED (Marathi)
};

const EN: SeasonReviewWords = {
    entryTitle: 'The season has ended',
    entrySub: 'Decide your schedule for next season. You are asked once.',
    entryOpen: "Next year's schedule",
    entryQueued: 'Your answers are kept on this phone. They go when the net is back.',
    entryAnswered: "Next season's schedule is set.",
    entryRead: 'See the answers',
    title: 'My schedule',
    chip: 'At the end of the season',
    originLine: origin => `Origin: ${origin ?? 'you yourself'} · Owner: you`,
    askLine: name => `${name}: next year?`,
    scheduleLabel: 'As scheduled',
    mineLabel: 'As I did it',
    skipLabel: 'Not needed',
    expectedLine: (from, to) => (to !== null && to !== from ? `In the schedule: day ${from} to ${to}` : `In the schedule: day ${from}`),
    recordedLine: (day, date) => `In your record: day ${day} (${date})`,
    partLine: 'This work was done some times, not every time.',
    noRecordLine: 'There is no record of this.',
    sourceOwn: 'Source: your schedule',
    sourceRecord: 'Source: your record',
    planOnlyTitle: 'Only planned',
    planOnlySub: 'These works were not in your schedule. They are carried only if you pick them.',
    planOnlyTake: 'Carry it',
    keptTitle: n => `${n} works were not answered`,
    keptNote: 'They are carried as scheduled.',
    closeTitle: 'This is my schedule',
    closeSub: 'Next year, planning starts from this.',
    finish: 'Carry on',
    queued: 'Kept. It goes when the net is back.',
    readTitle: 'Your answers',
    readKept: 'Not answered, so carried as scheduled',
    choiceWords: { schedule: 'As scheduled', mine: 'As I did it', skip: 'Not needed', planonly: 'Carried' },
    back: 'Back',
};

export const SEASON_REVIEW_WORDS: Record<OwnLanguage, SeasonReviewWords> = { mr: MR, en: EN };
