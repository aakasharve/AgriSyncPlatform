/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lanes RF, RF2) — the plot's day on आढावा (the founder's screen 1,
 * 2026-10-30: tap a plot card). It replaces lane RF's day sheet layout, and with the plot cards it replaces the day's
 * feed sheet and the one-recording glance (retired):
 *
 *   - ALL of that plot-day's work, sorted into buckets in the result screen's look — the result screen's own rows
 *     (`DayRow`, opened, each value with the time it was told and who told it), never a number summed across
 *     recordings (P4);
 *   - under the buckets, the time chips ("दुपारी 1:15 · रात्री 8:02 …"), a green dot when confirmed; a tap shows that
 *     recording's parts inline with one small line — who · पक्कं status · ऐका (only where `listenModel` allows it) — and
 *     "बदला" (the speak-the-change screen, lane E1). No "यातून काय समजलं / कोणत्या शब्दांतून" panel here;
 *   - "आणखी सांगा" (today) opens THE ONE mic for this place and comes back here with the new work highlighted.
 * The same view serves the "संपूर्ण शेत" card and a note's link to its recording (opened on that recording).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Mic, Pencil } from 'lucide-react';
import { useFarmContext } from '../../../core/session/FarmContext';
import { emitClosureSummaryViewed } from '../../../core/telemetry/eventEmitters';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import type { DailyLog } from '../../../types';
import { PHONE_COLUMN } from '../../logs/components/phoneColumn';
import { AddedRow, BlockerRow, DayRow, LegacyNote, TypedTag, WhoChip } from '../../logs/components/voiceResult/DayParts';
import { ProductBoxCard } from '../../logs/components/voiceResult/ProductRows';
import { showsProducts } from '../../logs/components/voiceResult/productModel';
import { PARTS, type PartKey } from '../../logs/components/voiceResult/resultModel';
import { dayPartsOf, type DayRecording } from './dayRecordings';
import { ListenControl, LogPhotos, StatusChip, useReflectCopy } from './RecordingParts';
import type { DayListen } from './useDayListen';

const SANS = "'Noto Sans Devanagari', sans-serif";
const NO_IDS: ReadonlySet<string> = new Set();

/** A test id from a log id (ids can carry characters a test id should not). */
export const recId = (rec: DayRecording): string => rec.view.id;

/** The frame of a full-screen view here: one big back, a head, a scrolling body. */
const Sheet: React.FC<{ testId: string; label: string; z: string; onBack: () => void; head?: React.ReactNode; children: React.ReactNode }> = ({ testId, label, z, onBack, head, children }) => {
    const copy = useReflectCopy();
    return (
        <div className={`fixed inset-0 ${z} flex justify-center bg-stone-900/30`}>
            <div className={`flex h-full flex-col bg-stone-50 ${PHONE_COLUMN}`} role="dialog" aria-modal="true" aria-label={label} data-testid={testId} style={{ fontFamily: SANS }}>
                <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-stone-200 bg-white px-3 py-2.5">
                    <button type="button" onClick={onBack} data-testid={`${testId}-back`}
                        className="inline-flex min-h-[52px] items-center gap-2 rounded-full border border-stone-300 bg-white pl-2 pr-5 text-stone-800 shadow-sm active:scale-95">
                        <span className="grid h-9 w-9 place-items-center rounded-full bg-stone-100"><ArrowLeft size={22} strokeWidth={2.75} /></span>
                        <span className="text-[17px] font-extrabold">{copy.back}</span>
                    </button>
                    {head}
                </div>
                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pb-24 pt-3">{children}</div>
            </div>
        </div>
    );
};

const plotOf = (log: DailyLog): string => (log.context?.selection ?? []).flatMap(s => s.selectedPlotNames ?? []).filter(Boolean).join(', ');

