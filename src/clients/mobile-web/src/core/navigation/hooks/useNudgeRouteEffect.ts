/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 8 — extracted from AppRouter.tsx.
 *
 * Honors `?nudge=close-day|review-summary|open-today` query params: routes
 * to log view (+ opens the matching summary modal for close-day/review-
 * summary), then strips the param from the URL so back/forward doesn't
 * re-trigger.
 *
 * Task 7 (spec: dfes-companion-2026-07-11) — 'open-today' is the morning
 * "आजची कामे पाहा" nudge (web SW today, native local notification once
 * VITE_MORNING_NOTIFICATION is on). It needs no extra modal: landing on
 * main/log (set unconditionally below for ANY known nudge) IS the whole
 * "open today" action. Kept as an explicit branch — matching close-day/
 * review-summary — so it reads as an intentionally-handled nudge and stays
 * in sync with navigationMachine's `isKnownNudge` allow-list.
 */

import React from 'react';
import type { AppRoute, PageView } from '../../../types';

interface UseNudgeRouteEffectInput {
    setCurrentRoute: (route: AppRoute) => void;
    setMainView: (view: PageView) => void;
    setShowCloseDaySummary: (open: boolean) => void;
    setShowCloseYesterdaySummary: (open: boolean) => void;
    setShowReviewInbox: (open: boolean) => void;
    todayUnverifiedCount: number;
}

export function useNudgeRouteEffect({
    setCurrentRoute,
    setMainView,
    setShowCloseDaySummary,
    setShowCloseYesterdaySummary,
    setShowReviewInbox,
    todayUnverifiedCount,
}: UseNudgeRouteEffectInput): void {
    React.useEffect(() => {
        if (typeof window === 'undefined') return;
        const params = new URLSearchParams(window.location.search);
        const nudge = params.get('nudge');
        if (!nudge) return;

        setCurrentRoute('main');
        setMainView('log');

        if (nudge === 'close-day') {
            setShowCloseDaySummary(true);
            if (todayUnverifiedCount > 0) {
                setShowReviewInbox(true);
            }
        }

        if (nudge === 'review-summary') {
            setShowCloseYesterdaySummary(true);
        }

        if (nudge === 'open-today') {
            // No additional modal — arriving on main/log (set above) is the
            // entire "open today" action.
        }

        params.delete('nudge');
        const nextQuery = params.toString();
        const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}`;
        window.history.replaceState({}, '', nextUrl);
    }, [
        setCurrentRoute,
        setMainView,
        setShowCloseDaySummary,
        setShowCloseYesterdaySummary,
        setShowReviewInbox,
        todayUnverifiedCount,
    ]);
}
