/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 8 — extracted from AppRouter.tsx.
 *
 * Honors `?nudge=close-day|review-summary` query params: routes to log
 * view + opens the matching summary modal, then strips the param from
 * the URL so back/forward doesn't re-trigger.
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
