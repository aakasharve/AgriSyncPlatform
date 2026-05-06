/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VOICE_LATENCY_PIPELINE_V2 Phase 2 — incremental silence trimmer that
 * processes PCM frames as they arrive from the AudioWorklet, instead of
 * scanning the full clip after recording stops. Output is equivalent to
 * the batch SilenceTrimmer within a small frame-quantization tolerance.
 */

import { SilenceConfig } from './types';

const FRAME_SIZE = 128;

interface BufferedFrame {
    samples: Float32Array;
}

export class StreamingSilenceTrimmer {
    private silenceBuffer: BufferedFrame[] = [];
    private speechFrames: BufferedFrame[] = [];
    private hasEmittedAnySpeech = false;
    private totalSilenceRemovedSamples = 0;
    private totalIngestedSamples = 0;

    constructor(private readonly config: SilenceConfig) {}

    feed(samples: Float32Array): void {
        // Split incoming samples into FRAME_SIZE-aligned frames.
        // Tail (< FRAME_SIZE) is held until the next feed() or finalize().
        let cursor = 0;
        while (cursor < samples.length) {
            const remaining = samples.length - cursor;
            const take = Math.min(FRAME_SIZE, remaining);
            const frame = samples.subarray(cursor, cursor + take);
            this.processFrame(frame);
            cursor += take;
            this.totalIngestedSamples += take;
        }
    }

    finalize(sampleRate: number): { trimmedData: Float32Array; totalSilenceRemovedMs: number } {
        // Decide what to do with the trailing silence buffer.
        if (this.silenceBuffer.length > 0) {
            if (this.hasEmittedAnySpeech) {
                // Trailing silence: keep paddingAfterMs of it, drop the rest.
                const padFrames = Math.max(
                    1,
                    Math.ceil((this.config.paddingAfterMs / 1000) * (sampleRate / FRAME_SIZE)),
                );
                const trailingCapFrames = Math.max(
                    padFrames,
                    Math.ceil((this.config.trailingSilenceMaxMs / 1000) * (sampleRate / FRAME_SIZE)),
                );
                const keep = this.silenceBuffer.slice(0, Math.min(padFrames, trailingCapFrames));
                const droppedFrames = this.silenceBuffer.length - keep.length;
                this.totalSilenceRemovedSamples += droppedFrames * FRAME_SIZE;
                this.speechFrames.push(...keep);
            } else {
                // Pure silence input → drop everything.
                this.totalSilenceRemovedSamples += this.silenceBuffer.reduce(
                    (sum, f) => sum + f.samples.length,
                    0,
                );
            }
            this.silenceBuffer = [];
        }

        // Flatten speech frames into a single Float32Array.
        const totalSamples = this.speechFrames.reduce((sum, f) => sum + f.samples.length, 0);
        const trimmedData = new Float32Array(totalSamples);
        let offset = 0;
        for (const f of this.speechFrames) {
            trimmedData.set(f.samples, offset);
            offset += f.samples.length;
        }

        const totalSilenceRemovedMs = (this.totalSilenceRemovedSamples / sampleRate) * 1000;
        return { trimmedData, totalSilenceRemovedMs };
    }

    private processFrame(frame: Float32Array): void {
        const rms = this.computeRms(frame);
        const isSilent = rms < this.config.rmsThreshold;
        // Copy frame so we don't hold a reference to the worklet's transferred buffer.
        const owned = new Float32Array(frame);
        const buffered: BufferedFrame = { samples: owned };

        if (isSilent) {
            this.silenceBuffer.push(buffered);
            return;
        }

        // Speech frame.
        if (!this.hasEmittedAnySpeech) {
            // First speech ever: keep up to leadingSilenceMaxMs of leading silence.
            this.flushLeadingSilence();
        } else {
            // Mid-stream silence run ending: keep paddingBeforeMs of it, drop the rest.
            this.flushMidSilenceRun();
        }

        this.speechFrames.push(buffered);
        this.hasEmittedAnySpeech = true;
    }

    private flushLeadingSilence(): void {
        // Cap leading silence to leadingSilenceMaxMs.
        const sampleRate = 16000; // worklet operates at AudioContext rate; matches start() config
        const maxFrames = Math.max(
            0,
            Math.ceil((this.config.leadingSilenceMaxMs / 1000) * (sampleRate / FRAME_SIZE)),
        );
        const droppedFrames = Math.max(0, this.silenceBuffer.length - maxFrames);
        this.totalSilenceRemovedSamples += droppedFrames * FRAME_SIZE;
        const keep = this.silenceBuffer.slice(this.silenceBuffer.length - Math.min(maxFrames, this.silenceBuffer.length));
        this.speechFrames.push(...keep);
        this.silenceBuffer = [];
    }

    private flushMidSilenceRun(): void {
        const sampleRate = 16000;
        const minSilenceFrames = Math.max(
            1,
            Math.ceil((this.config.minSilenceDurationMs / 1000) * (sampleRate / FRAME_SIZE)),
        );

        if (this.silenceBuffer.length < minSilenceFrames) {
            // Run too short to be considered "silence" — keep as-is (it's part of speech timing).
            this.speechFrames.push(...this.silenceBuffer);
            this.silenceBuffer = [];
            return;
        }

        // Long-enough silence run: drop the middle, keep paddingBeforeMs at the end (right before speech).
        const padFrames = Math.max(
            0,
            Math.ceil((this.config.paddingBeforeMs / 1000) * (sampleRate / FRAME_SIZE)),
        );
        const keepCount = Math.min(padFrames, this.silenceBuffer.length);
        const droppedCount = this.silenceBuffer.length - keepCount;
        this.totalSilenceRemovedSamples += droppedCount * FRAME_SIZE;
        const keep = this.silenceBuffer.slice(this.silenceBuffer.length - keepCount);
        this.speechFrames.push(...keep);
        this.silenceBuffer = [];
    }

    private computeRms(frame: Float32Array): number {
        if (frame.length === 0) return 0;
        let sum = 0;
        for (let i = 0; i < frame.length; i++) {
            sum += frame[i] * frame[i];
        }
        return Math.sqrt(sum / frame.length);
    }
}
