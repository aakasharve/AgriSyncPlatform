/**
 * Voice Preprocessor - Orchestrates the 4-layer hybrid voice pipeline.
 *
 * Layer 1: On-device buffering (handled by caller / MediaRecorder)
 * Layer 2: Silence trimming
 * Layer 3: Intent chunking
 * Layer 4: Segment compression
 *
 * Input: Raw PCM audio from recording
 * Output: Compressed VoiceSegments with deterministic metadata
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

type AudioContextCtor = { new(options?: AudioContextOptions): AudioContext };

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

    static isDecodeSupported(): boolean {
        return VoicePreprocessor.resolveAudioContextCtor() !== null;
    }

    async processBlobAsSingleBlob(
        audioBlob: Blob,
        sessionId: string,
        farmId: string,
    ): Promise<{
        audioBlob: Blob;
        mimeType: string;
        metadata: VoiceSessionMetadata;
        contentHash: string;
    }> {
        const { pcmData, sampleRate } = await this.decodeBlobToMonoPcm(audioBlob);
        return this.processAsSingleBlob(pcmData, sampleRate, sessionId, farmId);
    }

    /**
     * Process raw PCM audio through the full 4-layer pipeline.
     */
    async process(
        pcmData: Float32Array,
        sampleRate: number,
        sessionId: string,
        farmId: string,
        onEvent?: (event: PreprocessorEvent) => void,
    ): Promise<{
        segments: VoiceSegment[];
        metadata: VoiceSessionMetadata;
    }> {
        const rawDurationMs = (pcmData.length / sampleRate) * 1000;
        if (rawDurationMs < this.config.limits.minAudioDurationMs) {
            throw new Error(
                `Audio too short: ${rawDurationMs.toFixed(0)}ms (minimum: ${this.config.limits.minAudioDurationMs}ms)`,
            );
        }

        // Layer 2: Silence trimming
        const { trimmedData, totalSilenceRemovedMs } = this.silenceTrimmer.trimSilence(pcmData, sampleRate);
        const effectiveData = trimmedData.length > 0 ? trimmedData : pcmData;
        const effectiveSilenceRemovedMs = trimmedData.length > 0 ? totalSilenceRemovedMs : 0;
        const speechDurationMs = (effectiveData.length / sampleRate) * 1000;

        if (speechDurationMs > this.config.limits.maxSpeechDurationMs) {
            onEvent?.({
                type: 'duration_limit_reached',
                totalMs: speechDurationMs,
            });
        }

        // Layer 3: Intent chunking
        const chunkBoundaries = this.intentChunker.chunkAudio(effectiveData, sampleRate);
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

        const effectiveChunks = chunkBoundaries.slice(0, this.config.limits.hardSegmentLimit);
        const segments: VoiceSegment[] = [];
        let totalCompressedSize = 0;
        let totalRawPcmSize = 0;

        for (let i = 0; i < effectiveChunks.length; i++) {
            const chunk = effectiveChunks[i];
            const chunkPcm = effectiveData.subarray(chunk.startSample, chunk.endSample);

            let audioBlob: Blob;
            let mimeType: string;

            try {
                const compressed = await this.compressChunk(chunkPcm, sampleRate);
                audioBlob = compressed.audioBlob;
                mimeType = compressed.mimeType;
            } catch (error) {
                onEvent?.({
                    type: 'processing_error',
                    error: error instanceof Error ? error.message : 'Compression failed',
                });
                audioBlob = SegmentCompressor.createWavBlob(chunkPcm, sampleRate);
                mimeType = 'audio/wav';
            }

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
            totalRawPcmSize += chunkPcm.length * 4;
            onEvent?.({ type: 'segment_ready', segment });
        }

        const metadata: VoiceSessionMetadata = {
            sessionId,
            farmId,
            totalSegments: segments.length,
            totalSpeechDurationMs: speechDurationMs,
            totalRawDurationMs: rawDurationMs,
            totalSilenceRemovedMs: effectiveSilenceRemovedMs,
            compressionRatio: totalRawPcmSize > 0 ? totalCompressedSize / totalRawPcmSize : 1,
            deviceTimestamp: new Date().toISOString(),
            clientTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        };

        return { segments, metadata };
    }

    /**
     * Process raw audio and merge all segments into a single blob.
     * Used by the existing backend endpoint contract.
     */
    async processAsSingleBlob(
        pcmData: Float32Array,
        sampleRate: number,
        sessionId: string,
        farmId: string,
    ): Promise<{
        audioBlob: Blob;
        mimeType: string;
        metadata: VoiceSessionMetadata;
        contentHash: string;
    }> {
        const rawDurationMs = (pcmData.length / sampleRate) * 1000;
        const { trimmedData, totalSilenceRemovedMs } = this.silenceTrimmer.trimSilence(pcmData, sampleRate);
        const effectiveData = trimmedData.length > 0 ? trimmedData : pcmData;
        const effectiveSilenceRemovedMs = trimmedData.length > 0 ? totalSilenceRemovedMs : 0;
        const speechDurationMs = (effectiveData.length / sampleRate) * 1000;

        let audioBlob: Blob;
        let mimeType: string;
        let compressionRatio = 1;

        try {
            const compressed = await this.compressChunk(effectiveData, sampleRate);
            audioBlob = compressed.audioBlob;
            mimeType = compressed.mimeType;
            compressionRatio = compressed.compressionRatio;
        } catch {
            audioBlob = SegmentCompressor.createWavBlob(effectiveData, sampleRate);
            mimeType = 'audio/wav';
        }

        const contentHash = await ContentHasher.hashBlob(audioBlob);
        const metadata: VoiceSessionMetadata = {
            sessionId,
            farmId,
            totalSegments: 1,
            totalSpeechDurationMs: speechDurationMs,
            totalRawDurationMs: rawDurationMs,
            totalSilenceRemovedMs: effectiveSilenceRemovedMs,
            compressionRatio,
            deviceTimestamp: new Date().toISOString(),
            clientTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        };

        return { audioBlob, mimeType, metadata, contentHash };
    }

    private async compressChunk(
        chunkPcm: Float32Array,
        sampleRate: number,
    ): Promise<{
        audioBlob: Blob;
        mimeType: string;
        compressionRatio: number;
    }> {
        if (chunkPcm.length === 0) {
            throw new Error('Cannot compress empty audio chunk.');
        }

        if (!SegmentCompressor.isSupported()) {
            throw new Error('Opus/WebM compression is not supported in this browser.');
        }

        const compressed = await this.segmentCompressor.compress(chunkPcm, sampleRate);
        if (compressed.blob.size === 0) {
            throw new Error('Compression produced an empty output blob.');
        }

        return {
            audioBlob: compressed.blob,
            mimeType: compressed.mimeType,
            compressionRatio: compressed.compressionRatio,
        };
    }

    private async decodeBlobToMonoPcm(audioBlob: Blob): Promise<{
        pcmData: Float32Array;
        sampleRate: number;
    }> {
        const AudioContextConstructor = VoicePreprocessor.resolveAudioContextCtor();
        if (!AudioContextConstructor) {
            throw new Error('WebAudio decode is unavailable in this browser.');
        }

        const audioContext = new AudioContextConstructor();
        try {
            const audioBuffer = await audioContext.decodeAudioData(await audioBlob.arrayBuffer());
            const pcmData = VoicePreprocessor.toMonoPcm(audioBuffer);
            return {
                pcmData,
                sampleRate: audioBuffer.sampleRate,
            };
        } finally {
            await audioContext.close().catch(() => {});
        }
    }

    private static toMonoPcm(audioBuffer: AudioBuffer): Float32Array {
        const channels = audioBuffer.numberOfChannels;
        if (channels <= 0) {
            return new Float32Array(0);
        }

        if (channels === 1) {
            return new Float32Array(audioBuffer.getChannelData(0));
        }

        const mono = new Float32Array(audioBuffer.length);
        for (let channel = 0; channel < channels; channel++) {
            const source = audioBuffer.getChannelData(channel);
            for (let i = 0; i < source.length; i++) {
                mono[i] += source[i];
            }
        }

        for (let i = 0; i < mono.length; i++) {
            mono[i] /= channels;
        }

        return mono;
    }

    private static resolveAudioContextCtor(): AudioContextCtor | null {
        if (typeof AudioContext !== 'undefined') {
            return AudioContext;
        }

        const maybeWindow = typeof window !== 'undefined'
            ? (window as unknown as { webkitAudioContext?: AudioContextCtor })
            : undefined;
        return maybeWindow?.webkitAudioContext ?? null;
    }
}
