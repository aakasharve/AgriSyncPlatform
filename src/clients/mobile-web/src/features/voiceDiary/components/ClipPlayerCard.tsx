// spec: voice-diary-e2e-2026-05-17 (D.8)
//
// Single voice clip player card. Renders one of:
//   - LOCAL clip (< 30d, lives in Dexie):  source badge = "local"
//   - CLOUD clip (retained, lives in S3):  source badge = "cloud"
//
// For local clips the audio plays through `readVoiceClipPlaintext` →
// blob URL. For cloud clips the player lazy-fetches the ciphertext via
// `getVoiceDiaryById(clipId)`, opens it under the resolved DEK
// (Phase 05 envelope encryption), and renders the same Blob URL.
//
// Status badge mirrors V1 DayClipList semantics (parsed / parsing /
// failed / queued / recorded) but uses the i18n bundle.

import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Clock, AlertCircle, Loader2, Mic, Play, Pause, Cloud, CloudOff, HardDrive } from 'lucide-react';
import type { VoiceClipCacheRecord, VoiceClipStatus } from '../../../infrastructure/storage/DexieDatabase';
import { readVoiceClipPlaintext } from '../../../infrastructure/voice/VoiceClipRetention';
import { openRetainedClip } from '../../../infrastructure/voice/retainedClipReader';
import type { CloudArchiveState } from '../../../infrastructure/voice/voiceArchiveState';
import {
    type VoiceDiaryLocale,
    tVoiceDiary,
} from '../../../i18n/voiceDiaryTranslations';
import { formatDisplayTime } from '../../../shared/utils/displayTime';

/**
 * Unified clip projection consumed by the player. Either a local Dexie
 * record (`source: 'local'`) or a retained-tier list-item shim
 * (`source: 'cloud'`). The unified view in VoiceDiaryPage maps both
 * sources onto this shape.
 */
export interface UnifiedClip {
    id: string;
    recordedAtUtc: string;
    durationMs?: number;
    /** Only set for local clips; mirrors VoiceClipCacheRecord.status. */
    status?: VoiceClipStatus;
    /** Only set for local clips; surfaced as the inline error chip. */
    lastError?: string;
    /** Where the clip lives — drives the badge + audio fetch path. */
    source: 'local' | 'cloud';
    /** Underlying local record (only for source === 'local'). */
    localRecord?: VoiceClipCacheRecord;
    /**
     * spec: dfes-companion-2026-07-11 (farm-memory).
     * True when this farmer keeps his voice as Farm Memory but the
     * server has not acknowledged THIS clip yet. It is not an error
     * state — the recording is safe on the phone and the upload will be
     * retried — but he has to be able to see it, because until the
     * acknowledgement arrives the phone holds the only copy.
     */
    pendingCloudSave?: boolean;
    /**
     * spec: 2026-08-25-prod-cutover-waves (voice archive path).
     * Where this clip is in the cloud-save state machine. `acknowledged` is the
     * ONLY value that may be shown as saved to the cloud, and it means the
     * SERVER echoed this clip's id. Absent = unknown, rendered as not saved.
     */
    cloudState?: CloudArchiveState;
    /**
     * Why the last upload failed: `network` earns the connectivity message
     * (which promises a retry); anything else gets the plain "could not save".
     */
    cloudFailure?: 'network' | 'other';
}

interface Props {
    locale: VoiceDiaryLocale;
    clip: UnifiedClip;
}

const formatTime = (iso: string): string => formatDisplayTime(iso, '--:--');

