// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (part 03, A3; founder approved 28 Nov, Mode A) — the log tab's recording screen:
 * the top line, the ring of 9 icons with NO names (nothing lit while he speaks, P4), no words while the live-words switch is off, one
 * gentle buzz and one ring pulse per finished sentence, the production board's lines turning by the shared rule with no immediate
 * repeat, and one centred bottom group (clock, 76 px stop with the quiet ring, label, cancel pill). Only `flowV2.listening` draws it.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecorderFace, type RecorderFaceProps } from '../RecorderFace';
import { VOICE_FLOW_MR } from '../../../flowV2/voiceFlowWords';
import { VoiceLayer } from '../../../../logs/components/voiceFlowV2/VoiceLayer';
import { BOARD_LINES, boardLineMs } from '../../../../logs/components/shramsathi/chalkBoard';
import { hapticFeedback } from '../../../../../shared/utils/haptics';

const RING = ['work', 'labour', 'inputs', 'water', 'machinery', 'blockers', 'expenses', 'observations', 'reminders'];
const listening = { silenceHelp: true, listening: true, card: { armSeq: 1, placeLabel: () => 'द्राक्ष · प्लॉट १' } };

function face(over: Partial<RecorderFaceProps> = {}) {
    const props: RecorderFaceProps = {
        isRecording: true, seconds: 8, level: 0.3, onStart: vi.fn(), onStop: vi.fn(), onCancel: vi.fn(), flowV2: listening, ...over,
    };
    const view = render(<RecorderFace {...props} />);
    let current = props;
    return { props, rerender: (o: Partial<RecorderFaceProps>) => { current = { ...current, ...o }; view.rerender(<RecorderFace {...current} />); } };
}
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

