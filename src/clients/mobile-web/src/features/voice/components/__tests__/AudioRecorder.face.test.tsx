// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I12, LP-04, LP-06) — the REAL recorder in the
 * founder-approved look: the idle card says his sentence; recording shows "ऐकत आहे", a LIVE level
 * meter from an AnalyserNode on the real stream, the stop instruction, the stop hint after 10 s and a
 * cancel set apart that still DISCARDS the clip; typing goes to the same parse and is tagged.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: 'mr', setLanguage: () => undefined, t: (k: string) => k }),
    useOptionalLanguage: () => ({ language: 'mr', setLanguage: () => undefined, t: (k: string) => k }),
    LanguageProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import AudioRecorder from '../AudioRecorder';
import { MIC_INSTRUCTION, REC_WORDS } from '../recorder/recorderWords';

const track = { stop: vi.fn() };
const fakeStream = { getTracks: () => [track] } as unknown as MediaStream;
let analyserReads = 0;
let micContexts: FakeAudioContext[] = [];

class FakeMediaRecorder {
    state = 'inactive';
    ondataavailable: ((e: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    start() { this.state = 'recording'; }
    stop() {
        this.state = 'inactive';
        this.ondataavailable?.({ data: new Blob(['voice'], { type: 'audio/webm' }) });
        this.onstop?.();
    }
}

/** A voice at about half the meter: ±20 around the 8-bit midpoint. */
class FakeAudioContext {
    closed = false;
    source = { connect: vi.fn(), disconnect: vi.fn() };
    constructor() { micContexts.push(this); }
    createMediaStreamSource(stream: MediaStream) { expect(stream).toBe(fakeStream); return this.source; }
    createAnalyser() {
        return {
            fftSize: 0,
            getByteTimeDomainData(samples: Uint8Array) { analyserReads += 1; samples.forEach((_, i) => { samples[i] = i % 2 ? 148 : 108; }); },
        };
    }
    close() { this.closed = true; return Promise.resolve(); }
}

beforeEach(() => {
    analyserReads = 0;
    micContexts = [];
    track.stop.mockClear();
    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
        configurable: true,
        value: { getUserMedia: vi.fn().mockResolvedValue(fakeStream) },
    });
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    vi.stubGlobal('AudioContext', FakeAudioContext);
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

const startSpeaking = async () => {
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: MIC_INSTRUCTION })); });
};

describe('AudioRecorder — idle card', () => {
    it('says the founder\'s sentence beside the green mic, and offers the quiet "type instead" line', () => {
        render(<AudioRecorder onAudioCaptured={vi.fn()} onTextCaptured={vi.fn()} />);
        expect(screen.getByTestId('mic-instruction')).toHaveTextContent('हिरव्या रंगाचा माइक चे बटन एकदा दाबून बोलायला सुरवात करा');
        expect(screen.getByTestId('typed-link')).toHaveTextContent('बोलता येत नसेल तर इथे लिहा');
        // the old English and the old "नोंद सुरू करा" heading are gone from this card
        expect(document.body.textContent).not.toMatch(/Start Recording|Recording|voice\.startLogging/);
        expect(screen.queryByTestId('mic-level')).toBeNull();
    });
});

