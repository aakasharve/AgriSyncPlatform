/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 13, phone half; design version 7; P4) - "कोणाची पद्धत फॉलो होते": the rule first, then ONE card per schedule on this
 * plot's tiles: who made it (for ShramSafal's schedule the source named as TEXT, never a logo), "X / Y शेतकरी फॉलो करतात", "A / B कामं घेतली (P%)", one line per work the server
 * listed, then "done" and "heard" on their own lines apart from following. Every number is the server's, drawn as sent; a number the server did not send is not drawn, and the card
 * says in ONE sentence that fewer than five farmers stand behind it. A sample says it is a sample; an own schedule says it has no totals. With no signal the last answer seen with
 * signal is drawn and says so in words (no machine date).
 */
import React, { useEffect, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { useBackDismiss } from '../../../core/navigation/useBackDismiss';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import { dayCardWords } from '../dayCards/dayCardWords';
import { loadDayCards, type DayCardsLoad } from '../dayCards/dayCardsStore';
import type { DayCardsDetail } from '../dayCards/dayCardsTypes';
import { madeByLine, scheduleSources } from '../dayCards/sourceLines';
import { scheduleNameIn } from '../schedulePage/scheduleNames';
import type { ScheduleTotals, TotalsLoad } from './scheduleTotalsStore';
import { totalsWords, type TotalsWords } from './totalsWords';
import { useScheduleTotals } from './useScheduleTotals';

/** One schedule of the plot's tiles: any version id of it, its name when the page knows it, and its source as the catalog holds it. */
export interface TotalsScheduleRef { templateId: string; name?: string | null; sourceLabel?: string | null }

const Line: React.FC<{ id: string; children: React.ReactNode; strong?: boolean }> = ({ id, children, strong }) => (
    <p className={`m-0 text-[15px] leading-snug text-stone-900 ${strong ? 'font-extrabold' : 'font-bold'}`} data-testid={id}>{children}</p>
);

const TotalsLines: React.FC<{ id: string; totals: ScheduleTotals; words: TotalsWords }> = ({ id, totals: t, words }) => (
    <>
        <Line id={`totals-following-${id}`} strong>
            {t.following !== null
                ? words.followingLine(t.following, t.having)
                : <>{t.having !== null ? `${words.havingOnly(t.having)} ` : words.followingLabel}{words.fewer}</>}
        </Line>
        {t.worksTaken !== null && <Line id={`totals-works-taken-${id}`}>{words.worksTaken(t.worksTaken, t.worksInSchedule, t.worksTakenPercent)}</Line>}
        {t.works.length > 0 && (
            <ul className="m-0 list-none space-y-1 p-0" data-testid={`totals-work-list-${id}`}>
                {t.works.map(w => <li key={w.taskKey} className="text-[14.5px] font-bold text-stone-800">{words.workLine(w.name, w.farmers)}</li>)}
            </ul>
        )}
        <p className="m-0 border-t border-stone-200 pt-2 text-[13px] font-extrabold text-stone-500" data-testid={`totals-separate-${id}`}>{words.separate}</p>
        <Line id={`totals-done-${id}`}>{t.doneJobs !== null ? words.done(t.doneJobs) : <>{words.doneLabel}{words.fewer}</>}</Line>
        <Line id={`totals-heard-${id}`}>{t.heard !== null ? words.heard(t.heard) : <>{words.heardLabel}{words.fewer}</>}</Line>
    </>
);

const makerNote = (detail: DayCardsDetail | null, ref: TotalsScheduleRef, language: 'mr' | 'en', words: TotalsWords): string | null => {
    if (!detail) return null;
    const dc = dayCardWords(language);
    const made = madeByLine(detail, dc);
    if (detail.kind === 'own') return words.madeBy(made);
    if (made === dc.source.platform) return words.madeShramSafal(ref.sourceLabel ?? scheduleSources(detail)[0] ?? null);
    return words.madeBy(made);
};

const TotalsCard: React.FC<{ schedule: TotalsScheduleRef; state: 'loading' | TotalsLoad; language: 'mr' | 'en'; loadDetail: (id: string) => Promise<DayCardsLoad> }> = ({ schedule, state, language, loadDetail }) => {
    const words = totalsWords(language);
    const id = schedule.templateId;
    const [detail, setDetail] = useState<DayCardsDetail | null>(null);
    useEffect(() => {
        let alive = true;
        void Promise.resolve().then(() => loadDetail(id)).then(r => { if (alive) setDetail(r.ok ? r.detail : null); }).catch(() => { if (alive) setDetail(null); });
        return () => { alive = false; };
    }, [id, loadDetail]);
    const name = detail ? scheduleNameIn(detail.name, language) : schedule.name ? scheduleNameIn(schedule.name, language) : '';
    const note = makerNote(detail, schedule, language, words);
    return (
        <section className="space-y-2 rounded-2xl border-2 border-indigo-200 bg-white p-3" data-testid={`totals-card-${id}`}>
            {name && <h3 className="m-0 text-[17px] font-black text-stone-900" data-testid={`totals-name-${id}`}>{name}</h3>}
            {note && <p className="m-0 text-[13.5px] font-bold leading-snug text-stone-700" data-testid={`totals-made-${id}`}>{note}</p>}
            {state === 'loading' && <p className="m-0 text-[14px] font-bold text-stone-600" data-testid={`totals-loading-${id}`}>{words.loading}</p>}
            {state !== 'loading' && !state.ok && <p className="m-0 text-[14px] font-bold text-stone-700" data-testid={`totals-none-${id}`}>{state.reason === 'offline-no-copy' ? words.none : words.failed}</p>}
            {state !== 'loading' && state.ok && state.totals.kind === 'sample' && <p className="m-0 text-[14px] font-bold text-stone-700" data-testid={`totals-sample-${id}`}>{words.sample}</p>}
            {state !== 'loading' && state.ok && state.totals.kind === 'own' && <p className="m-0 text-[14px] font-bold text-stone-700" data-testid={`totals-own-${id}`}>{words.own}</p>}
            {state !== 'loading' && state.ok && state.totals.kind === 'totals' && (
                <>
                    <TotalsLines id={id} totals={state.totals} words={words} />
                    {state.source === 'phone' && <p className="m-0 text-[13px] font-bold text-stone-600" data-testid={`totals-last-seen-${id}`}>{words.lastSeen}</p>}
                </>
            )}
        </section>
    );
};

export const FollowTotalsScreen: React.FC<{
    schedules: readonly TotalsScheduleRef[];
    onClose: () => void;
    loadTotals?: (id: string) => Promise<TotalsLoad>;
    loadDetail?: (id: string) => Promise<DayCardsLoad>;
}> = ({ schedules, onClose, loadTotals, loadDetail = loadDayCards }) => {
    const language = useOptionalLanguage()?.language === 'en' ? 'en' : 'mr';
    const words = totalsWords(language);
    useBackDismiss(true, onClose);
    const states = useScheduleTotals(schedules.map(s => s.templateId), loadTotals);
    return (
        <div className="fixed inset-0 z-[120] flex justify-center bg-stone-900/40" data-testid="follow-totals-screen">
            <div className="flex h-full w-full max-w-md flex-col bg-stone-50" role="dialog" aria-modal="true" aria-label={words.title}>
                <div className="flex shrink-0 items-center gap-3 border-b border-stone-200 bg-white px-3 py-2.5">
                    <button type="button" onClick={onClose} data-testid="totals-back" aria-label={words.back}
                        className="flex min-h-[48px] shrink-0 items-center gap-1 rounded-full border border-stone-300 bg-white px-3 text-[16px] font-extrabold text-stone-800"><ChevronLeft size={20} aria-hidden="true" />{words.back}</button>
                    <h2 className="m-0 min-w-0 text-[18px] font-black text-stone-900" data-testid="totals-title">{words.title}</h2>
                </div>
                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pb-24 pt-3">
                    <p className="m-0 rounded-2xl bg-indigo-50 px-3 py-2.5 text-[14.5px] font-extrabold leading-snug text-indigo-900" data-testid="totals-rule">{words.rule}</p>
                    {schedules.map(s => <TotalsCard key={s.templateId} schedule={s} state={states[s.templateId] ?? 'loading'} language={language} loadDetail={loadDetail} />)}
                </div>
            </div>
        </div>
    );
};
