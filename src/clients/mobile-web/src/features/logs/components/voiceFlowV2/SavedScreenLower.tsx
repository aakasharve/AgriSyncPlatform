/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (Task 11, steps 5-9; design-fidelity pass F3) — the lower half of the saved screen, in the approved
 * design's order and look (sathi-ring.src.html):
 *   - his words, OPEN, with "श्रम साथीला हे का समजले?" and the lines Sathi could not place (`SavedWords`; no player: the clip is in
 *     the card above);
 *   - Sathi's ONE question (the container's panel) and the other post-save surfaces (`extras`), as the container draws them;
 *   - "✎ बदला" (`.editb.wide`) — or one per plot, each with its own not-queued badge, when he named several (`.edits`; duplicated
 *     from `VoiceResultScreen`, whose file this lane does not edit: amendment H7; follow-up to share them);
 *   - the day's earlier recordings in one fold (`SavedEarlier`);
 *   - the big blue button to today's detail page (`.aadbtn`, "आजचा आढावा बघा"; where the owner's "पक्कं आहे" stays) and the line
 *     that earlier recordings stay as they are.
 */
import React from 'react';
import { NotQueuedForServerBadge } from '../../../../core/navigation/mainViewComponents';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import type { VoiceClipCacheRecord } from '../../../../infrastructure/storage/DexieDatabase';
import { digitsFor } from '../../../../shared/utils/marathiDigits';
import { voiceFlowWords } from '../../../voice/flowV2/voiceFlowWords';
import type { DayView, RecordingView } from '../voiceResult/resultModel';
import { useResultStr, type ResultStr } from '../voiceResult/resultStrings';
import { SANS } from './savedBits';
import SavedEarlier from './SavedEarlier';
import { savedWords } from './savedWords';

/** The plots one log of this recording is about, as named on the farm (the result screen's own rule). */
const plotsOf = (r: RecordingView, RS: ResultStr): string => {
    const names = (r.log.context?.selection ?? []).flatMap(s => s.selectedPlotNames ?? []).filter(Boolean);
    return names.length > 0 ? names.join(', ') : RS.wholeFarm;
};

/** The design's `.editb`. */
const EDITB = 'min-h-[48px] w-full rounded-[14px] border-[1.5px] border-[#DDE3DA] bg-white px-3.5 text-[15px] font-extrabold text-[#1C1917]';

export interface SavedScreenLowerProps {
    day: DayView;
    primary: RecordingView;
    /** A recording saved for a past day: its short name ("२४ ऑक्टो"); null = today. */
    onDay: string | null;
    unclear: readonly string[];
    clips: ReadonlyMap<string, VoiceClipCacheRecord>;
    playingId: string | null;
    lengthOf: (logId: string) => number | null;
    onTogglePlay: (logId: string) => void;
    syncQueuedOf: (logId: string) => boolean | null | undefined;
    onEdit: (logId: string) => void;
    questionPanel?: React.ReactNode;
    extras?: React.ReactNode;
    onOpenDetail: () => void;
}

export const SavedScreenLower: React.FC<SavedScreenLowerProps> = (p) => {
    const { day, primary } = p;
    const RS = useResultStr();
    const language = useOptionalLanguage()?.language;
    const W = voiceFlowWords(language);
    const SW = savedWords(language);
    const severalPlots = day.current.length > 1;
    return (
        <>
            {p.questionPanel && <div data-testid="vr2-question">{p.questionPanel}</div>}
            {p.extras}

            {severalPlots ? (
                // He named several plots: one log each. Each can be fixed, and each says if it will not reach the server.
                <div className="flex flex-col gap-1.5" data-testid="vr2-plots" style={{ fontFamily: SANS }}>
                    <div className="text-[13px] font-extrabold text-[#5F6B63]">{SW.plotsEach(digitsFor(day.current.length, language))}</div>
                    {day.current.map(r => (
                        <div key={r.id} data-testid={`vr2-plot-${r.id}`}>
                            <button type="button" onClick={() => p.onEdit(r.id)} data-testid={`vr2-edit-${r.id}`} className={`${EDITB} text-left`}>
                                <span className="block truncate">✎ {RS.edit} · {plotsOf(r, RS)}</span>
                            </button>
                            <NotQueuedForServerBadge syncQueued={p.syncQueuedOf(r.id)} />
                        </div>
                    ))}
                </div>
            ) : (
                <button type="button" onClick={() => p.onEdit(primary.id)} data-testid="vr2-edit" className={`${EDITB} text-center`} style={{ fontFamily: SANS }}>
                    ✎ {RS.edit}
                </button>
            )}

            <SavedEarlier earlier={day.earlier} onDay={p.onDay} clips={p.clips} playingId={p.playingId} lengthOf={p.lengthOf} onTogglePlay={p.onTogglePlay} />

            <button type="button" onClick={p.onOpenDetail} data-testid="vr2-open-detail" style={{ fontFamily: SANS, background: 'linear-gradient(135deg,#1E56E6,#3B82F6)' }}
                className="flex min-h-[60px] w-full items-center gap-3 rounded-[18px] px-3.5 py-2.5 text-left text-white active:scale-[0.99]">
                <span className="grid h-[38px] w-[38px] flex-none place-items-center rounded-full bg-white/[0.18]">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                        <rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" />
                    </svg>
                </span>
                <span className="min-w-0 flex-1">
                    <b className="block text-[18px] font-bold leading-[1.25]">{W.detailButton}</b>
                </span>
                <span className="ml-auto text-[30px] leading-none" aria-hidden="true">›</span>
            </button>
        </>
    );
};

export default SavedScreenLower;
