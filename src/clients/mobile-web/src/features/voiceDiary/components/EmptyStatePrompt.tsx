// spec: voice-diary-e2e-2026-05-17 (D.11)
//
// Empty state shown when consent is OFF AND there are no local clips.
// CTA navigates to Settings → consent toggle anchor.
//
// When consent is ON but no clips exist yet, VoiceDiaryPage renders the
// "no clips yet" Mic card from DayClipList instead (per coordinator
// default #3 in design refs — V1 empty card verbatim).

import React from 'react';
import { Mic } from 'lucide-react';
import {
    type VoiceDiaryLocale,
    tVoiceDiary,
} from '../../../i18n/voiceDiaryTranslations';

interface Props {
    locale: VoiceDiaryLocale;
    onOpenSettings: () => void;
}

const EmptyStatePrompt: React.FC<Props> = ({ locale, onOpenSettings }) => {
    return (
        <div
            data-testid="voice-diary-empty-state"
            className="rounded-3xl border border-dashed border-stone-200 bg-white p-8 text-center space-y-3"
        >
            <div className="mx-auto h-14 w-14 rounded-2xl bg-emerald-50 text-emerald-700 flex items-center justify-center">
                <Mic size={28} />
            </div>
            <div>
                <h2 className="font-['Noto_Serif_Devanagari'] font-bold text-lg text-stone-900">
                    {tVoiceDiary(locale, 'emptyState.headline')}
                </h2>
                <p className="mt-1 font-['DM_Sans'] text-sm font-bold text-stone-500">
                    {tVoiceDiary(locale, 'emptyState.headlineEn')}
                </p>
            </div>
            <p className="font-['Noto_Sans_Devanagari'] text-sm text-stone-700 leading-relaxed max-w-sm mx-auto">
                {tVoiceDiary(locale, 'emptyState.body')}
            </p>
            <p className="font-['DM_Sans'] text-xs text-stone-500 max-w-sm mx-auto">
                {tVoiceDiary(locale, 'emptyState.bodyEn')}
            </p>
            <div className="pt-2">
                <button
                    type="button"
                    onClick={onOpenSettings}
                    data-testid="voice-diary-empty-state-cta"
                    className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-emerald-600 text-white font-['Noto_Sans_Devanagari'] font-bold hover:bg-emerald-700 active:bg-emerald-800"
                >
                    {tVoiceDiary(locale, 'emptyState.cta')}
                </button>
            </div>
        </div>
    );
};

export default EmptyStatePrompt;
