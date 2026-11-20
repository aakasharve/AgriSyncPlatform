/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I15; inventory S2 "keep every real feature")
 *
 * Everything the old शेड्यूल page did that is not the schedule itself, kept and said in Marathi:
 *   - the open-work lines (the old "Risk rising / Stable" card, V2-01). "आज N कामं बाकी" is the page's OWN
 *     count of today's open schedule tasks (`dueTodayCount`, the आज card's lines), never `computeDayState`'s
 *     `pendingCount`: that one still reads the app's built-in stand-in schedule, repeats the last stage after
 *     the end and counts a weekly task every day, so it said "आज 1 कामं बाकी" under "no schedule" (V2-01).
 *     The farmer's own to-do tasks that count keep a line of their own (same rule as `pendingCount`'s task
 *     half, `getTaskCompletion`). spec: plr-d10 lane HONESTY-1 (H10; P4): the amber "काम मागे पडतंय" (work is
 *     falling behind) title and colour, and the "फवारणी / पाणी देऊन N दिवस झाले" lines are GONE - they asserted
 *     lateness from two thresholds (10 days for a spray, 3 for water) that are the same for every crop. The
 *     last-spray / last-water tiles below already show those facts, without a verdict. What is left is two plain
 *     counts, in a plain box. The old green "Stable — execution is aligned" line is not drawn either: it could say "all fine" beside a non-empty आधी राहिलेलं काम (two true
 *     surfaces, one false impression — the founder's one-all-clear ruling, `oneAllClearSurface.test.tsx`);
 *   - last spray / last irrigation ("Last Action Memory");
 *   - today's spend, tapping it opens MoneyLens (as the old MoneyChip did) — "—" when nothing was spent (P4);
 *   - Close Day (opens the waiting drawer, as before);
 *   - the doors to the library (+ adopt), the schedule editor and the day-by-day grid.
 * A door whose handler the page did not get is not drawn (P5).
 */
import React from 'react';
import { CalendarRange, Layers, Settings, TableProperties } from 'lucide-react';
import { GlassCard, RowLink, Tap } from '../../../shared/components/ui/placeUi';
import type { DayState } from '../../../shared/utils/dayState';
import { rupees } from '../../finance/moneyLabels';
import { SC } from './scheduleCopy';

/** What the open-work lines and the last-action tiles read. */
export interface ToolsFacts {
    /** Today's open schedule tasks (`dueTodayCount`); 0 with no schedule, before day 0 and after the end. */
    dueToday: number;
    /** The farmer's own to-do tasks for this plot still open, due today or earlier (`getTaskCompletion`). */
    tasksOpen: number;
    lastActions: DayState['lastActions'];
}

/** The open-work lines in Marathi: two plain counts, no verdict. Empty = nothing open to say. */
export function openWorkLines(state: ToolsFacts): string[] {
    const out: string[] = [];
    if (state.dueToday > 0) out.push(SC.pendingToday(state.dueToday));
    if (state.tasksOpen > 0) out.push(SC.tasksOpen(state.tasksOpen));
    return out;
}

const lastLabel = (days: number | null) => (days === null ? SC.noRecordYet : SC.daysAgo(days));

export const ScheduleTools: React.FC<{
    facts: ToolsFacts;
    todaySpend: number;
    onOpenMoney: () => void;
    onCloseDay?: () => void;
    libraryCount: number;
    onLibrary?: () => void;
    onEditor?: () => void;
    onGrid?: () => void;
}> = ({ facts, todaySpend, onOpenMoney, onCloseDay, libraryCount, onLibrary, onEditor, onGrid }) => {
    const open = openWorkLines(facts);
    return (
        <section className="space-y-2.5" data-testid="sched-tools">
            {open.length > 0 && (
                // H10 (HONESTY-1): the same plain box as the tiles below - no amber, no "work is falling behind" title.
                <ul className="m-0 list-disc space-y-0.5 rounded-2xl bg-stone-50 py-3 pl-8 pr-4 ring-1 ring-stone-200" data-testid="open-work">
                    {open.map(r => <li key={r} className="text-[15px] font-bold text-stone-800">{r}</li>)}
                </ul>
            )}
            <GlassCard testId="last-actions">
                <div className="grid grid-cols-2 gap-2.5">
                    <div className="rounded-2xl bg-stone-50 p-3 ring-1 ring-stone-200">
                        <p className="m-0 text-[14px] font-bold text-stone-600">{SC.lastSpray}</p>
                        <p className="m-0 mt-1 text-[17px] font-black text-stone-900" data-testid="last-spray">{lastLabel(facts.lastActions.sprayDaysAgo)}</p>
                    </div>
                    <div className="rounded-2xl bg-stone-50 p-3 ring-1 ring-stone-200">
                        <p className="m-0 text-[14px] font-bold text-stone-600">{SC.lastWater}</p>
                        <p className="m-0 mt-1 text-[17px] font-black text-stone-900" data-testid="last-water">{lastLabel(facts.lastActions.irrigationDaysAgo)}</p>
                    </div>
                </div>
                <Tap onClick={onOpenMoney} data-testid="today-spend"
                    className="mt-2.5 flex min-h-[52px] w-full items-center justify-between rounded-2xl bg-emerald-50 px-3 text-left ring-1 ring-emerald-200">
                    <span className="text-[15px] font-extrabold text-emerald-900">{SC.todaySpend}</span>
                    <span className="text-[17px] font-black text-emerald-800" data-testid="today-spend-amount">{todaySpend > 0 ? rupees(todaySpend) : '—'}</span>
                </Tap>
                {onCloseDay && (
                    <Tap onClick={onCloseDay} data-testid="close-day"
                        className="mt-2.5 flex min-h-[52px] w-full items-center justify-center rounded-full bg-emerald-600 px-5 text-[16px] font-extrabold text-white">
                        <CalendarRange size={18} className="mr-2" aria-hidden="true" />{SC.closeDay}
                    </Tap>
                )}
            </GlassCard>
            {onLibrary && <RowLink icon={<Layers size={22} aria-hidden="true" />} tone="green" title={SC.library} line={SC.libraryLine(libraryCount)} onClick={onLibrary} testId="open-library" />}
            {onEditor && <RowLink icon={<Settings size={22} aria-hidden="true" />} tone="amber" title={SC.editor} line={SC.editorLine} onClick={onEditor} testId="open-editor" />}
            {onGrid && <RowLink icon={<TableProperties size={22} aria-hidden="true" />} tone="blue" title={SC.grid} line={SC.gridLine} onClick={onGrid} testId="open-grid" />}
        </section>
    );
};
