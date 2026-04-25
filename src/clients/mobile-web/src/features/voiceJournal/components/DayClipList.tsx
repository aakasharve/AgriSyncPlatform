import React from 'react';
import { AlertCircle, CheckCircle2, Clock, Loader2, Mic } from 'lucide-react';
import type { VoiceClipCacheRecord, VoiceClipStatus } from '../../../infrastructure/storage/DexieDatabase';
import { formatDateKeyForDisplay } from '../../../core/domain/services/DateKeyService';
import ClipPlayer from './ClipPlayer';

interface DayClipListProps {
    dateKey: string;
    clips: VoiceClipCacheRecord[];
}

const formatTime = (iso: string): string => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '--:--';
    return date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
};

const formatDuration = (durationMs?: number): string => {
    if (!durationMs || durationMs <= 0) return 'Audio';
    const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes === 0) return `${seconds}s`;
    return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
};

const getStatusPresentation = (status: VoiceClipStatus): {
    label: string;
    icon: React.ElementType;
    className: string;
} => {
    switch (status) {
        case 'parsed':
            return { label: 'Parsed', icon: CheckCircle2, className: 'bg-emerald-50 text-emerald-700 border-emerald-100' };
        case 'parsing':
            return { label: 'Parsing', icon: Loader2, className: 'bg-blue-50 text-blue-700 border-blue-100' };
        case 'failed':
            return { label: 'Retry needed', icon: AlertCircle, className: 'bg-rose-50 text-rose-700 border-rose-100' };
        case 'queued':
            return { label: 'Queued', icon: Clock, className: 'bg-amber-50 text-amber-700 border-amber-100' };
        case 'recorded':
        default:
            return { label: 'Recorded', icon: Mic, className: 'bg-stone-50 text-stone-700 border-stone-100' };
    }
};

const DayClipList: React.FC<DayClipListProps> = ({ dateKey, clips }) => {
    return (
        <section className="space-y-3">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-base font-black text-stone-900">
                        {formatDateKeyForDisplay(dateKey, { weekday: 'long', day: 'numeric', month: 'short' })}
                    </h2>
                    <p className="text-xs font-semibold text-stone-500">{clips.length} voice clip{clips.length === 1 ? '' : 's'}</p>
                </div>
            </div>

            {clips.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-stone-200 bg-white p-6 text-center">
                    <Mic className="mx-auto text-stone-300" size={28} />
                    <p className="mt-3 text-sm font-bold text-stone-600">No voice clips on this day</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {clips.map(clip => {
                        const status = getStatusPresentation(clip.status);
                        const StatusIcon = status.icon;
                        return (
                            <article key={clip.id} className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
                                <div className="mb-3 flex items-start justify-between gap-3">
                                    <div>
                                        <div className="text-sm font-black text-stone-900">{formatTime(clip.recordedAtUtc)}</div>
                                        <div className="mt-1 text-xs font-semibold text-stone-500">{formatDuration(clip.durationMs)}</div>
                                    </div>
                                    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-black ${status.className}`}>
                                        <StatusIcon size={12} className={clip.status === 'parsing' ? 'animate-spin' : ''} />
                                        {status.label}
                                    </span>
                                </div>
                                <ClipPlayer clip={clip} />
                                {clip.lastError && (
                                    <p className="mt-2 rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                                        {clip.lastError}
                                    </p>
                                )}
                            </article>
                        );
                    })}
                </div>
            )}
        </section>
    );
};

export default DayClipList;
