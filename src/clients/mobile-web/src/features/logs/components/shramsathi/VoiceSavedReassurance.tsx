/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VoiceSavedReassurance — the calm terminal surface shown when the voice-
 * continuity ladder degraded to a durable capture (transcript-only / audio-only).
 * Never red. Reuses the ShramSathi cream-orb palette + Devanagari fonts so a
 * degraded save still feels like the companion is caring for the farmer's work.
 * dfes-companion-2026-07-11 (Phase 4).
 */
import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import { useLanguage } from '../../../../i18n/LanguageContext';

const SANS = "'Noto Sans Devanagari', sans-serif";
const SERIF = "'Noto Serif Devanagari', serif";

interface Props {
    level: 'transcript-only' | 'audio-only';
}

const VoiceSavedReassurance: React.FC<Props> = ({ level }) => {
    const { t } = useLanguage();
    const body = level === 'transcript-only' ? t('voice.savedTranscriptBody') : t('voice.savedAudioBody');
    return (
        <div
            data-testid="voice-saved-reassurance"
            className="animate-in fade-in duration-500 rounded-3xl border border-emerald-100 bg-gradient-to-br from-emerald-50 to-white p-8 text-center shadow-xl"
        >
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-white text-emerald-600 shadow-sm ring-1 ring-emerald-50">
                <CheckCircle2 size={34} />
            </div>
            <h2 className="mb-3 text-2xl font-bold text-stone-800" style={{ fontFamily: SERIF }}>
                {t('voice.savedTitle')}
            </h2>
            <p data-testid="voice-saved-body" className="mx-auto mb-4 max-w-[30ch] text-stone-600" style={{ fontFamily: SANS }}>
                {body}
            </p>
            <p data-testid="voice-saved-reassure" className="text-sm font-bold text-emerald-700" style={{ fontFamily: SANS }}>
                {t('voice.savedReassure')}
            </p>
        </div>
    );
};

export default VoiceSavedReassurance;
