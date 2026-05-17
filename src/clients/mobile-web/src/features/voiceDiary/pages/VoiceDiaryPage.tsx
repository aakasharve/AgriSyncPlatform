// spec: voice-diary-e2e-2026-05-17 (D.6)
//
// Voice Diary unified view. Queries both:
//   - local Dexie clips (last 30 days; sealed envelope)
//   - retained-tier S3 clips (any age, gated by FullHistoryJournal grant)
//
// Merges them by clip id (the local Dexie `voiceClips.id` is reused as
// the server PK per the persist contract — supervisor risk #1
// mitigation). The unified projection feeds CalendarWithDots (dot
// density per day) and DayClipList (player cards for the selected day).
//
// Layout follows Wave 1.A design refs Screen 1: sticky glass header,
// state-aware RetentionBanner, then calendar + day list. EmptyState
// renders only when consent is OFF AND the local Dexie has no rows.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { getDateKey } from '../../../core/domain/services/DateKeyService';
import {
    getDatabase,
    type VoiceClipCacheRecord,
} from '../../../infrastructure/storage/DexieDatabase';
import { purgeExpiredProcessingVoiceClips } from '../../../infrastructure/voice/VoiceClipRetention';
import {
    getVoiceDiaryByRange,
    type VoiceDiaryListItem,
} from '../../../infrastructure/voiceDiary/voiceDiaryApiClient';
import { useLanguage } from '../../../i18n/LanguageContext';
import {
    toVoiceDiaryLocale,
    tVoiceDiary,
    type VoiceDiaryLocale,
} from '../../../i18n/voiceDiaryTranslations';
import CalendarWithDots from '../components/CalendarWithDots';
import DayClipList from '../components/DayClipList';
import RetentionBanner from '../components/RetentionBanner';
import EmptyStatePrompt from '../components/EmptyStatePrompt';
import type { UnifiedClip } from '../components/ClipPlayerCard';
import { useFullHistoryJournalConsent } from '../hooks/useFullHistoryJournalConsent';

interface VoiceDiaryPageProps {
    onBack: () => void;
    onOpenSettings: () => void;
    /** Test seam — lets the spec inject a deterministic locale. */
    forceLocale?: VoiceDiaryLocale;
}

const DEFAULT_RANGE_DAYS = 60;

