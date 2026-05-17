// spec: voice-diary-e2e-2026-05-17 (D.10)
//
// Consent-aware retention banner. Two states driven by the
// FullHistoryJournal toggle:
//
//   granted  — calm emerald: "voice notes kept forever in your cloud"
//   denied   — warn amber + inline CTA: "30 days only — turn on in
//              Settings". CTA navigates to the consent toggle anchor.
//
// All copy flows through `tVoiceDiary(locale, key)` and carries the
// LEGAL_REVIEW_PENDING runtime prefix per the i18n bundle convention.

import React from 'react';
import { Check, AlertTriangle } from 'lucide-react';
import {
    type VoiceDiaryLocale,
    tVoiceDiary,
} from '../../../i18n/voiceDiaryTranslations';

interface Props {
    locale: VoiceDiaryLocale;
    granted: boolean;
    /** Click handler for the "Turn on" CTA in the denied state. */
    onOpenSettings?: () => void;
}

const RetentionBanner: React.FC<Props> = ({ locale, granted, onOpenSettings }) => {
    if (granted) {
        return (
            <div
                data-testid="voice-diary-retention-banner-granted"
                className="rounded-2xl bg-emerald-50 border border-emerald-200 px-4 py-3 flex items-start gap-3"
            >
                <div className="mt-0.5 text-emerald-700">
                    <Check size={18} strokeWidth={2.5} />
                </div>
                <div className="flex-1">
                    <div className="font-['Noto_Sans_Devanagari'] font-bold text-emerald-900 text-sm">
                        {tVoiceDiary(locale, 'retentionBanner.grantedTitle')}
                    </div>
                    <div className="font-['DM_Sans'] text-xs text-emerald-700 mt-0.5">
                        {tVoiceDiary(locale, 'retentionBanner.grantedBody')}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div
            data-testid="voice-diary-retention-banner-denied"
            className="rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3 flex items-start gap-3"
        >
            <div className="mt-0.5 text-amber-700">
                <AlertTriangle size={18} strokeWidth={2.5} />
            </div>
            <div className="flex-1">
                <div className="font-['Noto_Sans_Devanagari'] font-bold text-amber-900 text-sm">
                    {tVoiceDiary(locale, 'retentionBanner.deniedTitle')}
                </div>
                <div className="font-['DM_Sans'] text-xs text-amber-700 mt-0.5">
                    {tVoiceDiary(locale, 'retentionBanner.deniedBody')}
                </div>
                {onOpenSettings && (
                    <button
                        type="button"
                        onClick={onOpenSettings}
                        data-testid="voice-diary-retention-banner-cta"
                        className="mt-2 text-xs font-['DM_Sans'] font-bold text-amber-800 underline hover:text-amber-900"
                    >
                        {tVoiceDiary(locale, 'retentionBanner.deniedCta')} →
                    </button>
                )}
            </div>
        </div>
    );
};

export default RetentionBanner;
