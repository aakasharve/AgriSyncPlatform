/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Parity tests: streaming silence-trim must produce equivalent output to
 * the existing batch SilenceTrimmer on identical PCM input.
 */

import { describe, it, expect } from 'vitest';
import { StreamingSilenceTrimmer } from '../StreamingSilenceTrimmer';
import { SilenceTrimmer } from '../SilenceTrimmer';
import { DEFAULT_VOICE_CONFIG } from '../types';

const SAMPLE_RATE = 16000;

function makePcm(specs: Array<{ kind: 'silence' | 'speech'; durationMs: number }>): Float32Array {
    const totalSamples = specs.reduce(
        (sum, s) => sum + Math.round((s.durationMs / 1000) * SAMPLE_RATE),
        0,
    );
    const pcm = new Float32Array(totalSamples);
    let offset = 0;
    for (const s of specs) {
        const samples = Math.round((s.durationMs / 1000) * SAMPLE_RATE);
        if (s.kind === 'speech') {
            for (let i = 0; i < samples; i++) {
                pcm[offset + i] = 0.5 * Math.sin((offset + i) * 0.1);
            }
        }
        // silence frames stay at 0.0
        offset += samples;
    }
    return pcm;
}

function feedInChunks(trimmer: StreamingSilenceTrimmer, pcm: Float32Array, chunkSize: number): void {
    for (let i = 0; i < pcm.length; i += chunkSize) {
        trimmer.feed(pcm.subarray(i, Math.min(i + chunkSize, pcm.length)));
    }
}

describe('StreamingSilenceTrimmer parity vs batch SilenceTrimmer', () => {
    it('produces equivalent length output for short speech surrounded by silence', () => {
        const pcm = makePcm([
            { kind: 'silence', durationMs: 800 },
            { kind: 'speech', durationMs: 400 },
            { kind: 'silence', durationMs: 800 },
        ]);

        const batch = new SilenceTrimmer(DEFAULT_VOICE_CONFIG.silence).trimSilence(pcm, SAMPLE_RATE);

        const streaming = new StreamingSilenceTrimmer(DEFAULT_VOICE_CONFIG.silence);
        feedInChunks(streaming, pcm, 128);
        const streamed = streaming.finalize(SAMPLE_RATE);

        // Batch and streaming use slightly different boundary detection
        // (batch processes full silence regions; streaming processes frame-by-frame).
        // Allow up to 8 frames of 128 samples = 1024 samples drift.
        const driftSamples = Math.abs(streamed.trimmedData.length - batch.trimmedData.length);
        expect(driftSamples).toBeLessThanOrEqual(1024);
    });

    it('preserves all samples when input is pure speech (no silence to trim)', () => {
        const pcm = makePcm([{ kind: 'speech', durationMs: 1000 }]);

        const streaming = new StreamingSilenceTrimmer(DEFAULT_VOICE_CONFIG.silence);
        feedInChunks(streaming, pcm, 128);
        const streamed = streaming.finalize(SAMPLE_RATE);

        // No silence to trim; output length should match input ± 1 frame.
        expect(streamed.trimmedData.length).toBeGreaterThan(pcm.length - 256);
        expect(streamed.trimmedData.length).toBeLessThanOrEqual(pcm.length);
    });

    it('reports approximate silence-removed-ms', () => {
        const pcm = makePcm([
            { kind: 'silence', durationMs: 1000 },
            { kind: 'speech', durationMs: 500 },
            { kind: 'silence', durationMs: 1000 },
        ]);

        const streaming = new StreamingSilenceTrimmer(DEFAULT_VOICE_CONFIG.silence);
        feedInChunks(streaming, pcm, 128);
        const streamed = streaming.finalize(SAMPLE_RATE);

        // Expect ~1500-2000ms of silence removed (some retained as padding).
        expect(streamed.totalSilenceRemovedMs).toBeGreaterThan(800);
        expect(streamed.totalSilenceRemovedMs).toBeLessThan(2100);
    });

    it('handles all-silence input gracefully', () => {
        const pcm = makePcm([{ kind: 'silence', durationMs: 1000 }]);

        const streaming = new StreamingSilenceTrimmer(DEFAULT_VOICE_CONFIG.silence);
        feedInChunks(streaming, pcm, 128);
        const streamed = streaming.finalize(SAMPLE_RATE);

        // All silence → most or all samples dropped.
        expect(streamed.trimmedData.length).toBeLessThan(pcm.length / 2);
    });
});
