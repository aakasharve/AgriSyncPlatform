/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane MIC-1) — THE log recorder and THE waiting screen, as one
 * piece each, so the log tab (`mainView.renderLogView`) and every other speak entry point (`core/speak/SpeakHost`)
 * show the very same thing: the legacy green mic (`RecorderFace`, through `AudioRecorderStreaming` / `AudioRecorder`,
 * wired to the app's one voice pipeline) and, after he speaks, the founder-approved श्रम साथी waiting screen.
 *
 * Moved here VERBATIM from `mainView.tsx` (same components, same props, same flag checks); the waiting screen's own
 * component is untouched.
 */
import React from 'react';
import { Leaf } from 'lucide-react';
import AudioRecorder from '../../features/voice/components/AudioRecorder';
import AudioRecorderStreaming from '../../features/voice/components/AudioRecorderStreaming';
import LiveCaption from '../../features/voice/components/LiveCaption';
import { DEFAULT_VOICE_CONFIG } from '../../infrastructure/voice/types';
import { FEATURE_FLAGS } from '../../app/featureFlags';
import { ShramSathiUnderstanding } from '../../features/logs/components/shramsathi/ShramSathiUnderstanding';
import { ShramSathiUnderstanding as ShramSathiUnderstandingLine } from './mainViewComponents';
import type { AppRouterContext } from './routeContext';

export interface LogRecorderHooks {
    /** The recorder says when it starts and stops listening. */
    onRecordingChange?: (recording: boolean) => void;
}

/** The recorder's own "choose a plot first" nudge: scroll to (and briefly ring) the crop/plot choice. */
const focusRecorder = () => {
    const el = document.getElementById('crop-selector-container');
    if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('ring-4', 'ring-emerald-200', 'rounded-xl');
        setTimeout(() => el.classList.remove('ring-4', 'ring-emerald-200', 'rounded-xl'), 1500);
    }
};

/** THE log recorder (and its live caption), bound to the app's one voice pipeline. */
export const renderLogRecorder = (ctx: AppRouterContext, { onRecordingChange }: LogRecorderHooks = {}): React.ReactNode => {
    const { handleAudioReady, handleTextReady, setStatus, isContextReady, error, errorTranscript, liveCaption, voiceStreamingPhase } = ctx;
    return (
        <>
            {DEFAULT_VOICE_CONFIG.streamingPcm.enabled ? (
                <AudioRecorderStreaming
                    onAudioCaptured={handleAudioReady}
                    onProcessingStart={() => setStatus('processing')}
                    onTextCaptured={handleTextReady}
                    disabled={!isContextReady}
                    externalError={error}
                    transcript={errorTranscript}
                    suggestInteraction={isContextReady}
                    onRequestContextSelection={focusRecorder}
                    onRecordingChange={onRecordingChange}
                />
            ) : (
                <AudioRecorder
                    onAudioCaptured={handleAudioReady}
                    onTextCaptured={handleTextReady}
                    disabled={!isContextReady}
                    externalError={error}
                    transcript={errorTranscript}
                    suggestInteraction={isContextReady}
                    onRequestContextSelection={focusRecorder}
                    onRecordingChange={onRecordingChange}
                />
            )}
            {/* SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-28 — LiveCaption Way-2.
                Cost-safe: consumes the same Sarvam transcribe-stream that
                useVoiceRecorder.runTranscribeStage already opened; no
                additional Sarvam call. Self-hides when there are no
                partials AND the stream isn't open. */}
            <LiveCaption
                text={liveCaption}
                isTranscribing={voiceStreamingPhase === 'transcribing'}
            />
        </>
    );
};

/** THE waiting screen after he speaks (founder-approved; its component is not touched here). */
export const renderProcessingScreen = (ctx: AppRouterContext): React.ReactNode => {
    const { liveCaption, voiceStreamingPhase } = ctx;
    return FEATURE_FLAGS.dailyLoop ? (
        /* dfes-companion loop v1 (spec: dfes-companion-2026-07-11) —
           founder-approved श्रम साथी video-character processing screen.
           Flag-gated: dailyLoop OFF renders the exact legacy spinner
           below (byte-equivalent no-op). */
        <ShramSathiUnderstanding />
    ) : (
        <div className="bg-white rounded-3xl shadow-xl shadow-stone-200/50 border border-stone-100 p-16 text-center">
            <div className="flex justify-center mb-8">
                <div className="relative">
                    <div className="w-24 h-24 border-4 border-stone-100 border-t-emerald-500 rounded-full animate-spin"></div>
                    <div className="absolute top-0 left-0 w-full h-full flex items-center justify-center"><Leaf size={32} className="text-emerald-600 animate-pulse" /></div>
                </div>
            </div>
            <ShramSathiUnderstandingLine />
            {/* SARVAM_PRIMARY_VOICE_PIPELINE — live transcript, placed right below the
                recorder/banner so the farmer sees their words appear as Sarvam transcribes
                the clip (post-Stop, cost-safe: reuses the single transcribe-stream that
                runTranscribeStage already opened; no extra Sarvam call). Self-hides when
                empty; the static placeholder below shows only until the first words land. */}
            <LiveCaption
                text={liveCaption}
                isTranscribing={voiceStreamingPhase === 'transcribing'}
            />
            {!liveCaption && voiceStreamingPhase !== 'transcribing' && (
                <div className="text-sm text-stone-400 max-w-xs mx-auto mt-2 italic">श्रम साथी तुम्ही जे बोललात ते समजून घेत आहे</div>
            )}
        </div>
    );
};
