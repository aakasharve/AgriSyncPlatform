/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * dfesPreviousLog — pure "what the farmer actually did last time" signal
 * (Task 7).
 *
 * Founder ruling 3 (2026-08-14): a question must be context-rich. The engine
 * already receives weather, stage, a schedule gap and an open observation;
 * the one thing it had NO input for was the farmer's own previous log. This
 * module supplies it, from the real ledger the caller already holds.
 *
 * ANTI-FABRICATION (P4): every field is read off a real prior log or the whole
 * context is null. There is no default, no "probably a spray", no invented
 * day count — no prior log means no previous-log clause in the question.
 *
 * HONEST GRANULARITY (same rule as dfesScheduleWindow.ts): a log's own
 * activity titles are free voice text and may be in any language, so this
 * never quotes them. It reports the CATEGORY the day's work falls into,
 * spoken with the SAME Marathi labels the app already ships
 * (dfesScheduleWindow.CATEGORY_LABEL_MR) — reused verbatim, never invented —
 * and classified with the SAME executed-count logic dayState.ts already uses.
 *
 * Deleted logs are already excluded upstream: every repository read path
 * filters them (`isDeleted`/`!log.deletion` in DexieLogsRepository /
 * LocalStorageLogsRepository), so the history handed to this module never
 * contains one and it does not re-filter (same assumption computeScheduleGap
 * makes about the same array).
 *
 * PURE: no Date.now(), no network, no React/DOM. todayLocalDate is passed in.
 *
 * spec: dfes-farmer-facing-deploy-readiness-2026-08-14 (task-7)
 */
import type { DailyLog } from '../../../types';
import { CATEGORY_LABEL_MR, type OperationCategory } from './dfesScheduleWindow';
import { getExecutionCountByCategory } from '../../../shared/utils/dayState';

/** What the farmer did on their most recent prior working day, and how long ago. */
export interface PreviousLogContext {
    /** Marathi category label, verbatim from CATEGORY_LABEL_MR — never a quoted activity title. */
    activityMr: string;
    /** Whole days between that log's date and today. Always >= 1 (today is never "last time"). */
    daysAgo: number;
}

/**
 * Which single category best describes a day that recorded several kinds of
 * work. Same spray-first ordering dfesScheduleWindow uses for its gap pick,
 * and for the same reason: a spray is the most specific, most memorable thing
 * a farmer did that day, general activity the least.
 */
const CATEGORY_ORDER: readonly OperationCategory[] = ['FOLIAR_SPRAY', 'FERTIGATION', 'IRRIGATION', 'ACTIVITY'];

const normalizeDateKey = (value: string): string => (value.includes('T') ? value.split('T')[0] : value);

/** Whole days from `dateKey` to `todayLocalDate`, or NaN when either key is not a real 'YYYY-MM-DD'. */
function daysBefore(dateKey: string, todayLocalDate: string): number {
    const toUtc = (key: string): number => {
        const [year, month, day] = key.split('-').map(Number);
        if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return NaN;
        return Date.UTC(year, month - 1, day);
    };
    return (toUtc(todayLocalDate) - toUtc(dateKey)) / 86_400_000;
}

/**
 * The most recent log BEFORE `todayLocalDate` that actually recorded work,
 * scoped to `plotId` when one is given (the plot the farmer just logged
 * against), or null when there is nothing true to refer to.
 */
export function computePreviousLog(
    history: DailyLog[],
    plotId: string | null,
    todayLocalDate: string,
): PreviousLogContext | null {
    const priorLogs = history
        .filter(log => normalizeDateKey(log.date) < todayLocalDate)
        .filter(log => !plotId || (log.context?.selection ?? []).some(
            selection => (selection.selectedPlotIds || []).includes(plotId),
        ))
        .sort((a, b) => normalizeDateKey(b.date).localeCompare(normalizeDateKey(a.date)));

    for (const log of priorLogs) {
        const category = CATEGORY_ORDER.find(candidate => getExecutionCountByCategory([log], candidate) > 0);
        if (!category) continue; // an honest no-work day has nothing to refer back to
        const daysAgo = daysBefore(normalizeDateKey(log.date), todayLocalDate);
        if (!Number.isFinite(daysAgo) || daysAgo < 1) continue; // unparseable date — say nothing rather than guess
        return { activityMr: CATEGORY_LABEL_MR[category], daysAgo };
    }

    return null;
}
