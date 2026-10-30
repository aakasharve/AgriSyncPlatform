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
    InputMode, AgriLogResponse,
} from '../../types';
import type { LogProvenance } from '../../domain/ai/LogProvenance';
import type { VoiceParserPort } from '../../application/ports';
import type { LogScope } from '../../domain/types/log.types';
import type { VoicePreprocessor } from '../../infrastructure/voice/VoicePreprocessor';

// Re-exported HERE so the hook can bind a parse's provenance to its draft through
// an import it already has: `useVoiceRecorder.ts` is quarantined at its line
// count (`check:file-sizes`) and may not grow by an import line.
export { bindDraftProvenance } from './draftProvenance';

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

/** PLR-D10 I13 — the recording a parse came from: its clip key on this phone (when known) and when he spoke. */
export interface VoiceRecordingRef {
    recordedAtUtc: string;
    clipId?: string;
    /**
     * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L6b) — he TYPED it in the "लिहून सांगा" sheet
     * ("साथीला पाठवा"): there is no recording behind it, so no clip and no player, and it is marked "लिहिलेलं".
     */
    typed?: true;
}

/**
 * Lane L6b (founder design `PostVoiceResultPreview.sendTyped`): what he types to Sathi is saved at once like a
 * spoken entry, through the same waiting screen to the same result screen. Its "when" is the moment he sent it.
 */
export const typedRecordingRef = (): VoiceRecordingRef => ({ recordedAtUtc: new Date().toISOString(), typed: true });

/**
 * PLR-D10 I13 — the voice auto-save hand-off (founder 2026-09-02: auto-save on a successful parse, no
 * review form, no Save tap). Called ONLY with a successful parse of a RECORDING, or (lane L6b) of what he
 * typed to Sathi (`recording.typed`) — never a one-part re-record. Resolves `true` when the auto-save took the
 * parse and owns the screen from here; `false` keeps today's review form with the parse in it.
 */
export type VoiceDraftSink = (
    draft: AgriLogResponse,
    provenance: LogProvenance | undefined,
    recording: VoiceRecordingRef,
) => Promise<boolean>;

export interface UseVoiceRecorderProps {
currentLogContext: FarmContext | null;
logScope: LogScope; // Needed for parser
hasActiveLogContext: boolean;
crops: CropProfile[];
farmerProfile: FarmerProfile;
setMode: (mode: InputMode) => void;
parser: VoiceParserPort;
voicePreprocessor: VoicePreprocessor;
/** PLR-D10 I13 — see `VoiceDraftSink`. Absent = every parse goes to the review form, as before. */
onVoiceDraft?: VoiceDraftSink;
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

// Lane V-1 — re-exported for the hook (its file may not grow; see scripts/check-file-sizes.mjs QUARANTINE).
export { liveEncodedUpload } from './liveEncodedUpload';
