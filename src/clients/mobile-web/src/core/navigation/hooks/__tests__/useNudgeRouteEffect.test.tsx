// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Task 7 (spec: dfes-companion-2026-07-11) — locks in the 'open-today'
 * routing gap fix: the morning "आजची कामे पाहा" nudge (web SW today, native
 * local notification once VITE_MORNING_NOTIFICATION ships) must land on
 * main/log and strip the `?nudge=` param, same as close-day/review-summary.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useNudgeRouteEffect } from '../useNudgeRouteEffect';

const baseProps = () => ({
    setCurrentRoute: vi.fn(),
    setMainView: vi.fn(),
    setShowCloseDaySummary: vi.fn(),
    setShowCloseYesterdaySummary: vi.fn(),
    setShowReviewInbox: vi.fn(),
    todayUnverifiedCount: 0,
});

describe('useNudgeRouteEffect', () => {
    beforeEach(() => {
        window.history.pushState({}, '', '/');
    });

    it('routes ?nudge=open-today to main/log and strips the param', () => {
        window.history.pushState({}, '', '/?nudge=open-today');
        const props = baseProps();

        renderHook(() => useNudgeRouteEffect(props));

        expect(props.setCurrentRoute).toHaveBeenCalledWith('main');
        expect(props.setMainView).toHaveBeenCalledWith('log');
        expect(props.setShowCloseDaySummary).not.toHaveBeenCalled();
        expect(props.setShowCloseYesterdaySummary).not.toHaveBeenCalled();
        expect(props.setShowReviewInbox).not.toHaveBeenCalled();
        expect(window.location.search).toBe('');
    });

    it('leaves an unrelated query param intact after stripping nudge', () => {
        window.history.pushState({}, '', '/?nudge=open-today&foo=bar');
        const props = baseProps();

        renderHook(() => useNudgeRouteEffect(props));

        expect(window.location.search).toBe('?foo=bar');
    });

    it('does nothing when there is no nudge param', () => {
        window.history.pushState({}, '', '/');
        const props = baseProps();

        renderHook(() => useNudgeRouteEffect(props));

        expect(props.setCurrentRoute).not.toHaveBeenCalled();
        expect(props.setMainView).not.toHaveBeenCalled();
    });

    it('still opens the close-day summary (regression guard)', () => {
        window.history.pushState({}, '', '/?nudge=close-day');
        const props = baseProps();

        renderHook(() => useNudgeRouteEffect(props));

        expect(props.setCurrentRoute).toHaveBeenCalledWith('main');
        expect(props.setMainView).toHaveBeenCalledWith('log');
        expect(props.setShowCloseDaySummary).toHaveBeenCalledWith(true);
    });
});
