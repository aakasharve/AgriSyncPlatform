// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (part 03, A3) — through the REAL streaming recorder: the sound frames are cut into
 * sentences on the phone (`PhraseChunker`, no network), and the final recording screen gives ONE gentle buzz per finished sentence.
 * A cough-length sound is not a sentence. Without the final screen (`flowV2.listening`) nothing is cut and nothing buzzes.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
    stream: { getTracks: () => [] } as unknown as MediaStream,
    onFrame: null as null | ((f: Float32Array) => void),
    perm: vi.fn(),
    ask: vi.fn(),
}));

vi.mock('../../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: 'mr', setLanguage: () => undefined, t: (k: string) => k }),
    useOptionalLanguage: () => ({ language: 'mr', setLanguage: () => undefined, t: (k: string) => k }),
    LanguageProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../../consent/separation/devicePermissions', () => ({ readDevicePermission: h.perm, requestDevicePermission: h.ask }));
vi.mock('../../../../infrastructure/voice/StreamingPcmRecorder', () => ({
    StreamingPcmRecorder: class {
        liveStream: MediaStream | null = null;
        sampleRate = 16000;
        start = async (onFrame: (f: Float32Array) => void) => { h.onFrame = onFrame; this.liveStream = h.stream; };
        stop = async () => { h.onFrame = null; this.liveStream = null; return { pcm: new Float32Array(0), sampleRate: 16000, durationMs: 0 }; };
    },
}));

import AudioRecorderStreaming from '../AudioRecorderStreaming';
import { resetAutoStartForTests } from '../recorder/useAutoStartCountdown';
import { hapticFeedback } from '../../../../shared/utils/haptics';

/** 100 ms of sound at 16 kHz: speech (well above the cut's level) or quiet. */
const SPEECH = new Float32Array(1600).fill(0.1);
const QUIET = new Float32Array(1600);
const feed = (frame: Float32Array, times: number) => act(() => { for (let i = 0; i < times; i++) h.onFrame?.(frame); });
/** One sentence: 0.8 s of speech, then the 0.5 s pause that ends it. */
const sentence = () => { feed(SPEECH, 8); feed(QUIET, 5); };
const flush = () => act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); });

const card = { armSeq: 0, placeLabel: () => 'द्राक्ष' };

let light: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
    resetAutoStartForTests();
    h.onFrame = null;
    h.perm.mockReset().mockResolvedValue('granted');
    h.ask.mockReset().mockResolvedValue('granted');
    light = vi.spyOn(hapticFeedback, 'light');
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function startRecording(flowV2: React.ComponentProps<typeof AudioRecorderStreaming>['flowV2']) {
    render(<AudioRecorderStreaming onAudioCaptured={vi.fn()} flowV2={flowV2} />);
    fireEvent.click(screen.getByTestId('mic-button'));
    await flush();
    expect(h.onFrame).not.toBeNull();
}

describe('AudioRecorderStreaming — one buzz per finished sentence (A3)', () => {
    it('three sentences: three buzzes, one each, as each one ends', async () => {
        await startRecording({ silenceHelp: true, listening: true, card });
        expect(screen.getByTestId('listening-top-line')).toBeInTheDocument();
        feed(SPEECH, 8);
        expect(light).not.toHaveBeenCalled();      // still speaking: no sentence has ended
        feed(QUIET, 5);
        expect(light).toHaveBeenCalledTimes(1);
        sentence();
        expect(light).toHaveBeenCalledTimes(2);
        sentence();
        expect(light).toHaveBeenCalledTimes(3);
        expect(screen.getByTestId('sathi-ring-pulse')).toHaveAttribute('data-pulse', '3');
    });

    it('a cough (0.2 s of sound) is not a sentence: no buzz', async () => {
        await startRecording({ silenceHelp: true, listening: true, card });
        feed(SPEECH, 2);
        feed(QUIET, 6);
        expect(light).not.toHaveBeenCalled();
    });

    it('without the final screen nothing is cut and nothing buzzes', async () => {
        await startRecording({ silenceHelp: true, card });
        sentence();
        sentence();
        expect(light).not.toHaveBeenCalled();
    });
});
