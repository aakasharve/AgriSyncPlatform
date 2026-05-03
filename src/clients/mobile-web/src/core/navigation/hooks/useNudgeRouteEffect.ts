/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * T-IGH-04-XSTATE-NAV — nudge replay flows through the navigation actor.
 *
 * Honors `?nudge=close-day|review-summary` query params: subscribes to the
 * actor's `pendingNudge` selector, opens the matching summary modal when a
 * nudge is present, then `NUDGE_CONSUMED`s the actor + strips the param from
 * the URL so back/forward doesn't re-trigger.
 *
 * On bootstrap the RootStore seeds the actor with `initialNudge` derived from
 * `window.location.search`, so a cold deep-link arrives as a `pendingNudge`
 * we react to here. Subsequent in-app `DEEP_LINK_REPLAY` events (e.g. push
 * notifications) follow the same path.
 */

import React from 'react';
import { useSelector } from '@xstate/react';
import type { AppRoute, PageView } from '../../../types';
import { getRootStore } from '../../../app/state/RootStore';
import { selectPendingNudge } from '../../../app/state/machines/navigationMachine';

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
    const navigation = getRootStore().navigation;
    const pendingNudge = useSelector(navigation, selectPendingNudge);

    React.useEffect(() => {
        if (!pendingNudge) return;
        if (typeof window === 'undefined') return;

        setCurrentRoute('main');
        setMainView('log');

        if (pendingNudge === 'close-day') {
            setShowCloseDaySummary(true);
            if (todayUnverifiedCount > 0) {
                setShowReviewInbox(true);
            }
        }

        if (pendingNudge === 'review-summary') {
            setShowCloseYesterdaySummary(true);
        }

        navigation.send({ type: 'NUDGE_CONSUMED' });

        const params = new URLSearchParams(window.location.search);
        if (params.has('nudge')) {
            params.delete('nudge');
            const nextQuery = params.toString();
            const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}`;
            window.history.replaceState({}, '', nextUrl);
        }
    }, [
        navigation,
        pendingNudge,
        setCurrentRoute,
        setMainView,
        setShowCloseDaySummary,
        setShowCloseYesterdaySummary,
        setShowReviewInbox,
        todayUnverifiedCount,
    ]);
}
