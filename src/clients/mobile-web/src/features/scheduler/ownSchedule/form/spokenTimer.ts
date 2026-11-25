/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 16, phone half; F215; doctrine P4, P8, P9) - what the timer he SPOKE does to the one-work draft,
 * and which boxes it filled (so each says "बोलण्यातून" with the heard words). Pure: no React.
 *   - day: the shown day goes through `shownScheduleDay` (never computed by hand);
 *   - after: the days are kept; the work is picked ONLY when exactly one other work of this schedule matches the words he named - otherwise it is left
 *     unpicked (the one thing then asked, P9);
 *   - sign: the sign words.
 * Nothing is saved here; the draft only holds what he will see and may change.
 */
import type { SpokenTimer } from '../../../plannedWork/data/planVoice';
import { shownScheduleDay } from '../../schedulePage/scheduleDates';
import type { WorkDraft } from './workDraft';

export interface SpokenMarks {
    heardWords: string;
    from?: boolean;
    afterWork?: boolean;
    afterDays?: boolean;
    sign?: boolean;
}

const norm = (s: string): string => s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();

/** The key of the ONE work whose shown name matches the words he named; null when none or two or more match. */
export function matchOneWork(words: string, anchors: ReadonlyArray<{ key: string; name: string }>): string | null {
    const w = norm(words);
    if (!w) return null;
    const hits = anchors.filter(a => { const n = norm(a.name); return n.length > 0 && (n === w || n.includes(w) || w.includes(n)); });
    return hits.length === 1 ? hits[0].key : null;
}

export function applySpokenTimer(t: SpokenTimer, anchors: ReadonlyArray<{ key: string; name: string }>): { patch: Partial<WorkDraft>; marks: SpokenMarks } {
    if (t.kind === 'day') {
        return { patch: { when: 'day', dayBefore: false, fromShown: shownScheduleDay(t.fromDay) }, marks: { heardWords: t.heardWords, from: true } };
    }
    if (t.kind === 'after') {
        const key = matchOneWork(t.afterWorkWords, anchors);
        return {
            patch: { when: 'after', usualDays: t.usualDays, ...(key ? { afterKey: key } : {}) },
            marks: { heardWords: t.heardWords, afterDays: true, ...(key ? { afterWork: true } : {}) },
        };
    }
    return { patch: { when: 'sign', signWords: t.signWords }, marks: { heardWords: t.heardWords, sign: true } };
}

/** A box he changes is no longer "from his words": the mark goes away from it (changing the kind of timer clears them all). */
export function marksAfterEdit(marks: SpokenMarks | null, patch: Partial<WorkDraft>): SpokenMarks | null {
    if (!marks) return null;
    if ('when' in patch) return null;
    const next: SpokenMarks = { ...marks };
    if ('fromShown' in patch || 'dayBefore' in patch) delete next.from;
    if ('afterKey' in patch) delete next.afterWork;
    if ('usualDays' in patch) delete next.afterDays;
    if ('signWords' in patch) delete next.sign;
    return next.from || next.afterWork || next.afterDays || next.sign ? next : null;
}
