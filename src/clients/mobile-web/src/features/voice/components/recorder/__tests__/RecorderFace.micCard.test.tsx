// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (Task 4 + amendments B1, Verifier 3, H1, M1, M2, L3) — the mic card starts listening by itself, ONCE
 * per arming, never twice, never while typing.
 * spec: plr-d10 (part 03, A1; the founder's final design, 28 Nov) — on the mic page: 3 s, ONE big number (३ २ १) in the green mic,
 * "साथी ऐकायला तयार" with "N सेकंदात साथी ऐकायला सुरुवात करेल"; the microphone is asked for here when not granted yet.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const perm = vi.hoisted(() => ({ read: vi.fn(), request: vi.fn() }));
vi.mock('../../../../consent/separation/devicePermissions', () => ({ readDevicePermission: perm.read, requestDevicePermission: perm.request }));

import { RecorderFace, type RecorderFaceProps } from '../RecorderFace';
import { MIC_INSTRUCTION } from '../recorderWords';
import { VOICE_FLOW_MR } from '../../../flowV2/voiceFlowWords';
import { resetAutoStartForTests } from '../useAutoStartCountdown';
import { hapticFeedback } from '../../../../../shared/utils/haptics';

const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); });
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const card = (armSeq = 1) => ({ silenceHelp: true, card: { armSeq, placeLabel: () => 'द्राक्ष · प्लॉट २' } });

function face(over: Partial<RecorderFaceProps> = {}) {
    const props: RecorderFaceProps = {
        isRecording: false, seconds: 0, onStart: vi.fn(), onStop: vi.fn(), onCancel: vi.fn(), onRequestContextSelection: vi.fn(),
        onTextCaptured: vi.fn(), flowV2: card(), ...over,
    };
    const view = render(<RecorderFace {...props} />);
    let current = props;
    return { props, rerender: (o: Partial<RecorderFaceProps>) => { current = { ...current, ...o }; view.rerender(<RecorderFace {...current} />); } };
}