const VoiceDiaryPage: React.FC<VoiceDiaryPageProps> = ({
    onBack,
    onOpenSettings,
    forceLocale,
}) => {
    const { language } = useLanguage();
    const locale: VoiceDiaryLocale = forceLocale ?? toVoiceDiaryLocale(language);

    const [localClips, setLocalClips] = useState<VoiceClipCacheRecord[]>([]);
    const [cloudClips, setCloudClips] = useState<VoiceDiaryListItem[]>([]);
    const [selectedDateKey, setSelectedDateKey] = useState<string>(() => getDateKey());
    const [loading, setLoading] = useState(true);

    const { granted: consentGranted, loaded: consentLoaded } = useFullHistoryJournalConsent();

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
            setLocalClips(records);

            // Only hit the retained-tier API when consent has been granted —
            // the backend would reject the call with ConsentRequired anyway,
            // but skipping it avoids a noisy 4xx on every page open.
            if (consentGranted) {
                const today = new Date();
                const from = new Date(today.getTime() - DEFAULT_RANGE_DAYS * 24 * 3600 * 1000);
                const fromKey = from.toISOString().slice(0, 10);
                const toKey = today.toISOString().slice(0, 10);
                try {
                    const cloud = await getVoiceDiaryByRange(fromKey, toKey);
                    setCloudClips(cloud);
                } catch {
                    // Retained tier unreachable — fall back to local-only view.
                    setCloudClips([]);
                }
            } else {
                setCloudClips([]);
            }
        } finally {
            setLoading(false);
        }
    }, [consentGranted]);

    useEffect(() => {
        if (!consentLoaded) return;
        void loadClips();
    }, [consentLoaded, loadClips]);

    // ---------------------------------------------------------------------
    // Unified projection — merge local + cloud, de-dup by clip id, sort.
    // ---------------------------------------------------------------------
    const unifiedClips = useMemo<UnifiedClip[]>(() => {
        const map = new Map<string, UnifiedClip>();
        // Local first so cloud overwrites if the same id exists in both
        // (cloud has the canonical recordedAt; local may still have a
        // fresher in-flight status badge for retry visibility — but the
        // de-dup contract per envelope brief is "cloud wins" on overlap).
        for (const record of localClips) {
            map.set(record.id, {
                id: record.id,
                recordedAtUtc: record.recordedAtUtc,
                durationMs: record.durationMs,
                status: record.status,
                lastError: record.lastError,
                source: 'local',
                localRecord: record,
            });
        }
        for (const cloud of cloudClips) {
            const existing = map.get(cloud.clipId);
            map.set(cloud.clipId, {
                id: cloud.clipId,
                recordedAtUtc: cloud.recordedAtUtc,
                durationMs: cloud.durationSeconds * 1000,
                status: existing?.status,
                lastError: existing?.lastError,
                source: 'cloud',
                localRecord: existing?.localRecord,
            });
        }
        return Array.from(map.values()).sort(
            (a, b) => Date.parse(b.recordedAtUtc) - Date.parse(a.recordedAtUtc),
        );
    }, [localClips, cloudClips]);

    const countsByDate = useMemo(() => {
        return unifiedClips.reduce<Record<string, number>>((acc, clip) => {
            const dateKey = getDateKey(clip.recordedAtUtc);
            acc[dateKey] = (acc[dateKey] ?? 0) + 1;
            return acc;
        }, {});
    }, [unifiedClips]);

    const clipsForSelectedDate = useMemo(() => {
        return unifiedClips.filter(clip => getDateKey(clip.recordedAtUtc) === selectedDateKey);
    }, [unifiedClips, selectedDateKey]);

    // If the user has clips but none on today, advance the calendar to the
    // most recent day with clips (mirrors V1 behaviour).
    useEffect(() => {
        if (unifiedClips.length === 0) return;
        const hasSelection = unifiedClips.some(
            clip => getDateKey(clip.recordedAtUtc) === selectedDateKey,
        );
        if (!hasSelection) {
            setSelectedDateKey(getDateKey(unifiedClips[0].recordedAtUtc));
        }
    }, [unifiedClips, selectedDateKey]);

    const showEmptyState = !loading
        && consentLoaded
        && !consentGranted
        && unifiedClips.length === 0;

    return (
        <div className="space-y-5 pb-24" data-testid="voice-diary-page">
            <div className="sticky top-[57px] z-30 -mx-1 border-b border-stone-100 bg-stone-50/95 px-1 py-3 backdrop-blur">
                <div className="flex items-center justify-between gap-3">
                    <button
                        type="button"
                        onClick={onBack}
                        className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-stone-700 shadow-sm active:bg-stone-100"
                        aria-label={tVoiceDiary(locale, 'page.back')}
                    >
                        <ArrowLeft size={20} />
                    </button>
                    <div className="min-w-0 flex-1">
                        <h1 className="truncate font-['Noto_Serif_Devanagari'] font-bold text-xl text-stone-900">
                            {tVoiceDiary(locale, 'page.title')}
                        </h1>
                        <p className="truncate font-['DM_Sans'] text-xs font-bold text-stone-500">
                            {tVoiceDiary(locale, 'page.subtitle')}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={() => void loadClips()}
                        className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-emerald-700 shadow-sm active:bg-emerald-50"
                        aria-label={tVoiceDiary(locale, 'page.refresh')}
                        data-testid="voice-diary-refresh"
                    >
                        <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                    </button>
                </div>
            </div>

            <RetentionBanner
                locale={locale}
                granted={consentGranted}
                onOpenSettings={!consentGranted ? onOpenSettings : undefined}
            />

            {showEmptyState ? (
                <EmptyStatePrompt locale={locale} onOpenSettings={onOpenSettings} />
            ) : (
                <>
                    <CalendarWithDots
                        countsByDate={countsByDate}
                        selectedDateKey={selectedDateKey}
                        onSelectDate={setSelectedDateKey}
                    />
                    <DayClipList
                        locale={locale}
                        dateKey={selectedDateKey}
                        clips={clipsForSelectedDate}
                    />
                </>
            )}
        </div>
    );
};

export default VoiceDiaryPage;
