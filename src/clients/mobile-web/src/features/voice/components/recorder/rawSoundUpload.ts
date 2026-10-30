/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane V-1 fix pass, review B002) — a long recording whose live
 * encoding failed is sent as the recorder's OWN sound, complete, and at once.
 *
 * The old fallback re-encoded the sound by playing it through the browser in real time, with a wall-clock timer that
 * stopped the encoder at (length + 1.5 s) — a phone that slowed or slept meanwhile handed on a CUT-SHORT file as if it
 * were whole. A long recording never takes that path now: its raw samples become an 8-bit G.711 mu-law WAV at 16 kHz
 * (16 kB a second: 10 minutes is 9.6 MB, inside the server's 12 MB audio limit), written in one pass, sample for sample.
 * The server decodes it with ffmpeg like any other recording and cuts it into pieces for speech-to-text.
 */

export const RAW_UPLOAD_SAMPLE_RATE = 16000;
export const RAW_UPLOAD_MIME = 'audio/wav';

/** The samples at 16 kHz (averaging the samples each output step covers, so a 48 kHz device does not alias). */
export function resampleTo16k(pcm: Float32Array, sampleRate: number): Float32Array {
    if (!(sampleRate > 0) || sampleRate === RAW_UPLOAD_SAMPLE_RATE) return pcm;
    const ratio = sampleRate / RAW_UPLOAD_SAMPLE_RATE;
    const out = new Float32Array(Math.floor(pcm.length / ratio));
    for (let i = 0; i < out.length; i++) {
        const from = i * ratio;
        const to = Math.min(pcm.length, from + Math.max(1, ratio));
        let sum = 0;
        let n = 0;
        for (let j = Math.floor(from); j < to; j++) { sum += pcm[j]; n++; }
        out[i] = n > 0 ? sum / n : 0;
    }
    return out;
}

/** G.711 mu-law: one byte a sample, about 14 bits of speech range. */
export function linearToMulaw(sample: number): number {
    const BIAS = 0x84;
    const CLIP = 32635;
    let s = Math.round(Math.max(-1, Math.min(1, sample)) * 32767);
    const sign = s < 0 ? 0x80 : 0;
    if (sign) s = -s;
    s = Math.min(CLIP, s) + BIAS;
    let exponent = 7;
    for (let mask = 0x4000; (s & mask) === 0 && exponent > 0; mask >>= 1) exponent--;
    const mantissa = (s >> (exponent + 3)) & 0x0f;
    return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

/** A complete mono mu-law WAV of the samples, resampled to 16 kHz. */
export function mulawWavOf(pcm: Float32Array, sampleRate: number): Blob {
    const samples = resampleTo16k(pcm, sampleRate);
    const bytes = new Uint8Array(44 + samples.length);
    const view = new DataView(bytes.buffer);
    const ascii = (offset: number, text: string) => { for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i); };
    ascii(0, 'RIFF');
    view.setUint32(4, 36 + samples.length, true);
    ascii(8, 'WAVE');
    ascii(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 7, true); // WAVE_FORMAT_MULAW
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, RAW_UPLOAD_SAMPLE_RATE, true);
    view.setUint32(28, RAW_UPLOAD_SAMPLE_RATE, true); // byte rate: one byte a sample
    view.setUint16(32, 1, true);
    view.setUint16(34, 8, true);
    ascii(36, 'data');
    view.setUint32(40, samples.length, true);
    for (let i = 0; i < samples.length; i++) bytes[44 + i] = linearToMulaw(samples[i]);
    return new Blob([bytes], { type: RAW_UPLOAD_MIME });
}
