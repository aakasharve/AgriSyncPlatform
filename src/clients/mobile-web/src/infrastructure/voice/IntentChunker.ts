/**
 * Layer 3: Intent Chunker
 *
 * Splits trimmed PCM audio into meaningful segments based on pause gaps.
 * v1 uses pause-based splitting only (no NLP). The LLM handles multi-topic chunks.
 */

import { ChunkingConfig, SilenceConfig, ChunkBoundary } from './types';
import { SilenceTrimmer } from './SilenceTrimmer';

export class IntentChunker {
    private readonly chunkConfig: ChunkingConfig;
    private readonly silenceTrimmer: SilenceTrimmer;

    constructor(chunkConfig: ChunkingConfig, silenceConfig: SilenceConfig) {
        this.chunkConfig = chunkConfig;
        this.silenceTrimmer = new SilenceTrimmer(silenceConfig);
    }

    /**
     * Split PCM audio into chunks based on pause gaps.
     * Each chunk represents a potential intent/topic from the farmer.
     */
    chunkAudio(pcmData: Float32Array, sampleRate: number): ChunkBoundary[] {
        const totalDurationMs = (pcmData.length / sampleRate) * 1000;

        if (totalDurationMs < this.chunkConfig.minChunkDurationMs) {
            // Audio too short to chunk — return as single chunk
            return [{
                startSample: 0,
                endSample: pcmData.length,
                startMs: 0,
                endMs: totalDurationMs,
                speechDurationMs: totalDurationMs,
                rawDurationMs: totalDurationMs,
                silenceRemovedMs: 0,
            }];
        }

        // Find pause locations (silence regions that qualify as chunk boundaries)
        const silenceRegions = this.silenceTrimmer.detectSilenceRegions(pcmData, sampleRate);
        const pauseGaps = silenceRegions.filter(
            s => s.durationMs >= this.chunkConfig.pauseGapMs
        );

        if (pauseGaps.length === 0) {
            // No significant pauses — check if we need force-splitting
            return this.handleContinuousSpeech(pcmData, sampleRate, totalDurationMs, silenceRegions);
        }

        // Build chunks from pause boundaries
        const rawChunks: ChunkBoundary[] = [];
        let chunkStartMs = 0;
        let chunkStartSample = 0;

        for (const pause of pauseGaps) {
            const chunkEndMs = pause.startMs;
            const chunkEndSample = Math.floor((chunkEndMs / 1000) * sampleRate);
            const speechDuration = chunkEndMs - chunkStartMs;

            if (speechDuration > 0) {
                rawChunks.push({
                    startSample: chunkStartSample,
                    endSample: chunkEndSample,
                    startMs: chunkStartMs,
                    endMs: chunkEndMs,
                    speechDurationMs: speechDuration,
                    rawDurationMs: speechDuration,
                    silenceRemovedMs: 0,
                });
            }

            chunkStartMs = pause.endMs;
            chunkStartSample = Math.floor((chunkStartMs / 1000) * sampleRate);
        }

        // Final chunk after last pause
        if (chunkStartMs < totalDurationMs) {
            rawChunks.push({
                startSample: chunkStartSample,
                endSample: pcmData.length,
                startMs: chunkStartMs,
                endMs: totalDurationMs,
                speechDurationMs: totalDurationMs - chunkStartMs,
                rawDurationMs: totalDurationMs - chunkStartMs,
                silenceRemovedMs: 0,
            });
        }

        // Apply merge rule: chunks shorter than min get merged with preceding
        return this.mergeShortChunks(rawChunks);
    }

