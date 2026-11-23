/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (Task 11, steps 5-9) — the lower half of the saved screen, each piece the result screen's own:
 *   - his words, OPEN (`WordsFold` + `Words`, no player: the clip is in the card above), "श्रम साथीला हे का समजले?" (`PartLinks`)
 *     and the lines Sathi could not place;
 *   - Sathi's ONE question (the container's panel); for someone who does not check products, the speaker's line (the rule of
 *     `VoiceResultScreen`: only when there is a product to check); the other post-save surfaces (`extras`);
 *   - "बदला" — one per plot, each with its own not-queued badge, when he named several (duplicated from `VoiceResultScreen`, whose
 *     file this lane does not edit: amendment H7; follow-up to share them);
 *   - the day's earlier recordings in one fold (`EarlierRecording`);
 *   - the big blue button to today's result screen, unchanged (the detail page, where the owner's "पक्कं आहे" stays).
 */
import React, { useState } from 'react';
import { ChevronRight, ClipboardList, Pencil } from 'lucide-react';
import { NotQueuedForServerBadge } from '../../../../core/navigation/mainViewComponents';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import type { VoiceClipCacheRecord } from '../../../../infrastructure/storage/DexieDatabase';
import { digitsFor } from '../../../../shared/utils/marathiDigits';
import { voiceFlowWords } from '../../../voice/flowV2/voiceFlowWords';
import MoneyWordsWithheldCard from '../originalVoice/MoneyWordsWithheldCard';
import { EarlierRecording } from '../voiceResult/DayParts';
import { PartLinks, Words, WordsFold } from '../voiceResult/HisWords';
import type { ProductAnswerKit } from '../voiceResult/ProductCard';
import { resultCopy } from '../voiceResult/resultCopy';
import { markTranscript, type DayView, type PartKey, type RecordingView } from '../voiceResult/resultModel';
import { resultDayStr, useResultStr, type ResultStr } from '../voiceResult/resultStrings';

const SANS = "'Noto Sans Devanagari', sans-serif";

/** The plots one log of this recording is about, as named on the farm (the result screen's own rule). */
const plotsOf = (r: RecordingView, RS: ResultStr): string => {
    const names = (r.log.context?.selection ?? []).flatMap(s => s.selectedPlotNames ?? []).filter(Boolean);
    return names.length > 0 ? names.join(', ') : RS.wholeFarm;
};

export interface SavedScreenLowerProps {
    day: DayView;
    primary: RecordingView;
    /** A recording saved for a past day: its short name ("२४ ऑक्टो"); null = today. */
    onDay: string | null;
    unclear: readonly string[];
    clips: ReadonlyMap<string, VoiceClipCacheRecord>;
    playingId: string | null;
    progress: number;
    lengthOf: (logId: string) => number | null;
    onTogglePlay: (logId: string) => void;
    syncQueuedOf: (logId: string) => boolean | null | undefined;
    onEdit: (logId: string) => void;
    questionPanel?: React.ReactNode;
    extras?: React.ReactNode;
    answerKit?: ProductAnswerKit;
    onOpenDetail: () => void;
    wordsRef: React.RefObject<HTMLDivElement | null>;
}