let selection: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
    vi.useFakeTimers();
    resetAutoStartForTests();
    perm.read.mockReset().mockResolvedValue('granted');
    perm.request.mockReset().mockResolvedValue('granted');
    selection = vi.spyOn(hapticFeedback, 'selection');
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('RecorderFace — the mic card on the mic page', () => {
    it('shows the design\'s words: "आता बोला", the place, "साथी ऐकायला तयार", the 3 s line and the example; no hold link', async () => {
        face();
        await flush();
        const c = screen.getByTestId('mic-card');
        expect(c).toHaveTextContent(VOICE_FLOW_MR.cardTitle);
        expect(screen.getByTestId('mic-card-place')).toHaveTextContent('द्राक्ष · प्लॉट २');
        expect(screen.getByTestId('mic-card-status')).toHaveTextContent('साथी ऐकायला तयार');
        expect(screen.getByTestId('mic-card-auto')).toHaveTextContent('३ सेकंदात साथी ऐकायला सुरुवात करेल');
        expect(screen.getByTestId('mic-card-auto')).toHaveAttribute('aria-hidden', 'true');
        expect(c).toHaveTextContent(VOICE_FLOW_MR.example);
        expect(screen.getByTestId('mic-card-ring')).toBeInTheDocument();
        expect(screen.getByTestId('mic-button')).toHaveAttribute('aria-label', VOICE_FLOW_MR.tapToStart);
        expect(screen.queryByTestId('mic-card-hold')).not.toBeInTheDocument();
        expect(c).not.toHaveTextContent('थांबा, अजून प्लॉट निवडायचे आहेत');
        expect(screen.getAllByRole('status')).toHaveLength(1);
        expect(screen.getByTestId('typed-link')).toBeInTheDocument();
    });

    it('ONE big number counts ३, २, १ inside the mic, and the line follows it', async () => {
        face();
        await flush();
        expect(screen.getByTestId('mic-card-number')).toHaveTextContent('३');
        expect(screen.getByTestId('mic-card-number')).toHaveAttribute('aria-hidden', 'true');
        expect(screen.getAllByTestId('mic-card-number')).toHaveLength(1);
        expect(screen.getByTestId('mic-card')).toHaveAttribute('data-state', 'counting');
        advance(1000);
        expect(screen.getByTestId('mic-card-number')).toHaveTextContent('२');
        expect(screen.getByTestId('mic-card-auto')).toHaveTextContent('२ सेकंदात');
        advance(1000);
        expect(screen.getByTestId('mic-card-number')).toHaveTextContent('१');
    });

    it('after 3 s it starts by itself, once, with one selection buzz; the mic turns to "साथी ऐकतोय…" while it opens', async () => {
        const { props } = face();
        await flush();
        advance(2999);
        expect(props.onStart).not.toHaveBeenCalled();
        advance(1);
        expect(props.onStart).toHaveBeenCalledTimes(1);
        expect(selection).toHaveBeenCalledTimes(1);
        expect(screen.queryByTestId('mic-card-number')).not.toBeInTheDocument();
        expect(screen.getByTestId('mic-card')).toHaveAttribute('data-state', 'live');
        expect(screen.getByTestId('mic-card-status')).toHaveTextContent('साथी ऐकतोय…');
        advance(10_000);
        expect(props.onStart).toHaveBeenCalledTimes(1);
    });

    it('not granted yet: the microphone is asked for on this page, and the 3 s count from his yes', async () => {
        perm.read.mockResolvedValue('prompt');
        const { props } = face();
        await flush();
        expect(perm.request).toHaveBeenCalledWith('microphone');
        expect(screen.getByTestId('mic-card-number')).toHaveTextContent('३');
        advance(3000);
        expect(props.onStart).toHaveBeenCalledTimes(1);
    });

    it('he says no to the question: no number, no start; the card says to press the mic', async () => {
        perm.read.mockResolvedValue('prompt');
        perm.request.mockResolvedValue('denied');
        const { props } = face();
        await flush();
        advance(10_000);
        expect(screen.queryByTestId('mic-card-ring')).not.toBeInTheDocument();
        expect(screen.queryByTestId('mic-card-number')).not.toBeInTheDocument();
        expect(screen.getByTestId('mic-card-tap')).toHaveTextContent(VOICE_FLOW_MR.tapToStart);
        expect(props.onStart).not.toHaveBeenCalled();
    });

    it('a permission read that never answers: no ring, no start', async () => {
        perm.read.mockReturnValue(new Promise(() => undefined));
        const { props } = face();
        await flush();
        advance(10_000);
        expect(screen.queryByTestId('mic-card-ring')).not.toBeInTheDocument();
        expect(props.onStart).not.toHaveBeenCalled();
    });

    it('arriving unarmed (armSeq 0): the mic waits for a tap, nothing is asked', async () => {
        const { props } = face({ flowV2: card(0) });
        await flush();
        advance(10_000);
        expect(screen.queryByTestId('mic-card-number')).not.toBeInTheDocument();
        expect(screen.getByTestId('mic-card-tap')).toHaveTextContent(VOICE_FLOW_MR.tapToStart);
        expect(perm.read).not.toHaveBeenCalled();
        expect(perm.request).not.toHaveBeenCalled();
        expect(props.onStart).not.toHaveBeenCalled();
    });

    it('a tap at 1 s starts once and the countdown does not start again at 3 s', async () => {
        const { props } = face();
        await flush();
        advance(1000);
        fireEvent.click(screen.getByTestId('mic-button'));
        advance(10_000);
        expect(props.onStart).toHaveBeenCalledTimes(1);
    });

    it('a tap at 2.9 s and the 3 s timer open ONE recorder', async () => {
        const { props } = face();
        await flush();
        advance(2900);
        fireEvent.click(screen.getByTestId('mic-button'));
        advance(200);
        expect(props.onStart).toHaveBeenCalledTimes(1);
    });

    it('the timer at 3 s, then a tap while the mic is still opening: still ONE recorder', async () => {
        const { props } = face();
        await flush();
        advance(3000);
        fireEvent.click(screen.getByTestId('mic-button'));
        expect(props.onStart).toHaveBeenCalledTimes(1);
    });

    it('opening the typing sheet at 1 s holds it, and closing without sending keeps it held', async () => {
        const { props } = face();
        await flush();
        advance(1000);
        fireEvent.click(screen.getByTestId('typed-link'));
        advance(5000);
        fireEvent.click(screen.getByTestId('typed-close'));
        advance(10_000);
        expect(props.onStart).not.toHaveBeenCalled();
    });

    it('a plot deselected at 2 s: no start at 3 s', async () => {
        const { props, rerender } = face();
        await flush();
        advance(2000);
        rerender({ disabled: true });
        advance(5000);
        expect(props.onStart).not.toHaveBeenCalled();
    });

    it('disabled: no ring, a tap asks for the plot choice', async () => {
        const { props } = face({ disabled: true });
        await flush();
        advance(8000);
        expect(screen.queryByTestId('mic-card-ring')).not.toBeInTheDocument();
        fireEvent.click(screen.getByTestId('mic-button'));
        expect(props.onRequestContextSelection).toHaveBeenCalledTimes(1);
        expect(props.onStart).not.toHaveBeenCalled();
    });

    it('cancel after the auto start: no restart', async () => {
        const { props, rerender } = face();
        await flush();
        advance(3000);
        rerender({ isRecording: true, level: 0.3 });
        advance(1000);
        fireEvent.click(screen.getByTestId('mic-cancel'));
        rerender({ isRecording: false, level: undefined });
        await flush();
        advance(20_000);
        expect(props.onStart).toHaveBeenCalledTimes(1);
    });

    it('a mic error after the auto start: no loop, and a tap starts again', async () => {
        const { props, rerender } = face();
        await flush();
        advance(3000);
        rerender({ error: 'माइक सुरू झाला नाही' });
        await flush();
        advance(20_000);
        expect(props.onStart).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('mic-card')).toHaveAttribute('data-state', 'ready');
        fireEvent.click(screen.getByTestId('mic-button'));
        expect(props.onStart).toHaveBeenCalledTimes(2);
    });

    it('an auto-started recording that hears no speech in 20 s is cancelled silently and the card says it waits for a tap', async () => {
        const { props, rerender } = face();
        await flush();
        advance(3000);
        rerender({ isRecording: true, level: 0.05 });
        expect(screen.getByTestId('mic-hint-listening')).toHaveTextContent(VOICE_FLOW_MR.sathiListening);
        advance(19_400);
        expect(props.onCancel).not.toHaveBeenCalled();
        advance(600);
        expect(props.onCancel).toHaveBeenCalledTimes(1);
        rerender({ isRecording: false, level: undefined });
        expect(screen.queryByTestId('mic-cancelled')).not.toBeInTheDocument();
        expect(screen.getByTestId('mic-card-held')).toHaveTextContent(VOICE_FLOW_MR.held);
    });

    it('an auto-started recording whose level is stuck at 0 is cancelled, and the next opening shows no ring', async () => {
        const { props, rerender } = face();
        await flush();
        advance(3000);
        rerender({ isRecording: true, level: 0 });
        advance(3000);
        expect(props.onCancel).toHaveBeenCalledTimes(1);
        rerender({ isRecording: false, level: undefined, flowV2: card(2) });
        await flush();
        advance(10_000);
        expect(screen.queryByTestId('mic-card-ring')).not.toBeInTheDocument();
        expect(props.onStart).toHaveBeenCalledTimes(1);
    });

    it('a recording he started by tapping is never cancelled for silence', async () => {
        const { props, rerender } = face();
        await flush();
        fireEvent.click(screen.getByTestId('mic-button'));
        rerender({ isRecording: true, level: 0 });
        advance(25_000);
        expect(props.onCancel).not.toHaveBeenCalled();
    });

    it('without flowV2 the idle face is today\'s', async () => {
        face({ flowV2: undefined });
        await flush();
        advance(8000);
        expect(screen.queryByTestId('mic-card')).not.toBeInTheDocument();
        expect(screen.getByTestId('mic-instruction')).toHaveTextContent(MIC_INSTRUCTION);
        expect(perm.read).not.toHaveBeenCalled();
    });

    it('with silence help but no card (the ONE mic) the idle face is today\'s and nothing auto-starts', async () => {
        const { props } = face({ flowV2: { silenceHelp: true } });
        await flush();
        advance(8000);
        expect(screen.queryByTestId('mic-card')).not.toBeInTheDocument();
        expect(screen.getByTestId('mic-instruction')).toHaveTextContent(MIC_INSTRUCTION);
        expect(props.onStart).not.toHaveBeenCalled();
    });
});
