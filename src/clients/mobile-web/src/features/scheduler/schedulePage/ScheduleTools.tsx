/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I15; inventory S2 "keep every real feature")
 *
 * Everything the old शेड्यूल page did that is not the schedule itself, kept and said in Marathi:
 *   - the risk card ("Risk rising / Stable") — now its facts in words, from the SAME `computeDayState` numbers
 *     and thresholds (`SPRAY_RISK_DAYS`, `IRRIGATION_RISK_DAYS`); the stage-overdue signal is the आधी राहिलेलं
 *     काम list above, so it is not repeated here. The old green "Stable — execution is aligned" line is not
 *     drawn: it could say "all fine" beside a non-empty आधी राहिलेलं काम (two true surfaces, one false
 *     impression — the founder's one-all-clear ruling, `oneAllClearSurface.test.tsx`);
 *   - last spray / last irrigation ("Last Action Memory");
 *   - today's spend, tapping it opens MoneyLens (as the old MoneyChip did) — "—" when nothing was spent (P4);
 *   - Close Day (opens the waiting drawer, as before);
 *   - the doors to the library (+ adopt), the schedule editor and the day-by-day grid.
 * A door whose handler the page did not get is not drawn (P5).
 */
import React from 'react';
import { CalendarRange, Layers, Settings, TableProperties } from 'lucide-react';
import { GlassCard, RowLink, SectionHead, Tap } from '../../../shared/components/ui/placeUi';
import { IRRIGATION_RISK_DAYS, SPRAY_RISK_DAYS, type DayState } from '../../../shared/utils/dayState';
import { rupees } from '../../finance/moneyLabels';
import { SC } from './scheduleCopy';

/** The risk lines in Marathi, from the day state's own numbers. Empty = nothing to warn about. */
export function riskLines(state: Pick<DayState, 'pendingCount' | 'lastActions'>): string[] {
    const out: string[] = [];
    if (state.pendingCount > 0) out.push(SC.pendingToday(state.pendingCount));
    const spray = state.lastActions.sprayDaysAgo;
    if (spray !== null && spray > SPRAY_RISK_DAYS) out.push(SC.sprayGap(spray));
    const water = state.lastActions.irrigationDaysAgo;
    if (water !== null && water > IRRIGATION_RISK_DAYS) out.push(SC.waterGap(water));
    return out;
}

const lastLabel = (days: number | null) => (days === null ? SC.noRecordYet : SC.daysAgo(days));

export const ScheduleTools: React.FC<{
    dayState: Pick<DayState, 'pendingCount' | 'lastActions'>;
    todaySpend: number;
    onOpenMoney: () => void;
    onCloseDay?: () => void;
    libraryCount: number;
    onLibrary?: () => void;
    onEditor?: () => void;
    onGrid?: () => void;
}> = ({ dayState, todaySpend, onOpenMoney, onCloseDay, libraryCount, onLibrary, onEditor, onGrid }) => {
    const risks = riskLines(dayState);
    return (
        <section className="space-y-2.5" data-testid="sched-tools">
            <SectionHead title={SC.toolsTitle} />
            {risks.length > 0 && (
                <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900" data-testid="risk-card">
                    <p className="m-0 text-[16px] font-black">{SC.riskTitle}</p>
                    <ul className="m-0 mt-1 list-disc space-y-0.5 pl-5">{risks.map(r => <li key={r} className="text-[15px] font-bold">{r}</li>)}</ul>
                </div>
            )}
            <GlassCard testId="last-actions">
                <div className="grid grid-cols-2 gap-2.5">
                    <div className="rounded-2xl bg-stone-50 p-3 ring-1 ring-stone-200">
                        <p className="m-0 text-[14px] font-bold text-stone-600">{SC.lastSpray}</p>
                        <p className="m-0 mt-1 text-[17px] font-black text-stone-900" data-testid="last-spray">{lastLabel(dayState.lastActions.sprayDaysAgo)}</p>
                    </div>
                    <div className="rounded-2xl bg-stone-50 p-3 ring-1 ring-stone-200">
                        <p className="m-0 text-[14px] font-bold text-stone-600">{SC.lastWater}</p>
                        <p className="m-0 mt-1 text-[17px] font-black text-stone-900" data-testid="last-water">{lastLabel(dayState.lastActions.irrigationDaysAgo)}</p>
                    </div>
                </div>
                <Tap onClick={onOpenMoney} data-testid="today-spend"
                    className="mt-2.5 flex min-h-[52px] w-full items-center justify-between rounded-2xl bg-emerald-50 px-3 text-left ring-1 ring-emerald-200">
                    <span className="text-[15px] font-extrabold text-emerald-900">{SC.todaySpend}</span>
                    <span className="text-[17px] font-black text-emerald-800" data-testid="today-spend-amount">{todaySpend > 0 ? rupees(todaySpend) : '—'}</span>
                </Tap>
                {onCloseDay && (
                    <Tap onClick={onCloseDay} data-testid="close-day"
                        className="mt-2.5 flex min-h-[52px] w-full items-center justify-center rounded-full bg-stone-900 px-5 text-[16px] font-extrabold text-white">
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
