/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Types and pure helpers for `useVoiceRecorder`.
 *
 * WHY: that hook was 893 lines against an 800-line budget
 * (`npm run check:file-sizes`). Everything here is a TYPE or a function that
 * closes over nothing — no hook state, no refs, no setters — so this is a pure
 * code move and the capture path is byte-for-byte what it was.
 *
 * WHAT DELIBERATELY STAYED: the stage functions (`runTranscribeStage`,
 * `persistDegradedCapture`, `commitParsedDraft` and friends) all close over hook
 * state and would each need six to ten dependencies threaded through a new
 * boundary. On the voice-capture path that is a refactor with real behaviour
 * risk, not a file-size fix, and it is not worth doing to win a line count.
 */

import type {
    FarmContext, CropProfile, FarmerProfile,
    InputMode, 
} from '../../types';
import type { VoiceParserPort } from '../../application/ports';
import type { LogScope } from '../../domain/types/log.types';
import type { VoicePreprocessor } from '../../infrastructure/voice/VoicePreprocessor';


// TASK 3 (voice-live-captions-banner-2026-06-10) — yield to the browser so a
// just-committed React state change can paint before heavy synchronous-ish
// work runs on the same async stack. Prefers requestAnimationFrame (fires
// right before the next paint); falls back to a setTimeout(0) macrotask when
// rAF is unavailable (jsdom / non-browser). Resolves immediately if neither
// exists. Kept out of the component so it's allocation-free per render.
export const yieldToPaint = (): Promise<void> =>
new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => resolve());
        return;
    }
    if (typeof setTimeout === 'function') {
        setTimeout(() => resolve(), 0);
        return;
    }
    resolve();
});

export const hasSuccessfulIrrigation = (events: Array<{ durationHours?: number; waterVolumeLitres?: number; method?: string; source?: string }>): boolean => {
return events.some(event => {
    if ((event.durationHours || 0) > 0) return true;
    if ((event.waterVolumeLitres || 0) > 0) return true;
    return Boolean(event.method || event.source);
});
};

export interface UseVoiceRecorderProps {
currentLogContext: FarmContext | null;
logScope: LogScope; // Needed for parser
hasActiveLogContext: boolean;
crops: CropProfile[];
farmerProfile: FarmerProfile;
setMode: (mode: InputMode) => void;
parser: VoiceParserPort;
voicePreprocessor: VoicePreprocessor;
}

export type PreprocessedAudioResult = {
    base64: string;
    mimeType: string;
    inputSpeechDurationMs?: number;
    inputRawDurationMs?: number;
    segmentMetadataJson?: string;
    idempotencyKey?: string;
    requestPayloadHash?: string;
};
