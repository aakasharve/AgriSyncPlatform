// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (Task 10, amendment M4) — the saved screen's bottom bar: the big round mic ("आणखी सांगा"), its clock
 * ticking in THIS leaf only (the screen above it is not re-rendered by it).
 * spec: plr-d10 (part 03, B6; the founder's final design, 28 Nov) — it waits his reading time (`waitMs`), the rule is not drawn on the
 * phone, and when the wait runs out the note "आजच्या शेतीचा आढावा बघा" stays 2.4 s before `onClose`; a touch or a scroll starts the
 * wait again.
 */
import '@testing-library/jest-dom/vitest';
import React, { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const { lng } = vi.hoisted(() => ({ lng: { v: 'mr' as 'mr' | 'en' } }));
vi.mock('../../../../../i18n/LanguageContext', async () => {
    const { t } = await import('../../../../../i18n/translations');
    const ctx = () => ({ language: lng.v, setLanguage: () => undefined, t: (k: string) => t(k, lng.v) });
    return { useLanguage: ctx, useOptionalLanguage: ctx };
});

import IdleCloseBar, { type IdleCloseBarProps } from '../IdleCloseBar';
import { MOVE_NOTE_MS } from '../readingTime';

const Host: React.FC<Omit<IdleCloseBarProps, 'rootRef'> & { onRender?: () => void }> = ({ onRender, ...p }) => {
    const root = useRef<HTMLDivElement>(null);
    onRender?.();
    return <div ref={root} data-testid="host"><IdleCloseBar {...p} rootRef={root} /></div>;
};

const base = (over: Partial<IdleCloseBarProps> = {}): Omit<IdleCloseBarProps, 'rootRef'> =>
    ({ waitMs: 8000, pauseReason: null, offReason: null, onClose: vi.fn(), onAddAnother: vi.fn(), ...over });
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const state = () => screen.getByTestId('vr2-idle-bar').getAttribute('data-state');

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-23T10:00:00.000Z')); });
afterEach(() => { cleanup(); vi.useRealTimers(); lng.v = 'mr'; });

describe('IdleCloseBar — the reading-time move', () => {
    it('draws no countdown on the phone: only the mic', () => {
        render(<Host {...base()} />);
        expect(state()).toBe('running');
        expect(screen.queryByTestId('vr2-idle-left')).toBeNull();
        expect(screen.getByTestId('vr2-idle-bar').textContent).toBe('आणखी सांगा');
        expect(screen.getByTestId('vr2-idle-bar').textContent).not.toMatch(/सेकंद/);
    });

    it('after the wait, the note "आजच्या शेतीचा आढावा बघा" stays 2.4 s, then it closes once', () => {
        const p = base({ waitMs: 8000 });
        render(<Host {...p} />);
        advance(7750);
        expect(screen.queryByTestId('vr2-move-note')).toBeNull();
        advance(500);
        const note = screen.getByTestId('vr2-move-note');
        expect(note).toHaveTextContent('आजच्या शेतीचा आढावा बघा');
        expect(state()).toBe('moving');
        expect(p.onClose).not.toHaveBeenCalled();
        advance(MOVE_NOTE_MS - 500);
        expect(p.onClose).not.toHaveBeenCalled();
        advance(750);
        expect(p.onClose).toHaveBeenCalledTimes(1);
        advance(60_000);
        expect(p.onClose).toHaveBeenCalledTimes(1);
    });

    it('a 20 s wait is 20 s: nothing at 19.5 s', () => {
        const p = base({ waitMs: 20_000 });
        render(<Host {...p} />);
        advance(19_500);
        expect(screen.queryByTestId('vr2-move-note')).toBeNull();
        advance(MOVE_NOTE_MS + 1000);
        expect(p.onClose).toHaveBeenCalledTimes(1);
    });

    it('his touch starts the wait again', () => {
        const p = base({ waitMs: 8000 });
        render(<Host {...p} />);
        advance(6000);
        fireEvent.pointerDown(screen.getByTestId('host'));
        advance(7500);
        expect(screen.queryByTestId('vr2-move-note')).toBeNull();
        advance(1000 + MOVE_NOTE_MS);
        expect(p.onClose).toHaveBeenCalledTimes(1);
    });

    it('a scroll of the screen starts the wait again', () => {
        const p = base({ waitMs: 8000 });
        render(<Host {...p} />);
        advance(6000);
        fireEvent.scroll(screen.getByTestId('host'));
        advance(7500);
        expect(screen.queryByTestId('vr2-move-note')).toBeNull();
        expect(p.onClose).not.toHaveBeenCalled();
    });

    it('a scroll somewhere else (not this screen, not what holds it) does not', () => {
        const p = base({ waitMs: 8000 });
        const elsewhere = document.createElement('div');
        document.body.appendChild(elsewhere);
        render(<Host {...p} />);
        advance(6000);
        fireEvent.scroll(elsewhere);
        advance(2500);
        expect(screen.getByTestId('vr2-move-note')).toBeTruthy();
        elsewhere.remove();
    });

    it('paused: no note and no close; "paused" on its state', () => {
        const p = base({ pauseReason: 'product' });
        render(<Host {...p} />);
        advance(60_000);
        expect(state()).toBe('paused');
        expect(screen.queryByTestId('vr2-move-note')).toBeNull();
        expect(p.onClose).not.toHaveBeenCalled();
    });

    it('the big mic calls onAddAnother', () => {
        const p = base();
        render(<Host {...p} />);
        const mic = screen.getByTestId('vr2-add-another');
        expect(mic.getAttribute('aria-label')).toBe('आणखी सांगा');
        fireEvent.click(mic);
        expect(p.onAddAnother).toHaveBeenCalledTimes(1);
    });

    it('the screen above it is not re-rendered by the clock', () => {
        const p = base();
        const onRender = vi.fn();
        render(<Host {...p} onRender={onRender} />);
        const renders = onRender.mock.calls.length;
        advance(31_000);
        expect(p.onClose).toHaveBeenCalledTimes(1);
        expect(onRender.mock.calls.length).toBe(renders);
    });

    it('off (a reason given): no move, no note, the mic stays', () => {
        const p = base({ offReason: 'not_queued' });
        render(<Host {...p} />);
        advance(120_000);
        expect(p.onClose).not.toHaveBeenCalled();
        expect(screen.queryByTestId('vr2-move-note')).toBeNull();
        expect(state()).toBe('off');
        expect(screen.getByTestId('vr2-add-another')).toBeTruthy();
    });

    it('turned off during the note: the move does not happen', () => {
        const p = base({ waitMs: 5000 });
        const view = render(<Host {...p} />);
        advance(5250);
        expect(screen.getByTestId('vr2-move-note')).toBeTruthy();
        view.rerender(<Host {...p} offReason="needs_fix" />);
        advance(MOVE_NOTE_MS + 1000);
        expect(screen.queryByTestId('vr2-move-note')).toBeNull();
        expect(p.onClose).not.toHaveBeenCalled();
    });

    it('English mode: the note in English', () => {
        lng.v = 'en';
        render(<Host {...base({ waitMs: 5000 })} />);
        advance(5250);
        expect(screen.getByTestId('vr2-move-note')).toHaveTextContent('See today\'s farm review');
    });
});
