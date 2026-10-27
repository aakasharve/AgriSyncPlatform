/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I15; inventory S7, S8)
 *
 * The झालं list. First, expected vs done for THIS stage: one bar per part split into done (green) and missed
 * (red), a summary line and a tappable strip of the recent days. "Partly" is not drawn — what it means is
 * open (PLR-D8 decision A). A part the stage never expected says "—", not 0/0 (P4).
 * Then the days already gone, newest first: date, the microphone count from THIS phone's recordings, each
 * expected part with झालं / राहिलं, and anything done that was not asked (जास्तीचं); older days on request.
 * Tapping a day opens its day sheet.
 */
import React, { useState } from 'react';
import { ChevronRight, Mic } from 'lucide-react';
import { dayDateLabel } from './scheduleDates';
import { SC } from './scheduleCopy';
import { PART_LABEL, PARTS, dayVerdict, extrasOn, type ScheduleDay, type Tally, type Part } from './scheduleModel';
import { GLASS, PART_TINT, PartIcon, StatusChip } from './scheduleUi';

export const STRIP_DAYS = 8;
const PAGE = 3;
const MORE = 7;

export const CompareCard: React.FC<{ total: Tally; byPart: Record<Part, Tally>; strip: readonly ScheduleDay[]; clipCount: (key: string) => number; onDay: (key: string) => void }> = ({ total, byPart, strip, clipCount, onDay }) => (
    <section className={`rounded-3xl p-4 ${GLASS}`} data-testid="compare-card">
        <h3 className="m-0 text-[19px] font-black leading-snug text-stone-900">{SC.compareTitle}</h3>
        <p className="m-0 mt-1 text-[15px] font-bold text-stone-700" data-testid="compare-summary">
            {total.expected === 0
                ? `${SC.expectedWord} —`
                : `${SC.expectedWord} ${total.expected} · ${SC.doneWord} ${total.done} · ${SC.missedWord} ${total.missed}`}
            {total.extra ? ` · ${SC.extraWord} ${total.extra}` : ''}
        </p>
        <div className="mt-3 space-y-3">
            {PARTS.map(p => {
                const t = byPart[p];
                return (
                    <div key={p} data-testid={`cmp-${p}`} data-expected={t.expected} data-done={t.done} data-missed={t.missed}>
                        <div className="flex items-center justify-between gap-2 text-[16px] font-extrabold text-stone-900">
                            <span className="inline-flex items-center gap-2"><PartIcon part={p} />{PART_LABEL[p]}</span>
                            <span className="text-stone-700" data-testid={`cmp-${p}-text`}>
                                {t.expected === 0 ? '—' : `${t.done}/${t.expected} ${SC.doneWord}`}{t.extra ? ` · +${t.extra} ${SC.extraWord}` : ''}
                            </span>
                        </div>
                        <div className="mt-1.5 flex h-4 gap-[2px] overflow-hidden rounded-full bg-stone-200" aria-hidden="true" data-testid={`cmp-${p}-bar`}>
                            {t.done > 0 && <span className="bg-emerald-600" data-seg="done" style={{ flexGrow: t.done, flexBasis: 0 }} />}
                            {t.missed > 0 && <span className="bg-red-500" data-seg="missed" style={{ flexGrow: t.missed, flexBasis: 0 }} />}
                        </div>
                    </div>
                );
            })}
        </div>
        {strip.length > 0 && (
            <>
                <p className="m-0 mb-1.5 mt-4 text-[15px] font-extrabold text-stone-700">{SC.lastDays}</p>
                <div className="flex gap-1.5" data-testid="day-strip">
                    {strip.map(d => {
                        const v = dayVerdict(d);
                        const cls = v === 'allDone' ? 'bg-emerald-600 text-white' : v === 'missed' ? 'bg-red-500 text-white' : v === 'mixed' ? 'bg-amber-400 text-stone-900' : 'bg-stone-200 text-stone-600';
                        return (
                            <button key={d.key} type="button" onClick={() => onDay(d.key)} data-testid={`strip-${d.key}`} data-verdict={v} aria-label={`${SC.dayN(d.day)} · ${dayDateLabel(d.key)}`}
                                className={`flex min-h-[52px] min-w-0 flex-1 flex-col items-center justify-center rounded-xl text-[15px] font-extrabold ${cls}`}>
                                {d.day}{clipCount(d.key) > 0 && <Mic size={12} aria-hidden="true" />}
                            </button>
                        );
                    })}
                </div>
            </>
        )}
    </section>
);

