/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lane V-1 fix pass (review B002) — a long recording whose live encoding failed is sent as the recorder's own sound:
 * a complete G.711 mu-law WAV at 16 kHz, one byte a sample, written in one pass (no real-time re-encode, no clock that
 * can cut it short). Ten minutes fit the server's 12 MB audio limit.
 */
import { describe, expect, it } from 'vitest';
import { linearToMulaw, mulawWavOf, resampleTo16k, RAW_UPLOAD_SAMPLE_RATE } from '../rawSoundUpload';

/** The standard G.711 decoder, to check the encoder against. */
function mulawToLinear(byte: number): number {
    const u = ~byte & 0xff;
    const sign = u & 0x80;
    const exponent = (u >> 4) & 0x07;
    const mantissa = u & 0x0f;
    const magnitude = (((mantissa << 3) + 0x84) << exponent) - 0x84;
    return (sign ? -magnitude : magnitude) / 32768;
}

const header = async (blob: Blob) => new DataView(await blob.arrayBuffer());

describe('rawSoundUpload — his own sound, complete', () => {
    it('writes every sample: a 44-byte mu-law WAV header and one byte a sample', async () => {
        const pcm = Float32Array.from({ length: 16000 * 3 }, (_, i) => Math.sin(i / 10) * 0.5);

        const wav = mulawWavOf(pcm, 16000);
        const view = await header(wav);

        expect(wav.type).toBe('audio/wav');
        expect(wav.size).toBe(44 + pcm.length);
        expect(view.getUint16(20, true)).toBe(7); // WAVE_FORMAT_MULAW
        expect(view.getUint16(22, true)).toBe(1); // mono
        expect(view.getUint32(24, true)).toBe(RAW_UPLOAD_SAMPLE_RATE);
        expect(view.getUint32(28, true)).toBe(RAW_UPLOAD_SAMPLE_RATE); // byte rate: the server's duration probe reads it
        expect(view.getUint32(40, true)).toBe(pcm.length);
    });

    it('keeps the sound: mu-law decodes back within its step size', () => {
        for (const x of [0, 0.001, -0.002, 0.05, -0.3, 0.7, -0.99, 1, -1]) {
            const back = mulawToLinear(linearToMulaw(x));
            expect(Math.abs(back - x)).toBeLessThan(Math.max(0.002, Math.abs(x) * 0.07));
        }
    });

    it('a 48 kHz recording comes down to 16 kHz, its length kept', () => {
        const pcm = new Float32Array(48000 * 2).fill(0.3);

        const out = resampleTo16k(pcm, 48000);

        expect(out.length).toBe(32000);
        expect(out.every(v => Math.abs(v - 0.3) < 1e-6)).toBe(true);
    });

    it('ten minutes fit the server audio limit (12 MB)', () => {
        const tenMinutes = 44 + (600 * RAW_UPLOAD_SAMPLE_RATE);

        expect(tenMinutes).toBeLessThan(12 * 1024 * 1024);
    });
});
