// spec: 2026-07-13-labour-attendance-approval-design (Task 3.6)
// @vitest-environment jsdom
//
// Arriving at the log page with logIntent === 'labour' must auto-scroll the
// labour banner ([data-testid="labour-log-banner"], mainView.tsx) into view
// so the farmer never has to manually scroll past the weather card / Daily
// Closure / Running Cost card to reach the crop/plot picker. A normal visit
// (logIntent === null) must be a complete no-op — no scrollIntoView call at
// all, whether or not the banner element happens to be present.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useLabourLogArrivalScroll } from '../useLabourLogArrivalScroll';
import type { AppRoute, PageView } from '../../../../types';
import type { LogIntent } from '../../../../app/hooks/useAppNavigation';

function mockMatchMedia(reducedMotion: boolean) {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: reducedMotion && query.includes('prefers-reduced-motion'),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    })) as unknown as typeof window.matchMedia;
}

function addBanner(): HTMLButtonElement {
    const el = document.createElement('button');
    el.setAttribute('data-testid', 'labour-log-banner');
    document.body.appendChild(el);
    return el;
}

describe('useLabourLogArrivalScroll', () => {
    let scrollIntoViewSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        document.body.innerHTML = '';
        scrollIntoViewSpy = vi.fn();
        // jsdom does not implement scrollIntoView at all.
        Element.prototype.scrollIntoView = scrollIntoViewSpy as unknown as typeof Element.prototype.scrollIntoView;
        mockMatchMedia(false);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('scrolls the labour banner into view (block: start, smooth) when arriving with logIntent "labour"', async () => {
        addBanner();

        renderHook(
            ({ currentRoute, mainView, logIntent }) =>
                useLabourLogArrivalScroll({ currentRoute, mainView, logIntent }),
            {
                initialProps: {
                    currentRoute: 'main' as AppRoute,
                    mainView: 'log' as PageView,
                    logIntent: 'labour' as LogIntent,
                },
            },
        );

        await waitFor(() => expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1));
        expect(scrollIntoViewSpy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    });

    it('uses instant scroll (behavior: auto) when prefers-reduced-motion is set', async () => {
        addBanner();
        mockMatchMedia(true);

        renderHook(() => useLabourLogArrivalScroll({
            currentRoute: 'main',
            mainView: 'log',
            logIntent: 'labour',
        }));

        await waitFor(() => expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1));
        expect(scrollIntoViewSpy).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' });
    });

    it('polls (via requestAnimationFrame) until the banner mounts, instead of giving up immediately', async () => {
        // Banner not present on first frame — simulates the log view still
        // being behind AppRouter's shared Suspense fallback.
        renderHook(() => useLabourLogArrivalScroll({
            currentRoute: 'main',
            mainView: 'log',
            logIntent: 'labour',
        }));

        expect(scrollIntoViewSpy).not.toHaveBeenCalled();

        // Banner mounts a few frames later.
        addBanner();

        await waitFor(() => expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1));
    });

    it('does NOT scroll on a normal visit (logIntent === null), even though the anchor exists', async () => {
        addBanner();

        renderHook(() => useLabourLogArrivalScroll({
            currentRoute: 'main',
            mainView: 'log',
            logIntent: null,
        }));

        // Give any (incorrect) rAF polling a chance to fire before asserting
        // the negative.
        await new Promise((resolve) => window.requestAnimationFrame(resolve));
        await new Promise((resolve) => window.requestAnimationFrame(resolve));

        expect(scrollIntoViewSpy).not.toHaveBeenCalled();
    });

    it('does NOT scroll when not on the main/log route, even with logIntent "labour"', async () => {
        addBanner();

        renderHook(() => useLabourLogArrivalScroll({
            currentRoute: 'profile',
            mainView: 'log',
            logIntent: 'labour',
        }));

        await new Promise((resolve) => window.requestAnimationFrame(resolve));
        await new Promise((resolve) => window.requestAnimationFrame(resolve));

        expect(scrollIntoViewSpy).not.toHaveBeenCalled();
    });

    it('fires once per arrival — an unrelated rerender with the same route/view/intent does not re-scroll', async () => {
        addBanner();

        const { rerender } = renderHook(
            ({ currentRoute, mainView, logIntent }) =>
                useLabourLogArrivalScroll({ currentRoute, mainView, logIntent }),
            {
                initialProps: {
                    currentRoute: 'main' as AppRoute,
                    mainView: 'log' as PageView,
                    logIntent: 'labour' as LogIntent,
                },
            },
        );

        await waitFor(() => expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1));

        // Same three values — simulates an unrelated re-render (e.g. voice
        // status or weather data changing elsewhere in AppRouter).
        rerender({ currentRoute: 'main', mainView: 'log', logIntent: 'labour' });

        await new Promise((resolve) => window.requestAnimationFrame(resolve));
        expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1);
    });

    it('fires again on a genuine re-arrival (leaving and re-entering the log view while still in labour intent)', async () => {
        addBanner();

        const { rerender } = renderHook(
            ({ currentRoute, mainView, logIntent }) =>
                useLabourLogArrivalScroll({ currentRoute, mainView, logIntent }),
            {
                initialProps: {
                    currentRoute: 'main' as AppRoute,
                    mainView: 'log' as PageView,
                    logIntent: 'labour' as LogIntent,
                },
            },
        );

        await waitFor(() => expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1));

        rerender({ currentRoute: 'main', mainView: 'reflect', logIntent: 'labour' });
        rerender({ currentRoute: 'main', mainView: 'log', logIntent: 'labour' });

        await waitFor(() => expect(scrollIntoViewSpy).toHaveBeenCalledTimes(2));
    });
});