export const PastDayRow: React.FC<{ day: ScheduleDay; clips: number; onOpen: (key: string) => void }> = ({ day, clips, onOpen }) => {
    const expected = PARTS.filter(p => day.cells[p].items.length > 0);
    const extras = extrasOn(day);
    return (
        <li className="list-none" data-testid={`past-${day.key}`}>
            <button type="button" onClick={() => onOpen(day.key)} data-testid={`open-day-${day.key}`} className={`flex w-full items-start gap-3 rounded-2xl p-3 text-left active:bg-white ${GLASS}`}>
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-stone-800 text-[18px] font-extrabold text-white">{day.day}</span>
                <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2 text-[15px] font-extrabold text-stone-800">
                        {dayDateLabel(day.key)}
                        {day.prep && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[13px] text-amber-900" data-testid={`prep-${day.key}`}>{SC.prep}</span>}
                        {clips > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[14px] text-emerald-900" data-testid={`clipcount-${day.key}`}><Mic size={13} aria-hidden="true" />{clips}</span>}
                    </span>
                    <span className="mt-1.5 flex flex-wrap gap-1.5">
                        {expected.map(p => (
                            <span key={p} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[14px] font-bold text-stone-800" style={{ background: PART_TINT[p] }} data-testid={`past-${day.key}-${p}`} data-status={day.cells[p].status}>
                                {PART_LABEL[p]}<StatusChip status={day.cells[p].status} />
                            </span>
                        ))}
                        {extras.map(p => (
                            <span key={`x-${p}`} className="inline-flex items-center gap-1.5 rounded-lg bg-sky-50 px-2 py-1 text-[14px] font-bold text-sky-950" data-testid={`past-${day.key}-${p}`} data-status="extra">
                                {PART_LABEL[p]}<StatusChip status="extra" />
                            </span>
                        ))}
                        {expected.length === 0 && extras.length === 0 && <span className="text-[14px] font-bold text-stone-500">—</span>}
                    </span>
                </span>
                <ChevronRight size={22} className="mt-3 shrink-0 text-stone-500" aria-hidden="true" />
            </button>
        </li>
    );
};

export const DoneTab: React.FC<{
    total: Tally;
    byPart: Record<Part, Tally>;
    past: readonly ScheduleDay[];
    clipCount: (key: string) => number;
    onOpenDay: (key: string) => void;
}> = ({ total, byPart, past, clipCount, onOpenDay }) => {
    const [shown, setShown] = useState(PAGE);
    const strip = past.slice(0, STRIP_DAYS).reverse();
    const rows = past.slice(0, shown);
    return (
        <>
            <CompareCard total={total} byPart={byPart} strip={strip} clipCount={clipCount} onDay={onOpenDay} />
            <section data-testid="before">
                <h3 className="m-0 mb-2 text-[20px] font-black text-emerald-900">✓ {SC.before}</h3>
                {past.length === 0 && <p className="m-0 text-[16px] font-bold text-stone-600" data-testid="no-past">{SC.noPastDays}</p>}
                {shown < past.length && (
                    <button type="button" onClick={() => setShown(n => n + MORE)} data-testid="show-older"
                        className="mb-2 min-h-[52px] w-full rounded-2xl border-2 border-dashed border-stone-400 bg-white/60 text-[16px] font-extrabold text-stone-800">↑ {SC.showOlder}</button>
                )}
                <ul className="m-0 space-y-2 p-0">{[...rows].reverse().map(d => <PastDayRow key={d.key} day={d} clips={clipCount(d.key)} onOpen={onOpenDay} />)}</ul>
            </section>
        </>
    );
};
