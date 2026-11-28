// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (Task 3 + amendments Verifier 1, H4, H5) — calm hints while he is silent, a nudge
 * to stop when he is done; ONE fixed hint slot from t=0 so the stop never moves; no live region while the mic is open.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecorderFace, type RecorderFaceProps } from '../RecorderFace';
import { VOICE_FLOW_MR } from '../../../flowV2/voiceFlowWords';

const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

function face(over: Partial<RecorderFaceProps> = {}) {
    const props: RecorderFaceProps = {
        isRecording: true, seconds: 0, level: undefined, onStart: vi.fn(), onStop: vi.fn(), onCancel: vi.fn(),
        flowV2: { silenceHelp: true }, ...over,
    };
    const view = render(<RecorderFace {...props} />);
    return { props, rerender: (o: Partial<RecorderFaceProps>) => view.rerender(<RecorderFace {...props} {...o} />) };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('RecorderFace — silence help (flowV2.silenceHelp)', () => {
    it('the hint slot is there from t=0, before the stop, quiet for screen readers', () => {
        face({ level: 0.02 });
        const slot = screen.getByTestId('mic-hint-slot');
        expect(slot).toHaveAttribute('role', 'note');
        expect(slot).toHaveAttribute('aria-live', 'off');
        expect(slot.textContent).toBe('');
        // in the flow ABOVE the stop ring, never over it
        expect(slot.compareDocumentPosition(screen.getByTestId('mic-stop')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        advance(9000);
        expect(screen.getByTestId('mic-hint-slot')).toBe(slot);
        expect(screen.queryAllByRole('status')).toHaveLength(0);
    });

    it('no hint at all while the level is not measurable', () => {
        face({ level: undefined });
        advance(20_000);
        expect(screen.getByTestId('mic-hint-slot').textContent).toBe('');
    });

    it('one example at 4 s, three prompts at 9 s, the stop note at 16 s', () => {
        face({ level: 0.02 });
        advance(3900);
        expect(screen.queryByTestId('mic-hint-coachOne')).not.toBeInTheDocument();
        advance(100);
        expect(screen.getByTestId('mic-hint-coachOne')).toHaveTextContent(VOICE_FLOW_MR.coachOne);
        advance(5000);
        const prompts = screen.getByTestId('mic-hint-prompts');
        VOICE_FLOW_MR.prompts.forEach(p => expect(prompts).toHaveTextContent(p.q));
        advance(7000);
        expect(screen.getByTestId('mic-hint-stopNote')).toHaveTextContent(VOICE_FLOW_MR.stopNote);
    });

    it('undefined first, real levels after: the hints still come', () => {
        const { rerender } = face({ level: undefined });
        advance(300);
        rerender({ level: 0.03 });
        advance(3700);
        expect(screen.getByTestId('mic-hint-coachOne')).toBeInTheDocument();
    });

    it('after speech then 5 s of quiet: "finished?" above the stop, the stop pulses and still stops in one tap', () => {
        const { props, rerender } = face({ level: 0.02 });
        rerender({ level: 0.3 });
        advance(500);
        rerender({ level: 0 });
        advance(4400);
        expect(screen.queryByTestId('mic-hint-doneAsk')).not.toBeInTheDocument();
        advance(600);
        const ask = screen.getByTestId('mic-hint-doneAsk');
        expect(ask).toHaveTextContent(VOICE_FLOW_MR.doneAskTitle);
        expect(ask).toHaveTextContent(VOICE_FLOW_MR.doneAskBody);
        expect(screen.getByTestId('mic-stop-attention')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('mic-stop'));
        expect(props.onStop).toHaveBeenCalledTimes(1);
        rerender({ level: 0.3 });
        advance(500);
        expect(screen.queryByTestId('mic-hint-doneAsk')).not.toBeInTheDocument();
    });

    it('the old 10 s stop hint never shows with the silence help', () => {
        const { rerender } = face({ level: 0.3 });
        rerender({ seconds: 11, level: 0.3 });
        advance(11_000);
        expect(screen.queryByTestId('mic-stop-hint')).not.toBeInTheDocument();
    });

    it('without flowV2 the face is today\'s: no slot, the old hint at 10 s', () => {
        const { rerender } = face({ flowV2: undefined, level: 0.02 });
        expect(screen.queryByTestId('mic-hint-slot')).not.toBeInTheDocument();
        rerender({ seconds: 10 });
        expect(screen.getByTestId('mic-stop-hint')).toBeInTheDocument();
        expect(screen.getByTestId('mic-stop-attention')).toBeInTheDocument();
    });
});

/**
 * spec plr-d10 (part 03, A2) — 3 s of quiet after at least 1 s of real speech ends the recording by itself; the ring fills round the
 * red stop while it runs. The model is stepped on every level change and every 500 ms, so the times below land on those steps.
 */
describe('RecorderFace — the quiet stop (A2)', () => {
    /** Speaks at 0.3 for `ms`, then goes quiet (0.02). */
    const speakThenQuiet = (ms: number) => {
        const f = face({ level: 0.02 });
        f.rerender({ level: 0.3 });
        advance(ms);
        f.rerender({ level: 0.02 });
        return f;
    };

    it('1.5 s of speech, then 3 s of quiet: it stops by itself, ONCE, with the ring and the design\'s words while it runs', () => {
        const { props } = speakThenQuiet(1500);
        expect(screen.queryByTestId('mic-stop-quiet')).not.toBeInTheDocument();
        expect(screen.getByTestId('mic-stop-instruction')).toHaveTextContent(VOICE_FLOW_MR.stopLabel);
        advance(1000);                                     // 1 s of quiet: the ring and its words are up
        expect(screen.getByTestId('mic-stop-quiet')).toBeInTheDocument();
        expect(screen.getByTestId('mic-stop')).toContainElement(screen.getByTestId('mic-stop-quiet'));
        expect(screen.getByTestId('mic-stop-instruction')).toHaveTextContent('शांत आहे… आपोआप थांबतोय');
        expect(screen.getByTestId('mic-listening')).toHaveTextContent('अजून काही?');
        expect(screen.getByTestId('sathi-bubble')).toHaveTextContent('नसेल तर साथी आपोआप थांबेल');
        advance(1500);                                     // 2.5 s of quiet: still listening
        expect(props.onStop).not.toHaveBeenCalled();
        advance(500);                                      // 3 s of quiet
        expect(props.onStop).toHaveBeenCalledTimes(1);
        expect(props.onCancel).not.toHaveBeenCalled();
        advance(10_000);
        expect(props.onStop).toHaveBeenCalledTimes(1);
    });

    it('under 1 s of speech it never stops by itself: it keeps listening and asks "finished?" at 5 s', () => {
        const { props } = speakThenQuiet(500);
        advance(4000);
        expect(screen.queryByTestId('mic-stop-quiet')).not.toBeInTheDocument();
        expect(props.onStop).not.toHaveBeenCalled();
        advance(1500);
        expect(screen.getByTestId('mic-hint-doneAsk')).toBeInTheDocument();
        advance(30_000);
        expect(props.onStop).not.toHaveBeenCalled();
    });

    it('speaking again takes the ring away and the stop does not come while he speaks', () => {
        const { props, rerender } = speakThenQuiet(1500);
        advance(2000);
        expect(screen.getByTestId('mic-stop-quiet')).toBeInTheDocument();
        rerender({ level: 0.3 });
        expect(screen.queryByTestId('mic-stop-quiet')).not.toBeInTheDocument();
        expect(screen.getByTestId('mic-stop-instruction')).toHaveTextContent(VOICE_FLOW_MR.stopLabel);
        advance(10_000);
        expect(props.onStop).not.toHaveBeenCalled();
        rerender({ level: 0.02 });                         // quiet again: a fresh 3 s
        advance(2500);
        expect(props.onStop).not.toHaveBeenCalled();
        advance(500);
        expect(props.onStop).toHaveBeenCalledTimes(1);
    });

    it('a tap on the red stop during the ring stops once; the quiet stop does not add a second', () => {
        const { props } = speakThenQuiet(1500);
        advance(1000);
        fireEvent.click(screen.getByTestId('mic-stop'));
        expect(props.onStop).toHaveBeenCalledTimes(1);
        advance(5000);
        expect(props.onStop).toHaveBeenCalledTimes(1);
    });

    it('no level (the phone cannot measure): never stops by itself (P5)', () => {
        const { props } = face({ level: undefined });
        advance(60_000);
        expect(props.onStop).not.toHaveBeenCalled();
        expect(screen.queryByTestId('mic-stop-quiet')).not.toBeInTheDocument();
    });

    it('without flowV2 (today\'s recorder) it never stops by itself', () => {
        const { props, rerender } = face({ flowV2: undefined, level: 0.3 });
        advance(2000);
        rerender({ level: 0.02 });
        advance(10_000);
        expect(props.onStop).not.toHaveBeenCalled();
    });
});
