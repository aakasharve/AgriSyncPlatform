/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane UI-8; founder D-150, pictures S3 and L2) - every word the picture map, the owner bar and
 * the three-step library say, in BOTH languages (Marathi mode shows Marathi only, English mode English only).
 *
 * Where each word comes from:
 *   - PICTURE - the founder's `DESIGN-OPTIONS-HOME-OVERVIEW-SCHEDULE.html` (read-only sample drawings), Marathi verbatim:
 *     शेड्यूल बनवणारे, शेड्यूल नाही, शेड्यूल निवडा, कोणत्या प्लॉटसाठी?, कोणतं शेड्यूल?, पक्कं करा, "<plot> साठी हे शेड्यूल लावा", नवीन शेड्यूल बनवा.
 *   - PROPOSED - written for this lane; each carries `// PROPOSED (Marathi)` / `// PROPOSED (English)`. The English twins are all PROPOSED.
 * No emoji. Nothing here says "AI".
 */
import { toDevanagariDigits } from '../../../shared/utils/marathiDigits';

export type ScheduleMapLanguage = 'mr' | 'en';

interface Words {
    /** The small label on the owner bar. */
    ownerLabel: string;
    /** The label of the plain-text owner type beside a real name ("संस्था" / "तज्ज्ञ"). */
    ownerTypeAria: string;
    /** The dashed group of plots that follow no schedule. */
    noScheduleGroup: string;
    chooseSchedule: string;
    /** "दिवस 102" on a plot's card. */
    dayN: (n: number) => string;
    /** A plot whose schedule has not started yet. */
    dayNotStarted: string;
    mapAria: string;
    plotsAria: string;
    schedulesAria: string;
    /** A crop that has no plot yet (the map has nothing to draw for it). */
    cropNoPlots: (crop: string) => string;
    /** "तुम्ही इथे आहात" is the page's; this is the map's own word for the plot whose details are open. */
    openBelow: string;
    /** a line's accessible name */
    lineAria: (plot: string, schedule: string) => string;
    /** a plot that also follows other schedules (3 + 1) */
    alsoFollows: (n: number) => string;
    /** library, three steps */
    step1: string;
    step2: string;
    step3: string;
    confirm: (plot: string) => string;
    confirmAdd: (plot: string) => string;
    confirmNeedsPick: string;
    makeNew: string;
    makeNewHint: string;
    inUse: string;
    noPlotsToPick: string;
}

export const SCHEDULE_MAP_WORDS: Readonly<Record<ScheduleMapLanguage, Words>> = {
    mr: {
        ownerLabel: 'शेड्यूल बनवणारे', // PICTURE
        ownerTypeAria: 'बनवणाऱ्याचा प्रकार', // PROPOSED (Marathi)
        noScheduleGroup: 'शेड्यूल नाही', // PICTURE
        chooseSchedule: 'शेड्यूल निवडा', // PICTURE
        dayN: n => `दिवस ${toDevanagariDigits(n)}`, // the page's own phrase (`SC.dayN`); Marathi digits (UI-9a item 9), English below keeps 0-9
        dayNotStarted: 'अजून सुरू नाही', // PROPOSED (Marathi)
        mapAria: 'कोणत्या प्लॉटला कोणतं शेड्यूल', // PROPOSED (Marathi)
        plotsAria: 'प्लॉट', // PROPOSED (Marathi)
        schedulesAria: 'शेड्यूल', // PROPOSED (Marathi)
        cropNoPlots: crop => `${crop}: या पिकात अजून प्लॉट नाही`, // PROPOSED (Marathi) - the page's own line (`SC.noPlots`) with the crop's name
        openBelow: 'खाली उघडलं आहे', // PROPOSED (Marathi)
        lineAria: (plot, schedule) => `${plot} — ${schedule}`, // PROPOSED (Marathi)
        alsoFollows: n => `+${toDevanagariDigits(n)} शेड्यूल`, // PROPOSED (Marathi); Marathi digits (UI-9a item 9)
        step1: 'कोणत्या प्लॉटसाठी?', // PICTURE
        step2: 'कोणतं शेड्यूल?', // PICTURE
        step3: 'पक्कं करा', // PICTURE
        confirm: plot => `${plot} साठी हे शेड्यूल लावा`, // PICTURE
        confirmAdd: plot => `${plot} साठी हे शेड्यूल पण पाळा`, // PROPOSED (Marathi) - the "3 + 1" button's own words ("हे शेड्यूल पण पाळा") with the plot named
        confirmNeedsPick: 'आधी वरून एक शेड्यूल निवडा', // PROPOSED (Marathi)
        makeNew: 'नवीन शेड्यूल बनवा', // PICTURE
        makeNewHint: 'नियोजन पानावर जाईल', // PICTURE ("(नियोजन पानावर जाईल)")
        inUse: 'वापरात आहे', // the library's own word
        noPlotsToPick: 'अजून एकही प्लॉट नाही', // PROPOSED (Marathi)
    },
    en: {
        ownerLabel: 'Schedule made by', // PROPOSED (English)
        ownerTypeAria: 'Kind of maker', // PROPOSED (English)
        noScheduleGroup: 'No schedule', // PROPOSED (English)
        chooseSchedule: 'Choose a schedule', // PROPOSED (English) - same as the 3 + 1 first-choice word
        dayN: n => `Day ${n}`, // PROPOSED (English)
        dayNotStarted: 'Not started yet', // PROPOSED (English)
        mapAria: 'Which plot follows which schedule', // PROPOSED (English)
        plotsAria: 'Plots', // PROPOSED (English)
        schedulesAria: 'Schedules', // PROPOSED (English)
        cropNoPlots: crop => `${crop}: no plot in this crop yet`, // PROPOSED (English)
        openBelow: 'Open below', // PROPOSED (English)
        lineAria: (plot, schedule) => `${plot} — ${schedule}`, // PROPOSED (English)
        alsoFollows: n => `+${n} schedules`, // PROPOSED (English)
        step1: 'For which plot?', // PROPOSED (English)
        step2: 'Which schedule?', // PROPOSED (English)
        step3: 'Confirm', // PROPOSED (English)
        confirm: plot => `Use this schedule for ${plot}`, // PROPOSED (English)
        confirmAdd: plot => `Follow this one too for ${plot}`, // PROPOSED (English)
        confirmNeedsPick: 'Pick a schedule above first', // PROPOSED (English)
        makeNew: 'Make a new schedule', // PROPOSED (English)
        makeNewHint: 'goes to the planning page', // PROPOSED (English)
        inUse: 'In use', // PROPOSED (English)
        noPlotsToPick: 'No plot yet', // PROPOSED (English)
    },
};

export const scheduleMapWords = (language: string | null | undefined): Words => SCHEDULE_MAP_WORDS[language === 'en' ? 'en' : 'mr'];
