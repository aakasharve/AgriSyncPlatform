/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (voice live words) — one phrase as the ONE format the server's live-words route
 * takes: a plain 44-byte-header WAV, 16 kHz, mono, 16-bit PCM (`LiveWordsAudio` on the server checks exactly this).
 */
import { resampleTo16k } from '../components/recorder/rawSoundUpload';

export const LIVE_WORDS_SAMPLE_RATE = 16000;

/** The phrase's samples (at any rate) as a 16 kHz mono 16-bit PCM WAV. */
export function wav16Of(pcm: Float32Array, sampleRate: number): Blob {
    const samples = resampleTo16k(pcm, sampleRate);
    const dataBytes = samples.length * 2;
    const bytes = new Uint8Array(44 + dataBytes);
    const view = new DataView(bytes.buffer);
    const ascii = (offset: number, text: string) => { for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i); };
    ascii(0, 'RIFF');
    view.setUint32(4, 36 + dataBytes, true);
    ascii(8, 'WAVE');
    ascii(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, LIVE_WORDS_SAMPLE_RATE, true);
    view.setUint32(28, LIVE_WORDS_SAMPLE_RATE * 2, true); // byte rate
    view.setUint16(32, 2, true); // block align
    view.setUint16(34, 16, true);
    ascii(36, 'data');
    view.setUint32(40, dataBytes, true);
    for (let i = 0; i < samples.length; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(44 + i * 2, s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), true);
    }
    return new Blob([bytes], { type: 'audio/wav' });
}
