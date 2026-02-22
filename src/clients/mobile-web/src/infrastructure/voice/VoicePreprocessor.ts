/**
 * Voice Preprocessor — Orchestrates the 4-layer hybrid voice pipeline.
 *
 * Layer 1: On-device buffering (handled by caller / MediaRecorder)
 * Layer 2: Silence trimming
 * Layer 3: Intent chunking
 * Layer 4: Segment compression
 *
 * Input: Raw PCM audio from recording
 * Output: Array of compressed VoiceSegments with metadata
 */

import {
    VoiceSegment,
    VoiceSessionMetadata,
    VoicePreprocessorConfig,
    DEFAULT_VOICE_CONFIG,
    PreprocessorEvent,
} from './types';
import { SilenceTrimmer } from './SilenceTrimmer';
import { IntentChunker } from './IntentChunker';
import { SegmentCompressor } from './SegmentCompressor';
import { ContentHasher } from './ContentHasher';

export class VoicePreprocessor {
    private readonly config: VoicePreprocessorConfig;
    private readonly silenceTrimmer: SilenceTrimmer;
    private readonly intentChunker: IntentChunker;
    private readonly segmentCompressor: SegmentCompressor;

    constructor(config: VoicePreprocessorConfig = DEFAULT_VOICE_CONFIG) {
        this.config = config;
        this.silenceTrimmer = new SilenceTrimmer(config.silence);
        this.intentChunker = new IntentChunker(config.chunking, config.silence);
        this.segmentCompressor = new SegmentCompressor(config.compression);
    }

    /**
     * Process raw PCM audio through the full 4-layer pipeline.
     *
     * @param pcmData Raw PCM audio data (Float32Array, mono)
     * @param sampleRate Sample rate of the input audio
     * @param sessionId Unique session identifier
     * @param farmId Farm identifier for metadata
     * @param onEvent Optional callback for pipeline events
     * @returns Array of processed VoiceSegments + session metadata
     */
    async process(
        pcmData: Float32Array,
        sampleRate: number,
        sessionId: string,
        farmId: string,
        onEvent?: (event: PreprocessorEvent) => void
    ): Promise<{
        segments: VoiceSegment[];
        metadata: VoiceSessionMetadata;
    }> {
        const rawDurationMs = (pcmData.length / sampleRate) * 1000;

        // Validate minimum duration
        if (rawDurationMs < this.config.limits.minAudioDurationMs) {
            throw new Error(
                `Audio too short: ${rawDurationMs.toFixed(0)}ms (minimum: ${this.config.limits.minAudioDurationMs}ms)`
            );
        }

        // Layer 2: Silence trimming
        const { trimmedData, totalSilenceRemovedMs } = this.silenceTrimmer.trimSilence(
            pcmData,
            sampleRate
        );

        const speechDurationMs = (trimmedData.length / sampleRate) * 1000;

        // Check speech duration limit
        if (speechDurationMs > this.config.limits.maxSpeechDurationMs) {
            onEvent?.({
                type: 'duration_limit_reached',
                totalMs: speechDurationMs,
            });
        }

        // Layer 3: Intent chunking
        const chunkBoundaries = this.intentChunker.chunkAudio(trimmedData, sampleRate);

        // Check segment limits
        if (chunkBoundaries.length > this.config.limits.hardSegmentLimit) {
            onEvent?.({
                type: 'hard_limit_reached',
                segmentCount: chunkBoundaries.length,
            });
        } else if (chunkBoundaries.length > this.config.limits.softSegmentLimit) {
            onEvent?.({
                type: 'soft_limit_reached',
                segmentCount: chunkBoundaries.length,
            });
        }

        // Limit to hard max
        const effectiveChunks = chunkBoundaries.slice(0, this.config.limits.hardSegmentLimit);

        // Layer 4: Compress each segment
        const useCompression = SegmentCompressor.isSupported();
        const segments: VoiceSegment[] = [];
        let totalCompressedSize = 0;
        let totalRawPcmSize = 0;

        for (let i = 0; i < effectiveChunks.length; i++) {
            const chunk = effectiveChunks[i];
            const chunkPcm = trimmedData.subarray(chunk.startSample, chunk.endSample);

            let audioBlob: Blob;
            let mimeType: string;

            if (useCompression) {
                try {
                    const compressed = await this.segmentCompressor.compress(chunkPcm, sampleRate);
                    audioBlob = compressed.blob;
                    mimeType = compressed.mimeType;
                } catch {
                    // Fallback to WAV if compression fails
                    audioBlob = SegmentCompressor.createWavBlob(chunkPcm, sampleRate);
                    mimeType = 'audio/wav';
                }
            } else {
                audioBlob = SegmentCompressor.createWavBlob(chunkPcm, sampleRate);
                mimeType = 'audio/wav';
            }

            // Size validation
            if (audioBlob.size > this.config.limits.maxSegmentSizeBytes) {
                onEvent?.({
                    type: 'processing_error',
                    error: `Segment ${i} exceeds size limit: ${audioBlob.size} bytes`,
                });
                continue;
            }

            const contentHash = await ContentHasher.hashBlob(audioBlob);

            const segment: VoiceSegment = {
                segmentIndex: i,
                audioBlob,
                mimeType,
                durationMs: chunk.speechDurationMs,
                rawDurationMs: chunk.rawDurationMs,
                silenceRemovedMs: chunk.silenceRemovedMs,
                contentHash,
                startOffsetMs: chunk.startMs,
                isFinal: i === effectiveChunks.length - 1,
                sessionId,
            };

            segments.push(segment);
            totalCompressedSize += audioBlob.size;
            totalRawPcmSize += chunkPcm.length * 4; // Float32 = 4 bytes

            onEvent?.({ type: 'segment_ready', segment });
        }

        const metadata: VoiceSessionMetadata = {
            sessionId,
            farmId,
            totalSegments: segments.length,
            totalSpeechDurationMs: speechDurationMs,
            totalRawDurationMs: rawDurationMs,
            totalSilenceRemovedMs: totalSilenceRemovedMs,
            compressionRatio: totalRawPcmSize > 0 ? totalCompressedSize / totalRawPcmSize : 1,
            deviceTimestamp: new Date().toISOString(),
            clientTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        };

        return { segments, metadata };
    }

