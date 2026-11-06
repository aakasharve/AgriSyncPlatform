/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ActivityFeedCard — one line of "आजचा आढावा" (the sheet behind the one button on "माझं शेत"). It REPLACES `DailyLogCard`
 * (founder 2026-10-24: "remove the old UI but integrate the elements that were on it, and the current direction").
 *
 * Kept from the old card: the crop colour bar, what work, plot + crop, who, the time, the status, the location badge,
 * the attachments, the summary lines and the little per-bucket counts. Now readable in Marathi at >=12px.
 * New: a ▶ button when a recording exists (plays it), and pressing the card opens the log (or, in the preview, the
 * "everything understood from this recording" sheet).
 *
 * Presentational. Every Marathi string below is PROPOSED (the English it replaces was never translated).
 */
import React, { useEffect, useState } from 'react';
import { ChevronRight, MapPin, Pause, Play, User } from 'lucide-react';
import { CategoryIcon } from './shramsathi/understandingRing';
import type { TodayCounts } from '../../../types';
import type { LocationDto } from '../../../infrastructure/api/AgriSyncClient';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { AttachmentList } from '../../attachments';
import { useAttachmentRetry } from '../../attachments/hooks/useAttachmentRetry';
import LocationBadge from '../../location/components/LocationBadge';
import VerificationStatusBadge from './verification/VerificationStatusBadge';
import { PlaybackUnavailableNote, usePlaybackSwitch } from './voiceResult/playbackSwitch';

const SANS = "'Noto Sans Devanagari', sans-serif";
const SERIF = "'Noto Serif Devanagari', serif";

export const CARD_STR = {
    status: { pending: 'तपासणी बाकी', rejected: 'दुरुस्ती हवी', approved: 'तपासलं' },
    by: 'कोणी',
    attachments: (n: number) => `जोडलेले फोटो ${n}`,
    play: 'ऐका',
    stop: 'थांबवा',
    counts: { cropActivities: 'पीक काम', irrigation: 'पाणी', labour: 'मजूर', inputs: 'औषध / खत' },
} as const;

/** A recording behind this card: the ▶ button and its running time. */
export interface CardAudio {
    durationLabel: string;
    playing: boolean;
    onToggle: () => void;
}

export interface ActivityFeedCardProps {
    logId?: string;
    workDone: string;
    plotName: string;
    cropName: string;
    cropColor: string;
    loggedBy: string;
    timeLabel: string;
    statusTone: 'pending' | 'rejected' | 'approved';
    counts?: Partial<TodayCounts>;
    summaryLines?: string[];
    location?: LocationDto | null;
    verificationStatus?: string;
    attachmentCount?: number;
    /** What he said, in his words (two lines). */
    snippet?: string;
    audio?: CardAudio;
    /** Extra small marks (e.g. one icon per bucket this recording touched). */
    chips?: React.ReactNode;
    onClick: () => void;
}

const TONE = {
    pending: 'border-amber-300 bg-amber-50 text-amber-900',
    rejected: 'border-red-300 bg-red-50 text-red-900',
    approved: 'border-emerald-300 bg-emerald-50 text-emerald-900',
} as const;

