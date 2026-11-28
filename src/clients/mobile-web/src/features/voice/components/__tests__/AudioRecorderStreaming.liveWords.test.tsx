// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (voice live words, founder 28 Nov 2026) — through the REAL streaming recorder: the
 * words he is saying appear on the strip DURING the recording (a phrase at a time), they never touch the recording, and when the
 * live words fail or are off, recording and saving go on exactly as before (P9).
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
    onFrame: undefined as ((f: Float32Array) => void) | undefined,
    pcmStops: 0,
    liveStream: null as MediaStream | null,
    send: vi.fn(),
    sampleRate: 16000 as number | null,
}));

vi.mock('../../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: 'mr', setLanguage: () => undefined, t: (k: string) => k }),
    useOptionalLanguage: () => ({ language: 'mr', setLanguage: () => undefined, t: (k: string) => k }),
    LanguageProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../../../infrastructure/voice/StreamingPcmRecorder', () => ({
    StreamingPcmRecorder: class {
        get liveStream(): MediaStream | null { return h.liveStream; }
        get sampleRate(): number | null { return h.sampleRate; }
        start = async (onFrame?: (f: Float32Array) => void) => { h.onFrame = onFrame; };
        stop = async () => { h.pcmStops++; return { pcm: new Float32Array(16000).fill(0.25), sampleRate: 16000, durationMs: 9000 }; };
    },
}));
vi.mock('../../liveWords/liveWordsClient', () => ({ sendLiveWords: h.send, LIVE_WORDS_TIMEOUT_MS: 9000 }));

import AudioRecorderStreaming from '../AudioRecorderStreaming';
import { MIC_INSTRUCTION } from '../recorder/recorderWords';
import { VOICE_FLOW_MR } from '../../flowV2/voiceFlowWords';

class FakeMediaRecorder {
    static isTypeSupported = (type: string) => type.startsWith('audio/webm');
    state: 'inactive' | 'recording' = 'inactive';
    ondataavailable: ((e: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: (() => void) | null = null;
    start() { this.state = 'recording'; }
    stop() { if (this.state === 'inactive') return; this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['live-opus'], { type: 'audio/webm' }) }); this.onstop?.(); }
}

const flowV2 = { silenceHelp: true };
const FRAME = 128;
const flush = async () => { await act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); }); };

/** He speaks for `speechMs`, then pauses: the frames reach the recorder's own callback, as the worklet's would. */
async function speak(speechMs = 900) {
    await act(async () => {
        for (let i = 0; i < Math.ceil((speechMs / 1000) * (16000 / FRAME)); i++) h.onFrame?.(new Float32Array(FRAME).fill(0.1));
        for (let i = 0; i < 70; i++) h.onFrame?.(new Float32Array(FRAME).fill(0.001));
    });
    await flush();
}

const start = async () => { await act(async () => { fireEvent.click(screen.getByTestId('mic-button')); }); await flush(); };

