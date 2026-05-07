/**
 * Hybrid Voice Pipeline v1 — Type Definitions
 *
 * These types define the contract between the 4-layer voice preprocessing pipeline
 * and the backend AI orchestration layer.
 */

export interface VoiceSegment {
    segmentIndex: number;
    audioBlob: Blob;
    mimeType: string;
    durationMs: number;
    rawDurationMs: number;
    silenceRemovedMs: number;
    contentHash: string;
    startOffsetMs: number;
    isFinal: boolean;
    sessionId: string;
}

export interface VoiceSessionMetadata {
    sessionId: string;
    farmId: string;
    totalSegments: number;
    totalSpeechDurationMs: number;
    totalRawDurationMs: number;
    totalSilenceRemovedMs: number;
    compressionRatio: number;
    deviceTimestamp: string;
    clientTimezone: string;
}

export interface VoicePreprocessorConfig {
    silence: SilenceConfig;
    chunking: ChunkingConfig;
    compression: CompressionConfig;
    limits: LimitsConfig;
    streamingPcm: StreamingPcmConfig;
    /**
     * VOICE_LATENCY_PIPELINE_V2 Phase 3 (§7 Task 3.13) — SSE streaming parse path.
     * When true, useVoiceRecorder routes text input through
     * BackendAiClient.parseInputStream → wizard sees field-arrival events live;
     * draftLog still commits only on the terminal `complete` event.
     * Defaults to false in v0.1 (per plan acceptance criterion 6); founder
     * flips after staging validation against the existing batch path.
     * Note: this is a SEPARATE flag from streamingPcm.enabled (Phase 2 recording
     * pipeline) — they may be flipped independently.
     */
    useStreamingParse: boolean;
}

export interface StreamingPcmConfig {
    /**
     * VOICE_LATENCY_PIPELINE_V2 Phase 2 — concurrent recording pipeline.
     * When true, useVoiceRecorder uses an AudioWorklet-backed PCM streaming
     * recorder and runs silence-trim + hashing during recording instead of
     * after stop. Defaults to false in v0.1; founder enables for testing.
     */
    enabled: boolean;
    /** PCM samples per worklet frame. AudioWorkletProcessor.process always emits 128. */
    frameSize: number;
    /** Max accumulated samples in the main-thread ring buffer before backpressure (currently unused; reserved for v0.2). */
    workletBufferSize: number;
}

export interface SilenceConfig {
    rmsThreshold: number;
    minSilenceDurationMs: number;
    paddingBeforeMs: number;
    paddingAfterMs: number;
    leadingSilenceMaxMs: number;
    trailingSilenceMaxMs: number;
}

export interface ChunkingConfig {
    pauseGapMs: number;
    minChunkDurationMs: number;
    maxChunkDurationMs: number;
    forceSplitPauseMs: number;
}

export interface CompressionConfig {
    targetSampleRate: number;
    targetBitrate: number;
    codec: string;
    mimeType: string;
}

export interface LimitsConfig {
    softSegmentLimit: number;
    hardSegmentLimit: number;
    maxSpeechDurationMs: number;
    minAudioDurationMs: number;
    maxSegmentSizeBytes: number;
    maxSessionSizeBytes: number;
}

export const DEFAULT_VOICE_CONFIG: VoicePreprocessorConfig = {
    silence: {
        // Tuned 2026-05-06 (VOICE_LATENCY_PIPELINE_V2 Phase 1):
        // more aggressive trim + smaller padding + larger trailing-silence cap
        // to drop dead air at end of speech.
        rmsThreshold: 0.015,
        minSilenceDurationMs: 350,
        paddingBeforeMs: 100,
        paddingAfterMs: 100,
        leadingSilenceMaxMs: 100,
        trailingSilenceMaxMs: 500,
    },
    chunking: {
        pauseGapMs: 1500,
        minChunkDurationMs: 800,
        maxChunkDurationMs: 120_000,
        forceSplitPauseMs: 500,
    },
    compression: {
        targetSampleRate: 16000,
        // Tuned 2026-05-06: 32k -> 24k Opus is highly intelligible for speech
        // and shrinks upload ~25%.
        targetBitrate: 24000,
        codec: 'opus',
        mimeType: 'audio/webm;codecs=opus',
    },
    streamingPcm: {
        // VOICE_LATENCY_PIPELINE_V2 Phase 2 — default OFF; founder enables for testing
        // before promoting to default-on after parity validation against batch path.
        enabled: false,
        frameSize: 128,
        workletBufferSize: 16384,
    },
    // VOICE_LATENCY_PIPELINE_V2 Phase 3 — default OFF; founder enables once
    // streaming Gemini path is parity-validated against batch /ai/voice-parse.
    useStreamingParse: false,
    limits: {
        softSegmentLimit: 20,
        hardSegmentLimit: 30,
        maxSpeechDurationMs: 600_000,
        minAudioDurationMs: 500,
        maxSegmentSizeBytes: 10 * 1024 * 1024,
        maxSessionSizeBytes: 50 * 1024 * 1024,
    },
};

export interface SilenceRegion {
    startMs: number;
    endMs: number;
    durationMs: number;
}

export interface SpeechRegion {
    startSample: number;
    endSample: number;
    startMs: number;
    endMs: number;
    durationMs: number;
}

export interface ChunkBoundary {
    startSample: number;
    endSample: number;
    startMs: number;
    endMs: number;
    speechDurationMs: number;
    rawDurationMs: number;
    silenceRemovedMs: number;
}

export type PreprocessorEvent =
    | { type: 'segment_ready'; segment: VoiceSegment }
    | { type: 'soft_limit_reached'; segmentCount: number }
    | { type: 'hard_limit_reached'; segmentCount: number }
    | { type: 'duration_limit_reached'; totalMs: number }
    | { type: 'processing_error'; error: string };