const formatDuration = (durationMs?: number): string => {
    if (!durationMs || durationMs <= 0) return '0:00';
    const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

interface StatusPresentation {
    label: string;
    icon: React.ElementType;
    className: string;
    spin?: boolean;
}

const getStatusPresentation = (
    locale: VoiceDiaryLocale,
    status?: VoiceClipStatus,
): StatusPresentation | null => {
    if (!status) {
        // Cloud clips don't carry processing status (already parsed by the time
        // they reached the retained tier).
        return {
            label: tVoiceDiary(locale, 'clipBadge.processed'),
            icon: CheckCircle2,
            className: 'bg-emerald-50 text-emerald-700 border-emerald-100',
        };
    }
    switch (status) {
        case 'parsed':
            return {
                label: tVoiceDiary(locale, 'clipBadge.processed'),
                icon: CheckCircle2,
                className: 'bg-emerald-50 text-emerald-700 border-emerald-100',
            };
        case 'parsing':
            return {
                label: tVoiceDiary(locale, 'clipBadge.parsing'),
                icon: Loader2,
                className: 'bg-blue-50 text-blue-700 border-blue-100',
                spin: true,
            };
        case 'failed':
            return {
                label: tVoiceDiary(locale, 'clipBadge.failed'), // speech understanding failed (NOT playback)
                icon: AlertCircle,
                className: 'bg-rose-50 text-rose-700 border-rose-100',
            };
        case 'queued':
            return {
                label: tVoiceDiary(locale, 'clipBadge.queued'),
                icon: Clock,
                className: 'bg-amber-50 text-amber-700 border-amber-100',
            };
        case 'recorded':
        default:
            return {
                label: tVoiceDiary(locale, 'clipBadge.recorded'),
                icon: Mic,
                className: 'bg-stone-50 text-stone-700 border-stone-100',
            };
    }
};

const ClipPlayerCard: React.FC<Props> = ({ locale, clip }) => {
    const [audioUrl, setAudioUrl] = useState<string>('');
    const [isPlaying, setIsPlaying] = useState(false);
    const [fetchingCloud, setFetchingCloud] = useState(false);
    const [fetchError, setFetchError] = useState<string | null>(null);
    const audioRef = React.useRef<HTMLAudioElement | null>(null);

    // Local clips: synchronously open the plaintext via the V18 sealed
    // path (or fall back to the legacy plaintext blob if present).
    useEffect(() => {
        if (clip.source !== 'local') {
            return;
        }
        const record = clip.localRecord;
        if (!record) {
            return;
        }
        let cancelled = false;
        let createdUrl: string | null = null;
        (async () => {
            try {
                // Prefer sealed → DEK roundtrip → plaintext bytes.
                const pt = await readVoiceClipPlaintext(record.id);
                if (cancelled) return;
                if (pt) {
                    const blob = new Blob([pt], { type: record.mimeType });
                    createdUrl = URL.createObjectURL(blob);
                    setAudioUrl(createdUrl);
                    return;
                }
                // Legacy plaintext fallback (pre-v18 rows).
                if (record.localBlob) {
                    createdUrl = URL.createObjectURL(record.localBlob);
                    setAudioUrl(createdUrl);
                }
            } catch (err) {
                if (!cancelled) {
                    setFetchError(err instanceof Error ? err.message : 'audio_read_failed');
                }
            }
        })();
        return () => {
            cancelled = true;
            if (createdUrl) URL.revokeObjectURL(createdUrl);
        };
    }, [clip]);

    // Cloud clips: lazy-fetch on first play to avoid hauling audio bytes for
    // every calendar paint. Also the fallback for a clip the server holds but
    // this phone no longer does (fresh install, new phone).
    // Returns the playable URL, or null when the recording could not be opened. The URL is returned (not just
    // stored in state) because the caller must put it on the <audio> element itself: React has not re-rendered yet.
    const ensureCloudAudioUrl = useCallback(async (): Promise<string | null> => {
        if (audioUrl) return audioUrl;
        if (fetchingCloud) return null;
        setFetchingCloud(true);
        setFetchError(null);
        try {
            const result = await openRetainedClip(clip.id);
            if (!result.ok) {
                setFetchError(result.error);
                return null;
            }
            const blob = new Blob([result.bytes], { type: result.mimeType });
            const url = URL.createObjectURL(blob);
            setAudioUrl(url);
            return url;
        } catch (err) {
            setFetchError(err instanceof Error ? err.message : 'cloud_fetch_failed');
            return null;
        } finally {
            setFetchingCloud(false);
        }
    }, [audioUrl, clip.id, fetchingCloud]);

    const handlePlayPause = useCallback(async () => {
        let url = audioUrl;
        if (!url && (clip.source === 'cloud' || clip.localRecord?.s3RetainedKey)) {
            url = (await ensureCloudAudioUrl()) ?? '';
            // Could not open the recording: the error is already shown; there is nothing to play.
            if (!url) return;
        }
        const el = audioRef.current;
        if (!el) return;
        // The fetched URL is only in React state; set it on the element now so the very first tap plays.
        if (url && el.getAttribute('src') !== url) {
            el.src = url;
        }
        if (el.paused) {
            await el.play().catch(() => undefined);
            setIsPlaying(true);
        } else {
            el.pause();
            setIsPlaying(false);
        }
    }, [audioUrl, clip.source, clip.localRecord?.s3RetainedKey, ensureCloudAudioUrl]);

    const status = getStatusPresentation(locale, clip.status);
    const StatusIcon = status?.icon ?? CheckCircle2;
    // The cloud badge is earned by the server's acknowledgement (or by the
    // server listing the clip) and by nothing else.
    const inCloud = clip.source === 'cloud' || clip.cloudState === 'acknowledged';
    const SourceIcon = inCloud ? Cloud : HardDrive;
    const sourceBadgeKey = inCloud ? 'clipBadge.cloud' : 'clipBadge.local';
    const sourceBadgeCls = inCloud
        ? 'bg-sky-50 text-sky-700'
        : 'bg-stone-100 text-stone-700';
    // One honest not-yet-saved badge per state. `queued` keeps the original
    // wording; `uploading` and `failed` say what is happening without claiming
    // the clip is safe.
    const unsavedKey = clip.cloudState === 'uploading'
        ? 'clipBadge.uploading'
        : clip.cloudState === 'failed'
            ? (clip.cloudFailure === 'network' ? 'clipBadge.uploadFailed' : 'clipBadge.uploadRefused')
            : clip.cloudState === 'queued' || clip.pendingCloudSave
                ? 'clipBadge.pendingCloudSave'
                : null;

    return (
        <article
            data-testid={`voice-diary-clip-card-${clip.id}`}
            data-source={clip.source}
            className="rounded-3xl bg-white p-4 flex items-center gap-3 shadow-sm"
        >
            <button
                type="button"
                onClick={() => void handlePlayPause()}
                aria-label={isPlaying ? 'Pause' : 'Play'}
                data-testid={`voice-diary-clip-play-${clip.id}`}
                className="h-11 w-11 shrink-0 rounded-full bg-emerald-600 text-white flex items-center justify-center active:bg-emerald-700"
            >
                {fetchingCloud ? (
                    <Loader2 size={18} className="animate-spin" />
                ) : isPlaying ? (
                    <Pause size={18} />
                ) : (
                    <Play size={18} />
                )}
            </button>

            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <span className="font-['DM_Sans'] font-bold text-sm text-stone-900 tabular-nums">
                        {formatTime(clip.recordedAtUtc)}
                    </span>
                    <span className="font-['DM_Sans'] text-xs text-stone-500 tabular-nums">
                        {formatDuration(clip.durationMs)}
                    </span>
                </div>
                <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                    <span
                        data-testid={`voice-diary-clip-source-${clip.id}`}
                        className={`inline-flex max-w-full items-start gap-1 ${sourceBadgeCls} text-xs font-['DM_Sans'] font-bold leading-snug whitespace-normal break-words text-left rounded-2xl px-2 py-1`}
                    >
                        <SourceIcon size={12} className="mt-0.5 shrink-0" />
                        <span className="min-w-0 break-words">{tVoiceDiary(locale, sourceBadgeKey)}</span>
                    </span>
                    {unsavedKey && !inCloud && (
                        <span
                            data-testid={`voice-diary-clip-pending-cloud-${clip.id}`}
                            data-cloud-state={clip.cloudState ?? 'queued'}
                            className="inline-flex max-w-full items-start gap-1 border bg-amber-50 text-amber-800 border-amber-200 text-xs font-['DM_Sans'] font-bold leading-snug whitespace-normal break-words text-left rounded-2xl px-2 py-1"
                        >
                            <CloudOff size={12} className="mt-0.5 shrink-0" />
                            <span className="min-w-0 break-words">{tVoiceDiary(locale, unsavedKey)}</span>
                        </span>
                    )}
                    {status && (
                        <span
                            className={`inline-flex max-w-full items-start gap-1 border ${status.className} text-xs font-['DM_Sans'] font-bold leading-snug whitespace-normal break-words text-left rounded-2xl px-2 py-1`}
                        >
                            <StatusIcon size={12} className={`mt-0.5 shrink-0 ${status.spin ? 'animate-spin' : ''}`} />
                            <span className="min-w-0 break-words">{status.label}</span>
                        </span>
                    )}
                </div>
                {fetchError && (
                    <p data-testid={`voice-diary-clip-play-error-${clip.id}`} data-error={fetchError} className="mt-1 text-xs font-['DM_Sans'] text-rose-600 whitespace-normal break-words">
                        {tVoiceDiary(locale, 'clipBadge.playbackUnavailable')}
                    </p>
                )}
                {clip.lastError && !fetchError && (
                    <p className="mt-1 text-xs font-['DM_Sans'] text-rose-600 whitespace-normal break-words">
                        {clip.lastError}
                    </p>
                )}
            </div>

            <audio
                ref={audioRef}
                src={audioUrl}
                preload="none"
                onEnded={() => setIsPlaying(false)}
                onPause={() => setIsPlaying(false)}
                className="hidden"
            />
        </article>
    );
};

export default ClipPlayerCard;
