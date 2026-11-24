// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (F4, F5 server line, F7) - the recording screen as approved, with the truth rules: nothing is lit
 * while he speaks (P4), the status says "फोनवर" and never "सर्व्हरवर" (P10), the stop is at the bottom and keeps working, and an answer
 * with no work is Sathi's calm screen, not the red "इनपुट तपासा" box.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecorderFace, type RecorderFaceProps } from '../RecorderFace';
import { VOICE_FLOW_MR } from '../../../flowV2/voiceFlowWords';
import { journeyStepsOf } from '../../../../logs/components/voiceFlowV2/journeyModel';
import { VoiceLayer } from '../../../../logs/components/voiceFlowV2/VoiceLayer';

function face(over: Partial<RecorderFaceProps> = {}) {
    const props: RecorderFaceProps = {
        isRecording: true, seconds: 2, level: 0.3, onStart: vi.fn(), onStop: vi.fn(), onCancel: vi.fn(),
        flowV2: { silenceHelp: true, card: { armSeq: 0, placeLabel: () => 'द्राक्ष · प्लॉट १' } }, ...over,
    };
    const view = render(<RecorderFace {...props} />);
    return { props, rerender: (o: Partial<RecorderFaceProps>) => view.rerender(<RecorderFace {...props} {...o} />) };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('F4 - the recording screen', () => {
    it('Sathi in the centre of the ring of the parts, his bubble, the words strip, the field with its name, the timer and "झालं की थांबवा"', () => {
        face();
        expect(screen.getByTestId('mic-listening')).toHaveTextContent(VOICE_FLOW_MR.sathiListening);
        expect(screen.getByTestId('sathi-bubble')).toHaveTextContent(VOICE_FLOW_MR.sathiListeningSub);
        for (const id of ['work', 'labour', 'inputs', 'water', 'machinery', 'blockers', 'expenses', 'observations', 'reminders']) {
            expect(screen.getByTestId(`sathi-ring-${id}`)).toBeInTheDocument();
        }
        expect(screen.getByTestId('sathi-words-strip')).toHaveTextContent('बोला... साथी ऐकतोय');
        expect(screen.getByTestId('sathi-field')).toHaveTextContent('तुमचं शेत · द्राक्ष · प्लॉट १');
        expect(screen.getByTestId('mic-clock')).toHaveTextContent('00:02');
        expect(screen.getByTestId('mic-stop-instruction')).toHaveTextContent('झालं की थांबवा');
    });

    it('P4: no part lights while he speaks - and no words appear (there is no live transcript)', () => {
        face();
        expect(screen.getByTestId('sathi-ring').getAttribute('data-lit')).toBe('0');
        for (const node of screen.getByTestId('sathi-ring').querySelectorAll('[data-testid^="sathi-ring-"]')) expect(node.getAttribute('data-state')).toBe('quiet');
        expect(screen.getByTestId('sathi-words-strip')).toHaveTextContent('बोला... साथी ऐकतोय');
    });

    it('P10: the status line counts the real seconds "फोनवर" and never says "सर्व्हरवर"', () => {
        face({ seconds: 5 });
        const status = screen.getByTestId('sathi-status');
        expect(status).toHaveTextContent('५ सेकंद आवाज फोनवर');
        expect(status.textContent).not.toContain('सर्व्हरवर');
    });

    it('the stop stops (and shows the stamp for a moment)', () => {
        const { props, rerender } = face();
        fireEvent.click(screen.getByTestId('mic-stop'));
        expect(props.onStop).toHaveBeenCalledTimes(1);
        rerender({ isRecording: false });
        expect(screen.getByTestId('sathi-stamp')).toBeInTheDocument();
        expect(screen.getByTestId('mic-listening')).toHaveTextContent('लक्षात ठेवलं ✓');
        act(() => { vi.advanceTimersByTime(1500); });
        expect(screen.queryByTestId('sathi-stamp')).not.toBeInTheDocument();
    });

    it('the cancel keeps its place and works', () => {
        const { props } = face();
        fireEvent.click(screen.getByTestId('mic-cancel'));
        expect(props.onCancel).toHaveBeenCalled();
    });

    it('inside the voice layer the timer, stop and cancel are the bottom bar of the layer', () => {
        const props: RecorderFaceProps = { isRecording: true, seconds: 3, level: 0.2, onStart: vi.fn(), onStop: vi.fn(), onCancel: vi.fn(), flowV2: { silenceHelp: true } };
        render(<VoiceLayer step="mic"><RecorderFace {...props} /></VoiceLayer>);
        const bottom = screen.getByTestId('voice-layer-bottom');
        expect(bottom.contains(screen.getByTestId('mic-stop'))).toBe(true);
        expect(bottom.contains(screen.getByTestId('mic-clock'))).toBe(true);
        expect(screen.getByTestId('voice-layer-body').contains(screen.getByTestId('mic-stop'))).toBe(false);
    });

    it('the silence hints still work (they sit in the bottom area, above the stop)', () => {
        face({ level: 0.02 });
        act(() => { vi.advanceTimersByTime(4100); });
        expect(screen.getByTestId('mic-hint-coachOne')).toHaveTextContent(VOICE_FLOW_MR.coachOne);
        expect(screen.getByTestId('mic-hint-slot').compareDocumentPosition(screen.getByTestId('mic-stop')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
});

describe('F5 - "फोनवर आणि सर्व्हरवर" only once the server has answered', () => {
    const base = { startedAt: 1000, input: 'audio' as const, durationMs: 174_000, keptAt: 1000 };
    const facts = { excerpt: 'सात बाया आणि तीन गडी होते', parts: [], products: [], places: [] };
    it('before the answer: phone only', () => {
        const v = journeyStepsOf(base, facts, 'mr');
        expect(v.steps[0].sub).toBe('१७४ सेकंदांचा आवाज · फोनवर सुरक्षित');
    });
    it('after the server answered: phone and server', () => {
        const v = journeyStepsOf({ ...base, understoodAt: 2000 }, facts, 'mr');
        expect(v.steps[0].sub).toBe('१७४ सेकंदांचा आवाज · फोनवर आणि सर्व्हरवर सुरक्षित');
        expect(v.steps[1].sub).toBe('सात बाया आणि तीन गडी होते');
    });
});

describe('F7 - nothing understood', () => {
    it('shows the calm screen with his words as he said them, the meter at 0 / १०, the ask and the examples - not the red box', () => {
        face({ isRecording: false, error: 'आज नेहमीप्रमाणे पाणी प्यायलो.', transcript: 'When I say, आज नेहमीप्रमाणे पाणी प्यायलो.' });
        expect(screen.getByTestId('nu-title')).toHaveTextContent('आवाज जतन झाला');
        expect(screen.getByTestId('nu-sub')).toHaveTextContent('काम सापडलं नाही — खालचा माइक दाबून सांगा');
        expect(screen.getByTestId('nu-heard')).toHaveTextContent('When I say, आज नेहमीप्रमाणे पाणी प्यायलो.');
        expect(screen.getByTestId('nu-meter')).toHaveTextContent('० / १०');
        expect(screen.getByTestId('nu-ask')).toHaveTextContent('आज कोणतं काम केलं?');
        expect(screen.getByTestId('nu-how')).toHaveTextContent('कसं सांगायचं?');
        expect(screen.queryByTestId('mic-error')).not.toBeInTheDocument();
        expect(document.body.textContent).not.toContain('इनपुट तपासा');
    });
    it('a mic failure (an error code) keeps the plain error box', () => {
        face({ isRecording: false, error: 'mic', errorCode: 'NotReadableError', transcript: undefined });
        expect(screen.getByTestId('mic-error')).toBeInTheDocument();
        expect(screen.queryByTestId('nothing-understood')).not.toBeInTheDocument();
    });
    it('flag off: the old red box stays exactly as it was', () => {
        face({ isRecording: false, flowV2: undefined, error: 'x', transcript: 'y' });
        expect(screen.getByTestId('mic-error')).toBeInTheDocument();
    });
});
