// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop (Task 14, change 5)
 *
 * Pins `MainViewTransition`'s slide direction and swipe gesture — the fix
 * for the founder's "movement UI" complaint: Log/Reflect/Compare used to
 * hard-swap with no motion; every other route in this app already slides.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../../../shared/utils/haptics', () => ({
    hapticFeedback: {
        light: vi.fn(),
        medium: vi.fn(),
        heavy: vi.fn(),
        success: vi.fn(),
        error: vi.fn(),
    },
}));

import { hapticFeedback } from '../../../shared/utils/haptics';
import MainViewTransition from '../MainViewTransition';

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

function touchPoint(x: number, y: number) {
    return { clientX: x, clientY: y } as Touch;
}

function fireSwipe(el: HTMLElement, from: [number, number], to: [number, number]) {
    fireEvent.touchStart(el, { touches: [touchPoint(...from)] });
    fireEvent.touchMove(el, { touches: [touchPoint(...to)] });
    fireEvent.touchEnd(el, { changedTouches: [touchPoint(...to)] });
}

describe('MainViewTransition — slide direction reflects travel', () => {
    it('moving to a higher-index view (log -> reflect) slides in from the right', () => {
        const { rerender } = render(
            <MainViewTransition view="log" onChangeView={vi.fn()} disabled={false}>
                <div>content</div>
            </MainViewTransition>,
        );
        rerender(
            <MainViewTransition view="reflect" onChangeView={vi.fn()} disabled={false}>
                <div>content</div>
            </MainViewTransition>,
        );

        const inner = screen.getByTestId('main-view-transition').firstElementChild as HTMLElement;
        expect(inner.className).toContain('slide-in-from-right-4');
    });

    it('moving to a lower-index view (compare -> log) slides in from the left', () => {
        const { rerender } = render(
            <MainViewTransition view="compare" onChangeView={vi.fn()} disabled={false}>
                <div>content</div>
            </MainViewTransition>,
        );
        rerender(
            <MainViewTransition view="log" onChangeView={vi.fn()} disabled={false}>
                <div>content</div>
            </MainViewTransition>,
        );

        const inner = screen.getByTestId('main-view-transition').firstElementChild as HTMLElement;
        expect(inner.className).toContain('slide-in-from-left-4');
    });

    it('the initial mount carries no directional slide class', () => {
        render(
            <MainViewTransition view="reflect" onChangeView={vi.fn()} disabled={false}>
                <div>content</div>
            </MainViewTransition>,
        );
        const inner = screen.getByTestId('main-view-transition').firstElementChild as HTMLElement;
        expect(inner.className).not.toContain('slide-in-from-right-4');
        expect(inner.className).not.toContain('slide-in-from-left-4');
    });
});

