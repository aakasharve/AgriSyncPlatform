// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Register F18 / lane V-1 — the recorder's length limit is ONE named constant (`AUTO_STOP_SEC`), read by both
 * recorders, and the stop it announces is REAL (P5). Found in this lane: the streaming recorder (the one the app
 * mounts) never stopped — its timer kept the first render's `stopRecording`, which believed nothing was
 * recording, so at 65 s it was still recording under "0 सेकंदात आपोआप थांबेल...".
 *
 * Lane V-1 lifted the limit to 10 minutes (the server now cuts long audio into pieces Sarvam can take, fills the
 * transcript itself and sends an answer budget) and the countdown to the last 30 seconds — see `AUTO_STOP_SEC`.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ stop: vi.fn() }));

vi.mock('../../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: 'mr', setLanguage: () => undefined, t: (k: string) => k }),
    useOptionalLanguage: () => ({ language: 'mr', setLanguage: () => undefined, t: (k: string) => k }),
    LanguageProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../../../infrastructure/voice/StreamingPcmRecorder', () => ({
    StreamingPcmRecorder: class {
        liveStream: MediaStream | null = null;
        start = async () => undefined;
        stop = async () => { h.stop(); return { pcm: new Float32Array(0), sampleRate: 16000, durationMs: 0 }; };
    },
}));

import AudioRecorder from '../AudioRecorder';
import AudioRecorderStreaming from '../AudioRecorderStreaming';
import { AUTO_STOP_SEC, AUTO_STOP_WARN_SEC, MIC_INSTRUCTION, REC_WORDS } from '../recorder/recorderWords';

const fakeStream = { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream;
const mediaStops = vi.fn();

class FakeMediaRecorder {
    state = 'inactive';
    ondataavailable: ((e: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    start() { this.state = 'recording'; }
    stop() {
        mediaStops();
        this.state = 'inactive';
        this.ondataavailable?.({ data: new Blob(['voice'], { type: 'audio/webm' }) });
        this.onstop?.();
    }
}

class FakeAudioContext {
    createMediaStreamSource() { return { connect: vi.fn(), disconnect: vi.fn() }; }
    createAnalyser() { return { fftSize: 0, getByteTimeDomainData() { /* silence */ } }; }
    close() { return Promise.resolve(); }
}

beforeEach(() => {
    h.stop.mockReset();
    mediaStops.mockReset();
    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
        configurable: true,
        value: { getUserMedia: vi.fn().mockResolvedValue(fakeStream) },
    });
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.useFakeTimers();
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const recording = () => screen.getByTestId('mic-ui').getAttribute('data-recording');
const startSpeaking = async () => { await act(async () => { fireEvent.click(screen.getByRole('button', { name: MIC_INSTRUCTION })); }); };
const wait = async (ms: number) => { await act(async () => { vi.advanceTimersByTime(ms); }); };

describe('the one length limit', () => {
    it('is one constant — 10 minutes — and the countdown is the last 30 seconds before it', () => {
        expect(AUTO_STOP_SEC).toBe(600);
        expect(AUTO_STOP_WARN_SEC).toBe(AUTO_STOP_SEC - 30);
    });
});

describe.each([
    ['AudioRecorderStreaming (the one the app mounts)', () => <AudioRecorderStreaming onAudioCaptured={vi.fn()} />, () => h.stop.mock.calls.length],
    ['AudioRecorder (batch)', () => <AudioRecorder onAudioCaptured={vi.fn()} />, () => mediaStops.mock.calls.length],
])('%s', (_name, mount, stops) => {
    it('keeps recording, with no countdown, until the countdown window', async () => {
        render(mount());
        await startSpeaking();
        await wait((AUTO_STOP_WARN_SEC - 1) * 1000);
        expect(recording()).toBe('yes');
        expect(screen.queryByTestId('mic-auto-stop')).not.toBeInTheDocument();
        expect(stops()).toBe(0);
    });

    it('counts down in its last 30 seconds, saying exactly how many are left', async () => {
        render(mount());
        await startSpeaking();
        await wait(AUTO_STOP_WARN_SEC * 1000);
        expect(screen.getByTestId('mic-auto-stop')).toHaveTextContent(REC_WORDS.autoStopping(30));
        await wait(25_000);
        expect(screen.getByTestId('mic-auto-stop')).toHaveTextContent(REC_WORDS.autoStopping(5));
    });

    it('says nothing about stopping at one minute any more', async () => {
        render(mount());
        await startSpeaking();
        await wait(61_000);
        expect(recording()).toBe('yes');
        expect(screen.queryByTestId('mic-auto-stop')).not.toBeInTheDocument();
    });

    it('really stops at the limit — once — as the countdown said', async () => {
        render(mount());
        await startSpeaking();
        await wait(AUTO_STOP_SEC * 1000);
        expect(stops()).toBe(1);
        expect(recording()).not.toBe('yes');
        await wait(10_000);
        expect(stops()).toBe(1);
    });
});
