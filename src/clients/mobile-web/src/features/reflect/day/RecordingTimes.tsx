/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane RF2 + its fix pass) — the time chips of a place's day and the
 * one recording they open, shared by the plot-day view (screen 1) and the "आजचा आढावा" screen (screen 2), never forked:
 *
 *   - ONE row of time chips ("दुपारी 1:15 · रात्री 8:02 …"), morning first, a green dot when confirmed;
 *   - a tap opens that recording RIGHT THERE: its work in the result screen's rows (each part's icon and colour), and
 *     one small line — who · पक्कं status · ऐका (only where `listenModel` allows it) · बदला (the speak-the-change screen);
 *   - no source-words panel and no quoted words: what was understood, never "“…”" (fix pass D4).
 * Nothing is summed across recordings (P4); a value is shown as recorded.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import type { DailyLog } from '../../../types';
import { AddedRow, BlockerRow, LegacyNote, TypedTag, WhoChip } from '../../logs/components/voiceResult/DayParts';
import { ProductBoxCard } from '../../logs/components/voiceResult/ProductRows';
import { withoutQuotes } from '../../logs/components/voiceResult/partNames';
import { showsProducts } from '../../logs/components/voiceResult/productModel';
import type { DayRecording } from './dayRecordings';
import { ListenControl, LogPhotos, StatusChip, useReflectCopy } from './RecordingParts';
import type { DayListen } from './useDayListen';

const NO_IDS: ReadonlySet<string> = new Set();

/** A test id from a log id (ids can carry characters a test id should not). */
export const recId = (rec: DayRecording): string => rec.view.id;

const plotOf = (log: DailyLog): string => (log.context?.selection ?? []).flatMap(s => s.selectedPlotNames ?? []).filter(Boolean).join(', ');

/** One recording, opened under its time chip: one small line (who · status · ऐका · बदला), then its work as rows. */
export const RecordingInline: React.FC<{ rec: DayRecording; listen: DayListen; testId: string; onEdit?: (log: DailyLog) => void }> = ({ rec, listen, testId, onEdit }) => {
    const language = useOptionalLanguage()?.language;
    const copy = useReflectCopy();
    const { view } = rec;
    const entries = withoutQuotes(view.entries);
    const blockers = withoutQuotes(view.blockers);
    const boxed = (e: typeof entries[number]) => e.verified && showsProducts(e.products, language);
    const others = entries.filter(e => !boxed(e));
    const boxes = entries.flatMap(e => (boxed(e) && e.products ? [e.products] : []));
    const nothing = others.length === 0 && boxes.length === 0 && blockers.length === 0;
    return (
        <div data-testid={testId} data-confirmed={view.confirmed ? 'yes' : 'no'} className="rounded-2xl border border-dashed border-stone-300 bg-white p-3">
            <div className="flex flex-wrap items-center gap-1.5" data-testid={`${testId}-line`}>
                <WhoChip who={view.who} testId={`${testId}-who`} />
                {view.typed && <TypedTag testId={`${testId}-typed`} />}
                <StatusChip confirmed={view.confirmed} testId={`${testId}-state`} />
                {!view.typed && <ListenControl rec={rec} listen={listen} testId={`${testId}-play`} />}
                {onEdit && rec.logs.map(l => (
                    <button key={l.id} type="button" onClick={() => { listen.stop(); onEdit(l); }} data-testid={`${testId}-edit-${l.id}`}
                        className="ml-auto inline-flex min-h-[40px] items-center gap-1 rounded-full border border-stone-300 bg-white px-3 text-[14px] font-extrabold text-stone-700">
                        <Pencil size={15} aria-hidden="true" /> {copy.edit}{rec.logs.length > 1 && plotOf(l) ? ` · ${plotOf(l)}` : ''}
                    </button>
                ))}
            </div>
            {view.legacyPartial && <LegacyNote testId={`${testId}-legacy`} />}
            <div className="mt-2 space-y-1.5" data-testid={`${testId}-parts`}>
                {nothing && <p className="m-0 text-[14px] font-semibold text-stone-600" data-testid={`${testId}-nothing`}>{copy.nothingUnderstood}</p>}
                {others.map(e => <AddedRow key={`${e.logId}:${e.id}`} entry={e} />)}
                {boxes.map(b => <ProductBoxCard key={b.id} box={b} />)}
                {blockers.map(b => <BlockerRow key={b.id} entry={b} />)}
            </div>
            {rec.logs.map(l => <LogPhotos key={l.id} logId={l.id} />)}
        </div>
    );
};

/** ONE row of time chips for a place's day; a tap opens that recording in place (a second tap closes it). */
export const RecordingTimes: React.FC<{
    recordings: readonly DayRecording[];
    listen: DayListen;
    /** Keeps test ids apart when one recording shows in two places (it named two plots). */
    idPrefix?: string;
    openKey?: string | null;
    /** Logs just told through the ONE mic: their chip is marked. */
    fresh?: ReadonlySet<string>;
    onEdit?: (log: DailyLog) => void;
    showKey?: boolean;
}> = ({ recordings, listen, idPrefix = '', openKey = null, fresh = NO_IDS, onEdit, showKey = true }) => {
    const copy = useReflectCopy();
    const [open, setOpen] = useState<string | null>(openKey);
    const openRef = useRef<HTMLDivElement | null>(null);
    // A note's link lands on its recording, in sight.
    useEffect(() => { if (openKey) openRef.current?.scrollIntoView?.({ block: 'nearest' }); }, [openKey]);
    const opened = recordings.find(r => r.key === open);
    return (
        <div>
            <div className="flex flex-wrap gap-2" data-testid={`rf-times-${idPrefix}`}>
                {recordings.map(r => {
                    const on = r.key === open;
                    const isNew = r.logs.some(l => fresh.has(l.id));
                    return (
                        <button key={r.key} type="button" aria-expanded={on} data-testid={`rf-time-${idPrefix}${recId(r)}`} data-confirmed={r.view.confirmed ? 'yes' : 'no'}
                            onClick={() => { listen.stop(); setOpen(on ? null : r.key); }}
                            className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full border-2 px-3 text-[14.5px] font-extrabold ${on ? 'border-emerald-700 bg-emerald-700 text-white' : isNew ? 'border-emerald-600 bg-emerald-50 text-stone-900' : 'border-stone-200 bg-white text-stone-900'}`}>
                            <span className={`h-2 w-2 rounded-full ${on ? 'bg-white' : r.view.confirmed ? 'bg-emerald-500' : 'bg-stone-400'}`} aria-hidden="true" />
                            {r.view.timeLabel || (r.view.typed ? <TypedTag /> : '—')}
                        </button>
                    );
                })}
            </div>
            {showKey && <p className="m-0 mt-1.5 text-[12.5px] font-semibold text-stone-600">{copy.timesKey}</p>}
            {opened && <div ref={openRef} className="mt-2"><RecordingInline rec={opened} listen={listen} testId={`rf-rec-${idPrefix}${recId(opened)}`} onEdit={onEdit} /></div>}
        </div>
    );
};
