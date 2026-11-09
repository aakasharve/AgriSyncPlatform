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
import React, { useMemo, useState } from 'react';
import type { DailyLog, FarmerProfile } from '../../../../types';
import { useDataSource } from '../../../../app/providers/DataSourceProvider';
import type { VoiceResultState } from '../../../../app/hooks/useVoiceAutoSave';
import { resolveVerifierUserId } from '../../../../core/domain/verifierIdentity';
import { getSessionUserId } from '../../../../infrastructure/storage/AuthTokenStore';
import { clipScanFloor } from '../../../../infrastructure/voice/clipLogLink';
import { useOptionalFarmContext } from '../../../../core/session/FarmContext';
import { AUTHORITY, holdsAuthority } from '../../../../core/session/farmAuthorities';
import { seeMoneyDoor, useStoredAccessScopes } from '../../../../core/session/storedFarmScope';
import { mayShowFarmMoney } from '../../../labour/homeAttendanceDoor';
import { AssertInputIdentityCommand } from '../../../../application/usecases/sync/AssertInputIdentityCommand';
import { captureAttachment } from '../../../../application/use-cases/CaptureAttachment';
import { CATALOG_VERSION } from '../../../../domain/inputs/inputCatalog';
import type { MixRule } from '../../../../domain/inputs/mixVerdict';
import type { ProductAnswerKit } from './ProductCard';
import { buildDayView, isConfirmed, ringNodesForDay, sameDayLogs, type PartKey, type WhoDeps } from './resultModel';
import { useResultStr } from './resultStrings';
import { clipSeconds, useClipPlayback, useLogClips, type AudioFactory } from './useClipPlayback';
import { useConfirmRecording, useLastSyncAt, useLogSyncState } from './useRecordingTrust';
import VoiceResultScreen from './VoiceResultScreen';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import { canMoveSavedEntry } from '../correction/correctionCapabilities';
import { isLabourDoorLog } from '../correction/correctionModel';
import { readRefusedChange, refusalLines, useRefusedChangeOf } from '../correction/refusedRevision';
import { moneyNotFollowedLines, useMoneyNotFollowedOf } from '../correction/moneyNotFollowed';
import { readMoneyNotFollowed } from '../../../finance/editMoney';
import { DayPickSheet } from '../dayPick/DayPickSheet';
import { AudienceRow } from '../../../recordAudience/AudienceRow';

/** The holder's own name from the session profile; the app's placeholder for "no name yet" is not a name. */
const ownNameOf = (name: string | undefined): string | undefined => {
    const n = (name ?? '').trim();
    return n && n.toLowerCase() !== 'owner' ? n : undefined;
};

export interface VoiceResultContainerProps {
    result: VoiceResultState;
    history: readonly DailyLog[];
    farmerProfile: FarmerProfile;
    operatorNameById: ReadonlyMap<string, string>;
    farmId: string | null;
    /** The server-told role on this farm: only the primary owner confirms his own recording here (I27). */
    farmRole: string | null | undefined;
    placeLabel: string | ((language: string | undefined) => string);
    /** Per log of this recording, from the save's enqueue result (false = will not reach the server). */
    syncQueuedById: ReadonlyMap<string, boolean | null>;
    onEdit: (log: DailyLog) => void;
    onBack: () => void;
    onAddAnother: () => void;
    /** Lane MIC-1 — "… सांगितलं नाही. दाबा आणि बोला": the ONE mic for that part. Absent = the same as "आणखी सांगा". */
    onTellMore?: (part: PartKey) => void;
    questionPanel?: React.ReactNode;
    extras?: React.ReactNode;
    /** Test seam for the audio element. */
    createAudio?: AudioFactory;
    /**
     * Lane OF-S (rule TAP-1, item 6) — put this SAVED recording on another day: the day chip opens the calendar and the
     * chosen day is queued as a move of each of its entries (`queueSavedEntryMove`). Absent = the day is shown, not offered.
     */
    onMoveDay?: (logs: readonly DailyLog[], dateKey: string) => Promise<void>;
    /** Lane IT4 - the mixing rules the combination boxes use. Default: the shippable list (no red rule is reviewed yet, D-96). Test seam. */
    mixRules?: readonly MixRule[];
}