export const SavedScreenLower: React.FC<SavedScreenLowerProps> = (p) => {
    const { day, primary } = p;
    const RS = useResultStr();
    const language = useOptionalLanguage()?.language;
    const W = voiceFlowWords(language);
    const copy = resultCopy(language);
    const [wordsOpen, setWordsOpen] = useState(true);
    const [focus, setFocus] = useState<PartKey | null>(null);
    const addedEntries = day.current.flatMap(r => r.entries);
    const runs = markTranscript(primary.transcript, addedEntries);
    const kit = p.answerKit;
    const hasAnswerable = !!kit && addedEntries.some(e => e.products?.items.some(i => !!i.ref));
    const severalPlots = day.current.length > 1;
    const earlierTitle = p.onDay ? resultDayStr(language).earlier : RS.earlierTitle;
    return (
        <>
            <div ref={p.wordsRef} data-testid="vr2-words">
                <WordsFold open={wordsOpen} onToggle={() => setWordsOpen(o => !o)}>
                    {primary.wordsWithheld
                        ? <MoneyWordsWithheldCard testId="vr-words-withheld" />
                        : runs.length > 0 && <Words runs={runs} tags focus={focus} />}
                    <PartLinks runs={runs} entries={addedEntries} focus={focus} onFocus={setFocus} />
                    {p.unclear.length > 0 && (
                        <div className="mt-2 rounded-2xl border border-amber-200 bg-amber-50 p-2.5" data-testid="vr2-unclear">
                            <div className="mb-1 text-[12.5px] font-extrabold text-amber-900">{RS.unclearTitle}</div>
                            {p.unclear.map((u, i) => <div key={i} className="text-[15px] font-semibold text-stone-800">“{u}”</div>)}
                        </div>
                    )}
                </WordsFold>
            </div>

            {p.questionPanel && <div data-testid="vr2-question">{p.questionPanel}</div>}
            {kit && !kit.canCheck && hasAnswerable && (
                <p className="m-0 rounded-2xl bg-white px-3 py-2 text-[14px] font-bold leading-snug text-stone-700 ring-1 ring-stone-200" data-testid="vr2-speaker-done">{copy.speakerDone}</p>
            )}
            {p.extras}

            {severalPlots ? (
                // He named several plots: one log each. Each can be fixed, and each says if it will not reach the server.
                <div className="space-y-1.5" data-testid="vr2-plots">
                    {day.current.map(r => (
                        <div key={r.id} data-testid={`vr2-plot-${r.id}`} className="rounded-2xl border border-stone-200 bg-white p-1.5">
                            <button type="button" onClick={() => p.onEdit(r.id)} data-testid={`vr2-edit-${r.id}`}
                                className="flex min-h-[48px] w-full items-center gap-2 rounded-xl px-2 text-left text-base font-extrabold text-stone-700">
                                <Pencil size={18} aria-hidden="true" />
                                <span className="min-w-0 flex-1 truncate">{RS.edit} · {plotsOf(r, RS)}</span>
                            </button>
                            <NotQueuedForServerBadge syncQueued={p.syncQueuedOf(r.id)} />
                        </div>
                    ))}
                </div>
            ) : (
                <button type="button" onClick={() => p.onEdit(primary.id)} data-testid="vr2-edit"
                    className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl border border-stone-300 bg-white text-base font-extrabold text-stone-700">
                    <Pencil size={18} aria-hidden="true" /> {RS.edit}
                </button>
            )}

            {day.earlier.length > 0 && (
                <details className="rounded-2xl border border-stone-200 bg-white px-3" data-testid="vr2-earlier">
                    <summary className="flex min-h-[52px] cursor-pointer list-none items-center justify-between gap-2 text-[14.5px] font-extrabold text-stone-800">
                        <span data-testid="vr2-earlier-title">{earlierTitle} ({digitsFor(day.earlier.length, language)})</span>
                        <ChevronRight size={18} className="shrink-0 text-stone-400" aria-hidden="true" />
                    </summary>
                    <div className="space-y-2 border-t border-stone-100 py-2">
                        {day.earlier.map(r => (
                            <EarlierRecording key={r.id} rec={r} clip={p.clips.get(r.id)} playing={p.playingId === r.id} progress={p.progress}
                                lengthSec={p.lengthOf(r.id)} onToggle={() => p.onTogglePlay(r.id)} />
                        ))}
                    </div>
                </details>
            )}

            <button type="button" onClick={p.onOpenDetail} data-testid="vr2-open-detail" style={{ fontFamily: SANS }}
                className="flex min-h-[76px] w-full items-center gap-3 rounded-[20px] bg-gradient-to-br from-blue-700 to-blue-500 px-3.5 py-3 text-left text-white shadow-[0_8px_20px_rgba(30,86,230,0.28)] active:scale-[0.99]">
                <span className="grid h-[46px] w-[46px] shrink-0 place-items-center rounded-full bg-white/20"><ClipboardList size={24} aria-hidden="true" /></span>
                <span className="min-w-0 flex-1">
                    <span className="block text-[19px] font-extrabold leading-tight">{W.detailButton}</span>
                    <span className="block text-[12.5px] font-semibold opacity-90">{W.detailSub}</span>
                </span>
                <ChevronRight size={28} className="shrink-0" aria-hidden="true" />
            </button>
        </>
    );
};

export default SavedScreenLower;