describe('MainViewTransition — swipe gesture, in tab order', () => {
    it('a leftward swipe (finger travels right-to-left) advances to the next tab, with haptic feedback', () => {
        const onChangeView = vi.fn();
        render(
            <MainViewTransition view="log" onChangeView={onChangeView} disabled={false}>
                <div>content</div>
            </MainViewTransition>,
        );

        fireSwipe(screen.getByTestId('main-view-transition'), [300, 400], [200, 400]);

        expect(onChangeView).toHaveBeenCalledExactlyOnceWith('reflect');
        expect(hapticFeedback.medium).toHaveBeenCalledTimes(1);
    });

    it('a rightward swipe moves back to the previous tab', () => {
        const onChangeView = vi.fn();
        render(
            <MainViewTransition view="reflect" onChangeView={onChangeView} disabled={false}>
                <div>content</div>
            </MainViewTransition>,
        );

        fireSwipe(screen.getByTestId('main-view-transition'), [200, 400], [300, 400]);

        expect(onChangeView).toHaveBeenCalledExactlyOnceWith('log');
    });

    it('does not advance past the last tab', () => {
        const onChangeView = vi.fn();
        render(
            <MainViewTransition view="compare" onChangeView={onChangeView} disabled={false}>
                <div>content</div>
            </MainViewTransition>,
        );

        fireSwipe(screen.getByTestId('main-view-transition'), [300, 400], [180, 400]);

        expect(onChangeView).not.toHaveBeenCalled();
    });

    it('does not move back past the first tab', () => {
        const onChangeView = vi.fn();
        render(
            <MainViewTransition view="log" onChangeView={onChangeView} disabled={false}>
                <div>content</div>
            </MainViewTransition>,
        );

        fireSwipe(screen.getByTestId('main-view-transition'), [180, 400], [300, 400]);

        expect(onChangeView).not.toHaveBeenCalled();
    });

    it('ignores a swipe below the distance threshold', () => {
        const onChangeView = vi.fn();
        render(
            <MainViewTransition view="log" onChangeView={onChangeView} disabled={false}>
                <div>content</div>
            </MainViewTransition>,
        );

        fireSwipe(screen.getByTestId('main-view-transition'), [300, 400], [280, 400]);

        expect(onChangeView).not.toHaveBeenCalled();
    });

    it('ignores a vertical-dominant gesture — never fights normal scrolling', () => {
        const onChangeView = vi.fn();
        render(
            <MainViewTransition view="log" onChangeView={onChangeView} disabled={false}>
                <div>content</div>
            </MainViewTransition>,
        );

        fireSwipe(screen.getByTestId('main-view-transition'), [300, 400], [260, 700]);

        expect(onChangeView).not.toHaveBeenCalled();
    });

    it('ignores a gesture that starts inside the horizontally-scrolling crop carousel', () => {
        const onChangeView = vi.fn();
        render(
            <MainViewTransition view="log" onChangeView={onChangeView} disabled={false}>
                <div className="overflow-x-auto">
                    <div data-testid="carousel-card">card</div>
                </div>
            </MainViewTransition>,
        );

        fireSwipe(screen.getByTestId('carousel-card'), [300, 400], [180, 400]);

        expect(onChangeView).not.toHaveBeenCalled();
    });
});

/**
 * F4 — swiping during recording used to destroy the recording.
 *
 * `renderLogView` (`core/navigation/mainView.tsx`) returns `null` the moment
 * `mainView !== 'log'`, so a swipe-driven `onChangeView` unmounts
 * `AudioRecorder` and with it the live `MediaRecorder`. The TAP path was
 * already gated on `AppContent.tsx`'s `disabled`; this is the swipe path's
 * equivalent, fed by the SAME `isRecordingPathBusy` predicate so the two
 * cannot drift (spec §P-I, "the recording path stays sacred").
 */
describe('MainViewTransition — the recording path is sacred (spec §P-I)', () => {
    it('refuses a swipe while the recording path is busy', () => {
        const onChangeView = vi.fn();
        render(
            <MainViewTransition view="log" onChangeView={onChangeView} disabled={true}>
                <div>content</div>
            </MainViewTransition>,
        );

        // The exact gesture that DOES change the view when idle (see the
        // sibling test below) — only `disabled` differs.
        fireSwipe(screen.getByTestId('main-view-transition'), [300, 400], [200, 400]);

        expect(onChangeView).not.toHaveBeenCalled();
        // No haptic either: a refused swipe must not feel like an accepted one.
        expect(hapticFeedback.medium).not.toHaveBeenCalled();
    });

    it('allows that same swipe once the recording path is idle', () => {
        const onChangeView = vi.fn();
        render(
            <MainViewTransition view="log" onChangeView={onChangeView} disabled={false}>
                <div>content</div>
            </MainViewTransition>,
        );

        fireSwipe(screen.getByTestId('main-view-transition'), [300, 400], [200, 400]);

        expect(onChangeView).toHaveBeenCalledExactlyOnceWith('reflect');
    });

    it('refuses a backward swipe while busy too — the guard is not direction-specific', () => {
        const onChangeView = vi.fn();
        render(
            <MainViewTransition view="reflect" onChangeView={onChangeView} disabled={true}>
                <div>content</div>
            </MainViewTransition>,
        );

        fireSwipe(screen.getByTestId('main-view-transition'), [200, 400], [300, 400]);

        expect(onChangeView).not.toHaveBeenCalled();
    });
});
