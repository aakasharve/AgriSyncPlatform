// spec: voice-diary-e2e-2026-05-17 (D.9)
//
// Day-filtered list of ClipPlayerCard. Mirrors V1 DayClipList shape but
// renders the unified clip projection (local + cloud) and routes
// translations through the voice-diary i18n bundle.

import React from 'react';
import { Mic } from 'lucide-react';
import { formatDateKeyForDisplay } from '../../../core/domain/services/DateKeyService';
import ClipPlayerCard, { type UnifiedClip } from './ClipPlayerCard';
import {
    type VoiceDiaryLocale,
    tVoiceDiary,
} from '../../../i18n/voiceDiaryTranslations';

interface DayClipListProps {
    locale: VoiceDiaryLocale;
    dateKey: string;
    clips: UnifiedClip[];
}

const DayClipList: React.FC<DayClipListProps> = ({ locale, dateKey, clips }) => {
    const dayHeading = formatDateKeyForDisplay(dateKey, {
        weekday: 'long',
        day: 'numeric',
        month: 'short',
    });
    const countLabel = clips.length === 1
        ? tVoiceDiary(locale, 'dayHeading.countSingular')
        : tVoiceDiary(locale, 'dayHeading.countPlural');

    return (
        <section className="space-y-3" data-testid="voice-diary-day-list">
            <div className="flex items-baseline justify-between">
                <h2 className="text-base font-['Noto_Sans_Devanagari'] font-bold text-stone-800">
                    {dayHeading}
                </h2>
                <p className="text-xs font-['DM_Sans'] font-bold text-stone-500 tabular-nums">
                    {clips.length} {countLabel}
                </p>
            </div>

            {clips.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-stone-200 bg-white p-6 text-center">
                    <Mic className="mx-auto text-stone-300" size={28} />
                    <p className="mt-3 text-sm font-['Noto_Sans_Devanagari'] font-bold text-stone-600">
                        {tVoiceDiary(locale, 'dayHeading.empty')}
                    </p>
                </div>
            ) : (
                <div className="space-y-3">
                    {clips.map(clip => (
                        <ClipPlayerCard key={`${clip.source}_${clip.id}`} locale={locale} clip={clip} />
                    ))}
                </div>
            )}
        </section>
    );
};

export default DayClipList;
