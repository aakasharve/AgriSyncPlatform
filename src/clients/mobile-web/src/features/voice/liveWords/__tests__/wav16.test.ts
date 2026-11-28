/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (voice live words) — a phrase as the ONE format the server's live-words route takes.
 * The server (`LiveWordsAudio.Refusal`) accepts exactly: a 44-byte-header PCM WAV, mono, 16 kHz, 16-bit, data length = file length - 44,
 * 0.3 to 12 seconds. These tests read the bytes the same way.
 */
import { describe, expect, it } from 'vitest';
import { LIVE_WORDS_SAMPLE_RATE, wav16Of } from '../wav16';

async function headerOf(blob: Blob) {
    const buffer = await blob.arrayBuffer();
    const view = new DataView(buffer);
    const text = (at: number) => String.fromCharCode(...new Uint8Array(buffer, at, 4));
    return {
        size: buffer.byteLength,
        riff: text(0), wave: text(8), fmt: text(12), data: text(36),
        fmtChunk: view.getUint32(16, true), format: view.getUint16(20, true), channels: view.getUint16(22, true),
        rate: view.getUint32(24, true), byteRate: view.getUint32(28, true), bits: view.getUint16(34, true),
        dataBytes: view.getUint32(40, true), riffSize: view.getUint32(4, true),
        sample: (i: number) => view.getInt16(44 + i * 2, true),
    };
}

describe('wav16Of — what the server accepts', () => {
    it('16 kHz in: a plain PCM WAV, mono, 16 kHz, 16-bit, the length its header says', async () => {
        const blob = wav16Of(new Float32Array(16000).fill(0.5), 16000);
        const h = await headerOf(blob);

        expect(blob.type).toBe('audio/wav');
        expect([h.riff, h.wave, h.fmt, h.data]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
        expect([h.fmtChunk, h.format, h.channels, h.rate, h.bits]).toEqual([16, 1, 1, LIVE_WORDS_SAMPLE_RATE, 16]);
        expect(h.byteRate).toBe(32000);
        expect(h.dataBytes).toBe(32000);
        expect(h.size).toBe(44 + 32000);
        expect(h.riffSize).toBe(36 + 32000);
        expect(h.sample(0)).toBe(Math.round(0.5 * 0x7fff));
    });

    it('a phone that records at 48 kHz still sends 16 kHz: one second stays one second', async () => {
        const h = await headerOf(wav16Of(new Float32Array(48000).fill(0.25), 48000));

        expect(h.rate).toBe(16000);
        expect(h.dataBytes).toBe(32000);
    });

    it('a loud peak is clamped, never wrapped round', async () => {
        const h = await headerOf(wav16Of(Float32Array.from([2, -2, 1, -1, 0]), 16000));

        expect(h.sample(0)).toBe(32767);
        expect(h.sample(1)).toBe(-32768);
        expect(h.sample(2)).toBe(32767);
        expect(h.sample(3)).toBe(-32768);
        expect(h.sample(4)).toBe(0);
    });

    it('the longest phrase the chunker makes (7.45 s) is inside the server\'s 12 s limit', async () => {
        const h = await headerOf(wav16Of(new Float32Array(Math.round(7.45 * 16000)), 16000));

        expect(h.dataBytes / 32000).toBeLessThan(12);
    });
});