describe('AudioRecorder — while recording', () => {
    it('shows the red dot + "ऐकत आहे", a LIVE meter fed by the real stream, and the stop instruction', async () => {
        vi.useFakeTimers();
        render(<AudioRecorder onAudioCaptured={vi.fn()} />);
        await startSpeaking();
        expect(screen.getByTestId('mic-ui')).toHaveAttribute('data-recording', 'yes');
        expect(screen.getByTestId('mic-red-dot')).toBeInTheDocument();
        expect(screen.getByTestId('mic-listening')).toHaveTextContent('ऐकत आहे');
        expect(screen.getByTestId('mic-stop-instruction')).toHaveTextContent(REC_WORDS.tapToStop);
        expect(screen.getByRole('button', { name: REC_WORDS.tapToStop })).toBeInTheDocument();

        act(() => { vi.advanceTimersByTime(200); });
        // the analyser on the SAME stream the recorder opened was read, and its level drives the meter
        expect(analyserReads).toBeGreaterThan(0);
        expect(screen.getByTestId('mic-level')).toHaveAttribute('data-level', '0.50');
    });

    it('after 10 seconds the stop hint appears in the founder\'s words, and "समजलं" puts it away', async () => {
        vi.useFakeTimers();
        render(<AudioRecorder onAudioCaptured={vi.fn()} />);
        await startSpeaking();
        act(() => { vi.advanceTimersByTime(9_000); });
        expect(screen.getByTestId('mic-clock')).toHaveTextContent('00:09');
        expect(screen.queryByTestId('mic-stop-hint')).toBeNull();
        act(() => { vi.advanceTimersByTime(1_000); });
        expect(screen.getByTestId('mic-clock')).toHaveTextContent('00:10');
        expect(screen.getByTestId('mic-stop-hint')).toHaveTextContent('सर्व कामे व्यवस्थित सांगून झाली असतील तरच लाल बटन दाबा.');
        fireEvent.click(screen.getByTestId('mic-stop-hint-ok'));
        expect(screen.queryByTestId('mic-stop-hint')).toBeNull();
    });

    // spec: plr-d10 (lane L6b fix) — founder's live test: at 13-20 s, with the hint up, his first tap on the red stop
    // did NOT stop (the hint was drawn over the top of the card, covering the button). The hint may never swallow it.
    it('with the stop hint showing, ONE tap on stop stops the recording — the hint sits under the stop, never over it', async () => {
        vi.useFakeTimers();
        const onAudioCaptured = vi.fn();
        render(<AudioRecorder onAudioCaptured={onAudioCaptured} />);
        await startSpeaking();
        act(() => { vi.advanceTimersByTime(13_000); });
        const hint = screen.getByTestId('mic-stop-hint');
        const stop = screen.getByTestId('mic-stop');
        // Never an overlay: in the flow, AFTER the stop button, and only its "समजलं" takes a tap.
        expect(hint.className).not.toMatch(/(^|\s)(absolute|fixed)(\s|$)/);
        expect(hint.className).toContain('pointer-events-none');
        expect(stop.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(hint.contains(stop)).toBe(false);

        await act(async () => { fireEvent.click(stop); }); // one tap
        expect(screen.getByTestId('mic-ui')).toHaveAttribute('data-recording', 'no');
        expect(track.stop).toHaveBeenCalled(); // the microphone is closed
        act(() => { vi.advanceTimersByTime(1_000); });
        vi.useRealTimers(); // the clip is read with a FileReader
        await waitFor(() => expect(onAudioCaptured).toHaveBeenCalledTimes(1)); // and what he said is sent, once
    });

    it('cancel is set apart, in the founder\'s words, and still DISCARDS the clip (nothing is sent, the mic closes)', async () => {
        vi.useFakeTimers();
        const onAudioCaptured = vi.fn();
        render(<AudioRecorder onAudioCaptured={onAudioCaptured} />);
        await startSpeaking();
        act(() => { vi.advanceTimersByTime(3_000); });
        const cancel = screen.getByTestId('mic-cancel');
        expect(cancel).toHaveTextContent('काही चुकीचे बोलले गेले असेल तर रद्द करा');
        expect(cancel).not.toBe(screen.getByTestId('mic-stop'));
        fireEvent.click(cancel);
        act(() => { vi.advanceTimersByTime(500); });
        expect(onAudioCaptured).not.toHaveBeenCalled();
        expect(track.stop).toHaveBeenCalled();
        expect(screen.getByTestId('mic-ui')).toHaveAttribute('data-recording', 'no');
        expect(screen.getByTestId('mic-cancelled')).toHaveTextContent('बोलणं रद्द केलं');
        // the meter's own listener is closed with the recording
        expect(micContexts.every(c => c.closed)).toBe(true);
    });

    it('stop sends the clip exactly as before (audio/webm), unchanged by the new look', async () => {
        const onAudioCaptured = vi.fn();
        render(<AudioRecorder onAudioCaptured={onAudioCaptured} />);
        await startSpeaking();
        fireEvent.click(screen.getByTestId('mic-stop'));
        await waitFor(() => expect(onAudioCaptured).toHaveBeenCalledTimes(1));
        expect(onAudioCaptured.mock.calls[0][0].mimeType).toBe('audio/webm');
    });
});

describe('AudioRecorder — typing instead (LP-06)', () => {
    it('the sheet says there is no recording, tags it "लिहिलेलं", and sends the words to the same parse', () => {
        const onTextCaptured = vi.fn();
        render(<AudioRecorder onAudioCaptured={vi.fn()} onTextCaptured={onTextCaptured} />);
        fireEvent.click(screen.getByTestId('typed-link'));
        expect(screen.getByTestId('typed-sheet-tag')).toHaveTextContent('लिहिलेलं');
        expect(screen.getByTestId('typed-note')).toHaveTextContent('आवाज रेकॉर्डिंग नाही');
        expect(screen.getByTestId('typed-sheet').querySelector('audio')).toBeNull();
        expect(screen.getByTestId('typed-send')).toBeDisabled();
        fireEvent.change(screen.getByTestId('typed-input'), { target: { value: 'आज फवारणी केली' } });
        fireEvent.click(screen.getByTestId('typed-send'));
        expect(onTextCaptured).toHaveBeenCalledWith('आज फवारणी केली');
        expect(screen.queryByTestId('typed-sheet')).toBeNull();
    });

    it('if the typed words come back with a problem, they are tagged "लिहिलेलं", never quoted as heard', () => {
        const onTextCaptured = vi.fn();
        const { rerender } = render(<AudioRecorder onAudioCaptured={vi.fn()} onTextCaptured={onTextCaptured} />);
        fireEvent.click(screen.getByTestId('typed-link'));
        fireEvent.change(screen.getByTestId('typed-input'), { target: { value: 'काहीतरी वेगळं' } });
        fireEvent.click(screen.getByTestId('typed-send'));
        rerender(<AudioRecorder onAudioCaptured={vi.fn()} onTextCaptured={onTextCaptured} externalError="Input seems unrelated to selected crop." transcript="काहीतरी वेगळं" />);
        expect(screen.getByTestId('mic-error-typed-tag')).toHaveTextContent('लिहिलेलं');
        expect(screen.getByTestId('mic-error-typed')).toHaveTextContent('काहीतरी वेगळं');
        expect(screen.queryByTestId('mic-error-heard')).toBeNull();
        // the English service message is not shown to him; a plain Marathi line is
        expect(document.body.textContent).not.toContain('Input seems unrelated');
        expect(screen.getByTestId('mic-error')).toHaveTextContent(REC_WORDS.genericError);
    });
});

describe('AudioRecorder — the mic\'s own failures are Marathi, with no English code (I12-V1-m3)', () => {
    it('a busy mic says the Marathi line whatever the app language; the cause rides on the box, never in the words', async () => {
        const busy = new Error('Could not start audio source');
        busy.name = 'NotReadableError';
        Object.defineProperty(globalThis.navigator, 'mediaDevices', {
            configurable: true,
            value: { getUserMedia: vi.fn().mockRejectedValue(busy) },
        });
        render(<AudioRecorder onAudioCaptured={vi.fn()} onTextCaptured={vi.fn()} />);
        await startSpeaking();
        const box = await screen.findByTestId('mic-error');
        expect(REC_WORDS.micError).toBe('माइक वापरता आला नाही. कृपया परवानगी द्या.');
        expect(box).toHaveTextContent(REC_WORDS.micError);
        expect(box.textContent).not.toMatch(/NotReadableError|\[|[A-Za-z]/);
        expect(box).toHaveAttribute('data-error-code', 'NotReadableError');
    });

    it('no microphone API at all (insecure page / old WebView): the same Marathi line, code kept off-screen', async () => {
        Object.defineProperty(globalThis.navigator, 'mediaDevices', { configurable: true, value: undefined });
        render(<AudioRecorder onAudioCaptured={vi.fn()} />);
        await startSpeaking();
        const box = await screen.findByTestId('mic-error');
        expect(box).toHaveTextContent(REC_WORDS.micError);
        expect(box.textContent).not.toContain('no-mediaDevices');
        expect(box).toHaveAttribute('data-error-code', 'no-mediaDevices');
    });
});
