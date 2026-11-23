/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 6, "the plan door") - the words of "plan this work" on "माझं शेड्यूल", one language at a time
 * (Marathi mode Marathi only, English mode English only). Every Marathi line is PROPOSED (G:\agrisync-scratch\sched6\MARATHI-WORDS.md) until the founder
 * approves it; the who chips reuse the planning form's own words. No emoji, no "AI" wording, no digits.
 */
import type { OwnLanguage } from './ownScheduleWords';

export interface OwnWorkPlanWords {
    plan: string;
    whoQ: string;
    notNow: string;
    planned: string;
    plannedKept: string;
    done: string;
    refusedOff: string;
    refusedNotAllowed: string;
    refusedOther: string;
}

const MR: OwnWorkPlanWords = {
    plan: 'नियोजन करा', // PROPOSED (Marathi)
    whoQ: 'कोण करणार?', // PROPOSED (Marathi)
    notNow: 'आत्ता नाही', // the done sheet's own word
    planned: 'नियोजनात आहे', // PROPOSED (Marathi)
    plannedKept: 'नियोजन फोनवर ठेवलं. नेट आल्यावर पाठवलं जाईल.', // PROPOSED (Marathi)
    done: 'हे काम झालं', // PROPOSED (Marathi)
    refusedOff: 'या शेतासाठी स्वतःचं शेड्यूल अजून सुरू झालेलं नाही. नियोजन पाठवलं गेलं नाही.', // PROPOSED (Marathi)
    refusedNotAllowed: 'हे काम तुम्हाला दुसऱ्याला देता येत नाही. स्वतःसाठी नियोजन करा.', // PROPOSED (Marathi)
    refusedOther: 'हे नियोजन पाठवता आलं नाही.', // PROPOSED (Marathi)
};

const EN: OwnWorkPlanWords = {
    plan: 'Plan it', // PROPOSED (English)
    whoQ: 'Who will do it?', // PROPOSED (English)
    notNow: 'Not now',
    planned: 'In the plan', // PROPOSED (English)
    plannedKept: 'Plan kept on this phone. Sent when the internet is back.', // PROPOSED (English)
    done: 'This work is done', // PROPOSED (English)
    refusedOff: 'Your own schedule is not switched on for this farm yet. The plan was not sent.', // PROPOSED (English)
    refusedNotAllowed: 'You cannot give this work to someone else. Plan it for yourself.', // PROPOSED (English)
    refusedOther: 'This plan could not be sent.', // PROPOSED (English)
};

export const OWN_WORK_PLAN_WORDS: Readonly<Record<OwnLanguage, OwnWorkPlanWords>> = { mr: MR, en: EN };

/** The words for a refused plan, by the server's code. */
export function refusalWords(words: OwnWorkPlanWords, code: string | null | undefined): string {
    if (code?.endsWith('ScheduleMechanismOff')) return words.refusedOff;
    if (code?.endsWith('Forbidden') || code?.endsWith('AssigneeNotMember') || code?.endsWith('AssigneeOutsidePlots')) return words.refusedNotAllowed;
    return words.refusedOther;
}
