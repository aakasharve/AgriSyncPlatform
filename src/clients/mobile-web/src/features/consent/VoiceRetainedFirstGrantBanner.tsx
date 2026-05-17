// spec: voice-diary-e2e-2026-05-17 (D.13)
//
// First-grant attestation modal — opens the first time the user flips
// FullHistoryJournal ON. Captures the explicit "I agree" interaction
// before the grant POSTs. Subsequent toggle-ON events (after a revoke)
// skip the modal — the per-grant audit row on the backend distinguishes
// fresh first-grants from re-grants via the existing acceptedAtUtc
// surface.
//
// Layout follows Wave 1.A design refs Screen 3: emerald shield icon,
// bilingual headline (serif Marathi + DM Sans English), body + 3-bullet
// list, primary CTA + secondary "Not now", DPDP attestation footer.

import React from 'react';
import { ShieldCheck } from 'lucide-react';
import {
    type VoiceDiaryLocale,
    tVoiceDiary,
} from '../../i18n/voiceDiaryTranslations';

interface Props {
    locale: VoiceDiaryLocale;
    saving: boolean;
    onConfirm: () => void;
    onDismiss: () => void;
}

const VoiceRetainedFirstGrantBanner: React.FC<Props> = ({
    locale,
    saving,
    onConfirm,
    onDismiss,
}) => {
    return (
        <div
            data-testid="voice-retained-first-grant-banner"
            className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm flex items-end sm:items-center justify-center z-50"
            role="dialog"
            aria-modal="true"
        >
            <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-white p-6 space-y-4 shadow-2xl">
                <div className="mx-auto h-14 w-14 rounded-2xl bg-emerald-50 text-emerald-700 flex items-center justify-center">
                    <ShieldCheck size={28} strokeWidth={2.4} />
                </div>

                <div className="text-center space-y-1">
                    <h2 className="font-['Noto_Serif_Devanagari'] font-bold text-2xl text-stone-900">
                        {tVoiceDiary(locale, 'firstGrant.headline')}
                    </h2>
                    <p className="font-['DM_Sans'] text-sm font-bold text-stone-500">
                        {tVoiceDiary(locale, 'firstGrant.headlineEn')}
                    </p>
                </div>

                <div className="space-y-2 text-stone-700">
                    <p className="font-['Noto_Sans_Devanagari'] text-base leading-relaxed">
                        {tVoiceDiary(locale, 'firstGrant.body')}
                    </p>
                    <p className="font-['DM_Sans'] text-sm text-stone-500 leading-relaxed">
                        {tVoiceDiary(locale, 'firstGrant.bodyEn')}
                    </p>
                </div>

                <ul className="space-y-1 text-sm font-['Noto_Sans_Devanagari'] text-stone-700">
                    <li className="flex items-start gap-2">
                        <span className="text-emerald-600">•</span>
                        <span>{tVoiceDiary(locale, 'firstGrant.bullet1')}</span>
                    </li>
                    <li className="flex items-start gap-2">
                        <span className="text-emerald-600">•</span>
                        <span>{tVoiceDiary(locale, 'firstGrant.bullet2')}</span>
                    </li>
                    <li className="flex items-start gap-2">
                        <span className="text-emerald-600">•</span>
                        <span>{tVoiceDiary(locale, 'firstGrant.bullet3')}</span>
                    </li>
                </ul>

                <div className="pt-2 space-y-2">
                    <button
                        type="button"
                        onClick={onConfirm}
                        disabled={saving}
                        data-testid="voice-retained-first-grant-confirm"
                        className="w-full py-3 rounded-xl bg-emerald-600 text-white font-['Noto_Sans_Devanagari'] font-bold hover:bg-emerald-700 disabled:opacity-50 active:bg-emerald-800"
                    >
                        {tVoiceDiary(locale, 'firstGrant.primaryCta')}
                    </button>
                    <button
                        type="button"
                        onClick={onDismiss}
                        disabled={saving}
                        data-testid="voice-retained-first-grant-dismiss"
                        className="w-full py-2 font-['DM_Sans'] text-sm font-bold text-stone-500 hover:text-stone-700 disabled:opacity-50"
                    >
                        {tVoiceDiary(locale, 'firstGrant.secondaryCta')}
                    </button>
                </div>

                <p className="text-[11px] font-['DM_Sans'] text-stone-400 text-center pt-1">
                    {tVoiceDiary(locale, 'firstGrant.attestation')}
                </p>
            </div>
        </div>
    );
};

export default VoiceRetainedFirstGrantBanner;
