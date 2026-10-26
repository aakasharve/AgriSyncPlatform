/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I13) — the ONE screen after he speaks.
 *
 * Founder PLR-D1 (rounds 1-5) and PLR-D5, ported from the approved preview (postVoiceResult/PostVoiceResult.tsx)
 * onto REAL data. Presentational: the container (`VoiceResultContainer`) owns the audio, the confirm and the
 * sync read-out. Top to bottom:
 *   0. the meter + all eight parts, the unmentioned ones in red, each tappable to tell Sathi (ResultHero);
 *   1. the recording he JUST made: "लक्षात ठेवलं" (true: the screen exists only after the phone's durable
 *      write) and the server state honestly; his words colour-marked; a big play button; "यातून काय समजलं";
 *      Sathi's ONE question (the existing panel, flag-gated); "पक्कं आहे", unlocked once he heard his clip;
 *      "बदला" (the existing edit form);
 *   2. the plot's whole day, one row per part; 3. the day's earlier recordings, newest first;
 *   4. the bottom bar: "मागे" + "आणखी सांगा".
 * One screen for readers and non-readers alike (no mode switch).
 */
import React, { useRef, useState } from 'react';
import { Check, Mic, Pencil } from 'lucide-react';
import FlowBackButton from '../../../context/components/FlowBackButton';
import { NotQueuedForServerBadge } from '../../../../core/navigation/mainViewComponents';
import type { VoiceClipCacheRecord } from '../../../../infrastructure/storage/DexieDatabase';
import type { RingNodeData } from '../shramsathi/understandingRing';
import ClipPlayer from './ClipPlayer';
import { AddedRow, DayRow, EarlierRecording, TimePill, WhoChip } from './DayParts';
import { PartLinks, Words } from './HisWords';
import ResultHero from './ResultHero';
import { PARTS, markTranscript, type DayView, type PartKey, type RecordingView } from './resultModel';
import { RESULT_STR } from './resultStrings';
import type { LogSyncState } from './useRecordingTrust';

const SANS = "'Noto Sans Devanagari', sans-serif";

export interface VoiceResultScreenProps {
    day: DayView;
    recordingKey: string;
    /** The plot(s) this recording is about, as named on the farm. */
    placeLabel: string;
    farmId: string | null;
    nodes: RingNodeData[];
    /** Phrases the parse could not place, shown as he said them. */
    unclear: readonly string[];
    /** Clips on this phone, by log id (this recording's and the earlier ones'). */
    clips: ReadonlyMap<string, VoiceClipCacheRecord>;
    playingId: string | null;
    progress: number;
    lengthOf: (logId: string) => number | null;
    heard: ReadonlySet<string>;
    onTogglePlay: (logId: string) => void;
    sync: LogSyncState;
    /** From the save's enqueue result: false = it will not reach the server (honest badge); null = no claim. */
    syncQueued: boolean | null | undefined;
    /** Owner tier with a server identity: may send the verify (P5: others never see a button that would fail). */
    canConfirm: boolean;
    /** He confirmed this recording (in this session, or the log already says so). */
    confirmed: boolean;
    confirmFailed: boolean;
    onConfirm: () => void;
    onEdit: () => void;
    onBack: () => void;
    onAddAnother: () => void;
    onTellMore: (part: PartKey) => void;
    /** Sathi's ONE question (LedgerRecognitionPanel), mounted by the container. */
    questionPanel?: React.ReactNode;
    /** The other existing post-save surfaces the container keeps (clarity line, task close). */
    extras?: React.ReactNode;
}