const Count: React.FC<{ icon: React.ReactNode; count: number; label: string }> = ({ icon, count, label }) => (
    <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[12px] font-bold ${count > 0 ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-stone-200 bg-stone-50 text-stone-600'}`}>
        {icon}{label} <span className="font-extrabold">{count}</span>
    </span>
);

const ActivityFeedCard: React.FC<ActivityFeedCardProps> = ({
    logId, workDone, plotName, cropName, cropColor, loggedBy, timeLabel, statusTone, counts, summaryLines = [], location,
    verificationStatus, attachmentCount, snippet, audio, chips, onClick,
}) => {
    const playbackOff = usePlaybackSwitch() === false; // fix round 3 (M1): OFF - no ▶, the founder's words instead
    const [attachmentsOpen, setAttachmentsOpen] = useState(false);
    const [attachments, setAttachments] = useState<number>(attachmentCount ?? 0);
    const { retryUpload } = useAttachmentRetry();

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            if (!logId) { setAttachments(attachmentCount ?? 0); return; }
            try {
                const n = await getDatabase().attachments.where('linkedEntityId').equals(logId).count();
                if (!cancelled) setAttachments(n);
            } catch {
                if (!cancelled) setAttachments(attachmentCount ?? 0);
            }
        };
        void load();
        return () => { cancelled = true; };
    }, [logId, attachmentCount]);

    const c = { cropActivities: counts?.cropActivities || 0, irrigation: counts?.irrigation || 0, labour: counts?.labour || 0, inputs: counts?.inputs || 0 };
    const hasCounts = counts !== undefined;

    return (
        <div data-testid="log-list-item" className="relative overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm" style={{ fontFamily: SANS }}>
            <div className={`absolute bottom-0 left-0 top-0 w-1.5 ${cropColor}`} aria-hidden="true" />
            <div className="flex items-stretch gap-2 py-2 pl-3.5 pr-2">
                {audio && playbackOff && <PlaybackUnavailableNote testId="card-play-off" className="grid max-w-[7rem] shrink-0 place-items-center self-center rounded-xl border border-stone-200 bg-stone-50 px-2 py-1 text-center text-[12px] font-bold text-stone-700" />}
                {audio && !playbackOff && (
                    <button type="button" onClick={audio.onToggle} aria-label={audio.playing ? CARD_STR.stop : CARD_STR.play} data-testid="card-play"
                        className="grid h-12 w-12 shrink-0 place-items-center self-center rounded-full bg-emerald-700 text-white active:scale-95">
                        {audio.playing ? <Pause size={22} /> : <Play size={22} />}
                    </button>
                )}
                <button type="button" onClick={onClick} data-testid="card-open"
                    className="flex min-h-[52px] min-w-0 flex-1 items-center gap-2 rounded-xl text-left active:bg-stone-50">
                    <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-1.5">
                            {/* No time captured (a typed entry): no pill, never a made-up time (P4). */}
                            {timeLabel && <span className="inline-block shrink-0 rounded-full border border-stone-300 bg-stone-100 px-2 py-0.5 text-[12px] font-extrabold text-stone-700" data-testid="card-time">{timeLabel}</span>}
                            {audio && !playbackOff && <span className="text-[12px] font-bold tabular-nums text-stone-700" data-testid="card-duration">{audio.durationLabel}</span>}
                            {verificationStatus
                                ? <VerificationStatusBadge status={verificationStatus} size="sm" />
                                : <span className={`rounded-full border px-2 py-0.5 text-[12px] font-extrabold ${TONE[statusTone]}`} data-testid="card-status">{CARD_STR.status[statusTone]}</span>}
                        </span>
                        <span className="mt-1 block text-[17px] font-extrabold leading-tight text-stone-900" data-testid="card-work">{workDone}</span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] font-bold text-stone-800">
                            <span className="inline-flex items-center gap-1" data-testid="card-where"><MapPin size={14} className="text-emerald-700" />{cropName} · {plotName}</span>
                            <span className="inline-flex items-center gap-1" data-testid="card-by"><User size={14} className="text-stone-600" />{CARD_STR.by}: {loggedBy}</span>
                        </span>
                        {snippet && <span className="mt-1 line-clamp-2 block text-[14px] leading-snug text-stone-800" style={{ fontFamily: SERIF }} data-testid="card-snippet">{snippet}</span>}
                        {summaryLines.length > 0 && (
                            <span className="mt-1 block rounded-lg border border-stone-100 bg-stone-50 px-2 py-1">
                                {summaryLines.map((line, i) => <span key={`${line}-${i}`} className="block text-[12px] leading-relaxed text-stone-700">{line}</span>)}
                            </span>
                        )}
                        {(hasCounts || chips) && (
                            <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                {hasCounts && <>
                                    <Count icon={<CategoryIcon name="work" size={18} />} count={c.cropActivities} label={CARD_STR.counts.cropActivities} />
                                    <Count icon={<CategoryIcon name="water" size={18} />} count={c.irrigation} label={CARD_STR.counts.irrigation} />
                                    <Count icon={<CategoryIcon name="labour" size={18} />} count={c.labour} label={CARD_STR.counts.labour} />
                                    <Count icon={<CategoryIcon name="inputs" size={18} />} count={c.inputs} label={CARD_STR.counts.inputs} />
                                </>}
                                {chips}
                            </span>
                        )}
                        {location && <span className="mt-1 block"><LocationBadge location={location} /></span>}
                    </span>
                    <ChevronRight size={20} className="shrink-0 text-stone-500" aria-hidden="true" />
                </button>
            </div>
            {attachments > 0 && (
                <div className="pb-2 pl-3.5 pr-2">
                    <button type="button" onClick={() => setAttachmentsOpen(o => !o)} aria-expanded={attachmentsOpen} data-testid="card-attachments"
                        className="inline-flex min-h-[32px] items-center rounded-md border border-blue-200 bg-blue-50 px-2 text-[12px] font-bold text-blue-800">
                        {CARD_STR.attachments(attachments)}
                    </button>
                    {attachmentsOpen && logId && <div className="mt-1"><AttachmentList linkedEntityId={logId} compact onRetry={retryUpload} /></div>}
                </div>
            )}
        </div>
    );
};

export default ActivityFeedCard;
