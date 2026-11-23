/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 5, "Own schedule feeds नियोजन") - the farmer's words on a plan made from his OWN schedule: where it
 * came from, why it has no date yet, the day it was expected, and the question about a sign with its three answers. One language at a time (Marathi mode shows
 * only Marathi, with Devanagari digits; English mode only English). "माझ्या शेड्यूलमधून" is the brief's word; every other Marathi line is PROPOSED
 * (G:\agrisync-scratch\sched5\MARATHI-WORDS.md) until the founder approves it. No emoji and no "AI" wording. A sign seen is never "done", and no answer is never
 * "not yet": the words never say so.
 */
import type { ScheduleSignAnswerName } from '../../infrastructure/storage/plannedWorkRow';

export interface ScheduleFeedWords {
    fromMySchedule: string;
    /** A "when seen" work whose sign nobody has said is seen. */
    waitingSign: string;
    /** A work that comes after another, whose earlier work is not recorded yet. */
    waitingAfter: string;
    expected: (date: string) => string;
    signQuestion: (signWords: string | null) => string;
    answer: Record<ScheduleSignAnswerName, string>;
    lastAnswer: (answer: string) => string;
    answerKept: string;
}

const MR: ScheduleFeedWords = {
    fromMySchedule: 'माझ्या शेड्यूलमधून',
    waitingSign: 'खूण दिसण्याची वाट', // PROPOSED (Marathi)
    waitingAfter: 'आधीचं काम नोंदल्यावर तारीख ठरेल', // PROPOSED (Marathi)
    expected: date => `अपेक्षित: ${date}`, // PROPOSED (Marathi)
    signQuestion: signWords => (signWords ? `${signWords} — दिसलं का?` : 'खूण दिसली का?'), // PROPOSED (Marathi)
    answer: { seen: 'हो, दिसलं', not_yet: 'अजून नाही', unsure: 'खात्री नाही' }, // PROPOSED (Marathi)
    lastAnswer: answer => `शेवटचं उत्तर: ${answer}`, // PROPOSED (Marathi)
    answerKept: 'उत्तर फोनवर ठेवलं — नेट आल्यावर पाठवलं जाईल', // PROPOSED (Marathi)
};

const EN: ScheduleFeedWords = {
    fromMySchedule: 'From my schedule',
    waitingSign: 'Waiting for the sign', // PROPOSED (English)
    waitingAfter: 'Dated once the earlier work is recorded', // PROPOSED (English)
    expected: date => `Expected: ${date}`, // PROPOSED (English)
    signQuestion: signWords => (signWords ? `${signWords} — seen?` : 'Is the sign seen?'), // PROPOSED (English)
    answer: { seen: 'Yes, seen', not_yet: 'Not yet', unsure: 'Not sure' }, // PROPOSED (English)
    lastAnswer: answer => `Last answer: ${answer}`, // PROPOSED (English)
    answerKept: 'Answer kept on this phone — it is sent when the internet is back', // PROPOSED (English)
};

export function scheduleFeedWords(language: string | null | undefined): ScheduleFeedWords {
    return language === 'en' ? EN : MR;
}

/** A YYYY-MM-DD day as the farmer reads it: Devanagari digits in Marathi mode, never a raw date string. */
export function feedDay(iso: string, language: string | null | undefined): string {
    const [y, m, d] = iso.split('-').map(Number);
    if (!y || !m || !d) return iso;
    try {
        return new Intl.DateTimeFormat(language === 'en' ? 'en-IN' : 'mr-IN-u-nu-deva', { day: 'numeric', month: 'short' }).format(new Date(y, m - 1, d));
    } catch {
        return iso;
    }
}
