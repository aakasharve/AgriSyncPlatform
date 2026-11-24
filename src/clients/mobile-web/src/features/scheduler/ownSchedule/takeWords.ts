/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 9, "One take with origin kept") - the words of "माझ्या वेळापत्रकात घ्या", one language at a time
 * (Marathi mode Marathi only, English mode English only). Every Marathi line is PROPOSED (G:\agrisync-scratch\sched9\MARATHI-WORDS.md) until the founder
 * approves it. No emoji, no "AI" wording. "Taken" is never "done" and never "planned": it says only that the work is in the farmer's own schedule.
 */
import type { OwnLanguage } from './ownScheduleWords';

export interface TakeWords {
    take: string;
    pickDose: string;
    notNow: string;
    queued: string;
    taken: string;
    takeBack: string;
    refusedOff: string;
    refusedSource: string;
    refusedNotAllowed: string;
    refusedInUse: string;
    refusedOther: string;
    openConflicts: string;
}

const MR: TakeWords = {
    take: 'माझ्या वेळापत्रकात घ्या', // PROPOSED (Marathi)
    pickDose: 'कोणता डोस घ्यायचा?', // PROPOSED (Marathi)
    notNow: 'आत्ता नाही', // the done sheet's own word
    queued: 'घेतलं. नेट आल्यावर पाठवलं जाईल.', // PROPOSED (Marathi)
    taken: 'माझ्या वेळापत्रकात आहे', // PROPOSED (Marathi)
    takeBack: 'परत काढा', // PROPOSED (Marathi)
    refusedOff: 'या शेतासाठी स्वतःचं शेड्यूल अजून सुरू झालेलं नाही. हे काम घेतलं गेलं नाही.', // PROPOSED (Marathi)
    refusedSource: 'हे शेड्यूल आता वापरात नाही, म्हणून हे काम घेता आलं नाही.', // PROPOSED (Marathi)
    refusedNotAllowed: 'हे काम माझ्या वेळापत्रकात घेण्याची परवानगी तुम्हाला नाही.', // PROPOSED (Marathi)
    refusedInUse: 'माझ्या वेळापत्रकात याच नावाचं काम आधीच आहे.', // PROPOSED (Marathi)
    refusedOther: 'हे काम घेता आलं नाही.', // PROPOSED (Marathi)
    openConflicts: 'काय झालं ते पाहा', // PROPOSED (Marathi)
};

const EN: TakeWords = {
    take: 'Take into my schedule', // PROPOSED (English)
    pickDose: 'Which dose do you take?', // PROPOSED (English)
    notNow: 'Not now',
    queued: 'Taken. Sent when the internet is back.', // PROPOSED (English)
    taken: 'In my schedule', // PROPOSED (English)
    takeBack: 'Take it back out', // PROPOSED (English)
    refusedOff: 'Your own schedule is not switched on for this farm yet. This work was not taken.', // PROPOSED (English)
    refusedSource: 'This schedule is no longer in use, so this work could not be taken.', // PROPOSED (English)
    refusedNotAllowed: 'You may not take this work into the schedule.', // PROPOSED (English)
    refusedInUse: 'A work with this name is already in my schedule.', // PROPOSED (English)
    refusedOther: 'This work could not be taken.', // PROPOSED (English)
    openConflicts: 'See what happened', // PROPOSED (English)
};

export const TAKE_WORDS: Readonly<Record<OwnLanguage, TakeWords>> = { mr: MR, en: EN };

/** The words for a refused take, by the server's code (the take-specific reason rides on its message, which the parked row keeps). */
export function takeRefusalWords(words: TakeWords, code: string | null | undefined, message?: string | null): string {
    if (code?.endsWith('ScheduleMechanismOff')) return words.refusedOff;
    if (code?.endsWith('Forbidden')) return words.refusedNotAllowed;
    if (message?.includes('TakeKeyInUse')) return words.refusedInUse;
    if (message?.includes('TakeSourceWithdrawn') || message?.includes('TakeSourceNotFollowed')) return words.refusedSource;
    return words.refusedOther;
}