export const VoiceResultScreen: React.FC<VoiceResultScreenProps> = (p) => {
    const { day } = p;
    const primary: RecordingView | undefined = day.current.find(r => !!r.transcript) ?? day.current[0];
    const [focus, setFocus] = useState<PartKey | null>(null);
    const latest = useRef<HTMLElement>(null);
    if (!primary) return null;

    const addedEntries = day.current.flatMap(r => r.entries);
    const runs = markTranscript(primary.transcript, addedEntries);
    const clip = p.clips.get(primary.id);
    const heard = p.heard.has(primary.id);
    const unlocked = heard || !clip;
    const nowIds = new Set(day.current.map(r => r.id));
    const byLog = new Map([...day.current, ...day.earlier].map(r => [r.id, r]));
    const count = day.current.length > 0 ? day.earlier.length + 1 : day.earlier.length;
    const toWords = () => latest.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });

    return (
        <div className="space-y-3 pb-6 pt-1" style={{ fontFamily: SANS }} data-testid="voice-result">
            <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center rounded-full border border-stone-200 bg-white px-3 py-1.5 text-sm font-extrabold text-stone-800" data-testid="vr-place">{p.placeLabel}</span>
                <span className="text-xs font-bold text-stone-600" data-testid="vr-count">{count > 1 ? RESULT_STR.todayCount(count) : RESULT_STR.firstToday}</span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-stone-200 bg-white px-2.5 py-1.5" data-testid="vr-speakers">
                <span className="text-[12px] font-extrabold text-stone-700">{RESULT_STR.todayWho}:</span>
                {day.speakers.map(s => (
                    <span key={`${s.you}-${s.name}`} data-you={s.you ? 'yes' : 'no'}
                        className={`rounded-full border px-2 py-0.5 text-[12px] font-extrabold ${s.you ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-blue-300 bg-blue-50 text-blue-900'}`}>
                        {s.name} · {RESULT_STR.times(s.times)}
                    </span>
                ))}
            </div>

            <ResultHero farmId={p.farmId} dayDate={primary.log.date} savedLogId={primary.id} recordingKey={p.recordingKey}
                nodes={p.nodes} missing={day.missing} onTellMore={p.onTellMore} onReadMore={toWords} />

            <section ref={latest} className="rounded-3xl border-2 border-emerald-600 bg-white p-3.5" data-testid="vr-latest">
                <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[12px] font-extrabold">
                    <span className="rounded-full bg-emerald-700 px-2.5 py-1 text-white">{RESULT_STR.justNow}</span>
                    <TimePill label={primary.timeLabel} strong />
                    <WhoChip who={primary.who} testId="vr-latest-who" />
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-emerald-800" data-testid="vr-remembered">{RESULT_STR.remembered}</span>
                    {p.sync === 'onServer' && <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-blue-800" data-testid="vr-on-server">{RESULT_STR.onServer}</span>}
                    {p.sync === 'needsFix' && <span className="rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-amber-800" data-testid="vr-needs-fix">{RESULT_STR.needsFix}</span>}
                    {p.confirmed && <span className="rounded-full bg-emerald-900 px-2.5 py-1 text-white" data-testid="vr-confirmed-badge">{RESULT_STR.confirmedBadge}</span>}
                </div>
                <NotQueuedForServerBadge syncQueued={p.syncQueued} />

                {runs.length > 0 && <Words runs={runs} tags focus={focus} />}
                <PartLinks runs={runs} entries={addedEntries} focus={focus} onFocus={setFocus} />

                {p.unclear.length > 0 && (
                    <div className="mt-2 rounded-2xl border border-amber-200 bg-amber-50 p-2.5" data-testid="vr-unclear">
                        <div className="mb-1 text-[12.5px] font-extrabold text-amber-900">{RESULT_STR.unclearTitle}</div>
                        {p.unclear.map((u, i) => <div key={i} className="text-[15px] font-semibold text-stone-800">“{u}”</div>)}
                    </div>
                )}

                {clip && (
                    <div className="mt-2">
                        <ClipPlayer clipKey={clip.id} durationSec={p.lengthOf(primary.id)} playing={p.playingId === primary.id} progress={p.progress} big
                            onToggle={() => p.onTogglePlay(primary.id)} testId="vr-play" />
                    </div>
                )}

                {addedEntries.length > 0 && (
                    <div className="mt-3" data-testid="vr-added">
                        <div className="mb-1.5 text-[13px] font-extrabold text-emerald-800">{RESULT_STR.addedTitle}</div>
                        <div className="space-y-1.5">{addedEntries.map(e => <AddedRow key={`${e.logId}:${e.id}`} entry={e} />)}</div>
                    </div>
                )}

                {p.questionPanel && <div className="mt-3">{p.questionPanel}</div>}

                {p.canConfirm && (p.confirmed ? (
                    <div className="mt-3 rounded-2xl border-2 border-emerald-900 bg-emerald-50 p-3 text-center font-extrabold text-emerald-900" data-testid="vr-confirm-done">
                        <Check className="mx-auto mb-0.5" size={22} aria-hidden="true" /> {RESULT_STR.confirmedDone}
                    </div>
                ) : (
                    <div className="mt-3">
                        <div className="mb-1.5 text-base font-extrabold">{!clip ? RESULT_STR.readAndConfirm : heard ? RESULT_STR.listenAndConfirm : RESULT_STR.lockedLabel}</div>
                        <button type="button" onClick={p.onConfirm} disabled={!unlocked} data-testid="vr-confirm"
                            className="min-h-[62px] w-full rounded-2xl bg-emerald-700 text-xl font-extrabold text-white disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-600">
                            {unlocked ? `✔ ${RESULT_STR.confirm}` : RESULT_STR.unlockHint}
                        </button>
                        {p.confirmFailed && <p className="m-0 mt-1 text-[13px] font-bold text-red-700" data-testid="vr-confirm-failed">{RESULT_STR.confirmFailed}</p>}
                    </div>
                ))}

                <button type="button" onClick={p.onEdit} data-testid="vr-edit"
                    className="mt-2 flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl border border-stone-300 bg-white text-base font-extrabold text-stone-700">
                    <Pencil size={18} aria-hidden="true" /> {RESULT_STR.edit}
                </button>
            </section>

            {p.extras}

            <div>
                <h3 className="m-0 pt-1 text-sm font-extrabold text-stone-700" data-testid="vr-day-title">{RESULT_STR.dayTitle}</h3>
                <p className="m-0 mb-2 text-[12px] text-stone-600">{RESULT_STR.tapForHistory}</p>
                <div className="space-y-2">
                    {PARTS.filter(m => day.byPart[m.key].length > 0).map(m => (
                        <DayRow key={m.key} part={m.key} entries={day.byPart[m.key]} byLog={byLog} touched={day.touchedNow.has(m.key)}
                            showWho={day.speakers.length > 1} nowIds={nowIds} />
                    ))}
                </div>
            </div>

            {day.earlier.length > 0 && (
                <div className="space-y-2" data-testid="vr-earlier">
                    <h3 className="m-0 pt-1 text-sm font-extrabold text-stone-700">{RESULT_STR.earlierTitle}</h3>
                    {day.earlier.map(r => (
                        <EarlierRecording key={r.id} rec={r} clip={p.clips.get(r.id)} playing={p.playingId === r.id} progress={p.progress}
                            lengthSec={p.lengthOf(r.id)} onToggle={() => p.onTogglePlay(r.id)} />
                    ))}
                </div>
            )}
            <p className="px-1.5 text-center text-xs leading-relaxed text-stone-600">{RESULT_STR.foot}</p>

            <div className="flex items-center gap-2 pt-1" data-testid="vr-actionbar">
                <FlowBackButton onClick={p.onBack} testId="vr-back" />
                <button type="button" onClick={p.onAddAnother} data-testid="vr-add-another"
                    className="flex min-h-[52px] flex-1 items-center justify-center gap-2 rounded-2xl bg-emerald-700 text-[17px] font-extrabold text-white active:scale-95">
                    <Mic size={20} aria-hidden="true" /> {RESULT_STR.addAnother}
                </button>
            </div>
        </div>
    );
};

export default VoiceResultScreen;
