/**
 * Layer 2: Silence Trimmer
 *
 * Detects speech versus silence regions in PCM audio and removes dead air.
 */

import { SilenceConfig, SpeechRegion, SilenceRegion } from './types';

const FRAME_SIZE = 128;

export class SilenceTrimmer {
    private readonly config: SilenceConfig;

    constructor(config: SilenceConfig) {
        this.config = config;
    }

    private computeRms(samples: Float32Array, start: number, length: number): number {
        const end = Math.min(start + length, samples.length);
        const count = end - start;
        if (count <= 0) {
            return 0;
        }

        let sum = 0;
        for (let i = start; i < end; i++) {
            const sample = samples[i];
            sum += sample * sample;
        }

        return Math.sqrt(sum / count);
    }

    detectSilenceRegions(pcmData: Float32Array, sampleRate: number): SilenceRegion[] {
        if (pcmData.length === 0 || sampleRate <= 0) {
            return [];
        }

        const frameDurationMs = (FRAME_SIZE / sampleRate) * 1000;
        const minSilenceFrames = Math.max(
            1,
            Math.ceil(this.config.minSilenceDurationMs / frameDurationMs),
        );
        const totalFrames = Math.ceil(pcmData.length / FRAME_SIZE);

        const regions: SilenceRegion[] = [];
        let silenceStart = -1;
        let silenceFrameCount = 0;

        for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
            const rms = this.computeRms(pcmData, frameIndex * FRAME_SIZE, FRAME_SIZE);
            const isSilent = rms < this.config.rmsThreshold;

            if (isSilent) {
                if (silenceStart === -1) {
                    silenceStart = frameIndex;
                }
                silenceFrameCount += 1;
                continue;
            }

            if (silenceStart !== -1 && silenceFrameCount >= minSilenceFrames) {
                const startMs = (silenceStart * FRAME_SIZE / sampleRate) * 1000;
                const endMs = (frameIndex * FRAME_SIZE / sampleRate) * 1000;
                regions.push({
                    startMs,
                    endMs,
                    durationMs: Math.max(0, endMs - startMs),
                });
            }

            silenceStart = -1;
            silenceFrameCount = 0;
        }

        if (silenceStart !== -1 && silenceFrameCount >= minSilenceFrames) {
            const startMs = (silenceStart * FRAME_SIZE / sampleRate) * 1000;
            const endMs = (pcmData.length / sampleRate) * 1000;
            regions.push({
                startMs,
                endMs,
                durationMs: Math.max(0, endMs - startMs),
            });
        }

        return regions;
    }

    extractSpeechRegions(pcmData: Float32Array, sampleRate: number): SpeechRegion[] {
        const totalDurationMs = (pcmData.length / sampleRate) * 1000;
        const silenceRegions = this.detectSilenceRegions(pcmData, sampleRate);

        if (silenceRegions.length === 0) {
            return [
                {
                    startSample: 0,
                    endSample: pcmData.length,
                    startMs: 0,
                    endMs: totalDurationMs,
                    durationMs: totalDurationMs,
                },
            ];
        }

        const speechRegions: SpeechRegion[] = [];
        let cursorMs = 0;

        for (const silence of silenceRegions) {
            const speechStartMs = cursorMs;
            const speechEndMs = silence.startMs;
            if (speechEndMs > speechStartMs) {
                const paddedStartMs = Math.max(0, speechStartMs - this.config.paddingBeforeMs);
                const paddedEndMs = Math.min(totalDurationMs, speechEndMs + this.config.paddingAfterMs);

                speechRegions.push({
                    startSample: Math.floor((paddedStartMs / 1000) * sampleRate),
                    endSample: Math.ceil((paddedEndMs / 1000) * sampleRate),
                    startMs: paddedStartMs,
                    endMs: paddedEndMs,
                    durationMs: paddedEndMs - paddedStartMs,
                });
            }

            cursorMs = silence.endMs;
        }

        if (cursorMs < totalDurationMs) {
            const paddedStartMs = Math.max(0, cursorMs - this.config.paddingBeforeMs);
            speechRegions.push({
                startSample: Math.floor((paddedStartMs / 1000) * sampleRate),
                endSample: pcmData.length,
                startMs: paddedStartMs,
                endMs: totalDurationMs,
                durationMs: totalDurationMs - paddedStartMs,
            });
        }

        const constrained = this.applyEdgeConstraints(speechRegions, totalDurationMs, sampleRate);
        return this.mergeOverlappingRegions(constrained, sampleRate);
    }

    trimSilence(
        pcmData: Float32Array,
        sampleRate: number,
    ): {
        trimmedData: Float32Array;
        speechRegions: SpeechRegion[];
        totalSilenceRemovedMs: number;
    } {
        const speechRegions = this.extractSpeechRegions(pcmData, sampleRate);
        const totalDurationMs = (pcmData.length / sampleRate) * 1000;

        if (speechRegions.length === 0) {
            return {
                trimmedData: new Float32Array(0),
                speechRegions: [],
                totalSilenceRemovedMs: totalDurationMs,
            };
        }

        let totalSamples = 0;
        for (const region of speechRegions) {
            totalSamples += region.endSample - region.startSample;
        }

        const trimmedData = new Float32Array(totalSamples);
        let offset = 0;

        for (const region of speechRegions) {
            const length = region.endSample - region.startSample;
            trimmedData.set(pcmData.subarray(region.startSample, region.endSample), offset);
            offset += length;
        }

        const trimmedDurationMs = (trimmedData.length / sampleRate) * 1000;
        return {
            trimmedData,
            speechRegions,
            totalSilenceRemovedMs: Math.max(0, totalDurationMs - trimmedDurationMs),
        };
    }

    private applyEdgeConstraints(
        regions: SpeechRegion[],
        totalDurationMs: number,
        sampleRate: number,
    ): SpeechRegion[] {
        if (regions.length === 0) {
            return [];
        }

        const maxSample = Math.floor((totalDurationMs / 1000) * sampleRate);
        const constrained = regions
            .map(region => {
                const startSample = Math.max(0, Math.min(region.startSample, maxSample));
                const endSample = Math.max(startSample, Math.min(region.endSample, maxSample));
                const startMs = (startSample / sampleRate) * 1000;
                const endMs = (endSample / sampleRate) * 1000;

                return {
                    startSample,
                    endSample,
                    startMs,
                    endMs,
                    durationMs: Math.max(0, endMs - startMs),
                };
            })
            .filter(region => region.durationMs > 0);

        return constrained;
    }

    private mergeOverlappingRegions(regions: SpeechRegion[], sampleRate: number): SpeechRegion[] {
        if (regions.length <= 1) {
            return regions;
        }

        const sorted = [...regions].sort((a, b) => a.startSample - b.startSample);
        const merged: SpeechRegion[] = [sorted[0]];

        for (let i = 1; i < sorted.length; i++) {
            const current = sorted[i];
            const previous = merged[merged.length - 1];

            if (current.startSample <= previous.endSample) {
                const endSample = Math.max(previous.endSample, current.endSample);
                const startSample = previous.startSample;
                const startMs = (startSample / sampleRate) * 1000;
                const endMs = (endSample / sampleRate) * 1000;

                merged[merged.length - 1] = {
                    startSample,
                    endSample,
                    startMs,
                    endMs,
                    durationMs: endMs - startMs,
                };
                continue;
            }

            merged.push(current);
        }

        return merged;
    }
}
