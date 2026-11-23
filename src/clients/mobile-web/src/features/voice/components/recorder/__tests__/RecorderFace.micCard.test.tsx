// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (Task 4 + amendments B1, Verifier 3, H1, M1, M2, L3) — the mic card after a plot
 * tap: it starts listening by itself after 7 s, ONCE per plot tap, never twice, never while held or typing.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const perm = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../../../../consent/separation/devicePermissions', () => ({ readDevicePermission: perm.read }));

import { RecorderFace, type RecorderFaceProps } from '../RecorderFace';
import { MIC_INSTRUCTION } from '../recorderWords';
import { VOICE_FLOW_MR } from '../../../flowV2/voiceFlowWords';
import { resetAutoStartForTests } from '../useAutoStartCountdown';
import { hapticFeedback } from '../../../../../shared/utils/haptics';

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
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
    selection = vi.spyOn(hapticFeedback, 'selection');
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('RecorderFace — the mic card', () => {
    it('shows the title, the place, the example and the hold link, with the 7 s ring', async () => {
        face();
        await flush();
        const c = screen.getByTestId('mic-card');
        expect(c).toHaveTextContent(VOICE_FLOW_MR.cardTitle);
        expect(screen.getByTestId('mic-card-place')).toHaveTextContent('द्राक्ष · प्लॉट २');
        expect(c).toHaveTextContent(VOICE_FLOW_MR.tapToStart);
        expect(c).toHaveTextContent(VOICE_FLOW_MR.example);
        expect(screen.getByTestId('mic-card-hold')).toHaveTextContent(VOICE_FLOW_MR.holdLink);
        expect(screen.getByTestId('mic-card-ring')).toBeInTheDocument();
        expect(screen.getByTestId('mic-card-auto')).toHaveTextContent('७ सेकंदात');
        expect(screen.getByTestId('mic-card-auto')).toHaveAttribute('aria-hidden', 'true');
        expect(screen.getAllByRole('status')).toHaveLength(1);
        expect(screen.getByTestId('typed-link')).toBeInTheDocument();
    });

    it('after 7 s it starts by itself, once, with one selection buzz', async () => {
        const { props } = face();
        await flush();
        advance(6999);
        expect(props.onStart).not.toHaveBeenCalled();
        advance(1);
        expect(props.onStart).toHaveBeenCalledTimes(1);
        expect(selection).toHaveBeenCalledTimes(1);
    });

    it('no ring and no start without the permission granted (the card waits for a tap)', async () => {
        perm.read.mockResolvedValue('prompt');
        const { props } = face();
        await flush();
        advance(10_000);
        expect(screen.queryByTestId('mic-card-ring')).not.toBeInTheDocument();
        expect(screen.queryByTestId('mic-card-auto')).not.toBeInTheDocument();
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

    it('a tap at 2 s starts once and the ring does not start again at 7 s', async () => {
        const { props } = face();
        await flush();
        advance(2000);
        fireEvent.click(screen.getByTestId('mic-button'));
        advance(10_000);
        expect(props.onStart).toHaveBeenCalledTimes(1);
    });

    it('a tap at 6.9 s and the 7 s timer open ONE recorder', async () => {
        const { props } = face();
        await flush();
        advance(6900);
        fireEvent.click(screen.getByTestId('mic-button'));
        advance(200);
        expect(props.onStart).toHaveBeenCalledTimes(1);
    });

    it('the timer at 7 s, then a tap while the mic is still opening: still ONE recorder', async () => {
        const { props } = face();
        await flush();
        advance(7000);
        fireEvent.click(screen.getByTestId('mic-button'));
        expect(props.onStart).toHaveBeenCalledTimes(1);
    });

    it('the hold link stops it and never starts recording', async () => {
        const { props } = face();
        await flush();
        advance(2000);
        fireEvent.click(screen.getByTestId('mic-card-hold'));
        expect(props.onStart).not.toHaveBeenCalled();
        expect(screen.getByTestId('mic-card-held')).toHaveTextContent(VOICE_FLOW_MR.held);
        fireEvent.click(screen.getByTestId('mic-card'));
        advance(10_000);
        expect(props.onStart).not.toHaveBeenCalled();
    });

    it('opening the typing sheet at 3 s holds it, and closing without sending keeps it held', async () => {
        const { props } = face();
        await flush();
        advance(3000);
        fireEvent.click(screen.getByTestId('typed-link'));
        advance(5000);
        fireEvent.click(screen.getByTestId('typed-close'));
        advance(10_000);
        expect(props.onStart).not.toHaveBeenCalled();
    });

    it('a plot deselected at 5 s: no start at 7 s', async () => {
        const { props, rerender } = face();
        await flush();
        advance(5000);
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
        advance(7000);
        rerender({ isRecording: true, level: 0.3 });
        advance(1000);
        fireEvent.click(screen.getByTestId('mic-cancel'));
        rerender({ isRecording: false, level: undefined });
        await flush();
        advance(20_000);
        expect(props.onStart).toHaveBeenCalledTimes(1);
    });

    it('a mic error after the auto start: no loop', async () => {
        const { props, rerender } = face();
        await flush();
        advance(7000);
        rerender({ error: 'माइक सुरू झाला नाही' });
        await flush();
        advance(20_000);
        expect(props.onStart).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByTestId('mic-button'));
        expect(props.onStart).toHaveBeenCalledTimes(2);
    });

    it('an auto-started recording that hears no speech in 20 s is cancelled silently and the card says it waits for a tap', async () => {
        const { props, rerender } = face();
        await flush();
        advance(7000);
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

    it('an auto-started recording whose level is stuck at 0 is cancelled, and the next plot tap shows no ring', async () => {
        const { props, rerender } = face();
        await flush();
        advance(7000);
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
