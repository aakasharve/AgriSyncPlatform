/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I15; inventory S6, S12)
 *
 * The आज list: first "आधी राहिलेलं काम" (computed by `owedWork` — expected on an earlier day, its part not done
 * since; never typed in), then today's card with every task the schedule expects today grouped in the four
 * parts (each already marked झालं when a log today covers its part), then a peek at tomorrow.
 */
import React from 'react';
import { Pin } from 'lucide-react';
import { SC } from './scheduleCopy';
import { PART_LABEL, type OwedEntry, type ScheduleDay } from './scheduleModel';
import { GLASS, PartGroup, StatusChip } from './scheduleUi';

export const OwedCard: React.FC<{ owed: readonly OwedEntry[]; onOpenDay: (key: string) => void }> = ({ owed, onOpenDay }) => (
    <section className="rounded-3xl border-2 border-red-300 bg-red-50/80 p-4 backdrop-blur-sm" data-testid="owed-card" data-count={owed.length}>
        <h3 className="m-0 text-[20px] font-black text-red-900">{SC.owedTitle}</h3>
        {owed.length === 0 ? <p className="m-0 mt-1 text-[16px] font-bold text-stone-700" data-testid="nothing-owed">{SC.nothingOwed}</p> : (
            <>
                <p className="m-0 mb-2 text-[15px] font-bold text-red-900">{SC.owedSub}</p>
                <ul className="m-0 space-y-1.5 p-0">
                    {owed.map(o => (
                        <li key={o.id} className="list-none">
                            <button type="button" onClick={() => onOpenDay(o.lastKey)} data-testid={`owed-${o.part}`}
                                className="flex w-full flex-wrap items-center gap-2 rounded-2xl bg-white/90 px-3 py-2.5 text-left active:bg-white">
                                <StatusChip status="missed" />
                                <span className="min-w-0 flex-1 text-[17px] font-extrabold text-stone-900">
                                    {o.title}
                                    {o.detail && <span className="block text-[15px] font-bold text-stone-700">{o.detail}</span>}
                                </span>
                                <span className="w-full text-[14px] font-bold text-red-800">
                                    {o.times > 1 ? `${SC.since(o.firstDay)} · ${SC.times(o.times)}` : SC.dayN(o.lastDay)} · {PART_LABEL[o.part]}
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
            </>
        )}
    </section>
);

export const TodayTab: React.FC<{
    owed: readonly OwedEntry[];
    today: ScheduleDay | undefined;
    tomorrow: ScheduleDay | undefined;
    totalDays: number | null;
    onOpenDay: (key: string) => void;
    onSeeAhead: () => void;
}> = ({ owed, today, tomorrow, totalDays, onOpenDay, onSeeAhead }) => (
    <>
        <OwedCard owed={owed} onOpenDay={onOpenDay} />
        {today && (
            <section className="rounded-3xl border-2 border-[#1448E6] bg-[#1448E6]/5 p-4 backdrop-blur-sm" data-testid="today-card">
                <p className="m-0 inline-flex items-center gap-1.5 rounded-full bg-[#1448E6] px-3.5 py-1.5 text-[15px] font-extrabold text-white">
                    <Pin size={15} aria-hidden="true" />{SC.here} · {SC.today} · {totalDays !== null ? SC.dayOf(today.day, totalDays) : SC.dayN(today.day)}
                </p>
                {today.items.length === 0
                    ? <p className="m-0 mt-2 text-[16px] font-bold text-stone-700" data-testid="today-nothing">{SC.nothingToday}</p>
                    : (
                        <>
                            <p className="m-0 mb-3 mt-2 text-[16px] font-bold text-stone-800">{SC.expectsToday}</p>
                            <PartGroup items={today.items} statusOf={p => today.cells[p].status} testId="today-parts" />
                        </>
                    )}
            </section>
        )}
        {tomorrow && (
            <section className={`rounded-3xl p-4 ${GLASS}`} data-testid="tomorrow-peek">
                <p className="m-0 mb-2 text-[18px] font-black text-stone-900">→ {SC.tomorrow} · {SC.dayN(tomorrow.day)}</p>
                {tomorrow.items.length === 0
                    ? <p className="m-0 text-[16px] font-bold text-stone-700">{SC.noExpectation}</p>
                    : <PartGroup items={tomorrow.items} statusOf={p => tomorrow.cells[p].status} testId="tomorrow-parts" />}
                <button type="button" onClick={onSeeAhead} data-testid="see-ahead" className="mt-3 min-h-[52px] w-full rounded-full border-2 border-stone-500 bg-white/80 text-[16px] font-extrabold text-stone-900">{SC.seeAhead} →</button>
            </section>
        )}
    </>
);
