/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 16, phone half; doctrine P8) - the words that mark a timer box filled from his speech.
 * Marathi mode Marathi only, English mode English only. PROPOSED Marathi (not yet founder-approved): see G:\agrisync-scratch\sched16\MARATHI-WORDS.md.
 */
import type { OwnLanguage } from '../ownScheduleWords';

export interface SpokenTimerWords {
    /** The mark on a box he did not type. */
    fromWords: string;
    /** The words it was heard from, beside the mark. */
    heardLine: (heard: string) => string;
}

export const SPOKEN_TIMER_WORDS: Readonly<Record<OwnLanguage, SpokenTimerWords>> = {
    mr: { fromWords: 'बोलण्यातून', heardLine: heard => `ऐकलेले शब्द: “${heard}”` }, // PROPOSED
    en: { fromWords: 'From your words', heardLine: heard => `Heard: “${heard}”` },
};
