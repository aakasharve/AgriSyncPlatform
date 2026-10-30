// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lane V-1 (register F18) — a recording longer than one minute is sent as it was encoded WHILE he spoke.
 *
 * The streaming recorder's own encode plays the sound through the browser in real time after the stop, so a
 * 10-minute recording would wait about 10 minutes before it could even be sent. The recorder now also encodes the
 * same microphone stream live; a recording over `LIVE_ENCODE_AFTER_SEC` is emitted from that encoder at once
 * (`encodedLive`), without the post-stop encode. A shorter one takes today's path, untouched. If the live encoder is
 * unavailable or failed, a long recording falls back to today's path too — slow, never lost.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
    processStreamingResult: vi.fn(),
    liveStream: null as MediaStream | null,
    recorders: [] as Array<{ stop: () => void; failNext?: boolean }>,
}));

vi.mock('../../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: 'mr', setLanguage: () => undefined, t: (k: string) => k }),
    useOptionalLanguage: () => ({ language: 'mr', setLanguage: () => undefined, t: (k: string) => k }),
    LanguageProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../../../infrastructure/voice/StreamingPcmRecorder', () => ({
    StreamingPcmRecorder: class {
        get liveStream(): MediaStream | null { return h.liveStream; }
        start = async () => undefined;
        stop = async () => ({ pcm: new Float32Array(16), sampleRate: 16000, durationMs: 123_456 });
    },
}));
vi.mock('../../../../infrastructure/voice/VoicePreprocessor', () => ({
    VoicePreprocessor: class {
        processStreamingResult = h.processStreamingResult;
    },
}));

import AudioRecorderStreaming from '../AudioRecorderStreaming';
import { LIVE_ENCODE_AFTER_SEC, MIC_INSTRUCTION } from '../recorder/recorderWords';
import type { AudioData } from '../../../../types';

/** MediaRecorder as the live encoder uses it: a chunk per timeslice, the last on stop. */
class FakeMediaRecorder {
    static isTypeSupported = (type: string) => type.startsWith('audio/webm');
    state: 'inactive' | 'recording' = 'inactive';
    ondataavailable: ((e: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: (() => void) | null = null;
    options: MediaRecorderOptions | undefined;
    constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
        this.options = options;
        h.recorders.push(this as unknown as { stop: () => void });
    }
    start() { this.state = 'recording'; }
    stop() {
        if (this.state === 'inactive') return;
        this.state = 'inactive';
        if ((this as unknown as { failNext?: boolean }).failNext) { this.onerror?.(); } else { this.ondataavailable?.({ data: new Blob(['live-opus'], { type: 'audio/webm' }) }); }
        this.onstop?.();
    }
}

beforeEach(() => {
    h.processStreamingResult.mockReset().mockResolvedValue({
        audioBlob: new Blob(['re-encoded'], { type: 'audio/webm' }),
        mimeType: 'audio/webm',
        metadata: {},
        contentHash: 'h',
    });
    h.liveStream = { getTracks: () => [] } as unknown as MediaStream;
    h.recorders = [];
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    vi.useFakeTimers();
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const startSpeaking = async () => { await act(async () => { fireEvent.click(screen.getByRole('button', { name: MIC_INSTRUCTION })); }); };
const wait = async (ms: number) => { await act(async () => { vi.advanceTimersByTime(ms); }); };
const stop = async () => {
    await act(async () => { fireEvent.click(screen.getByTestId('mic-stop')); });
    // FileReader + the awaited stops settle on real microtasks/macrotasks.
    await act(async () => { await vi.runAllTimersAsync(); });
};
const captured = (fn: ReturnType<typeof vi.fn>): AudioData => fn.mock.calls[0][0] as AudioData;

describe('a long recording is sent as it was encoded while he spoke', () => {
    it('over one minute: the live encoding, at once — no re-encode after the stop', async () => {
        const onAudioCaptured = vi.fn();
        render(<AudioRecorderStreaming onAudioCaptured={onAudioCaptured} />);
        await startSpeaking();
        await wait((LIVE_ENCODE_AFTER_SEC + 5) * 1000);
        await stop();

        expect(onAudioCaptured).toHaveBeenCalledTimes(1);
        const audio = captured(onAudioCaptured);
        expect(audio.encodedLive).toBe(true);
        expect(await audio.blob.text()).toBe('live-opus');
        expect(audio.mimeType).toBe('audio/webm');
        expect(audio.durationMs).toBe(123_456);
        expect(audio.base64.length).toBeGreaterThan(0);
        expect(h.processStreamingResult).not.toHaveBeenCalled();
        // The live encoder is Opus in WebM at the app's speech bitrate (24 kbps: about 1.8 MB for 10 minutes).
        expect((h.recorders[0] as unknown as FakeMediaRecorder).options).toEqual({ mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 24000 });
    });

    it('at the 10-minute limit the automatic stop sends the live encoding too', async () => {
        const onAudioCaptured = vi.fn();
        render(<AudioRecorderStreaming onAudioCaptured={onAudioCaptured} />);
        await startSpeaking();
        await wait(600_000);
        await act(async () => { await vi.runAllTimersAsync(); });

        expect(onAudioCaptured).toHaveBeenCalledTimes(1);
        expect(captured(onAudioCaptured).encodedLive).toBe(true);
    });

    it('one minute or less: today\'s path, unchanged', async () => {
        const onAudioCaptured = vi.fn();
        render(<AudioRecorderStreaming onAudioCaptured={onAudioCaptured} />);
        await startSpeaking();
        await wait(20_000);
        await stop();

        expect(h.processStreamingResult).toHaveBeenCalledTimes(1);
        const audio = captured(onAudioCaptured);
        expect(audio.encodedLive).toBeUndefined();
        expect(await audio.blob.text()).toBe('re-encoded');
    });

    it('a long recording whose live encoder failed still goes, by today\'s path (never lost)', async () => {
        const onAudioCaptured = vi.fn();
        render(<AudioRecorderStreaming onAudioCaptured={onAudioCaptured} />);
        await startSpeaking();
        (h.recorders[0] as unknown as { failNext: boolean }).failNext = true;
        await wait(90_000);
        await stop();

        expect(h.processStreamingResult).toHaveBeenCalledTimes(1);
        expect(captured(onAudioCaptured).encodedLive).toBeUndefined();
    });

    it('a phone with no live stream to encode uses today\'s path', async () => {
        h.liveStream = null;
        const onAudioCaptured = vi.fn();
        render(<AudioRecorderStreaming onAudioCaptured={onAudioCaptured} />);
        await startSpeaking();
        await wait(90_000);
        await stop();

        expect(h.recorders).toHaveLength(0);
        expect(h.processStreamingResult).toHaveBeenCalledTimes(1);
    });

    it('cancel discards a long recording: nothing is sent', async () => {
        const onAudioCaptured = vi.fn();
        render(<AudioRecorderStreaming onAudioCaptured={onAudioCaptured} />);
        await startSpeaking();
        await wait(90_000);
        await act(async () => { fireEvent.click(screen.getByTestId('mic-cancel')); });
        await act(async () => { await vi.runAllTimersAsync(); });

        expect(onAudioCaptured).not.toHaveBeenCalled();
    });
});
