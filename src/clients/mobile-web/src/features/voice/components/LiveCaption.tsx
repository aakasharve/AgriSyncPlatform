/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-28 — LiveCaption Way-2 surface.
 *
 * Renders the live Sarvam transcript_partial stream so the farmer can see
 * their words appearing as Sarvam hears them. Built per the founder's
 * cost-safe rule: this component is PURELY presentational and consumes a
 * pre-existing SSE that useVoiceRecorder.runTranscribeStage already opened
 * to /shramsafal/ai/transcribe-stream. It does NOT issue any new request,
 * does NOT call Sarvam, and does NOT touch the save/audit/diary pipeline.
 *
 * Hides itself when there's nothing to show (idle, complete, or non-voice
 * mode) so it doesn't clutter the recorder surface between sessions.
 */

import React from 'react';
import { useLanguage } from '../../../i18n/LanguageContext';

interface LiveCaptionProps {
    text: string;
    /** True while the SSE stream is open (phase === 'transcribing'). */
    isTranscribing: boolean;
}

const LiveCaption: React.FC<LiveCaptionProps> = ({ text, isTranscribing }) => {
    const { t } = useLanguage();
    // Render nothing when there are no captions to show and the stream
    // isn't open. Avoids a blank pill flashing between recording attempts.
    if (!isTranscribing && !text) return null;

    return (
        <div
            className="mx-auto my-4 max-w-md px-6 py-4 rounded-2xl bg-white/70 backdrop-blur-md border border-emerald-100 shadow-sm animate-in fade-in slide-in-from-bottom-2"
            aria-live="polite"
            aria-atomic="false"
            role="status"
        >
            <div className="flex items-center gap-2 mb-2 text-xs font-bold uppercase tracking-wider text-emerald-700">
                <span
                    className={`inline-block w-2 h-2 rounded-full bg-emerald-500 ${isTranscribing ? 'animate-pulse' : ''}`}
                    aria-hidden="true"
                />
                {t('logPage.listening')}
            </div>
            <p className="text-stone-800 text-lg leading-relaxed font-medium min-h-[1.5em] break-words">
                {text || <span className="text-stone-400 italic">…</span>}
            </p>
        </div>
    );
};

export default LiveCaption;
