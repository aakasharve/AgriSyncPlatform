// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lane V-1 fix pass (review B002) — the REAL `VoicePreprocessor.processStreamingResult` (nothing of it mocked): when the
 * real-time Opus encode is stopped by its wall-clock timer before the sound has played through (a phone that slowed
 * or slept), the cut-short encode is NOT passed on as the recording. The encode fails, and the recording goes as a
 * complete WAV of every trimmed sample. Only the browser's own MediaRecorder / AudioContext are stood in for, the
 * second one so that its sound never finishes playing — exactly the stalled case.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoicePreprocessor } from '../VoicePreprocessor';
import { StreamingSilenceTrimmer } from '../StreamingSilenceTrimmer';
import { StreamingHasher } from '../StreamingHasher';
import { DEFAULT_VOICE_CONFIG } from '../types';
import { ENCODE_CUT_SHORT } from '../SegmentCompressor';

const h = vi.hoisted(() => ({ soundEnds: false, recorderStops: 0 }));

/** A browser recorder that has encoded only the first part when it is stopped early. */
class StalledMediaRecorder {
    static isTypeSupported = (type: string) => type.startsWith('audio/webm');
    state: 'inactive' | 'recording' = 'inactive';
    ondataavailable: ((e: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: (() => void) | null = null;
    start() { this.state = 'recording'; }
    stop() {
        h.recorderStops++;
        this.state = 'inactive';
        this.ondataavailable?.({ data: new Blob(['only-the-first-seconds'], { type: 'audio/webm' }) });
        this.onstop?.();
    }
}

/** An AudioContext whose buffer source never reaches its end unless the test says so. */
class StalledAudioContext {
    createBuffer(_channels: number, length: number) {
        const data = new Float32Array(length);
        return { getChannelData: () => data };
    }
    createBufferSource() {
        const source = {
            buffer: null as unknown,
            onended: null as (() => void) | null,
            connect: () => undefined,
            start: () => { if (h.soundEnds) queueMicrotask(() => source.onended?.()); },
        };
        return source;
    }
    createMediaStreamDestination() { return { stream: {} }; }
    close() { return Promise.resolve(); }
}

function speech(seconds: number, sampleRate: number): Float32Array {
    return Float32Array.from({ length: seconds * sampleRate }, (_, i) => 0.4 * Math.sin((2 * Math.PI * 220 * i) / sampleRate));
}

async function process(seconds: number) {
    const sampleRate = 16000;
    const pcm = speech(seconds, sampleRate);
    const trimmer = new StreamingSilenceTrimmer(DEFAULT_VOICE_CONFIG.silence);
    const hasher = new StreamingHasher();
    for (let i = 0; i < pcm.length; i += 1024) {
        const frame = pcm.subarray(i, Math.min(pcm.length, i + 1024));
        trimmer.feed(frame);
        hasher.feed(frame);
    }
    const run = new VoicePreprocessor(DEFAULT_VOICE_CONFIG).processStreamingResult({
        recording: { pcm, sampleRate, durationMs: seconds * 1000 },
        trimmer,
        hasher,
        sessionId: 's',
        farmId: 'f',
    });
    await vi.advanceTimersByTimeAsync((seconds * 1000) + 5000);
    return run;
}

beforeEach(() => {
    h.soundEnds = false;
    h.recorderStops = 0;
    vi.stubGlobal('MediaRecorder', StalledMediaRecorder);
    vi.stubGlobal('AudioContext', StalledAudioContext);
    vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('processStreamingResult — a cut-short encode is never the recording', () => {
    it('stopped by its clock: the recording goes as a COMPLETE WAV, not the cut-short Opus', async () => {
        const result = await process(20);

        expect(h.recorderStops).toBe(1); // the clock did stop the encoder...
        expect(result.mimeType).toBe('audio/wav'); // ...and what it held was not sent
        const trimmedSamples = Math.round((result.metadata.totalSpeechDurationMs / 1000) * 16000);
        expect(result.audioBlob.size).toBe(44 + (trimmedSamples * 2)); // every trimmed sample, 16-bit
        expect(trimmedSamples).toBeGreaterThan(19 * 16000);
    });

    it('a sound that plays through is encoded as before', async () => {
        h.soundEnds = true;

        const result = await process(5);

        expect(result.mimeType.startsWith('audio/webm')).toBe(true);
    });

    it('the cut-short failure has a stable name', () => {
        expect(ENCODE_CUT_SHORT).toMatch(/cut short/);
    });
});
