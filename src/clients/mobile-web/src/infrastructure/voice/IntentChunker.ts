/**
 * Layer 3: Intent Chunker
 *
 * Splits trimmed PCM audio into deterministic segments using pause gaps.
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

    chunkAudio(pcmData: Float32Array, sampleRate: number): ChunkBoundary[] {
        if (pcmData.length === 0 || sampleRate <= 0) {
            return [];
        }

        const totalDurationMs = (pcmData.length / sampleRate) * 1000;
        if (totalDurationMs < this.chunkConfig.minChunkDurationMs) {
            return [
                {
                    startSample: 0,
                    endSample: pcmData.length,
                    startMs: 0,
                    endMs: totalDurationMs,
                    speechDurationMs: totalDurationMs,
                    rawDurationMs: totalDurationMs,
                    silenceRemovedMs: 0,
                },
            ];
        }

        const silenceRegions = this.silenceTrimmer.detectSilenceRegions(pcmData, sampleRate);
        const pauseGaps = silenceRegions.filter(region => region.durationMs >= this.chunkConfig.pauseGapMs);

        if (pauseGaps.length === 0) {
            const continuousChunks = this.handleContinuousSpeech(
                pcmData,
                sampleRate,
                totalDurationMs,
                silenceRegions,
            );
            return this.normalizeChunks(continuousChunks, pcmData.length, sampleRate);
        }

        const rawChunks: ChunkBoundary[] = [];
        let chunkStartMs = 0;
        let chunkStartSample = 0;

        for (const pause of pauseGaps) {
            const chunkEndMs = pause.startMs;
            const chunkEndSample = Math.floor((chunkEndMs / 1000) * sampleRate);
            const speechDurationMs = chunkEndMs - chunkStartMs;

            if (speechDurationMs <= 0) {
                chunkStartMs = pause.endMs;
                chunkStartSample = Math.floor((chunkStartMs / 1000) * sampleRate);
                continue;
            }

            rawChunks.push({
                startSample: chunkStartSample,
                endSample: chunkEndSample,
                startMs: chunkStartMs,
                endMs: chunkEndMs,
                speechDurationMs,
                rawDurationMs: speechDurationMs,
                silenceRemovedMs: 0,
            });

            chunkStartMs = pause.endMs;
            chunkStartSample = Math.floor((chunkStartMs / 1000) * sampleRate);
        }

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

        const mergedChunks = this.mergeShortChunks(rawChunks);
        return this.normalizeChunks(mergedChunks, pcmData.length, sampleRate);
    }

    private handleContinuousSpeech(
        pcmData: Float32Array,
        sampleRate: number,
        totalDurationMs: number,
        silenceRegions: { startMs: number; endMs: number; durationMs: number }[],
    ): ChunkBoundary[] {
        if (totalDurationMs <= this.chunkConfig.maxChunkDurationMs) {
            return [
                {
                    startSample: 0,
                    endSample: pcmData.length,
                    startMs: 0,
                    endMs: totalDurationMs,
                    speechDurationMs: totalDurationMs,
                    rawDurationMs: totalDurationMs,
                    silenceRemovedMs: 0,
                },
            ];
        }

        const forceSplitPauses = silenceRegions
            .filter(region => region.durationMs >= this.chunkConfig.forceSplitPauseMs)
            .sort((a, b) => a.startMs - b.startMs);

        if (forceSplitPauses.length === 0) {
            return this.splitAtDurationBoundaries(pcmData, sampleRate, totalDurationMs);
        }

        const chunks: ChunkBoundary[] = [];
        let chunkStartMs = 0;
        let chunkStartSample = 0;

        for (const pause of forceSplitPauses) {
            const currentDuration = pause.startMs - chunkStartMs;
            if (currentDuration < this.chunkConfig.maxChunkDurationMs) {
                continue;
            }

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

        if (chunks.length > 0) {
            return chunks;
        }

        return [
            {
                startSample: 0,
                endSample: pcmData.length,
                startMs: 0,
                endMs: totalDurationMs,
                speechDurationMs: totalDurationMs,
                rawDurationMs: totalDurationMs,
                silenceRemovedMs: 0,
            },
        ];
    }

    private splitAtDurationBoundaries(
        pcmData: Float32Array,
        sampleRate: number,
        totalDurationMs: number,
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

    private mergeShortChunks(chunks: ChunkBoundary[]): ChunkBoundary[] {
        if (chunks.length <= 1) {
            return chunks;
        }

        const merged: ChunkBoundary[] = [chunks[0]];
        for (let i = 1; i < chunks.length; i++) {
            const current = chunks[i];
            const previous = merged[merged.length - 1];

            if (current.speechDurationMs >= this.chunkConfig.minChunkDurationMs) {
                merged.push(current);
                continue;
            }

            merged[merged.length - 1] = {
                startSample: previous.startSample,
                endSample: current.endSample,
                startMs: previous.startMs,
                endMs: current.endMs,
                speechDurationMs: previous.speechDurationMs + current.speechDurationMs,
                rawDurationMs: current.endMs - previous.startMs,
                silenceRemovedMs: previous.silenceRemovedMs + current.silenceRemovedMs,
            };
        }

        return merged;
    }

    private normalizeChunks(
        chunks: ChunkBoundary[],
        totalSamples: number,
        sampleRate: number,
    ): ChunkBoundary[] {
        return chunks
            .map(chunk => {
                const startSample = Math.max(0, Math.min(chunk.startSample, totalSamples));
                const endSample = Math.max(startSample, Math.min(chunk.endSample, totalSamples));
                const startMs = (startSample / sampleRate) * 1000;
                const endMs = (endSample / sampleRate) * 1000;
                const speechDurationMs = Math.max(0, endMs - startMs);

                return {
                    startSample,
                    endSample,
                    startMs,
                    endMs,
                    speechDurationMs,
                    rawDurationMs: speechDurationMs,
                    silenceRemovedMs: chunk.silenceRemovedMs,
                };
            })
            .filter(chunk => chunk.endSample > chunk.startSample);
    }
}
