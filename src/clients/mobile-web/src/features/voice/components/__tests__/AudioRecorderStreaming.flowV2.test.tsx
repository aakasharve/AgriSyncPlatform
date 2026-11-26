// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (Task 4 + amendments H1, M1) — through the REAL streaming recorder: the ring opens ONE
 * recorder, and an auto-started recording that hears no speech in 20 s is cancelled with nothing sent.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
    stream: { getTracks: () => [] } as unknown as MediaStream,
    start: vi.fn(),
    stop: vi.fn(),
    perm: vi.fn(),
}));

vi.mock('../../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: 'mr', setLanguage: () => undefined, t: (k: string) => k }),
    useOptionalLanguage: () => ({ language: 'mr', setLanguage: () => undefined, t: (k: string) => k }),
    LanguageProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../../consent/separation/devicePermissions', () => ({ readDevicePermission: h.perm }));
vi.mock('../../../../infrastructure/voice/StreamingPcmRecorder', () => ({
    StreamingPcmRecorder: class {
        liveStream: MediaStream | null = null;
        start = async (...a: unknown[]) => { await h.start(...a); this.liveStream = h.stream; };
        stop = async () => { h.stop(); this.liveStream = null; return { pcm: new Float32Array(0), sampleRate: 16000, durationMs: 0 }; };
    },
}));

import AudioRecorderStreaming from '../AudioRecorderStreaming';
import { resetAutoStartForTests } from '../recorder/useAutoStartCountdown';
import { VOICE_FLOW_MR } from '../../flowV2/voiceFlowWords';

/** A quiet room: a real, non-zero level well under speech (≈0.05). */
class QuietAudioContext {
    createMediaStreamSource() { return { connect: vi.fn(), disconnect: vi.fn() }; }
    createAnalyser() { return { fftSize: 0, getByteTimeDomainData(s: Uint8Array) { s.forEach((_, i) => { s[i] = i % 2 ? 130 : 126; }); } }; }
    close() { return Promise.resolve(); }
}

const flowV2 = { silenceHelp: true, card: { armSeq: 1, placeLabel: () => 'द्राक्ष' } };
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => {
    vi.useFakeTimers();
    resetAutoStartForTests();
    h.start.mockReset().mockResolvedValue(undefined);
    h.stop.mockReset();
    h.perm.mockReset().mockResolvedValue('granted');
    vi.stubGlobal('AudioContext', QuietAudioContext);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('AudioRecorderStreaming — voice flow v2 mic card', () => {
    it('an auto-started recording with no speech in 20 s is cancelled: nothing is sent', async () => {
        const onAudioCaptured = vi.fn();
        render(<AudioRecorderStreaming onAudioCaptured={onAudioCaptured} flowV2={flowV2} />);
        await flush();
        await act(async () => { vi.advanceTimersByTime(7000); });
        expect(h.start).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('mic-ui')).toHaveAttribute('data-recording', 'yes');
        await act(async () => { vi.advanceTimersByTime(20_000); });
        expect(h.stop).toHaveBeenCalledTimes(1);
        expect(onAudioCaptured).not.toHaveBeenCalled();
        expect(screen.getByTestId('mic-card-held')).toHaveTextContent(VOICE_FLOW_MR.held);
        await act(async () => { vi.advanceTimersByTime(20_000); });
        expect(h.start).toHaveBeenCalledTimes(1);
    });

    it('the ring and a tap while the mic is still opening open ONE recorder', async () => {
        let open: () => void = () => undefined;
        h.start.mockReturnValue(new Promise<void>((r) => { open = r; }));
        render(<AudioRecorderStreaming onAudioCaptured={vi.fn()} flowV2={flowV2} />);
        await flush();
        act(() => { vi.advanceTimersByTime(7000); });
        fireEvent.click(screen.getByTestId('mic-button'));
        await act(async () => { open(); await Promise.resolve(); });
        expect(h.start).toHaveBeenCalledTimes(1);
    });
});
