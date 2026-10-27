// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I12, LP-04) — the streaming recorder wears the
 * same founder-approved face as `AudioRecorder`: its meter listens to the recorder's OWN live stream
 * (read-only `liveStream`), the stop hint comes after 10 s, and cancel emits nothing.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
    stream: { getTracks: () => [] } as unknown as MediaStream,
    start: vi.fn(),
    stop: vi.fn(),
}));

vi.mock('../../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: 'mr', setLanguage: () => undefined, t: (k: string) => k }),
    LanguageProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../../../infrastructure/voice/StreamingPcmRecorder', () => ({
    StreamingPcmRecorder: class {
        liveStream: MediaStream | null = null;
        start = async (...a: unknown[]) => { await h.start(...a); this.liveStream = h.stream; };
        stop = async () => { h.stop(); this.liveStream = null; return { pcm: new Float32Array(0), sampleRate: 16000, durationMs: 0 }; };
    },
}));

import AudioRecorderStreaming from '../AudioRecorderStreaming';
import { MIC_INSTRUCTION, REC_WORDS } from '../recorder/recorderWords';

class FakeAudioContext {
    createMediaStreamSource(stream: MediaStream) { expect(stream).toBe(h.stream); return { connect: vi.fn(), disconnect: vi.fn() }; }
    createAnalyser() { return { fftSize: 0, getByteTimeDomainData(s: Uint8Array) { s.forEach((_, i) => { s[i] = i % 2 ? 148 : 108; }); } }; }
    close() { return Promise.resolve(); }
}

beforeEach(() => {
    h.start.mockReset().mockResolvedValue(undefined);
    h.stop.mockReset();
    vi.stubGlobal('AudioContext', FakeAudioContext);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('AudioRecorderStreaming — the same face as AudioRecorder', () => {
    it('meter from its own live stream, stop hint at 10 s, and cancel emits nothing', async () => {
        vi.useFakeTimers();
        const onAudioCaptured = vi.fn();
        const onRecordingChange = vi.fn();
        render(<AudioRecorderStreaming onAudioCaptured={onAudioCaptured} onRecordingChange={onRecordingChange} />);
        expect(screen.getByTestId('mic-instruction')).toHaveTextContent(MIC_INSTRUCTION);

        await act(async () => { fireEvent.click(screen.getByRole('button', { name: MIC_INSTRUCTION })); });
        expect(screen.getByTestId('mic-ui')).toHaveAttribute('data-recording', 'yes');
        expect(onRecordingChange).toHaveBeenLastCalledWith(true);

        act(() => { vi.advanceTimersByTime(200); });
        expect(screen.getByTestId('mic-level')).toHaveAttribute('data-level', '0.50');

        act(() => { vi.advanceTimersByTime(10_000); });
        expect(screen.getByTestId('mic-stop-hint')).toBeInTheDocument();

        await act(async () => { fireEvent.click(screen.getByTestId('mic-cancel')); });
        expect(h.stop).toHaveBeenCalledTimes(1);
        expect(onAudioCaptured).not.toHaveBeenCalled();
        expect(onRecordingChange).toHaveBeenLastCalledWith(false);
        expect(screen.getByTestId('mic-cancelled')).toBeInTheDocument();
    });

    it('a mic that cannot start says the Marathi line with no English code (I12-V1-m3)', async () => {
        const failed = new Error('worklet 404');
        failed.name = 'AbortError';
        h.start.mockRejectedValue(failed);
        render(<AudioRecorderStreaming onAudioCaptured={vi.fn()} />);
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: MIC_INSTRUCTION })); });
        const box = screen.getByTestId('mic-error');
        expect(box).toHaveTextContent(REC_WORDS.micError);
        expect(box.textContent).not.toMatch(/AbortError|\[|[A-Za-z]/);
        expect(box).toHaveAttribute('data-error-code', 'AbortError');
    });
});
