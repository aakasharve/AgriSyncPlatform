import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, RefreshCw, Mic } from 'lucide-react';
import { getDateKey } from '../../../core/domain/services/DateKeyService';
import { getDatabase, type VoiceClipCacheRecord } from '../../../infrastructure/storage/DexieDatabase';
import { purgeExpiredProcessingVoiceClips } from '../../../infrastructure/voice/VoiceClipRetention';
import CalendarWithDots from '../components/CalendarWithDots';
import DayClipList from '../components/DayClipList';
import RetentionBanner from '../components/RetentionBanner';

interface VoiceJournalPageProps {
    onBack: () => void;
}

const VoiceJournalPage: React.FC<VoiceJournalPageProps> = ({ onBack }) => {
    const [clips, setClips] = useState<VoiceClipCacheRecord[]>([]);
    const [selectedDateKey, setSelectedDateKey] = useState<string>(() => getDateKey());
    const [loading, setLoading] = useState(true);

    const loadClips = useCallback(async () => {
        setLoading(true);
        try {
            await purgeExpiredProcessingVoiceClips();
            const nowUtc = new Date().toISOString();
            const records = await getDatabase()
                .voiceClips
                .where('expiresAtUtc')
                .above(nowUtc)
                .toArray();

            records.sort((a, b) => Date.parse(b.recordedAtUtc) - Date.parse(a.recordedAtUtc));
            setClips(records);

            if (records.length > 0 && !records.some(record => getDateKey(record.recordedAtUtc) === selectedDateKey)) {
                setSelectedDateKey(getDateKey(records[0].recordedAtUtc));
            }
        } finally {
            setLoading(false);
        }
    }, [selectedDateKey]);

    useEffect(() => {
        void loadClips();
    }, [loadClips]);

    const countsByDate = useMemo(() => {
        return clips.reduce<Record<string, number>>((acc, clip) => {
            const dateKey = getDateKey(clip.recordedAtUtc);
            acc[dateKey] = (acc[dateKey] ?? 0) + 1;
            return acc;
        }, {});
    }, [clips]);

    const clipsForSelectedDate = useMemo(() => {
        return clips.filter(clip => getDateKey(clip.recordedAtUtc) === selectedDateKey);
    }, [clips, selectedDateKey]);

    return (
        <div className="space-y-5 pb-24">
            <div className="sticky top-[57px] z-30 -mx-1 border-b border-stone-100 bg-stone-50/95 px-1 py-3 backdrop-blur">
                <div className="flex items-center justify-between gap-3">
                    <button
                        type="button"
                        onClick={onBack}
                        className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-stone-700 shadow-sm active:bg-stone-100"
                        aria-label="Back"
                    >
                        <ArrowLeft size={20} />
                    </button>
                    <div className="min-w-0 flex-1">
                        <h1 className="truncate text-xl font-black text-stone-900">Voice Journal</h1>
                        <p className="truncate text-xs font-bold text-stone-500">Replay recent voice logs</p>
                    </div>
                    <button
                        type="button"
                        onClick={() => void loadClips()}
                        className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-emerald-700 shadow-sm active:bg-emerald-50"
                        aria-label="Refresh"
                    >
                        <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                    </button>
                </div>
            </div>

            <RetentionBanner />

            {clips.length === 0 && !loading ? (
                <div className="rounded-3xl border border-dashed border-stone-200 bg-white p-8 text-center">
                    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
                        <Mic size={26} />
                    </div>
                    <h2 className="mt-4 text-base font-black text-stone-900">No saved recordings yet</h2>
                    <p className="mt-2 text-sm font-semibold leading-relaxed text-stone-500">
                        New voice logs will appear here after recording.
                    </p>
                </div>
            ) : (
                <>
                    <CalendarWithDots
                        countsByDate={countsByDate}
                        selectedDateKey={selectedDateKey}
                        onSelectDate={setSelectedDateKey}
                    />
                    <DayClipList dateKey={selectedDateKey} clips={clipsForSelectedDate} />
                </>
            )}
        </div>
    );
};

export default VoiceJournalPage;
