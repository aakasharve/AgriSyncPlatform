/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I15; inventory S10 this phone's clips only, S11)
 *
 * One day of the schedule, opened from the झालं list, the recent-days strip or a line of आधी राहिलेलं काम:
 *   1. that day's recordings THIS PHONE holds for the plot, each playable with the voice diary's own player
 *      (`ClipPlayerCard`: local sealed/plain audio, or the saved copy when the phone kept only the link);
 *   2. the typed entries of that day, tagged "लिहिलेलं", with the parts each one recorded;
 *   3. what the schedule expected that day against what was done, and what was done without being asked
 *      ("जास्तीचं").
 * Not here, on purpose: the day's short story (S9 waits on decision B), who spoke (clips carry no speaker
 * yet, S10) and the expert's extras (no such record exists, S14).
 */
import React, { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import ClipPlayerCard, { type UnifiedClip } from '../../voiceDiary/components/ClipPlayerCard';
import { useFullHistoryJournalConsent } from '../../voiceDiary/hooks/useFullHistoryJournalConsent';
import type { VoiceClipCacheRecord } from '../../../infrastructure/storage/DexieDatabase';
import { archiveFailureKind, deriveCloudArchiveState } from '../../../infrastructure/voice/voiceArchiveState';
import { getArchiveConsentSince, recordedUnderConsent } from '../../../infrastructure/voice/voiceArchiveConsent';
import { useBackDismiss } from '../../../core/navigation/useBackDismiss';
import { formatFarmerTime } from '../../../shared/utils/displayTime';
import { SANS, Tap } from '../../../shared/components/ui/placeUi';
import type { DailyLog } from '../../../types';
import { dayDateLabel } from './scheduleDates';
import { SC } from './scheduleCopy';
import { PART_LABEL, PARTS, extrasOn, partsDone, type ScheduleDay } from './scheduleModel';
import { ItemLine, PartIcon, StatusChip } from './scheduleUi';

/**
 * A local recording as the voice diary's player reads it, with the SAME cloud-save rule the voice diary uses
 * (`deriveCloudArchiveState`: only the server's acknowledgement is "saved"; a clip waiting, uploading or
 * refused says so), so the player shows the same "not saved to the cloud yet" badge here as there.
 */
export function toUnifiedClip(r: VoiceClipCacheRecord, consentGranted: boolean, consentSince: string | null, nowMs: number = Date.now()): UnifiedClip {
    const eligible = recordedUnderConsent(r.recordedAtUtc, consentSince);
    return {
        id: r.id,
        recordedAtUtc: r.recordedAtUtc,
        durationMs: r.durationMs,
        status: r.status,
        lastError: r.lastError,
        source: 'local',
        localRecord: r,
        pendingCloudSave: consentGranted && !r.s3RetainedKey && eligible,
        cloudState: deriveCloudArchiveState(r, consentGranted, nowMs, eligible),
        cloudFailure: archiveFailureKind(r),
    };
}

/** That day's clips, played with the voice diary's player. Asks for the voice-keeping answer only when there are clips. */
const DayClips: React.FC<{ clips: readonly VoiceClipCacheRecord[] }> = ({ clips }) => {
    const { granted } = useFullHistoryJournalConsent();
    const [since, setSince] = useState<string | null>(null);
    useEffect(() => {
        let alive = true;
        void getArchiveConsentSince().catch(() => null).then(s => { if (alive) setSince(s); });
        return () => { alive = false; };
    }, []);
    return <div className="space-y-2">{clips.map(c => <ClipPlayerCard key={c.id} locale="mr-IN" clip={toUnifiedClip(c, granted, since)} />)}</div>;
};

export const isTyped = (log: DailyLog): boolean => log.meta?.provenance?.source === 'manual';

export const ScheduleDaySheet: React.FC<{ day: ScheduleDay; stageName: string | null; clips: readonly VoiceClipCacheRecord[]; onClose: () => void }> = ({ day, stageName, clips, onClose }) => {
    useBackDismiss(true, onClose);
    const typed = day.logs.filter(isTyped);
    const expectedParts = PARTS.filter(p => day.cells[p].items.length > 0);
    const extras = extrasOn(day);
    return (
        <div className="fixed inset-0 z-[60] flex justify-center bg-stone-900/30">
            <div className="flex h-full w-full max-w-md flex-col bg-stone-50" role="dialog" aria-modal="true" aria-label={SC.dayN(day.day)} data-testid="day-sheet" style={{ fontFamily: SANS }}>
                <div className="flex shrink-0 items-center gap-3 border-b border-stone-200 bg-white px-3 py-2.5">
                    <Tap onClick={onClose} data-testid="day-sheet-back" aria-label="मागे"
                        className="flex min-h-[52px] shrink-0 items-center gap-2 rounded-full border border-stone-300 bg-white pl-2 pr-5 text-stone-800 shadow-sm">
                        <span className="grid h-9 w-9 place-items-center rounded-full bg-stone-100"><ArrowLeft size={22} strokeWidth={2.75} aria-hidden="true" /></span>
                        <span className="text-[17px] font-extrabold">मागे</span>
                    </Tap>
                    <div className="min-w-0">
                        <p className="m-0 text-[17px] font-extrabold text-stone-900" data-testid="day-sheet-title">{SC.dayN(day.day)} · {dayDateLabel(day.key)}</p>
                        {stageName && <p className="m-0 text-[13px] font-bold text-stone-600">{SC.stage}: {stageName}</p>}
                    </div>
                </div>
                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 pb-24 pt-3">
                    <section data-testid="day-clips" data-count={clips.length}>
                        <h3 className="m-0 text-[16px] font-extrabold text-stone-800">{SC.voiceTalk} <span className="text-[14px] font-bold text-stone-600">({clips.length})</span></h3>
                        <p className="m-0 mb-2 text-[13px] font-bold text-stone-500">{SC.thisPhoneClips}</p>
                        {clips.length === 0
                            ? <p className="m-0 text-[15px] font-semibold text-stone-600" data-testid="day-no-clips">{SC.noClipsOnPhone}</p>
                            : <DayClips clips={clips} />}
                    </section>

                    {typed.length > 0 && (
                        <section data-testid="day-typed">
                            <h3 className="m-0 mb-2 text-[16px] font-extrabold text-stone-800">{SC.typedEntries}</h3>
                            <ul className="m-0 space-y-2 p-0">
                                {typed.map(log => {
                                    const parts = PARTS.filter(p => partsDone([log]).has(p));
                                    return (
                                        <li key={log.id} className="list-none rounded-2xl border border-stone-200 bg-white p-3" data-testid={`day-typed-${log.id}`}>
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="text-[15px] font-extrabold text-stone-800">{formatFarmerTime(log.meta?.createdAtISO, '')}</span>
                                                <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[13px] font-extrabold text-amber-900" data-testid="typed-tag">{SC.typed}</span>
                                            </div>
                                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                                                {parts.length === 0
                                                    ? <span className="text-[14px] font-bold text-stone-500">—</span>
                                                    : parts.map(p => <span key={p} className="inline-flex items-center gap-1.5 rounded-lg bg-stone-100 px-2 py-1 text-[14px] font-bold text-stone-800"><PartIcon part={p} size={24} />{PART_LABEL[p]}</span>)}
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>
                        </section>
                    )}

                    <section data-testid="day-vs">
                        <h3 className="m-0 mb-2 text-[16px] font-extrabold text-stone-800">{SC.vsTitle}</h3>
                        {expectedParts.length === 0 && <p className="m-0 mb-1 text-[15px] font-semibold text-stone-600" data-testid="day-no-expectation">{SC.noExpectation}</p>}
                        <div className="space-y-2.5">
                            {expectedParts.map(p => (
                                <div key={p} data-testid={`day-vs-${p}`} data-status={day.cells[p].status}>
                                    <p className="m-0 mb-1 flex items-center gap-2 text-[15px] font-extrabold text-stone-800"><PartIcon part={p} size={28} />{PART_LABEL[p]}</p>
                                    <ul className="m-0 space-y-1.5 p-0">{day.cells[p].items.map(i => <ItemLine key={i.key} item={i} status={day.cells[p].status} />)}</ul>
                                </div>
                            ))}
                        </div>
                        {extras.map(p => (
                            <p key={p} className="m-0 mt-2 flex items-center gap-2 rounded-xl border border-sky-300 bg-sky-50 px-2.5 py-1.5 text-[15px] font-extrabold text-sky-950" data-testid={`day-extra-${p}`}>
                                <StatusChip status="extra" />{PART_LABEL[p]}
                            </p>
                        ))}
                        {day.logs.length === 0 && <p className="m-0 mt-2 text-[14px] font-semibold text-stone-500" data-testid="day-nothing-recorded">{SC.nothingRecorded}</p>}
                    </section>
                </div>
            </div>
        </div>
    );
};

export default ScheduleDaySheet;
