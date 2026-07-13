/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * taskAutoClose — pure "suggest-and-confirm task close" matcher (Task 5,
 * "राहिलं → झालं", spec: dfes-companion-2026-07-11).
 *
 * When a farmer logs an activity that PLAUSIBLY matches an open pending task,
 * Sathi offers a one-tap confirm to close it. This module ONLY finds the
 * candidate(s) — it NEVER flips a task's status itself. Task titles and
 * activity titles are fuzzy free text, so a silent auto-done would risk a
 * wrong "done", which for this trust-first product is worse than a lingering
 * task. The farmer's own तap (होय) is the only thing that closes a task —
 * see `TaskCloseConfirm.tsx`.
 *
 * CONSERVATIVE MATCH RULE — a task is a candidate ONLY when ALL hold:
 *   1. task.status is open ('pending' | 'in_progress' | 'suggested').
 *   2. Same plot: task.plotId is one of the saved log's
 *      context.selection[].selectedPlotIds (exact string match). Never
 *      cross-plot.
 *   3. Due window: task.dueDate is set AND due-or-overdue (<= today) AND not
 *      staler than TASK_CLOSE_STALE_DAYS days before today. A task with no
 *      dueDate is NOT a candidate — too ambiguous.
 *   4. Title match: normalized substring-containment between task.title and
 *      ANY of the saved log's cropActivities[].title.
 *
 * Title-containment mirrors ONLY the tier-1 name-based match in
 * features/compare/plotComparisonService.ts's matchItems() (not exported,
 * so reimplemented here at the same tier-1 scope: normalize + `a.includes(b)
 * || b.includes(a)`). We deliberately do NOT reuse its tier-2 positional/
 * date-order fallback — that fallback pairs UNRELATED items by index/date
 * order alone, which would risk closing a task that has nothing to do with
 * the logged activity. There is no positional fallback here at all.
 *
 * PURE: no Date.now(), no network, no React. `todayLocalDate` is passed in
 * by the caller (mirrors dfesScheduleWindow.ts's contract).
 */
import type { DailyLog, PlannedTask } from '../../../types';

export interface TaskCloseCandidate {
    task: PlannedTask;
    matchedActivityTitle: string;
}

/**
 * Founder-tunable: a due-or-overdue task more than this many days in the past
 * is too stale to safely suggest a close for — the farmer's memory of it (and
 * its relevance to today's activity) has likely drifted too far. Client-only
 * constant (this feature has no backend component today); tune here if the
 * founder wants a wider/narrower window.
 */
export const TASK_CLOSE_STALE_DAYS = 21;

const OPEN_STATUSES: ReadonlySet<PlannedTask['status']> = new Set(['pending', 'in_progress', 'suggested']);

// Same date-key normalization dfesScheduleWindow.ts already uses locally
// (dayState.ts's own normalizeDateKey isn't exported) — strips a trailing
// 'T...' time component so 'YYYY-MM-DD' and 'YYYY-MM-DDTHH:mm:ss' compare/sort
// identically.
const normalizeDateKey = (value: string): string => (value.includes('T') ? value.split('T')[0] : value);

/** Day-count between two date keys (from - to), both taken at local noon to dodge DST edges. Mirrors dayState.ts's getDaysBetween (unexported). */
const daysBetween = (fromDateKey: string, toDateKey: string): number => {
    const toNoon = (key: string) => new Date(`${key}T12:00:00`).getTime();
    return Math.round((toNoon(fromDateKey) - toNoon(toDateKey)) / (1000 * 60 * 60 * 24));
};

const normalizeTitle = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Tier-1 containment ONLY — mirrors plotComparisonService.ts's matchItems()
 * name-based match (`execName.includes(planName) || planName.includes(execName)`
 * after `.toLowerCase()`). No positional/date-order fallback (see module doc).
 */
const titlesContain = (a: string, b: string): boolean => {
    const normA = normalizeTitle(a);
    const normB = normalizeTitle(b);
    if (!normA || !normB) return false;
    return normA.includes(normB) || normB.includes(normA);
};

/**
 * Returns every open task from `openTasks` that is a CONSERVATIVE candidate
 * for a one-tap close, given the just-saved `savedLog`. Deterministic order
 * (by dueDate then title). Returns [] when there is nothing safe to suggest
 * (including when savedLog is undefined, or logs no plot/activity titles).
 */
export function findConfirmableTaskCloses(
    openTasks: PlannedTask[],
    savedLog: DailyLog | undefined,
    todayLocalDate: string,
): TaskCloseCandidate[] {
    if (!savedLog) return [];

    const loggedPlotIds = new Set(
        (savedLog.context?.selection ?? []).flatMap(sel => sel.selectedPlotIds || []),
    );
    if (loggedPlotIds.size === 0) return [];

    const activityTitles = (savedLog.cropActivities || [])
        .map(activity => activity.title)
        .filter((title): title is string => Boolean(title && title.trim()));
    if (activityTitles.length === 0) return [];

    const todayKey = normalizeDateKey(todayLocalDate);
    const seenTaskIds = new Set<string>();
    const candidates: TaskCloseCandidate[] = [];

    for (const task of openTasks) {
        if (seenTaskIds.has(task.id)) continue;
        if (!OPEN_STATUSES.has(task.status)) continue;
        if (!loggedPlotIds.has(task.plotId)) continue;
        if (!task.dueDate) continue;

        const dueDateKey = normalizeDateKey(task.dueDate);
        if (dueDateKey > todayKey) continue; // future — not due yet
        if (daysBetween(todayKey, dueDateKey) > TASK_CLOSE_STALE_DAYS) continue; // too stale

        const matchedActivityTitle = activityTitles.find(title => titlesContain(task.title, title));
        if (!matchedActivityTitle) continue;

        seenTaskIds.add(task.id);
        candidates.push({ task, matchedActivityTitle });
    }

    return candidates.sort((a, b) => {
        const byDueDate = (a.task.dueDate || '').localeCompare(b.task.dueDate || '');
        if (byDueDate !== 0) return byDueDate;
        return a.task.title.localeCompare(b.task.title);
    });
}
