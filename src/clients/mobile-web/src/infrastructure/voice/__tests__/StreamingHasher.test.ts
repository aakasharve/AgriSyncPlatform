/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Parity test: streaming hash output must equal a single-pass SHA-256
 * over the same byte sequence.
 */

import { describe, it, expect } from 'vitest';
import { StreamingHasher } from '../StreamingHasher';

function pcm(values: number[]): Float32Array {
    return new Float32Array(values);
}

async function singlePassSha256Hex(samples: Float32Array): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', samples.buffer.slice(samples.byteOffset, samples.byteOffset + samples.byteLength));
    return Array.from(new Uint8Array(digest))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

describe('StreamingHasher parity vs single-pass SHA-256', () => {
    it('matches single-pass hash when fed in 128-sample chunks', async () => {
        const samples = new Float32Array(2048);
        for (let i = 0; i < samples.length; i++) {
            samples[i] = Math.sin(i * 0.01);
        }

        const hasher = new StreamingHasher();
        for (let i = 0; i < samples.length; i += 128) {
            hasher.feed(samples.subarray(i, Math.min(i + 128, samples.length)));
        }
        const streamed = await hasher.finalize();
        const direct = await singlePassSha256Hex(samples);

        expect(streamed).toBe(direct);
    });

    it('matches single-pass hash when fed in irregular chunks', async () => {
        const samples = pcm([0.1, 0.2, 0.3, 0.4, 0.5, -0.1, -0.2, -0.3, 0.0]);

        const hasher = new StreamingHasher();
        hasher.feed(samples.subarray(0, 3));
        hasher.feed(samples.subarray(3, 4));
        hasher.feed(samples.subarray(4, 9));
        const streamed = await hasher.finalize();
        const direct = await singlePassSha256Hex(samples);

        expect(streamed).toBe(direct);
    });

    it('returns SHA-256 of empty input deterministically', async () => {
        const hasher = new StreamingHasher();
        const streamed = await hasher.finalize();

        // SHA-256 of empty bytes
        expect(streamed).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    });
});
