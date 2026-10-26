/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I13) — the ONE result screen, wired to the real stores:
 * the saved logs (`history`), the clips on this phone (`db.voiceClips`, linked by the auto-save), the sync
 * queue (server acknowledgement), the existing verify (`verify_log_v2`) and the session's identity.
 */
import React, { useMemo } from 'react';
import type { DailyLog, FarmerProfile } from '../../../../types';
import { useDataSource } from '../../../../app/providers/DataSourceProvider';
import type { VoiceResultState } from '../../../../app/hooks/useVoiceAutoSave';
import { resolveVerifierUserId } from '../../../../core/domain/verifierIdentity';
import { getSessionUserId } from '../../../../infrastructure/storage/AuthTokenStore';
import { isOwnerTierRole } from '../../../profile/helpers/teamRoster';
import { buildDayView, isConfirmed, ringNodesForDay, sameDayLogs, type PartKey, type WhoDeps } from './resultModel';
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
    /** The server-told role on this farm: only the owner tier may confirm (verify). */
    farmRole: string | null | undefined;
    placeLabel: string;
    syncQueued: boolean | null | undefined;
    onEdit: (log: DailyLog) => void;
    onBack: () => void;
    onAddAnother: () => void;
    questionPanel?: React.ReactNode;
    extras?: React.ReactNode;
    /** Test seam for the audio element. */
    createAudio?: AudioFactory;
}

export const VoiceResultContainer: React.FC<VoiceResultContainerProps> = ({
    result, history, farmerProfile, operatorNameById, farmId, farmRole, placeLabel, syncQueued,
    onEdit, onBack, onAddAnother, questionPanel, extras, createAudio,
}) => {
    const sessionUserId = getSessionUserId();
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
    const nodes = useMemo(() => ringNodesForDay(sameDayLogs(current, history), current[0]?.date), [current, history]);

    const clips = useLogClips([...day.current, ...day.earlier].map(r => r.id));
    const playback = useClipPlayback(createAudio);
    const sync = useLogSyncState(result.logIds);

    const { dataSource, auditPort } = useDataSource();
    const verifierUserId = resolveVerifierUserId(farmerProfile.activeOperatorId, sessionUserId);
    const trust = useConfirmRecording({ verifierUserId, repository: dataSource.logs, auditPort, profile: farmerProfile });

    if (current.length === 0) return null;
    const confirmed = current.every(l => trust.confirmed.has(l.id) || isConfirmed(l));
    const primary = current.find(l => !!l.fullTranscript) ?? current[0];
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
            playingId={playback.playingId}
            progress={playback.progress}
            lengthOf={id => clipSeconds(id, clips.get(id), playback.lengths)}
            heard={playback.heard}
            onTogglePlay={id => { const clip = clips.get(id); if (clip) void playback.toggle(id, clip); }}
            sync={sync}
            syncQueued={syncQueued}
            canConfirm={isOwnerTierRole(farmRole) && !!verifierUserId}
            confirmed={confirmed}
            confirmFailed={!!trust.failed}
            onConfirm={() => { void (async () => { for (const l of current) await trust.confirm(l.id); })(); }}
            onEdit={leave(() => onEdit(primary))}
            onBack={leave(onBack)}
            onAddAnother={leave(onAddAnother)}
            onTellMore={(_part: PartKey) => leave(onAddAnother)()}
            questionPanel={questionPanel}
            extras={extras}
        />
    );
};

export default VoiceResultContainer;