    /**
     * Process raw audio and merge all segments into a single audio blob.
     * Used when the backend expects a single audio file rather than segments.
     * Still applies silence trimming and compression for cost savings.
     */
    async processAsSingleBlob(
        pcmData: Float32Array,
        sampleRate: number,
        sessionId: string,
        farmId: string
    ): Promise<{
        audioBlob: Blob;
        mimeType: string;
        metadata: VoiceSessionMetadata;
        contentHash: string;
    }> {
        const rawDurationMs = (pcmData.length / sampleRate) * 1000;

        // Layer 2: Silence trimming only
        const { trimmedData, totalSilenceRemovedMs } = this.silenceTrimmer.trimSilence(
            pcmData,
            sampleRate
        );

        const speechDurationMs = (trimmedData.length / sampleRate) * 1000;

        // Layer 4: Compress
        let audioBlob: Blob;
        let mimeType: string;
        let compressionRatio = 1;

        if (SegmentCompressor.isSupported()) {
            try {
                const compressed = await this.segmentCompressor.compress(trimmedData, sampleRate);
                audioBlob = compressed.blob;
                mimeType = compressed.mimeType;
                compressionRatio = compressed.compressionRatio;
            } catch {
                audioBlob = SegmentCompressor.createWavBlob(trimmedData, sampleRate);
                mimeType = 'audio/wav';
            }
        } else {
            audioBlob = SegmentCompressor.createWavBlob(trimmedData, sampleRate);
            mimeType = 'audio/wav';
        }

        const contentHash = await ContentHasher.hashBlob(audioBlob);

        const metadata: VoiceSessionMetadata = {
            sessionId,
            farmId,
            totalSegments: 1,
            totalSpeechDurationMs: speechDurationMs,
            totalRawDurationMs: rawDurationMs,
            totalSilenceRemovedMs: totalSilenceRemovedMs,
            compressionRatio,
            deviceTimestamp: new Date().toISOString(),
            clientTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        };

        return { audioBlob, mimeType, metadata, contentHash };
    }
}
