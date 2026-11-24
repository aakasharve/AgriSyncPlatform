// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (Task 10, amendment M4) — the saved screen's bottom bar: the big round mic ("आणखी सांगा") and
 * the 30-second close, its clock ticking in THIS leaf only (the screen above it is not re-rendered every second).
 */
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

const Host: React.FC<Omit<IdleCloseBarProps, 'rootRef'> & { onRender?: () => void }> = ({ onRender, ...p }) => {
    const root = useRef<HTMLDivElement>(null);
    onRender?.();
    return <div ref={root}><IdleCloseBar {...p} rootRef={root} /></div>;
};

const base = (over: Partial<IdleCloseBarProps> = {}) => ({ pauseReason: null, offReason: null, onClose: vi.fn(), onAddAnother: vi.fn(), ...over });

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-23T10:00:00.000Z')); });
afterEach(() => { cleanup(); vi.useRealTimers(); lng.v = 'mr'; });

describe('IdleCloseBar', () => {
    it('says "३० सेकंदात बंद होईल" in Marathi digits, then counts down', () => {
        render(<Host {...base()} />);
        expect(screen.getByTestId('vr2-idle-left').textContent).toContain('३० सेकंदात बंद होईल');
        expect(screen.getByTestId('vr2-idle-left').textContent).toContain('काहीही दाबलं की वेळ परत ३० होईल');
        act(() => { vi.advanceTimersByTime(5_000); });
        expect(screen.getByTestId('vr2-idle-left').textContent).toContain('२५ सेकंदात बंद होईल');
        expect(screen.getByTestId('vr2-idle-bar').getAttribute('data-state')).toBe('running');
    });

    it('says "थांबवलं" while paused', () => {
        render(<Host {...base({ pauseReason: 'product' })} />);
        act(() => { vi.advanceTimersByTime(300); });
        expect(screen.getByTestId('vr2-idle-left').textContent).toContain('थांबवलं');
        expect(screen.getByTestId('vr2-idle-bar').getAttribute('data-state')).toBe('paused');
    });

    it('the big mic calls onAddAnother', () => {
        const p = base();
        render(<Host {...p} />);
        const mic = screen.getByTestId('vr2-add-another');
        expect(mic.getAttribute('aria-label')).toBe('आणखी सांगा');
        fireEvent.click(mic);
        expect(p.onAddAnother).toHaveBeenCalledTimes(1);
    });

    it('closes once at 30 s; the screen above it is not re-rendered by the clock', () => {
        const p = base();
        const onRender = vi.fn();
        render(<Host {...p} onRender={onRender} />);
        const renders = onRender.mock.calls.length;
        act(() => { vi.advanceTimersByTime(31_000); });
        expect(p.onClose).toHaveBeenCalledTimes(1);
        expect(onRender.mock.calls.length).toBe(renders);
    });

    it('off (a reason given): no countdown and no close, the mic stays', () => {
        const p = base({ offReason: 'not_queued' });
        render(<Host {...p} />);
        act(() => { vi.advanceTimersByTime(120_000); });
        expect(p.onClose).not.toHaveBeenCalled();
        expect(screen.queryByTestId('vr2-idle-left')).toBeNull();
        expect(screen.getByTestId('vr2-idle-bar').getAttribute('data-state')).toBe('off');
        expect(screen.getByTestId('vr2-add-another')).toBeTruthy();
    });

    it('English mode: English words', () => {
        lng.v = 'en';
        render(<Host {...base()} />);
        expect(screen.getByTestId('vr2-idle-left').textContent).toContain('Closes in 30 seconds');
    });
});