/** One recording, inline under its time chip: who · status · ऐका, then its parts (result-screen rows) and "बदला". */
const RecordingInline: React.FC<{ rec: DayRecording; listen: DayListen; onEdit?: (log: DailyLog) => void }> = ({ rec, listen, onEdit }) => {
    const language = useOptionalLanguage()?.language;
    const copy = useReflectCopy();
    const { view } = rec;
    const testId = `rf-rec-${recId(rec)}`;
    const boxed = (e: typeof view.entries[number]) => e.verified && showsProducts(e.products, language);
    const others = view.entries.filter(e => !boxed(e));
    const boxes = view.entries.flatMap(e => (boxed(e) && e.products ? [e.products] : []));
    const nothing = others.length === 0 && boxes.length === 0 && view.blockers.length === 0;
    return (
        <div data-testid={testId} data-confirmed={view.confirmed ? 'yes' : 'no'} className="rounded-2xl border border-dashed border-stone-300 bg-white p-3">
            <div className="flex flex-wrap items-center gap-1.5" data-testid={`${testId}-line`}>
                <WhoChip who={view.who} testId={`${testId}-who`} />
                {view.typed && <TypedTag testId={`${testId}-typed`} />}
                <StatusChip confirmed={view.confirmed} testId={`${testId}-state`} />
            </div>
            {!view.typed && <ListenControl rec={rec} listen={listen} testId={`${testId}-play`} />}
            {view.legacyPartial && <LegacyNote testId={`${testId}-legacy`} />}
            <div className="mt-2 space-y-1.5" data-testid={`${testId}-parts`}>
                {nothing && <p className="m-0 text-[14px] font-semibold text-stone-600" data-testid={`${testId}-nothing`}>{copy.nothingUnderstood}</p>}
                {others.map(e => <AddedRow key={`${e.logId}:${e.id}`} entry={e} />)}
                {boxes.map(b => <ProductBoxCard key={b.id} box={b} />)}
                {view.blockers.map(b => <BlockerRow key={b.id} entry={b} />)}
            </div>
            {rec.logs.map(l => <LogPhotos key={l.id} logId={l.id} />)}
            {onEdit && rec.logs.map(l => (
                <button key={l.id} type="button" onClick={() => { listen.stop(); onEdit(l); }} data-testid={`${testId}-edit-${l.id}`}
                    className="mt-2 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl border border-stone-300 bg-white text-base font-extrabold text-stone-700">
                    <Pencil size={18} aria-hidden="true" /> {copy.edit}{rec.logs.length > 1 && plotOf(l) ? ` · ${plotOf(l)}` : ''}
                </button>
            ))}
        </div>
    );
};

