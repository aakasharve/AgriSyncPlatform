/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I15; inventory S12) — the पुढे list: what the schedule
 * expects in the next 3 or 8 days (a toggle; the founder asked for "3 to 8 days at most", PLR-D8 §1.3),
 * each day's tasks grouped in the four parts. Days with nothing expected are left out.
 */
import React, { useState } from 'react';
import { addDays, dayDateLabel } from './scheduleDates';
import { SC } from './scheduleCopy';
import { upcomingDays, type ScheduleModel } from './scheduleModel';
import { GLASS, PartGroup } from './scheduleUi';

export const AheadTab: React.FC<{ model: ScheduleModel; onlyStageId?: string | null }> = ({ model, onlyStageId }) => {
    const [win, setWin] = useState<3 | 8>(8);
    // spec: plr-d10 lane SCH-GATE-b (R10) - in the trial only today's stage's days are laid open (`onlyStageId`); absent = every stage.
    const days = upcomingDays(model, win, onlyStageId);
    const tomorrowKey = addDays(model.todayKey, 1);
    return (
        <section data-testid="ahead">
            <div className="mb-2.5 flex items-center justify-between gap-2">
                <h3 className="m-0 text-[20px] font-black text-stone-900">→ {SC.ahead}</h3>
                <div className="inline-flex overflow-hidden rounded-full border-2 border-stone-400" role="group">
                    {([3, 8] as const).map(n => (
                        <button key={n} type="button" aria-pressed={win === n} onClick={() => setWin(n)} data-testid={`win-${n}`}
                            className={`min-h-[48px] px-4 text-[16px] font-extrabold ${win === n ? 'bg-[#1448E6] text-white' : 'bg-white/80 text-stone-800'}`}>{n === 3 ? SC.next3 : SC.next8}</button>
                    ))}
                </div>
            </div>
            {days.length === 0 && <p className="m-0 text-[16px] font-bold text-stone-600" data-testid="nothing-ahead">{SC.nothingAhead}</p>}
            <div className="space-y-3">
                {days.map(d => (
                    <article key={d.key} className={`rounded-3xl p-3.5 ${GLASS}`} data-testid={`ahead-${d.key}`}>
                        <p className="m-0 mb-2 text-[18px] font-black text-stone-900">{SC.dayN(d.day)} · {d.key === tomorrowKey ? `${SC.tomorrow} · ` : ''}{dayDateLabel(d.key)}</p>
                        <PartGroup items={d.items} statusOf={p => d.cells[p].status} testId={`ahead-${d.key}-parts`} />
                    </article>
                ))}
            </div>
        </section>
    );
};
