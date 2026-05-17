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
import { CheckCircle2, Clock, AlertCircle, Loader2, Mic, Play, Pause, Cloud, HardDrive } from 'lucide-react';
import type { VoiceClipCacheRecord, VoiceClipStatus } from '../../../infrastructure/storage/DexieDatabase';
import { readVoiceClipPlaintext } from '../../../infrastructure/voice/VoiceClipRetention';
import { openVoiceClip } from '../../../infrastructure/security/voiceEnvelope';
import { resolveDek } from '../../../infrastructure/security/tenantDekClient';
import { getVoiceDiaryById } from '../../../infrastructure/voiceDiary/voiceDiaryApiClient';
import {
    type VoiceDiaryLocale,
    tVoiceDiary,
} from '../../../i18n/voiceDiaryTranslations';

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
}

interface Props {
    locale: VoiceDiaryLocale;
    clip: UnifiedClip;
}

const formatTime = (iso: string): string => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '--:--';
    return date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
};

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
                label: tVoiceDiary(locale, 'clipBadge.failed'),
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

    // Cloud clips: lazy-fetch on first play to avoid hauling audio
    // bytes for every calendar paint.
    const ensureCloudAudioUrl = useCallback(async () => {
        if (audioUrl || fetchingCloud) return;
        setFetchingCloud(true);
        setFetchError(null);
        try {
            const result = await getVoiceDiaryById(clip.id);
            if (!result) {
                setFetchError('clip_not_found');
                return;
            }
            const cipher = Uint8Array.from(atob(result.cipherBase64), c => c.charCodeAt(0));
            const iv = Uint8Array.from(atob(result.ivBase64), c => c.charCodeAt(0));
            const dek = await resolveDek(result.dekId);
            if (!dek) {
                setFetchError('dek_unavailable');
                return;
            }
            const plaintext = await openVoiceClip(
                { ciphertext: cipher, iv, wrappedDekId: result.dekId },
                dek,
            );
            // Voice clips are persisted as the recording's original mime type
            // (typically audio/webm). Cloud projection doesn't echo it back —
            // the browser sniff is reliable for the common cases.
            const blob = new Blob([plaintext], { type: 'audio/webm' });
            setAudioUrl(URL.createObjectURL(blob));
        } catch (err) {
            setFetchError(err instanceof Error ? err.message : 'cloud_fetch_failed');
        } finally {
            setFetchingCloud(false);
        }
    }, [audioUrl, clip.id, fetchingCloud]);

    const handlePlayPause = useCallback(async () => {
        if (clip.source === 'cloud' && !audioUrl) {
            await ensureCloudAudioUrl();
        }
        const el = audioRef.current;
        if (!el) return;
        if (el.paused) {
            await el.play().catch(() => undefined);
            setIsPlaying(true);
        } else {
            el.pause();
            setIsPlaying(false);
        }
    }, [audioUrl, clip.source, ensureCloudAudioUrl]);

    const status = getStatusPresentation(locale, clip.status);
    const StatusIcon = status?.icon ?? CheckCircle2;
    const SourceIcon = clip.source === 'cloud' ? Cloud : HardDrive;
    const sourceBadgeKey = clip.source === 'cloud' ? 'clipBadge.cloud' : 'clipBadge.local';
    const sourceBadgeCls = clip.source === 'cloud'
        ? 'bg-sky-50 text-sky-700'
        : 'bg-stone-100 text-stone-700';

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
                        className={`inline-flex items-center gap-1 ${sourceBadgeCls} text-[10px] font-['DM_Sans'] font-bold uppercase tracking-wider rounded-full px-2 py-0.5`}
                    >
                        <SourceIcon size={10} />
                        {tVoiceDiary(locale, sourceBadgeKey)}
                    </span>
                    {status && (
                        <span
                            className={`inline-flex items-center gap-1 border ${status.className} text-[10px] font-['DM_Sans'] font-bold uppercase tracking-wider rounded-full px-2 py-0.5`}
                        >
                            <StatusIcon size={10} className={status.spin ? 'animate-spin' : ''} />
                            {status.label}
                        </span>
                    )}
                </div>
                {fetchError && (
                    <p className="mt-1 text-[11px] font-['DM_Sans'] text-rose-600">
                        {fetchError}
                    </p>
                )}
                {clip.lastError && !fetchError && (
                    <p className="mt-1 text-[11px] font-['DM_Sans'] text-rose-600">
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
