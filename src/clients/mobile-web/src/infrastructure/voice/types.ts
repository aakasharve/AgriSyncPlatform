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
        rmsThreshold: 0.01,
        minSilenceDurationMs: 500,
        paddingBeforeMs: 150,
        paddingAfterMs: 150,
        leadingSilenceMaxMs: 150,
        trailingSilenceMaxMs: 300,
    },
    chunking: {
        pauseGapMs: 1500,
        minChunkDurationMs: 800,
        maxChunkDurationMs: 120_000,
        forceSplitPauseMs: 500,
    },
    compression: {
        targetSampleRate: 16000,
        targetBitrate: 32000,
        codec: 'opus',
        mimeType: 'audio/webm;codecs=opus',
    },
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