    /**
     * Handle continuous speech (no qualifying pauses).
     * If duration exceeds max, force-split at smaller pauses.
     */
    private handleContinuousSpeech(
        pcmData: Float32Array,
        sampleRate: number,
        totalDurationMs: number,
        silenceRegions: { startMs: number; endMs: number; durationMs: number }[]
    ): ChunkBoundary[] {
        if (totalDurationMs <= this.chunkConfig.maxChunkDurationMs) {
            return [{
                startSample: 0,
                endSample: pcmData.length,
                startMs: 0,
                endMs: totalDurationMs,
                speechDurationMs: totalDurationMs,
                rawDurationMs: totalDurationMs,
                silenceRemovedMs: 0,
            }];
        }

        // Force-split at shorter pauses
        const forceSplitPauses = silenceRegions
            .filter(s => s.durationMs >= this.chunkConfig.forceSplitPauseMs)
            .sort((a, b) => a.startMs - b.startMs);

        if (forceSplitPauses.length === 0) {
            // No pauses at all — split at max duration boundaries
            return this.splitAtDurationBoundaries(pcmData, sampleRate, totalDurationMs);
        }

        // Find optimal split points near max chunk duration
        const chunks: ChunkBoundary[] = [];
        let chunkStartMs = 0;
        let chunkStartSample = 0;

        for (const pause of forceSplitPauses) {
            const currentDuration = pause.startMs - chunkStartMs;
            if (currentDuration >= this.chunkConfig.maxChunkDurationMs) {
                const chunkEndMs = pause.startMs;
                const chunkEndSample = Math.floor((chunkEndMs / 1000) * sampleRate);

                chunks.push({
                    startSample: chunkStartSample,
                    endSample: chunkEndSample,
                    startMs: chunkStartMs,
                    endMs: chunkEndMs,
                    speechDurationMs: currentDuration,
                    rawDurationMs: currentDuration,
                    silenceRemovedMs: 0,
                });

                chunkStartMs = pause.endMs;
                chunkStartSample = Math.floor((chunkStartMs / 1000) * sampleRate);
            }
        }

        // Final chunk
        if (chunkStartMs < totalDurationMs) {
            chunks.push({
                startSample: chunkStartSample,
                endSample: pcmData.length,
                startMs: chunkStartMs,
                endMs: totalDurationMs,
                speechDurationMs: totalDurationMs - chunkStartMs,
                rawDurationMs: totalDurationMs - chunkStartMs,
                silenceRemovedMs: 0,
            });
        }

        return chunks.length > 0 ? chunks : [{
            startSample: 0,
            endSample: pcmData.length,
            startMs: 0,
            endMs: totalDurationMs,
            speechDurationMs: totalDurationMs,
            rawDurationMs: totalDurationMs,
            silenceRemovedMs: 0,
        }];
    }

    /**
     * Hard split at duration boundaries when no pauses exist.
     */
    private splitAtDurationBoundaries(
        pcmData: Float32Array,
        sampleRate: number,
        totalDurationMs: number
    ): ChunkBoundary[] {
        const chunks: ChunkBoundary[] = [];
        let startMs = 0;

        while (startMs < totalDurationMs) {
            const endMs = Math.min(startMs + this.chunkConfig.maxChunkDurationMs, totalDurationMs);
            const startSample = Math.floor((startMs / 1000) * sampleRate);
            const endSample = Math.min(Math.floor((endMs / 1000) * sampleRate), pcmData.length);

            chunks.push({
                startSample,
                endSample,
                startMs,
                endMs,
                speechDurationMs: endMs - startMs,
                rawDurationMs: endMs - startMs,
                silenceRemovedMs: 0,
            });

            startMs = endMs;
        }

        return chunks;
    }

    /**
     * Merge chunks shorter than minimum duration with the preceding chunk.
     */
    private mergeShortChunks(chunks: ChunkBoundary[]): ChunkBoundary[] {
        if (chunks.length <= 1) return chunks;

        const merged: ChunkBoundary[] = [chunks[0]];

        for (let i = 1; i < chunks.length; i++) {
            const current = chunks[i];
            const prev = merged[merged.length - 1];

            if (current.speechDurationMs < this.chunkConfig.minChunkDurationMs) {
                // Merge with preceding chunk
                merged[merged.length - 1] = {
                    startSample: prev.startSample,
                    endSample: current.endSample,
                    startMs: prev.startMs,
                    endMs: current.endMs,
                    speechDurationMs: prev.speechDurationMs + current.speechDurationMs,
                    rawDurationMs: current.endMs - prev.startMs,
                    silenceRemovedMs: prev.silenceRemovedMs + current.silenceRemovedMs,
                };
            } else {
                merged.push(current);
            }
        }

        return merged;
    }
}
