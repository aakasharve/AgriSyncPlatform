/**
 * Layer 2: Silence Trimmer
 *
 * Analyzes PCM audio data and identifies speech vs silence regions.
 * Removes dead air while preserving natural phrasing with configurable padding.
 */

import { SilenceConfig, SpeechRegion, SilenceRegion } from './types';

const FRAME_SIZE = 128; // samples per analysis frame

export class SilenceTrimmer {
    private readonly config: SilenceConfig;

    constructor(config: SilenceConfig) {
        this.config = config;
    }

    /**
     * Compute RMS energy for a frame of samples.
     */
    private computeRms(samples: Float32Array, start: number, length: number): number {
        let sum = 0;
        const end = Math.min(start + length, samples.length);
        const count = end - start;
        if (count <= 0) return 0;
        for (let i = start; i < end; i++) {
            sum += samples[i] * samples[i];
        }
        return Math.sqrt(sum / count);
    }

    /**
     * Detect silence regions in PCM audio data.
     */
    detectSilenceRegions(pcmData: Float32Array, sampleRate: number): SilenceRegion[] {
        const frameDurationMs = (FRAME_SIZE / sampleRate) * 1000;
        const minSilenceFrames = Math.ceil(this.config.minSilenceDurationMs / frameDurationMs);
        const totalFrames = Math.floor(pcmData.length / FRAME_SIZE);

        const regions: SilenceRegion[] = [];
        let silenceStart = -1;
        let silenceFrameCount = 0;

        for (let f = 0; f < totalFrames; f++) {
            const rms = this.computeRms(pcmData, f * FRAME_SIZE, FRAME_SIZE);
            const isSilent = rms < this.config.rmsThreshold;

            if (isSilent) {
                if (silenceStart === -1) {
                    silenceStart = f;
                }
                silenceFrameCount++;
            } else {
                if (silenceStart !== -1 && silenceFrameCount >= minSilenceFrames) {
                    const startMs = (silenceStart * FRAME_SIZE / sampleRate) * 1000;
                    const endMs = (f * FRAME_SIZE / sampleRate) * 1000;
                    regions.push({
                        startMs,
                        endMs,
                        durationMs: endMs - startMs,
                    });
                }
                silenceStart = -1;
                silenceFrameCount = 0;
            }
        }

        // Handle trailing silence
        if (silenceStart !== -1 && silenceFrameCount >= minSilenceFrames) {
            const startMs = (silenceStart * FRAME_SIZE / sampleRate) * 1000;
            const endMs = (pcmData.length / sampleRate) * 1000;
            regions.push({
                startMs,
                endMs,
                durationMs: endMs - startMs,
            });
        }

        return regions;
    }

    /**
     * Extract speech regions from PCM data by inverting silence regions.
     * Applies padding to preserve natural phrasing.
     */
    extractSpeechRegions(pcmData: Float32Array, sampleRate: number): SpeechRegion[] {
        const totalDurationMs = (pcmData.length / sampleRate) * 1000;
        const silenceRegions = this.detectSilenceRegions(pcmData, sampleRate);

        if (silenceRegions.length === 0) {
            return [{
                startSample: 0,
                endSample: pcmData.length,
                startMs: 0,
                endMs: totalDurationMs,
                durationMs: totalDurationMs,
            }];
        }

        const speechRegions: SpeechRegion[] = [];
        let cursor = 0;

        for (const silence of silenceRegions) {
            const speechStartMs = cursor;
            const speechEndMs = silence.startMs;

            if (speechEndMs - speechStartMs > 0) {
                // Add padding: extend speech region into silence
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

            cursor = silence.endMs;
        }

        // Handle trailing speech after last silence
        if (cursor < totalDurationMs) {
            const paddedStartMs = Math.max(0, cursor - this.config.paddingBeforeMs);
            speechRegions.push({
                startSample: Math.floor((paddedStartMs / 1000) * sampleRate),
                endSample: pcmData.length,
                startMs: paddedStartMs,
                endMs: totalDurationMs,
                durationMs: totalDurationMs - paddedStartMs,
            });
        }

        // Apply leading/trailing silence constraints
        return this.applyEdgeConstraints(speechRegions, totalDurationMs, sampleRate);
    }

    /**
     * Trim the PCM data to only include speech regions.
     * Returns a new Float32Array with silence removed.
     */
    trimSilence(pcmData: Float32Array, sampleRate: number): {
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

        // Calculate total trimmed length
        let totalSamples = 0;
        for (const region of speechRegions) {
            totalSamples += region.endSample - region.startSample;
        }

        const trimmedData = new Float32Array(totalSamples);
        let offset = 0;

        for (const region of speechRegions) {
            const length = region.endSample - region.startSample;
            trimmedData.set(
                pcmData.subarray(region.startSample, region.endSample),
                offset
            );
            offset += length;
        }

        const trimmedDurationMs = (trimmedData.length / sampleRate) * 1000;
        const silenceRemovedMs = totalDurationMs - trimmedDurationMs;

        return {
            trimmedData,
            speechRegions,
            totalSilenceRemovedMs: Math.max(0, silenceRemovedMs),
        };
    }

    private applyEdgeConstraints(
        regions: SpeechRegion[],
        _totalDurationMs: number,
        sampleRate: number
    ): SpeechRegion[] {
        if (regions.length === 0) return regions;

        // Trim excessive leading silence from first region
        const first = regions[0];
        if (first.startMs > this.config.leadingSilenceMaxMs) {
            const newStartMs = first.startMs;
            regions[0] = {
                ...first,
                startSample: Math.floor((newStartMs / 1000) * sampleRate),
                startMs: newStartMs,
                durationMs: first.endMs - newStartMs,
            };
        }

        return regions;
    }
}
