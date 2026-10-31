/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lane FX-1 — founder instruction ATT-LOG (2026-10-31, register F81): on the log page the हजेरी card stays EMPTY, with
 * big text, until today's work AND how many people worked have both been told; it shows which of the two is still
 * missing. What it reads, and nothing else:
 *
 *   - THE HEADCOUNT is the हजेरी rule itself — "No anchor → no mic" (`resolveLabourAnchor` over the day's stored logs,
 *     for the day a capture made now is filed under). `todaysLabourAnchor` below is that ONE call; the हजेरी route's
 *     gate (`simpleRoutes.tsx renderLabourRoute`) makes the same call, so the card and the screen cannot disagree. When
 *     several entries state a count the rule adds them, as the हजेरी screen does today; names are never counted into
 *     a number. A count nobody has confirmed yet is carried as provisional (D-46) and the card says so.
 *   - THE WORK is what the day's entries say was done: a crop job (not one recorded as still to do or missed), water,
 *     sprays / fertiliser, machines, or a job named on a labour row. A rest day declared with no work, an observation, an
 *     expense or a plan is not work done.
 *
 * Pure: no React, no storage. The card (`TodayAttendanceCard`) turns it into words in his language.
 */
import type { DailyLog } from '../../../../types';
import { resolveLabourAnchor, type LabourAnchor } from '../../../labour/labourAnchor';
import { attendanceCaptureDay } from '../../attendanceDraft';

/** The parts of a day that are work done but carry no job name of their own (a crop job with no name is 'crop'). */
export type UnnamedWorkPart = 'crop' | 'irrigation' | 'inputs' | 'machinery';

export interface DayWork {
    /** Job names as stored (the parser's English, or his own words), first told first, each once. */
    names: string[];
    /** Work told with no job name: an unnamed crop job, water, sprays / fertiliser, machines. */
    parts: UnnamedWorkPart[];
    /** Where the first of it was done, as the entry names it. */
    place: { cropId: string; cropName: string; plotNames: string[] } | null;
}

export interface TodayAttendance {
    /** Today's work as told; null = not told yet. */
    work: DayWork | null;
    /** How many people, by the हजेरी rule; null = not told yet (never 0 for "not told"). */
    headcount: number | null;
    /** The count comes (in part) from an entry nobody has confirmed yet (D-46): shown, and marked so. */
    provisional: boolean;
}

/** THE day's हजेरी anchor: the stored logs of the day a capture made now is filed under. One call, two readers. */
export function todaysLabourAnchor(history: readonly DailyLog[]): LabourAnchor {
    return resolveLabourAnchor(history, attendanceCaptureDay(null));
}

/** A crop job recorded as still to do, or as missed, is not work done (the schedule's own rule, `scheduleModel.notAGap`). */
const done = (status?: string): boolean => status !== 'pending' && status !== 'gap_recorded';

/** The work these entries say was done, or null when they say none. */
export function workOf(logs: readonly DailyLog[]): DayWork | null {
    const names: string[] = [];
    const seen = new Set<string>();
    const parts: UnnamedWorkPart[] = [];
    let place: DayWork['place'] = null;
    const addName = (raw: string | undefined) => {
        const name = (raw ?? '').trim();
        const key = name.toLowerCase();
        if (!name || seen.has(key)) return;
        seen.add(key);
        names.push(name);
    };
    const addPart = (part: UnnamedWorkPart) => { if (!parts.includes(part)) parts.push(part); };

    for (const log of logs) {
        if (log.deletion) continue;
        const before = names.length + parts.length;
        for (const job of log.cropActivities ?? []) {
            if (!done(job.status)) continue;
            const typed = (job.workTypes ?? []).filter(w => w.trim());
            if (typed.length > 0) typed.forEach(addName);
            else if (job.title?.trim()) addName(job.title);
            else addPart('crop');
        }
        for (const row of log.labour ?? []) addName(row.activity);
        if ((log.irrigation ?? []).length > 0) addPart('irrigation');
        if ((log.inputs ?? []).length > 0) addPart('inputs');
        if ((log.machinery ?? []).length > 0) addPart('machinery');
        if (!place && names.length + parts.length > before) {
            const sel = log.context?.selection?.[0];
            if (sel) place = { cropId: sel.cropId, cropName: sel.cropName ?? '', plotNames: (sel.selectedPlotNames ?? []).filter(Boolean) };
        }
    }
    return names.length + parts.length > 0 ? { names, parts, place } : null;
}

/** The log page's card: today's work and today's headcount, each told or not. */
export function todayAttendance(history: readonly DailyLog[]): TodayAttendance {
    const day = attendanceCaptureDay(null);
    const anchor = todaysLabourAnchor(history);
    return {
        work: workOf(history.filter(l => l.date === day)),
        headcount: anchor.state === 'anchored' ? anchor.headcount : null,
        provisional: anchor.state === 'anchored' && anchor.provisional === true,
    };
}

/**
 * The result screen after he speaks: the same empty card, only when THIS entry (today's) states work but no
 * headcount, and the day has no headcount from an earlier entry either. Otherwise null (no card).
 */
export function entryAttendance(entryLogs: readonly DailyLog[], history: readonly DailyLog[]): TodayAttendance | null {
    const day = attendanceCaptureDay(null);
    const mine = entryLogs.filter(l => l.date === day && !l.deletion);
    const work = workOf(mine);
    if (!work) return null;
    if (resolveLabourAnchor(mine, day).state === 'anchored') return null;
    if (todaysLabourAnchor(history).state === 'anchored') return null;
    return { work, headcount: null, provisional: false };
}
