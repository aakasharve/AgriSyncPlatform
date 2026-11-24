// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-instant-phase-a-2026-11-23 (P4) — when the SERVER failed and his words were kept on the phone, the
 * recorder shows a CALM line (not the red "तपासा" error box): "आवाज जतन आहे — साथी थोड्या वेळात समजून घेईल". No emoji, no
 * timer, no percentage. The words are Marathi in Marathi mode and English in English mode, one language at a time, in
 * the old screen (`recorderWords.readableError`) and in the v2 flow (`voiceFlowWords.keptForLater`).
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ language: 'mr' as string }));
vi.mock('../../../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: h.language, setLanguage: () => undefined, t: (k: string) => k }),
    useOptionalLanguage: () => ({ language: h.language, setLanguage: () => undefined, t: (k: string) => k }),
    LanguageProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../../../../../infrastructure/voice/StreamingPcmRecorder', () => ({
    StreamingPcmRecorder: class { liveStream = null; start = async () => undefined; stop = async () => ({ pcm: new Float32Array(0), sampleRate: 16000, durationMs: 0 }); },
}));

import AudioRecorderStreaming from '../../AudioRecorderStreaming';
import AudioRecorder from '../../AudioRecorder';
import { RecorderFace } from '../RecorderFace';
import { REC_WORDS, keptNoteOf, readableError } from '../recorderWords';
import { VOICE_FLOW_EN, VOICE_FLOW_MR } from '../../../flowV2/voiceFlowWords';
import { ONLINE_KEPT_MESSAGE } from '../../../../../infrastructure/voice/keptForLater';
import { OFFLINE_SAVED_MESSAGE } from '../../../../../infrastructure/ai/offlineVoiceQueue';

const DEVANAGARI = /[ऀ-ॿ]/;
const NO_DIGITS_OR_PERCENT = /[0-9०-९%]/;
// An emoji (pictographs, symbols, dingbats) — none belongs in this line.
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const noop = () => undefined;
const face = (props: Partial<React.ComponentProps<typeof RecorderFace>>) => render(
    <RecorderFace isRecording={false} seconds={0} onStart={noop} onStop={noop} onCancel={noop} {...props} />,
);

beforeEach(() => { h.language = 'mr'; });
afterEach(() => { cleanup(); });

describe('the words for "kept, will be understood shortly"', () => {
    it('Marathi: Devanagari, calm, no emoji, no number, no percentage — and not the generic error or the offline sentence', () => {
        const mr = readableError(ONLINE_KEPT_MESSAGE, 'mr');
        expect(mr).toMatch(DEVANAGARI);
        expect(mr).not.toMatch(NO_DIGITS_OR_PERCENT);
        expect(mr).not.toMatch(EMOJI);
        expect(mr).not.toBe(REC_WORDS.genericError);
        expect(mr).not.toBe(readableError(OFFLINE_SAVED_MESSAGE, 'mr'));
        expect(mr).toBe(VOICE_FLOW_MR.keptForLater);
    });
    it('English: no Devanagari, calm, no number', () => {
        const en = readableError(ONLINE_KEPT_MESSAGE, 'en');
        expect(en).not.toMatch(DEVANAGARI);
        expect(en).not.toMatch(NO_DIGITS_OR_PERCENT);
        expect(en).toBe(VOICE_FLOW_EN.keptForLater);
    });
    it('keptNoteOf is the words for the code and nothing for anything else', () => {
        expect(keptNoteOf(ONLINE_KEPT_MESSAGE, 'mr')).toBe(readableError(ONLINE_KEPT_MESSAGE, 'mr'));
        expect(keptNoteOf(ONLINE_KEPT_MESSAGE, 'mr', true)).toBe(VOICE_FLOW_MR.keptForLater);
        expect(keptNoteOf(ONLINE_KEPT_MESSAGE, 'en', true)).toBe(VOICE_FLOW_EN.keptForLater);
        expect(keptNoteOf(OFFLINE_SAVED_MESSAGE, 'mr')).toBeNull();
        expect(keptNoteOf('Voice parsing failed.', 'mr')).toBeNull();
        expect(keptNoteOf(null)).toBeNull();
        expect(keptNoteOf(undefined)).toBeNull();
    });
});

describe('RecorderFace — the calm note', () => {
    it('shows the note as a status, in Sathi\'s calm green, with none of the red error box', () => {
        face({ keptNote: VOICE_FLOW_MR.keptForLater });
        const note = screen.getByTestId('mic-kept');
        expect(note).toHaveTextContent(VOICE_FLOW_MR.keptForLater);
        expect(note).toHaveAttribute('role', 'status');
        expect(note.className).not.toMatch(/red|rose/);
        expect(screen.queryByTestId('mic-error')).toBeNull();
        expect(screen.queryByText(REC_WORDS.checkInput)).toBeNull();
    });
    it('no note, no box', () => {
        face({});
        expect(screen.queryByTestId('mic-kept')).toBeNull();
    });
    it('a real error is still the red box', () => {
        face({ error: 'काहीतरी चुकलं.' });
        expect(screen.getByTestId('mic-error')).toBeInTheDocument();
        expect(screen.queryByTestId('mic-kept')).toBeNull();
    });
});

describe.each([
    ['AudioRecorderStreaming', AudioRecorderStreaming],
    ['AudioRecorder', AudioRecorder],
] as const)('%s — the parse said "kept"', (_name, Recorder) => {
    it('old screen: the calm Marathi line from recorderWords, never the red box', () => {
        render(<Recorder onAudioCaptured={noop} externalError={ONLINE_KEPT_MESSAGE} />);
        expect(screen.getByTestId('mic-kept')).toHaveTextContent(readableError(ONLINE_KEPT_MESSAGE, 'mr'));
        expect(screen.queryByTestId('mic-error')).toBeNull();
    });
    it('v2 flow: the line from voiceFlowWords, in the language of the screen', () => {
        h.language = 'en';
        render(<Recorder onAudioCaptured={noop} externalError={ONLINE_KEPT_MESSAGE} flowV2={{ silenceHelp: true }} />);
        expect(screen.getByTestId('mic-kept')).toHaveTextContent(VOICE_FLOW_EN.keptForLater);
        expect(screen.queryByTestId('mic-error')).toBeNull();
    });
    it('any other error is the red box, as before', () => {
        render(<Recorder onAudioCaptured={noop} externalError="Voice parsing failed." />);
        expect(screen.getByTestId('mic-error')).toBeInTheDocument();
        expect(screen.queryByTestId('mic-kept')).toBeNull();
    });
    it('the offline sentence is unchanged (this lane does not move it)', () => {
        render(<Recorder onAudioCaptured={noop} externalError={OFFLINE_SAVED_MESSAGE} />);
        expect(screen.getByTestId('mic-error')).toHaveTextContent(readableError(OFFLINE_SAVED_MESSAGE, 'mr'));
        expect(screen.queryByTestId('mic-kept')).toBeNull();
    });
});
