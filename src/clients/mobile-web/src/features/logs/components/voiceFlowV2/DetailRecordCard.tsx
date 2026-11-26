/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (founder 2026-11-26: "exact replication of what we built") — the detail page's record card, as
 * the approved design draws it (sathi-ring.src.html `openAadhava`: `.adrec`, `.badges .bd`, `.clip.big`, "तुमचं बोलणं", the tinted
 * words, "श्रम साथीला हे का समजले?", `.unclr`). Presentational: the container owns the audio, the sync read-out and the confirm.
 *
 * The badges say only what is true (P10, P4): the time and who said it — with the holder's role in brackets only when he is the
 * speaker and the server told this phone his role; "लक्षात ठेवलं" (the card exists only after the phone's durable write); the
 * server's "श्रम सफलमध्ये साठवून ठेवलं" only once the server acknowledged it; "पक्कं केलं" / "पक्कं नाही" as the record says.
 *
 * Under his words, for the PRIMARY OWNER only (`canConfirm`, decided by the container exactly as before — spec I27, founder D-44 /
 * D-46): "पक्कं आहे", with whether he heard his clip or read his words; nobody else is ever asked. Then "✎ बदला" (one per plot when
 * he named several). Duplicated from the result screen's ~20 lines, whose file this lane does not edit (amendment H7).
 */
import React from 'react';
import { NotQueuedForServerBadge } from '../../../../core/navigation/mainViewComponents';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import type { VoiceClipCacheRecord } from '../../../../infrastructure/storage/DexieDatabase';
import { LegacyNote, TypedNote } from '../voiceResult/DayParts';
import { resultCopy } from '../voiceResult/resultCopy';
import type { DayView, RecordingView } from '../voiceResult/resultModel';
import { useResultStr } from '../voiceResult/resultStrings';
import type { LogSyncState } from '../voiceResult/useRecordingTrust';
import { Bd, SANS } from './savedBits';
import SavedClip from './SavedClip';
import { SavedEditButtons } from './SavedScreenLower';
import SavedWords from './SavedWords';
import { savedWords } from './savedWords';

/** The owner's confirm, as he sees it (the container decides who may; this only draws it). */
export interface DetailConfirm {
    canConfirm: boolean;
    confirmed: boolean;
    confirmFailed: boolean;
    /** His clip played on this screen: "ऐका आणि पक्कं करा" (heard), else "वाचा आणि पक्कं करा" (read) — D-44. */
    heard: boolean;
    onConfirm: () => void;
}

export interface DetailRecordCardProps {
    day: DayView;
    primary: RecordingView;
    /** The viewer's role on this farm, as the server last told this phone (only for his own name's bracket). */
    farmRole: string | null | undefined;
    unclear: readonly string[];
    clips: ReadonlyMap<string, VoiceClipCacheRecord>;
    playingId: string | null;
    lengthOf: (logId: string) => number | null;
    onTogglePlay: (logId: string) => void;
    sync: LogSyncState;
    syncQueuedOf: (logId: string) => boolean | null | undefined;
    confirm: DetailConfirm;
    onEdit: (logId: string) => void;
    /** Someone who does not check products sees that the owner will (the result screen's D-95 line). */
    speakerDone: boolean;
}

export const DetailRecordCard: React.FC<DetailRecordCardProps> = (p) => {
    const { primary, confirm } = p;
    const RS = useResultStr();
    const language = useOptionalLanguage()?.language;
    const copy = resultCopy(language);
    const SW = savedWords(language);
    const role = primary.who.you && p.farmRole ? SW.role[p.farmRole] : undefined;
    const clip = p.clips.get(primary.id);
    const severalPlots = p.day.current.length > 1;
    return (
        <section className="flex flex-col gap-2 rounded-[18px] border border-[#DDE3DA] bg-white p-3" data-testid="vr2d-record" style={{ fontFamily: SANS }}>
            <div className="flex flex-wrap gap-[5px]" data-testid="vr2d-badges">
                {primary.timeLabel && <Bd testId="vr2d-time">{primary.timeLabel}</Bd>}
                <Bd tone="who" testId="vr2d-who" you={primary.who.you}>{role ? `${primary.who.name} (${role})` : primary.who.name}</Bd>
                {primary.typed && <Bd tone="amber" testId="vr2d-typed">{copy.typedTag}</Bd>}
                <Bd tone="green" testId="vr2d-remembered">{RS.remembered.replace(/\s*✓$/, '')}</Bd>
                {p.sync === 'onServer' && <Bd tone="green" testId="vr2d-on-server">{RS.onServer}</Bd>}
                {p.sync === 'needsFix' && <Bd tone="amber" testId="vr2d-needs-fix">{RS.needsFix}</Bd>}
                {confirm.confirmed
                    ? <Bd tone="green" testId="vr2d-confirmed-badge">{`${RS.confirmedBadge} ✓`}</Bd>
                    : <Bd testId="vr2d-not-confirmed-badge">{RS.notConfirmed}</Bd>}
            </div>
            {!severalPlots && <div className="empty:hidden"><NotQueuedForServerBadge syncQueued={p.syncQueuedOf(primary.id)} /></div>}
            {primary.legacyPartial && <LegacyNote testId="vr2d-legacy-note" />}
            {p.speakerDone && <p className="m-0 text-[14px] font-bold leading-snug text-[#44403C]" data-testid="vr2d-speaker-done">{copy.speakerDone}</p>}

            <SavedWords framed={false} transcript={primary.transcript} wordsWithheld={primary.wordsWithheld} entries={p.day.current.flatMap(r => r.entries)}
                unclear={p.unclear}
                player={primary.typed ? <TypedNote testId="vr2d-typed-note" /> : (
                    <SavedClip clipKey={clip?.id ?? null} durationSec={clip ? p.lengthOf(primary.id) : null} playing={p.playingId === primary.id} big
                        onToggle={() => p.onTogglePlay(primary.id)} testId="vr2d-play" />
                )} />

            {confirm.canConfirm && (confirm.confirmed ? (
                <div className="mt-1 rounded-2xl border-2 border-[#0F6B3A] bg-white p-3 text-center text-[18px] font-extrabold text-[#0F6B3A]" data-testid="vr2d-confirm-done">
                    ✓ {RS.confirmedDone}
                    <div className="mt-0.5 text-[13px] font-bold" data-testid="vr2d-kept-safe">{RS.keptSafe}</div>
                </div>
            ) : (
                <div className="mt-1">
                    <div className="mb-1.5 text-[15px] font-extrabold text-[#1C1917]" data-testid="vr2d-confirm-basis">{confirm.heard ? RS.listenAndConfirm : RS.readAndConfirm}</div>
                    <button type="button" onClick={confirm.onConfirm} data-testid="vr2d-confirm"
                        className="min-h-[56px] w-full rounded-2xl bg-[#0F6B3A] p-[13px] text-[18px] font-extrabold text-white active:scale-[0.99]">
                        {`✔ ${RS.confirm}`}
                    </button>
                    {confirm.confirmFailed && <p className="m-0 mt-1 text-[13px] font-bold text-red-700" data-testid="vr2d-confirm-failed">{RS.confirmFailed}</p>}
                </div>
            ))}
            <SavedEditButtons day={p.day} primary={primary} syncQueuedOf={p.syncQueuedOf} onEdit={p.onEdit} prefix="vr2d" />
        </section>
    );
};

export default DetailRecordCard;
