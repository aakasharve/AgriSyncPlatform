/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I13) — the ONE result screen, wired to the real stores:
 * the saved logs (`history`), the clips on this phone (`db.voiceClips`, linked by the auto-save), the sync
 * queue (server acknowledgement), the existing verify (`verify_log_v2`) and the session's identity.
 *
 * Who sees "पक्कं आहे" (spec I27, founder D-44 / D-46 — AMENDS I13): only the PRIMARY OWNER, on his own recording,
 * as the server last told this phone — his "save and confirm", sent with whether he heard his clip or read his words.
 * The speaker is never asked to confirm his own record: a worker, a मुकादम (granted or not) and a co-owner see it stay
 * "पक्कं नाही" until the owner, or someone the owner trusts, confirms it in review. A role not yet known never sees
 * the button. A log whose create is not KNOWN to be in the sync queue is not offered either: its verify would be
 * refused as "not found".
 */
import React, { useMemo } from 'react';
import type { DailyLog, FarmerProfile } from '../../../../types';
import { useDataSource } from '../../../../app/providers/DataSourceProvider';
import type { VoiceResultState } from '../../../../app/hooks/useVoiceAutoSave';
import { resolveVerifierUserId } from '../../../../core/domain/verifierIdentity';
import { getSessionUserId } from '../../../../infrastructure/storage/AuthTokenStore';
import { clipScanFloor } from '../../../../infrastructure/voice/clipLogLink';
import { asWritten, buildDayView, isConfirmed, ringNodesForDay, sameDayLogs, type PartKey, type WhoDeps } from './resultModel';
import { RESULT_STR } from './resultStrings';
import { clipSeconds, useClipPlayback, useLogClips, type AudioFactory } from './useClipPlayback';
import { useConfirmRecording, useLogSyncState } from './useRecordingTrust';
import VoiceResultScreen from './VoiceResultScreen';

export interface VoiceResultContainerProps {
    result: VoiceResultState;
    history: readonly DailyLog[];
    farmerProfile: FarmerProfile;
    operatorNameById: ReadonlyMap<string, string>;
    farmId: string | null;
    /** The server-told role on this farm: only the primary owner confirms his own recording here (I27). */
    farmRole: string | null | undefined;
    placeLabel: string;
    /** Per log of this recording, from the save's enqueue result (false = will not reach the server). */
    syncQueuedById: ReadonlyMap<string, boolean | null>;
    onEdit: (log: DailyLog) => void;
    onBack: () => void;
    onAddAnother: () => void;
    questionPanel?: React.ReactNode;
    extras?: React.ReactNode;
    /** Test seam for the audio element. */
    createAudio?: AudioFactory;
}

export const VoiceResultContainer: React.FC<VoiceResultContainerProps> = ({
    result, history: liveHistory, farmerProfile, operatorNameById, farmId, farmRole, placeLabel, syncQueuedById,
    onEdit, onBack, onAddAnother, questionPanel, extras, createAudio,
}) => {
    const sessionUserId = getSessionUserId();
    // L6b fix — what Sathi understood from the recording just made is read as this phone wrote it: the first sync
    // pull rebuilds those items from the server's flattened tasks and loses his phrases and amounts (`asWritten`).
    const history = useMemo(() => {
        if (!result.written?.length) return liveHistory;
        const written = new Map(result.written.map(l => [l.id, l] as const));
        return liveHistory.map(l => asWritten(l, written.get(l.id)) ?? l);
    }, [liveHistory, result.written]);
    const current = useMemo(
        () => result.logIds.map(id => history.find(l => l.id === id)).filter((l): l is DailyLog => !!l),
        [result.logIds, history],
    );
    const deps: WhoDeps = useMemo(() => ({
        youIds: new Set([farmerProfile.activeOperatorId, sessionUserId].filter((x): x is string => !!x)),
        nameOf: id => operatorNameById.get(id),
        youLabel: RESULT_STR.you,
        unknownLabel: RESULT_STR.unknownPerson,
    }), [farmerProfile.activeOperatorId, sessionUserId, operatorNameById]);
    const day = useMemo(() => buildDayView(current, history, deps), [current, history, deps]);
    const dayLogs = useMemo(() => sameDayLogs(current, history), [current, history]);
    const nodes = useMemo(() => ringNodesForDay(dayLogs, current[0]?.date), [dayLogs, current]);
    const clipFloor = useMemo(() => clipScanFloor([...current, ...dayLogs]), [current, dayLogs]);

    const { clips, ready: clipsReady } = useLogClips([...day.current, ...day.earlier].map(r => r.id), clipFloor);
    const playback = useClipPlayback(createAudio);
    const sync = useLogSyncState(result.logIds);

    const { dataSource, auditPort } = useDataSource();
    const verifierUserId = resolveVerifierUserId(farmerProfile.activeOperatorId, sessionUserId);
    const trust = useConfirmRecording({ verifierUserId, repository: dataSource.logs, auditPort, profile: farmerProfile });
    const mayConfirmOwn = farmRole === 'PrimaryOwner';

    if (current.length === 0) return null;
    // Only a log KNOWN to be on its way to the server can be verified there. `null` (the write held but the
    // enqueue threw, or a demo save) is no evidence either way: its verify would reach the server before any
    // create and be refused as "not found" — a row he would then be asked to fix. So no button for it (P5).
    const confirmable = current.filter(l => syncQueuedById.get(l.id) === true);
    const confirmed = confirmable.length > 0 && confirmable.every(l => trust.confirmed.has(l.id) || isConfirmed(l));
    const primary = current.find(l => !!l.fullTranscript) ?? current[0];
    // D-44: "whether they listened to the original voice or reviewed the text" — his clip played on this screen, or not.
    const basis: 'heard' | 'read' = playback.heard.has(primary.id) ? 'heard' : 'read';
    const leave = (then: () => void) => () => { playback.stop(); then(); };

    return (
        <VoiceResultScreen
            day={day}
            recordingKey={result.key}
            placeLabel={placeLabel}
            farmId={farmId}
            nodes={nodes}
            unclear={result.unclear}
            clips={clips}
            clipsReady={clipsReady}
            playingId={playback.playingId}
            progress={playback.progress}
            lengthOf={id => clipSeconds(id, clips.get(id), playback.lengths)}
            heard={playback.heard}
            onTogglePlay={id => { const clip = clips.get(id); if (clip) void playback.toggle(id, clip); }}
            sync={sync}
            syncQueuedOf={id => syncQueuedById.get(id)}
            canConfirm={mayConfirmOwn && !!verifierUserId && confirmable.length > 0}
            confirmed={confirmed}
            confirmFailed={!!trust.failed}
            onConfirm={() => { void (async () => { for (const l of confirmable) await trust.confirm(l.id, basis); })(); }}
            onEdit={id => leave(() => onEdit(current.find(l => l.id === id) ?? primary))()}
            onBack={leave(onBack)}
            onAddAnother={leave(onAddAnother)}
            onTellMore={(_part: PartKey) => leave(onAddAnother)()}
            questionPanel={questionPanel}
            extras={extras}
        />
    );
};

export default VoiceResultContainer;
