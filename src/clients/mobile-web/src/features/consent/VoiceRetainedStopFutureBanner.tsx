// spec: dfes-companion-2026-07-11 (farm-memory) — ADR-DS-017 (c)
//
// Second confirmation for turning voice retention OFF.
//
// Turning the toggle off used to post immediately on the first tap. That
// made two very different intentions — "stop saving what I say from now
// on" and "delete everything I have ever saved" — reachable by the same
// gesture, with nothing on screen to tell the farmer which one he had
// just performed. The backend now keeps his history either way, so this
// modal is not a warning about losing anything. It is the sentence that
// says so, at the moment he is deciding.
//
// Deliberately NOT modelled on VoiceRetainedFirstGrantBanner's shield: the
// grant modal is a reassurance, this one is a change of state, and an
// identical treatment would make them read as the same interaction. Same
// layout skeleton, amber rather than emerald, mic-off rather than shield.

import React from 'react';
import { MicOff } from 'lucide-react';
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

const VoiceRetainedStopFutureBanner: React.FC<Props> = ({
    locale,
    saving,
    onConfirm,
    onDismiss,
}) => {
    return (
        <div
            data-testid="voice-retained-stop-future-banner"
            className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm flex items-end sm:items-center justify-center z-50"
            role="dialog"
            aria-modal="true"
        >
            <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-white p-6 space-y-4 shadow-2xl">
                <div className="mx-auto h-14 w-14 rounded-2xl bg-amber-50 text-amber-700 flex items-center justify-center">
                    <MicOff size={28} strokeWidth={2.4} />
                </div>

                <div className="text-center space-y-1">
                    <h2 className="font-['Noto_Serif_Devanagari'] font-bold text-2xl text-stone-900">
                        {tVoiceDiary(locale, 'stopFutureConfirm.headline')}
                    </h2>
                    <p className="font-['DM_Sans'] text-sm font-bold text-stone-500">
                        {tVoiceDiary(locale, 'stopFutureConfirm.headlineEn')}
                    </p>
                </div>

                <div className="space-y-2 text-stone-700">
                    <p className="font-['Noto_Sans_Devanagari'] text-base leading-relaxed">
                        {tVoiceDiary(locale, 'stopFutureConfirm.body')}
                    </p>
                    <p className="font-['DM_Sans'] text-sm text-stone-500 leading-relaxed">
                        {tVoiceDiary(locale, 'stopFutureConfirm.bodyEn')}
                    </p>
                </div>

                {/* The load-bearing sentence. Emerald against the amber
                    header on purpose: the consequence being confirmed is a
                    stop, but the thing the farmer most needs to read is
                    what is NOT happening to his history. */}
                <div
                    data-testid="voice-retained-stop-future-kept-note"
                    className="rounded-2xl bg-emerald-50 border border-emerald-200 px-4 py-3 space-y-1"
                >
                    <p className="font-['Noto_Sans_Devanagari'] text-sm font-bold text-emerald-900 leading-relaxed">
                        {tVoiceDiary(locale, 'stopFutureConfirm.keptNote')}
                    </p>
                    <p className="font-['DM_Sans'] text-xs text-emerald-700 leading-relaxed">
                        {tVoiceDiary(locale, 'stopFutureConfirm.keptNoteEn')}
                    </p>
                </div>

                <div className="pt-2 space-y-2">
                    <button
                        type="button"
                        onClick={onConfirm}
                        disabled={saving}
                        data-testid="voice-retained-stop-future-confirm"
                        className="w-full py-3 rounded-xl bg-amber-600 text-white font-['Noto_Sans_Devanagari'] font-bold hover:bg-amber-700 disabled:opacity-50 active:bg-amber-800"
                    >
                        {tVoiceDiary(locale, 'stopFutureConfirm.primaryCta')}
                    </button>
                    <button
                        type="button"
                        onClick={onDismiss}
                        disabled={saving}
                        data-testid="voice-retained-stop-future-dismiss"
                        className="w-full py-2 font-['DM_Sans'] text-sm font-bold text-stone-500 hover:text-stone-700 disabled:opacity-50"
                    >
                        {tVoiceDiary(locale, 'stopFutureConfirm.secondaryCta')}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default VoiceRetainedStopFutureBanner;
