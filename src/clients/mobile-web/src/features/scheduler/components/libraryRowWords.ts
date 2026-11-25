/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-final-polish - the words on the schedule library's rows (and its search, order and empty line) in BOTH languages: Marathi mode shows
 * Marathi only, English mode English only. The Marathi is the words the library always had (read from `scheduleCopy`, never re-typed); the English
 * twins are all PROPOSED (English).
 */
import { OWNER_LABEL, SC, frequencyMr, mrNum, opNameMr, stageNameMr } from '../schedulePage/scheduleCopy';
import { PART_LABEL, type Part } from '../schedulePage/scheduleModel';
import { taskNameMr } from '../schedulePage/scheduleNames';
import type { ScheduleOwnerType } from '../scheduler.types';
import type { ScheduleMapLanguage } from '../schedulePage/scheduleMapCopy';

export interface LibraryRowWords {
    madeBy: string;
    owner: Readonly<Record<ScheduleOwnerType, string>>;
    /** "Total days 41 · Stages 2" */
    meta: (days: number | null, stages: number) => string;
    checked: string;
    notChecked: string;
    sampleWillHide: (crop: string) => string;
    searchPlaceholder: string;
    empty: string;
    orderUsual: string;
    orderShort: string;
    view: string;
    back: string;
    useThis: string;
    /** The stages sheet ("View"): a stage's name, its days, a task's name, the schedule's own name for it, how often / on which day. */
    stageName: (name: string) => string;
    days: (from: number, to: number) => string;
    dayN: (day: number) => string;
    frequency: (mode: string, value: number) => string;
    opLabel: (opId: string, part: Part) => string;
    ownTaskName: (notes: string) => string;
}

const EN_OP: Readonly<Record<string, string>> = {
    op_irrig_drip: 'Drip irrigation', // PROPOSED (English)
    op_irrig_flood: 'Flood irrigation', // PROPOSED (English)
    op_fert_gen: 'Soluble fertiliser (through drip)', // PROPOSED (English)
    op_spray_gen: 'Spray', // PROPOSED (English)
    op_weed_man: 'Weeding', // PROPOSED (English)
    op_pruning: 'Pruning', // PROPOSED (English)
    op_thinning: 'Thinning', // PROPOSED (English)
    op_harvest: 'Harvest', // PROPOSED (English)
    op_pest_scout: 'Pest check', // PROPOSED (English)
    op_field_prep: 'Field preparation', // PROPOSED (English)
    op_drainage_audit: 'Check water drainage', // PROPOSED (English)
    op_gap_fill: 'Fill gaps', // PROPOSED (English)
    op_earthing_up: 'Earthing up', // PROPOSED (English)
    op_growth_check: 'Check growth', // PROPOSED (English)
    op_quality_check: 'Check quality', // PROPOSED (English)
    op_harvest_plan: 'Harvest planning', // PROPOSED (English)
    op_post_harvest_cleanup: 'Clean-up after harvest', // PROPOSED (English)
    op_phi_watch: 'Check the days to wait after spraying', // PROPOSED (English)
};
const EN_PART: Readonly<Record<Part, string>> = {
    irrigation: 'Irrigation', // PROPOSED (English)
    nutrition: 'Fertiliser', // PROPOSED (English)
    spray: 'Spraying', // PROPOSED (English)
    work: 'Work', // PROPOSED (English)
};

const MR: LibraryRowWords = {
    madeBy: SC.madeBy,
    owner: OWNER_LABEL,
    meta: SC.edMeta,
    checked: SC.checkedByShramSafal,
    notChecked: SC.notCheckedByShramSafal,
    sampleWillHide: SC.sampleWillHide,
    searchPlaceholder: 'शेड्यूल किंवा बनवणाऱ्याचं नाव शोधा',
    empty: 'तुमच्या पिकांसाठी अजून एकही शेड्यूल आलेलं नाही. इंटरनेट चालू असताना ॲप उघडा.',
    orderUsual: 'नेहमीचा क्रम',
    orderShort: 'कमी दिवसांचं आधी',
    view: 'पाहा',
    back: 'मागे',
    useThis: 'हे शेड्यूल वापरा',
    stageName: stageNameMr,
    days: (from, to) => `${SC.dayN(from)}–${mrNum(to)}`,
    dayN: SC.dayN,
    frequency: frequencyMr,
    opLabel: (opId, part) => opNameMr(opId) ?? PART_LABEL[part],
    ownTaskName: taskNameMr,
};

const EN: LibraryRowWords = {
    madeBy: 'Made by', // PROPOSED (English)
    owner: {
        EXPERT: 'Expert', // PROPOSED (English)
        INSTITUTION: 'Institution', // PROPOSED (English)
        USER: 'Made by the farmer himself', // PROPOSED (English)
        SYSTEM_DEFAULT: "The app's own schedule", // PROPOSED (English)
    },
    meta: (days, stages) => `Total days ${days === null ? '—' : days} · Stages ${stages}`, // PROPOSED (English)
    checked: 'Checked by ShramSafal', // PROPOSED (English)
    notChecked: 'Not yet checked by ShramSafal', // PROPOSED (English)
    sampleWillHide: crop => `Once the first checked ${crop} schedule arrives, this one will no longer be shown for a new choice. If you already follow it, it stays.`, // PROPOSED (English)
    searchPlaceholder: 'Search by schedule or maker name', // PROPOSED (English)
    empty: 'No schedule has come for your crops yet. Open the app while the internet is on.', // PROPOSED (English)
    orderUsual: 'Usual order', // PROPOSED (English)
    orderShort: 'Fewer days first', // PROPOSED (English)
    view: 'View', // PROPOSED (English)
    back: 'Back', // PROPOSED (English)
    useThis: 'Use this schedule', // PROPOSED (English)
    stageName: name => name, // the schedule's own stage name, as written
    days: (from, to) => `Day ${from}–${to}`, // PROPOSED (English)
    dayN: day => `Day ${day}`, // PROPOSED (English)
    frequency: (mode, value) => (mode === 'PER_WEEK' ? `${value} ${value === 1 ? 'time' : 'times'} a week` : `Every ${value} ${value === 1 ? 'day' : 'days'}`), // PROPOSED (English)
    opLabel: (opId, part) => EN_OP[opId] ?? EN_PART[part], // PROPOSED (English)
    ownTaskName: notes => notes.trim(),
};

export const libraryRowWords = (language: ScheduleMapLanguage | string | null | undefined): LibraryRowWords => (language === 'en' ? EN : MR);

/** The check's date in the screen's language, Latin digits, unreadable dates left out. */
export function checkDateIn(iso: string | undefined, language: ScheduleMapLanguage | string | null | undefined): string | null {
    if (!iso) return null;
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) return null;
    try {
        return new Intl.DateTimeFormat(language === 'en' ? 'en-IN' : 'mr-IN-u-nu-latn', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(at);
    } catch {
        return at.toISOString().slice(0, 10);
    }
}