/** A plot card's day (and the whole farm's, and a note's recording). */
export const PlotDayView: React.FC<{
    title: string;
    subtitle?: string;
    dayLabel: string;
    dateKey: string;
    isToday: boolean;
    recordings: readonly DayRecording[];
    listen: DayListen;
    /** Open on this recording (a note's link). */
    openKey?: string | null;
    /** Logs just told through the ONE mic from here: their parts and time chip are highlighted. */
    fresh?: ReadonlySet<string>;
    onEdit?: (log: DailyLog) => void;
    /** "आणखी सांगा" — today only (a recording is always today's, so another day offers no such button, P5). */
    onTellMore?: () => void;
    onClose: () => void;
}> = ({ title, subtitle, dayLabel, dateKey, isToday, recordings, listen, openKey = null, fresh = NO_IDS, onEdit, onTellMore, onClose }) => {
    const copy = useReflectCopy();
    const { currentFarmId } = useFarmContext();
    const [open, setOpen] = useState<string | null>(openKey);
    const openRef = useRef<HTMLDivElement | null>(null);
    const logsCount = recordings.reduce((n, r) => n + r.logs.length, 0);
    // DWC v2 §2.8 #7 — closure_summary.viewed when the day opens (the old drawer's event, kept).
    useEffect(() => {
        if (currentFarmId) emitClosureSummaryViewed({ farmId: currentFarmId, dateKey, logsCount, source: 'drawer_open' });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    // A note's link lands on its recording, in sight.
    useEffect(() => { if (openKey) openRef.current?.scrollIntoView?.({ block: 'nearest' }); }, [openKey]);
    const { byPart, byLog } = dayPartsOf(recordings);
    const freshParts = useMemo(() => new Set<PartKey>(PARTS.map(p => p.key).filter(k => byPart[k].some(e => fresh.has(e.logId)))), [byPart, fresh]);
    const blockers = recordings.flatMap(r => r.view.blockers);
    const opened = recordings.find(r => r.key === open);
    const head = (
        <span className="min-w-0 flex-1">
            <span className="block truncate text-[17px] font-extrabold leading-tight text-stone-900" data-testid="rf-day-title">{title}</span>
            <span className="block truncate text-[13px] font-bold text-stone-600" data-testid="rf-day-date">{[dayLabel, subtitle].filter(Boolean).join(' · ')}</span>
        </span>
    );
    const tellMore = onTellMore && (
        <button type="button" onClick={() => { listen.stop(); onTellMore(); }} data-testid="rf-day-tell"
            className="flex min-h-[56px] w-full items-center justify-center gap-2 rounded-2xl bg-emerald-700 px-5 text-[17px] font-extrabold text-white active:scale-95">
            <Mic size={22} aria-hidden="true" /> {copy.tellMore}
        </button>
    );
    return (
        <Sheet testId="rf-day" label={title} z="z-50" onBack={() => { listen.stop(); onClose(); }} head={head}>
            {recordings.length === 0 ? (
                <div className="space-y-3 rounded-2xl border-2 border-dashed border-stone-200 bg-white p-6 text-center" data-testid="rf-day-empty">
                    <p className="m-0 text-[16px] font-bold text-stone-700">{copy.nothingTold(isToday)}</p>
                    {tellMore}
                </div>
            ) : (
                <>
                    <div data-testid="rf-day-parts">
                        <p className="m-0 mb-2 text-[13px] font-semibold text-stone-600">{copy.dayViewHint(isToday)}</p>
                        <div className="space-y-2">
                            {PARTS.filter(m => byPart[m.key].length > 0).map(m => (
                                <DayRow key={m.key} part={m.key} entries={byPart[m.key]} byLog={byLog} touched={freshParts.has(m.key)} showWho nowIds={fresh} defaultOpen />
                            ))}
                            {blockers.map(b => <BlockerRow key={b.id} entry={b} />)}
                        </div>
                    </div>
                    <div data-testid="rf-day-times">
                        <h3 className="m-0 mb-1.5 text-[13px] font-extrabold text-stone-700">{copy.timesTitle}</h3>
                        <div className="flex flex-wrap gap-2">
                            {recordings.map(r => {
                                const on = r.key === open;
                                const isNew = r.logs.some(l => fresh.has(l.id));
                                return (
                                    <button key={r.key} type="button" aria-expanded={on} data-testid={`rf-time-${recId(r)}`} data-confirmed={r.view.confirmed ? 'yes' : 'no'}
                                        onClick={() => { listen.stop(); setOpen(on ? null : r.key); }}
                                        className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full border-2 px-3 text-[14.5px] font-extrabold ${on ? 'border-emerald-700 bg-emerald-700 text-white' : isNew ? 'border-emerald-600 bg-emerald-50 text-stone-900' : 'border-stone-200 bg-white text-stone-900'}`}>
                                        <span className={`h-2 w-2 rounded-full ${on ? 'bg-white' : r.view.confirmed ? 'bg-emerald-500' : 'bg-stone-400'}`} aria-hidden="true" />
                                        {r.view.timeLabel || (r.view.typed ? <TypedTag /> : '—')}
                                    </button>
                                );
                            })}
                        </div>
                        <p className="m-0 mt-1.5 text-[12.5px] font-semibold text-stone-600">{copy.timesKey}</p>
                        {opened && <div ref={openRef} className="mt-2"><RecordingInline rec={opened} listen={listen} onEdit={onEdit} /></div>}
                    </div>
                    {tellMore}
                </>
            )}
        </Sheet>
    );
};
