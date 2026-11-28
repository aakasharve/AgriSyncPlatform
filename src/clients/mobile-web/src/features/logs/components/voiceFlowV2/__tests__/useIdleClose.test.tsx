// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (Task 10, amendments H3 / M4) — the saved screen's self-close clock. Deadline-based
 * (the phone may sleep), reset by his touch (pointer, touch, key, focus), frozen while something is open or a
 * clip plays or the page is hidden (and it starts again from 30), and off entirely when the caller says so.
 * spec: plr-d10 (part 03, B6) — a scroll resets it too (the founder: "any touch or scroll restarts the wait"); `totalMs` sets the
 * wait; `noteMs` holds a note up before the close, timed by the same deadline check.
 */
import React, { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useIdleClose, type IdleCloseOptions } from '../useIdleClose';

type HarnessProps = Omit<IdleCloseOptions, 'rootRef'>;
const Harness: React.FC<HarnessProps> = (p) => {
    const root = useRef<HTMLDivElement>(null);
    const { secondsLeft, paused, noting } = useIdleClose({ ...p, rootRef: root });
    return (
        <div ref={root} data-testid="root">
            <button type="button" data-testid="inside">x</button>
            <span data-testid="left">{secondsLeft}</span>
            <span data-testid="paused">{paused ? 'yes' : 'no'}</span>
            <span data-testid="noting">{noting ? 'yes' : 'no'}</span>
        </div>
    );
};

let hidden = false;
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-23T10:00:00.000Z'));
    hidden = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('useIdleClose — the 30 s clock', () => {
    it('closes once at 30 s, never again', () => {
        const onClose = vi.fn();
        render(<Harness pauseReason={null} onClose={onClose} />);
        advance(29_700);
        expect(onClose).not.toHaveBeenCalled();
        advance(600);
        expect(onClose).toHaveBeenCalledTimes(1);
        advance(60_000);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('counts down in whole seconds', () => {
        render(<Harness pauseReason={null} onClose={vi.fn()} />);
        expect(screen.getByTestId('left').textContent).toBe('30');
        advance(10_000);
        expect(screen.getByTestId('left').textContent).toBe('20');
    });

    it('a pointerdown at 20 s pushes the close to 50 s', () => {
        const onClose = vi.fn();
        render(<Harness pauseReason={null} onClose={onClose} />);
        advance(20_000);
        fireEvent.pointerDown(screen.getByTestId('inside'));
        expect(screen.getByTestId('left').textContent).toBe('30');
        advance(29_700);
        expect(onClose).not.toHaveBeenCalled();
        advance(600);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('a key, a touch, a focus, a wheel and a scroll reset it too (B6: "any touch or scroll restarts the wait")', () => {
        const onClose = vi.fn();
        render(<Harness pauseReason={null} onClose={onClose} />);
        advance(20_000);
        fireEvent.keyDown(screen.getByTestId('inside'), { key: 'a' });
        expect(screen.getByTestId('left').textContent).toBe('30');
        advance(10_000);
        fireEvent.touchStart(screen.getByTestId('inside'));
        expect(screen.getByTestId('left').textContent).toBe('30');
        advance(10_000);
        fireEvent.focusIn(screen.getByTestId('inside'));
        expect(screen.getByTestId('left').textContent).toBe('30');
        advance(10_000);
        fireEvent.wheel(screen.getByTestId('inside'), { deltaY: 40 });
        expect(screen.getByTestId('left').textContent).toBe('30');
        advance(10_000);
        fireEvent.scroll(screen.getByTestId('root'));
        expect(screen.getByTestId('left').textContent).toBe('30');
        advance(29_500);
        expect(onClose).not.toHaveBeenCalled();
    });

    it('a scroll of what holds the screen (the layer\'s body) resets it; a scroll elsewhere does not', () => {
        const onClose = vi.fn();
        const holder = document.createElement('div');
        const elsewhere = document.createElement('div');
        document.body.append(holder, elsewhere);
        render(<Harness pauseReason={null} onClose={onClose} />, { container: holder });
        advance(20_000);
        fireEvent.scroll(holder);
        expect(screen.getByTestId('left').textContent).toBe('30');
        advance(10_000);
        fireEvent.scroll(elsewhere);
        expect(screen.getByTestId('left').textContent).toBe('20');
        holder.remove();
        elsewhere.remove();
    });

    it('totalMs sets the wait; noteMs holds the note up before the close', () => {
        const onClose = vi.fn();
        render(<Harness pauseReason={null} totalMs={6400} noteMs={2400} onClose={onClose} />);
        expect(screen.getByTestId('left').textContent).toBe('7');
        advance(6250);
        expect(screen.getByTestId('noting').textContent).toBe('no');
        advance(250);
        expect(screen.getByTestId('noting').textContent).toBe('yes');
        // during the note a touch does not hold the move: it was announced
        fireEvent.pointerDown(screen.getByTestId('inside'));
        advance(2250);
        expect(onClose).not.toHaveBeenCalled();
        advance(250);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('paused from 10 s to 40 s closes at 70 s (it starts again from 30)', () => {
        const onClose = vi.fn();
        const view = render(<Harness pauseReason={null} onClose={onClose} />);
        advance(10_000);
        view.rerender(<Harness pauseReason="clip" onClose={onClose} />);
        advance(250);
        expect(screen.getByTestId('paused').textContent).toBe('yes');
        advance(29_750);
        expect(onClose).not.toHaveBeenCalled();
        view.rerender(<Harness pauseReason={null} onClose={onClose} />);
        advance(29_500);
        expect(onClose).not.toHaveBeenCalled();
        expect(screen.getByTestId('paused').textContent).toBe('no');
        advance(1_000);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('an open overlay (polled) pauses it, and it starts again from 30 when the overlay closes', () => {
        const onClose = vi.fn();
        let overlay = true;
        render(<Harness pauseReason={null} overlayOpen={() => overlay} onClose={onClose} />);
        advance(60_000);
        expect(onClose).not.toHaveBeenCalled();
        expect(screen.getByTestId('paused').textContent).toBe('yes');
        overlay = false;
        advance(29_000);
        expect(onClose).not.toHaveBeenCalled();
        advance(1_500);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('hidden for 60 s, then visible: does not close on return, closes 30 s later', () => {
        const onClose = vi.fn();
        render(<Harness pauseReason={null} onClose={onClose} />);
        advance(5_000);
        hidden = true;
        advance(60_000);
        hidden = false;
        advance(500);
        expect(onClose).not.toHaveBeenCalled();
        advance(29_000);
        expect(onClose).not.toHaveBeenCalled();
        advance(1_000);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('unmounted before 30 s: never closes', () => {
        const onClose = vi.fn();
        const view = render(<Harness pauseReason={null} onClose={onClose} />);
        advance(15_000);
        view.unmount();
        advance(60_000);
        expect(onClose).not.toHaveBeenCalled();
    });

    it('disabled: no auto-close at all', () => {
        const onClose = vi.fn();
        render(<Harness pauseReason={null} disabled onClose={onClose} />);
        advance(120_000);
        expect(onClose).not.toHaveBeenCalled();
        expect(screen.getByTestId('left').textContent).toBe('30');
    });
});