export const VoiceResultContainer: React.FC<VoiceResultContainerProps> = ({
    result, history, farmerProfile, operatorNameById, farmId, farmRole, placeLabel, syncQueuedById,
    onEdit, onBack, onAddAnother, onTellMore, questionPanel, extras, createAudio, onMoveDay, mixRules,
}) => {
    const [pickingDay, setPickingDay] = useState(false);
    const sessionUserId = getSessionUserId();
    const RS = useResultStr();
    const language = useOptionalLanguage()?.language;
    // lane F1 — the screen reads the RECORD. The L6b work-around that read this phone's own write instead
    // (`asWritten`) is gone: the server now keeps what Sathi understood and the pull hands it back exactly, so
    // the record after a pull is the write, his phrases and amounts included.
    const current = useMemo(
        () => result.logIds.map(id => history.find(l => l.id === id)).filter((l): l is DailyLog => !!l),
        [result.logIds, history],
    );
    const deps: WhoDeps = useMemo(() => ({
        youIds: new Set([farmerProfile.activeOperatorId, sessionUserId].filter((x): x is string => !!x)),
        nameOf: id => operatorNameById.get(id),
        // Lane IT4 Task 0b (founder 2026-11-06): the holder is shown by his own name, never "तुम्ही". The profile's default
        // placeholder ("Owner") is not a name: it reads as unknown.
        ownName: ownNameOf(farmerProfile.name),
        unknownLabel: RS.unknownPerson,
        language,
        // Lane IT-D2 (founder D-123b): in Marathi mode this screen writes its numbers and times in Devanagari digits.
        nativeDigits: true,
    }), [farmerProfile.activeOperatorId, farmerProfile.name, sessionUserId, operatorNameById, RS, language]);
    const day = useMemo(() => buildDayView(current, history, deps), [current, history, deps]);
    const dayLogs = useMemo(() => sameDayLogs(current, history), [current, history]);
    const nodes = useMemo(() => ringNodesForDay(dayLogs, current[0]?.date), [dayLogs, current]);
    const clipFloor = useMemo(() => clipScanFloor([...current, ...dayLogs]), [current, dayLogs]);

    const { clips, ready: clipsReady } = useLogClips([...day.current, ...day.earlier].map(r => r.id), clipFloor);
    const playback = useClipPlayback(createAudio);
    const sync = useLogSyncState(result.logIds);
    // Lane OF-S fix 1 (B011): a change to this recording the server refused later (a day moved by the chip) says why HERE.
    const lastSyncAt = useLastSyncAt();
    const refused = useRefusedChangeOf(result.logIds, readRefusedChange, lastSyncAt);
    // Lane OF-M — money a change he saved here could not change, said where he saved it.
    const moneyNotFollowed = moneyNotFollowedLines(useMoneyNotFollowedOf(result.logIds, readMoneyNotFollowed, lastSyncAt), language);

    const { dataSource, auditPort } = useDataSource();
    const verifierUserId = resolveVerifierUserId(farmerProfile.activeOperatorId, sessionUserId);
    const trust = useConfirmRecording({ verifierUserId, repository: dataSource.logs, auditPort, profile: farmerProfile });
    const mayConfirmOwn = farmRole === 'PrimaryOwner';

    // Lane IT4 Task 2 (founder D-95): who may CHECK products (the confirm-records authority) and who may see money. The server
    // decides what an answer is; the phone only draws the right words. Without a farm context only the primary owner checks.
    const currentFarm = useOptionalFarmContext()?.currentFarm ?? null;
    const storedScopes = useStoredAccessScopes();
    const canCheck = mayConfirmOwn || holdsAuthority(currentFarm, AUTHORITY.confirmRecords);
    const canSeeMoney = mayShowFarmMoney(farmRole, seeMoneyDoor(storedScopes, farmId, currentFarm));
    const ownName = deps.ownName;
    const answerKit: ProductAnswerKit = useMemo(() => {
        const logById = new Map<string, DailyLog>([...dayLogs, ...current].map(l => [l.id, l] as const));
        const farmOf = (logId: string): string | null => logById.get(logId)?.meta?.farmId ?? farmId;
        const enqueue = async (logId: string, item: { ref?: { eventId: string; mixIndex: number } }, rest: { verdict: 'confirmed' | 'rejected' | 'photo'; catalogProductId?: string; attachmentId?: string }) => {
            const farm = farmOf(logId);
            if (!farm || !item.ref) throw new Error('VoiceResultContainer: this product cannot be answered about yet.');
            await AssertInputIdentityCommand.enqueue({
                farmId: farm, dailyLogId: logId, inputEventId: item.ref.eventId, mixIndex: item.ref.mixIndex,
                catalogVersion: CATALOG_VERSION, ...rest,
            });
        };
        return {
            logById,
            canCheck,
            canSeeMoney,
            nameOfUser: userId => (userId && (operatorNameById.get(userId) || (userId === sessionUserId ? ownName : undefined))) || RS.unknownPerson,
            cropNamesOf: logId => (logById.get(logId)?.context?.selection ?? []).map(s => s.cropName).filter((n): n is string => !!n),
            onAnswer: ({ logId, item, verdict, catalogProductId }) => enqueue(logId, item, { verdict, ...(catalogProductId ? { catalogProductId } : {}) }),
            // The photo goes with the SAME record as its parent ("DailyLog"), through the existing attachment flow; the answer
            // then points at it (the photo may not have reached the server yet - the server takes a pointer).
            onPhoto: async ({ logId, item }) => {
                const farm = farmOf(logId);
                if (!farm) throw new Error('VoiceResultContainer: no farm for this photo.');
                const photo = await captureAttachment({ source: 'camera', farmId: farm, linkedEntityId: logId, linkedEntityType: 'DailyLog' });
                await enqueue(logId, item, { verdict: 'photo', attachmentId: photo.id });
            },
        };
    }, [dayLogs, current, farmId, canCheck, canSeeMoney, operatorNameById, sessionUserId, ownName, RS]);

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

    // A हजेरी-door record is changed in the हजेरी वही, never moved from here (none reaches this screen today: its save
    // goes to the saved card — this keeps it so).
    const moveDay = canMoveSavedEntry() && onMoveDay && !current.some(isLabourDoorLog) ? onMoveDay : undefined;

    return (
        <>
        {refused && (
            <div className="mx-3 mt-2 rounded-2xl border border-red-200 bg-red-50 p-3 text-[15px] font-bold text-red-800" data-testid="vr-move-refused" role="status">
                {refusalLines(refused, language).map(line => <p key={line} className="m-0">{line}</p>)}
            </div>
        )}
        {/* lane PRV (D-26) — who may see this record: the farm's primary account holder only, once it is on its way to
            the server (the choice is queued after the record itself). Never asked at capture (P9). */}
        {mayConfirmOwn && farmId && current.every(l => typeof l.contentVersion === 'number' || syncQueuedById.get(l.id) === true) && (
            <div className="mx-3 mt-2">
                <AudienceRow kind="DailyLog" recordIds={current.map(l => l.id)} farmId={farmId} selfUserId={sessionUserId}
                    audience={primary.audience} chosen={primary.audienceUserIds} moneyFollows testId="vr-audience"
                    madeBySomeoneElse={!!primary.meta?.createdByOperatorId && primary.meta.createdByOperatorId !== 'owner'
                        && primary.meta.createdByOperatorId !== sessionUserId} />
            </div>
        )}
        {moneyNotFollowed.length > 0 && (
            <div className="mx-3 mt-2 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-[15px] font-bold text-amber-950" data-testid="vr-money-not-followed" role="status">
                {moneyNotFollowed.map(line => <p key={line} className="m-0">{line}</p>)}
            </div>
        )}
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
            onConfirm={() => { void (async () => { for (const l of confirmable) await trust.confirm(l.id, basis, l.contentVersion); })(); }}
            onEdit={id => leave(() => onEdit(current.find(l => l.id === id) ?? primary))()}
            onBack={leave(onBack)}
            onAddAnother={leave(onAddAnother)}
            onTellMore={(part: PartKey) => leave(() => (onTellMore ? onTellMore(part) : onAddAnother()))()}
            questionPanel={questionPanel}
            extras={extras}
            onChangeDay={moveDay ? () => setPickingDay(true) : undefined}
            answerKit={answerKit}
            mixRules={mixRules}
        />
        {moveDay && pickingDay && (
            <DayPickSheet
                value={primary.date}
                onPick={key => {
                    setPickingDay(false);
                    if (key === primary.date) return;
                    void moveDay(current, key).catch((error: unknown) => {
                        // Never silent: he is told the day did not change (pressing again is safe — the same move is
                        // queued once, `MoveDailyLogCommand`), and what failed is kept in the log.
                        console.error('VoiceResultContainer: the day could not be changed', error);
                        window.dispatchEvent(new CustomEvent('agrisync:toast', { detail: { message: RS.dayNotMoved, type: 'error' } }));
                    });
                }}
                onClose={() => setPickingDay(false)}
            />
        )}
        </>
    );
};

export default VoiceResultContainer;
