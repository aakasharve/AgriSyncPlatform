// @vitest-environment jsdom
//
// spec: dfes-truthful-number-and-merge-readiness-2026-08-13 (task-11, BUG 2 cause 3)
//
// useSavedSurfaceScrollReset — the farmer must LAND on the post-save surface,
// not somewhere in its middle.
//
// Measured before the fix: after a save the single scroll container
// (`main.page-content`) kept its recording-time offset, so the farmer opened
// the success card 591px down at 390x844 — past श्रम साथी, past the /10 and its
// bar. Pinned here:
//   • entering 'success' resets the container to the top;
//   • it fires on the EDGE only — a farmer who scrolls down to read the
//     question is not yanked back by the surface's own async re-renders;
//   • prefers-reduced-motion collapses the movement to an instant set;
//   • a mount that is ALREADY in 'success' is not a fresh save.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSavedSurfaceScrollReset } from '../useSavedSurfaceScrollReset';
import type { AppStatus } from '../../../domain/types/farm.types';

/** jsdom leaves Element.prototype.scrollTo undefined; add a spy-able one. */
function makeContainer(scrollTop: number): {
    el: HTMLElement;
    scrollTo: ReturnType<typeof vi.fn>;
} {
    const el = document.createElement('main');
    const scrollTo = vi.fn((opts: ScrollToOptions) => {
        el.scrollTop = opts.top ?? 0;
    });
    Object.defineProperty(el, 'scrollTo', { value: scrollTo, writable: true });
    el.scrollTop = scrollTop;
    return { el, scrollTo };
}

function setReducedMotion(reduce: boolean): void {
    Object.defineProperty(window, 'matchMedia', {
        writable: true,
        configurable: true,
        value: (query: string) => ({
            matches: reduce && query.includes('prefers-reduced-motion'),
            media: query,
            onchange: null,
            addListener: () => {},
            removeListener: () => {},
            addEventListener: () => {},
            removeEventListener: () => {},
            dispatchEvent: () => false,
        }),
    });
}

beforeEach(() => {
    setReducedMotion(false);
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('useSavedSurfaceScrollReset', () => {
    it('puts the farmer at the top when a save lands (processing -> success)', () => {
        const { el, scrollTo } = makeContainer(591);
        const ref = { current: el };

        const { rerender } = renderHook(
            ({ status }: { status: AppStatus }) => useSavedSurfaceScrollReset(ref, status),
            { initialProps: { status: 'processing' as AppStatus } },
        );
        expect(scrollTo).not.toHaveBeenCalled();
        expect(el.scrollTop).toBe(591);

        rerender({ status: 'success' as AppStatus });

        expect(scrollTo).toHaveBeenCalledTimes(1);
        expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
        expect(el.scrollTop).toBe(0);
    });

    it('does NOT fight a farmer who scrolls down to read: no reset on later renders', () => {
        const { el, scrollTo } = makeContainer(591);
        const ref = { current: el };

        const { rerender } = renderHook(
            ({ status }: { status: AppStatus }) => useSavedSurfaceScrollReset(ref, status),
            { initialProps: { status: 'processing' as AppStatus } },
        );
        rerender({ status: 'success' as AppStatus });
        expect(scrollTo).toHaveBeenCalledTimes(1);

        // The farmer deliberately scrolls down to the question card, and the
        // surface re-renders as its async parts (score, engagement) land.
        el.scrollTop = 420;
        rerender({ status: 'success' as AppStatus });
        rerender({ status: 'success' as AppStatus });

        expect(scrollTo).toHaveBeenCalledTimes(1);
        expect(el.scrollTop).toBe(420);
    });

    it('resets again on the NEXT save (success -> idle -> success)', () => {
        const { el, scrollTo } = makeContainer(0);
        const ref = { current: el };

        const { rerender } = renderHook(
            ({ status }: { status: AppStatus }) => useSavedSurfaceScrollReset(ref, status),
            { initialProps: { status: 'processing' as AppStatus } },
        );
        rerender({ status: 'success' as AppStatus });
        rerender({ status: 'idle' as AppStatus });
        el.scrollTop = 700;
        rerender({ status: 'processing' as AppStatus });
        rerender({ status: 'success' as AppStatus });

        expect(scrollTo).toHaveBeenCalledTimes(2);
        expect(el.scrollTop).toBe(0);
    });

    it('jumps instantly, with no smooth animation, under prefers-reduced-motion', () => {
        setReducedMotion(true);
        const { el, scrollTo } = makeContainer(709);
        const ref = { current: el };

        const { rerender } = renderHook(
            ({ status }: { status: AppStatus }) => useSavedSurfaceScrollReset(ref, status),
            { initialProps: { status: 'processing' as AppStatus } },
        );
        rerender({ status: 'success' as AppStatus });

        expect(scrollTo).not.toHaveBeenCalled();
        expect(el.scrollTop).toBe(0);
    });

    it('treats a remount already in success as mid-surface, not a fresh save', () => {
        const { el, scrollTo } = makeContainer(591);
        const ref = { current: el };

        renderHook(
            ({ status }: { status: AppStatus }) => useSavedSurfaceScrollReset(ref, status),
            { initialProps: { status: 'success' as AppStatus } },
        );

        expect(scrollTo).not.toHaveBeenCalled();
        expect(el.scrollTop).toBe(591);
    });

    it('is a no-op when the scroll container is not mounted', () => {
        const ref: { current: HTMLElement | null } = { current: null };

        const { rerender } = renderHook(
            ({ status }: { status: AppStatus }) => useSavedSurfaceScrollReset(ref, status),
            { initialProps: { status: 'processing' as AppStatus } },
        );

        expect(() => rerender({ status: 'success' as AppStatus })).not.toThrow();
    });
});