let light: ReturnType<typeof vi.spyOn>;
beforeEach(() => { vi.useFakeTimers(); light = vi.spyOn(hapticFeedback, 'light'); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('A3 — the final recording screen', () => {
    it('the top line "श्रम साथी तुमचं बोलणं ऐकून घेतोय" on one line, "श्रम साथी" in brand green; no old bubble', () => {
        face();
        const line = screen.getByTestId('listening-top-line');
        expect(line).toHaveTextContent('श्रम साथी तुमचं बोलणं ऐकून घेतोय');
        expect(line.className).toContain('whitespace-nowrap');
        expect(line.className).toContain('font-semibold');
        const brand = screen.getByTestId('listening-brand');
        expect(brand).toHaveTextContent('श्रम साथी');
        expect(brand.className).toContain('text-[#0F6B3A]');
        expect(screen.queryByTestId('sathi-bubble')).not.toBeInTheDocument();
        expect(document.body.textContent).not.toContain('बोला... साथी ऐकतोय');
    });

    it('the ring: the 9 icons, NO name labels, and nothing lit while he speaks (P4)', () => {
        face();
        const ring = screen.getByTestId('sathi-ring');
        expect(ring).toHaveAttribute('data-mode', 'listen');
        expect(ring).toHaveAttribute('data-lit', '0');
        RING.forEach(id => expect(screen.getByTestId(`sathi-ring-${id}`)).toHaveAttribute('data-state', 'quiet'));
        expect(ring.querySelectorAll('[data-testid^="sathi-ring-"][data-state]')).toHaveLength(9);
        expect(ring.textContent?.trim()).toBe('');
        for (const label of ['झालेली कामे', 'अडथळा', 'पाणी', 'इतर खर्च']) expect(ring.textContent).not.toContain(label);
        expect(screen.queryByTestId('sathi-ring-label-work')).not.toBeInTheDocument();
    });

    it('the halo uses the blackboard\'s grain, and the dotted circle has 44 fine dots in one green-to-teal shade', () => {
        face();
        const halo = screen.getByTestId('sathi-ring-halo');
        expect(halo.querySelector('.g')).not.toBeNull();
        const dots = screen.getByTestId('sathi-ring-dots').querySelectorAll('circle');
        expect(dots).toHaveLength(44);
        dots.forEach(d => expect(d.getAttribute('r')).toBe('1.6'));
    });

    it('no words strip while the live-words switch is off, even when words exist', () => {
        face({ liveWords: 'आज पाच मजूर होते' });
        expect(screen.queryByTestId('sathi-words-strip')).not.toBeInTheDocument();
        expect(document.body.textContent).not.toContain('आज पाच मजूर होते');
    });

    it('with the switch on, the strip shows the words heard so far', () => {
        vi.stubEnv('VITE_LIVE_WORDS_ENABLED', 'true');
        face({ liveWords: 'आज पाच मजूर होते' });
        expect(screen.getByTestId('sathi-words-strip')).toHaveTextContent('आज पाच मजूर होते');
    });

    it('one gentle buzz and one ring pulse per finished sentence; a count he arrived with does not buzz', () => {
        const { rerender } = face({ phrases: 2 });
        expect(light).not.toHaveBeenCalled();
        expect(screen.getByTestId('sathi-ring-pulse')).toHaveAttribute('data-pulse', '2');
        rerender({ phrases: 3 });
        expect(light).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('sathi-ring-pulse')).toHaveAttribute('data-pulse', '3');
        rerender({ phrases: 3, level: 0.5 });
        expect(light).toHaveBeenCalledTimes(1);
        rerender({ phrases: 4 });
        expect(light).toHaveBeenCalledTimes(2);
    });

    it('no sentence yet: no pulse drawn and no buzz', () => {
        face({ phrases: 0 });
        expect(screen.queryByTestId('sathi-ring-pulse')).not.toBeInTheDocument();
        expect(light).not.toHaveBeenCalled();
    });

    it('the board shows one of the shared 15 lines and turns after its reading time, never to the same line', () => {
        const random = vi.spyOn(Math, 'random').mockReturnValue(7 / 15 + 0.001);
        face();
        const first = screen.getByTestId('chalk-board-line');
        expect(first).toHaveAttribute('data-line', '7');
        expect(first).toHaveTextContent(BOARD_LINES[7]);
        // the next random pick is the same line: it moves on to the next one instead (no immediate repeat)
        advance(boardLineMs(7) - 1);
        expect(screen.getByTestId('chalk-board-line')).toHaveAttribute('data-line', '7');
        advance(1);
        expect(screen.getByTestId('chalk-board-line')).toHaveAttribute('data-line', '8');
        expect(screen.getByTestId('chalk-board-line')).toHaveTextContent(BOARD_LINES[8]);
        random.mockRestore();
    });

    it('the bottom is ONE centred group: clock, the 76 px stop, the label, then the cancel pill', () => {
        face();
        const bottom = screen.getByTestId('sathi-recording-bottom');
        expect(bottom).toHaveAttribute('data-layout', 'centred');
        expect(bottom.className).toContain('flex-col');
        expect(bottom.className).toContain('items-center');
        const order = [...bottom.children].map(c => c.getAttribute('data-testid'));
        expect(order).toEqual(['listening-hint-float', 'mic-clock', 'mic-stop', 'mic-stop-instruction', 'mic-cancel']);
        const stop = screen.getByTestId('mic-stop');
        expect(stop.style.width).toBe('76px');
        expect(stop.style.height).toBe('76px');
        expect(screen.getByTestId('mic-clock')).toHaveTextContent('00:08');
        expect(screen.getByTestId('mic-stop-instruction')).toHaveTextContent('झालं की थांबवा');
        expect(screen.getByTestId('mic-cancel')).toHaveTextContent('काही चुकीचे बोलले गेले असेल तर रद्द करा');
    });

    it('the stop and the cancel work', () => {
        const { props } = face();
        fireEvent.click(screen.getByTestId('mic-stop'));
        expect(props.onStop).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByTestId('mic-cancel'));
        expect(props.onCancel).toHaveBeenCalledTimes(1);
    });

    it('slice 1\'s quiet stop sits on the centred stop: the ring on it, its words under it, and it stops by itself', () => {
        const { props, rerender } = face({ level: 0.02 });
        rerender({ level: 0.3 });
        advance(1500);
        rerender({ level: 0.02 });
        advance(1000);
        const stop = screen.getByTestId('mic-stop');
        expect(stop).toContainElement(screen.getByTestId('mic-stop-quiet'));
        expect(screen.getByTestId('mic-stop-instruction')).toHaveTextContent('शांत आहे… आपोआप थांबतोय');
        expect(screen.getByTestId('listening-top-line')).toHaveTextContent('श्रम साथी तुमचं बोलणं ऐकून घेतोय');
        advance(2000);
        expect(props.onStop).toHaveBeenCalledTimes(1);
    });

    it('the silence hints still work, floating just above the group (before the stop, never over it)', () => {
        face({ level: 0.02 });
        advance(4100);
        expect(screen.getByTestId('mic-hint-coachOne')).toHaveTextContent(VOICE_FLOW_MR.coachOne);
        expect(screen.getByTestId('listening-hint-float')).toContainElement(screen.getByTestId('mic-hint-slot'));
        expect(screen.getByTestId('mic-hint-slot').compareDocumentPosition(screen.getByTestId('mic-stop')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('inside the voice layer the bottom group is the layer\'s bottom bar; the ring and the board are in the body', () => {
        render(<VoiceLayer step="mic"><RecorderFace isRecording seconds={3} level={0.2} onStart={vi.fn()} onStop={vi.fn()} onCancel={vi.fn()} flowV2={listening} /></VoiceLayer>);
        const bottom = screen.getByTestId('voice-layer-bottom');
        expect(bottom).toContainElement(screen.getByTestId('mic-stop'));
        expect(bottom).toContainElement(screen.getByTestId('mic-clock'));
        const body = screen.getByTestId('voice-layer-body');
        expect(body).toContainElement(screen.getByTestId('sathi-ring'));
        expect(body).toContainElement(screen.getByTestId('chalk-board'));
    });

    it('reduced motion: the calm still version (the icons hold one soft tint, nothing turns)', () => {
        const mm = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() });
        vi.stubGlobal('matchMedia', mm);
        face();
        expect(screen.getByTestId('sathi-ring')).toHaveAttribute('data-still', 'yes');
        const hl = screen.getByTestId('sathi-ring-work').querySelector<HTMLElement>('.sr-hl');
        expect(Number(hl?.style.opacity)).toBeCloseTo(0.24, 5);
        vi.unstubAllGlobals();
    });

    it('without `listening` (the ONE mic, the हजेरी door) the earlier v2 recording screen stays', () => {
        face({ flowV2: { silenceHelp: true, card: { armSeq: 0, placeLabel: () => 'द्राक्ष · प्लॉट १' } } });
        expect(screen.getByTestId('sathi-bubble')).toBeInTheDocument();
        expect(screen.queryByTestId('listening-top-line')).not.toBeInTheDocument();
        expect(screen.queryByTestId('chalk-board')).not.toBeInTheDocument();
    });
});