beforeEach(() => {
    h.onFrame = undefined;
    h.pcmStops = 0;
    h.sampleRate = 16000;
    h.liveStream = { getTracks: () => [] } as unknown as MediaStream;
    h.send.mockReset().mockResolvedValue({ kind: 'words', text: 'आज पाच मजूर होते' });
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    vi.useFakeTimers();
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('AudioRecorderStreaming — live words while he speaks', () => {
    it('the words appear on the strip DURING the recording, before he stops', async () => {
        render(<AudioRecorderStreaming onAudioCaptured={vi.fn()} flowV2={flowV2} liveWordsFarmId="farm-1" />);
        await start();
        expect(screen.getByTestId('sathi-words-strip')).toHaveTextContent(VOICE_FLOW_MR.wordsStrip);

        await speak();

        expect(h.send).toHaveBeenCalledTimes(1);
        expect(h.send.mock.calls[0][0]).toMatchObject({ farmId: 'farm-1', seq: 1 });
        expect(screen.getByTestId('sathi-words-strip')).toHaveTextContent('आज पाच मजूर होते');
        expect(screen.getByTestId('mic-ui')).toHaveAttribute('data-recording', 'yes'); // still recording
        expect(h.pcmStops).toBe(0);
    });

    it('nothing is sorted: the ring stays quiet while the words show', async () => {
        render(<AudioRecorderStreaming onAudioCaptured={vi.fn()} flowV2={flowV2} liveWordsFarmId="farm-1" />);
        await start();
        await speak();

        expect(screen.getByTestId('sathi-ring').getAttribute('data-lit')).toBe('0');
    });

    it('the recording is the batch path\'s, untouched: stop sends his recording as before, whatever the live words did', async () => {
        const onAudioCaptured = vi.fn();
        render(<AudioRecorderStreaming onAudioCaptured={onAudioCaptured} flowV2={flowV2} liveWordsFarmId="farm-1" />);
        await start();
        await speak();
        await act(async () => { vi.advanceTimersByTime(12_000); });
        await act(async () => { fireEvent.click(screen.getByTestId('mic-stop')); });
        await act(async () => { await vi.runAllTimersAsync(); });

        expect(onAudioCaptured).toHaveBeenCalledTimes(1);
        const sent = onAudioCaptured.mock.calls[0][0];
        expect(sent.encodedLive).toBe(true);
        expect(JSON.stringify(Object.keys(sent).sort())).not.toContain('liveWords');
        expect(h.pcmStops).toBe(1);
    });

    it('stopping ends the live words: no further phrase is sent, and the words are gone with the screen', async () => {
        const onAudioCaptured = vi.fn();
        render(<AudioRecorderStreaming onAudioCaptured={onAudioCaptured} flowV2={flowV2} liveWordsFarmId="farm-1" />);
        await start();
        await speak();
        await act(async () => { fireEvent.click(screen.getByTestId('mic-stop')); });
        await act(async () => { await vi.runAllTimersAsync(); });
        const sentBefore = h.send.mock.calls.length;

        await speak(); // the worklet is closed; any late frame must send nothing

        expect(h.send).toHaveBeenCalledTimes(sentBefore);
        expect(screen.queryByTestId('sathi-words-strip')).not.toBeInTheDocument();
    });

    it('when the live words fail, the strip keeps its calm line and recording and saving are unaffected (P9)', async () => {
        h.send.mockResolvedValue({ kind: 'failed' });
        const onAudioCaptured = vi.fn();
        render(<AudioRecorderStreaming onAudioCaptured={onAudioCaptured} flowV2={flowV2} liveWordsFarmId="farm-1" />);
        await start();
        await speak();
        await speak();
        await speak();
        await speak(); // three failures end it; the fourth phrase is not even sent

        expect(h.send).toHaveBeenCalledTimes(3);
        expect(screen.getByTestId('sathi-words-strip')).toHaveTextContent(VOICE_FLOW_MR.wordsStrip);
        expect(screen.getByTestId('mic-ui')).toHaveAttribute('data-recording', 'yes');

        await act(async () => { vi.advanceTimersByTime(12_000); });
        await act(async () => { fireEvent.click(screen.getByTestId('mic-stop')); });
        await act(async () => { await vi.runAllTimersAsync(); });
        expect(onAudioCaptured).toHaveBeenCalledTimes(1);
    });

    it('a request that blows up inside the recorder callback cannot stop the recording', async () => {
        h.send.mockImplementation(() => { throw new Error('synchronous bug in the client'); });
        render(<AudioRecorderStreaming onAudioCaptured={vi.fn()} flowV2={flowV2} liveWordsFarmId="farm-1" />);
        await start();

        await expect(speak()).resolves.toBeUndefined();
        expect(screen.getByTestId('mic-ui')).toHaveAttribute('data-recording', 'yes');
    });

    it.each([
        ['no farm is known', { flowV2, liveWordsFarmId: undefined }],
        ['the farm is still "unknown-farm"', { flowV2, liveWordsFarmId: 'unknown-farm' }],
        ['the v2 flow is off (today\'s recorder)', { flowV2: undefined, liveWordsFarmId: 'farm-1' }],
    ])('sends nothing when %s', async (_why, props) => {
        render(<AudioRecorderStreaming onAudioCaptured={vi.fn()} {...props} />);
        await start();
        await speak();

        expect(h.send).not.toHaveBeenCalled();
        expect(screen.getByTestId('mic-ui')).toHaveAttribute('data-recording', 'yes');
    });

    it('sends nothing when the recorder cannot say its sample rate (cannot cut phrases honestly)', async () => {
        h.sampleRate = null;
        render(<AudioRecorderStreaming onAudioCaptured={vi.fn()} flowV2={flowV2} liveWordsFarmId="farm-1" />);
        await start();
        await speak();

        expect(h.send).not.toHaveBeenCalled();
    });
});

// keeps MIC_INSTRUCTION import honest for the legacy face lookups other suites use
void MIC_INSTRUCTION;
