/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sub-plan 04 Task 8 — extracted from AppRouter.tsx.
 *
 * Honors `?nudge=close-day|review-summary` and strips the param from the URL
 * so back/forward cannot re-trigger it.
 *
 * THESE NUDGES ARE LIVE, NOT LEGACY (finding F3 — verified, not assumed).
 * `shared/services/NotificationService.ts:137` schedules a daily 19:00
 * notification whose `data.url` is `/?nudge=close-day`, and `public/sw.js`
 * (`notificationclick`, lines 136-144) turns its two action buttons into
 * `/?nudge=review-summary` and `/?nudge=close-day`. So whatever this hook
 * does IS what a farmer sees after tapping a notification.
 *
 * WHERE THEY LAND, AND WHY (finding F3)
 * --------------------------------------
 * Until this fix both branches wrote `showCloseDaySummary` /
 * `showCloseYesterdaySummary` — two booleans that NO component read any more.
 * Commit `0e4ad118` deleted their only readers from `mainView.tsx` when the
 * Daily Closure card and the yesterday-not-closed block moved into the
 * waiting drawer (spec §4.2's own table). Tapping the notification therefore
 * routed the farmer to the log screen and did nothing else.
 *
 *   close-day      -> the waiting drawer. Spec §4.2 routes the whole Daily
 *                     Closure card ("Day Not Closed", Close Day, task
 *                     counts, "Pending approvals: N") there, and the drawer
 *                     already renders those as real rows off real data.
 *                     Dispatched, not called: the drawer is owned by
 *                     `AppHeader`, outside this provider tree — see
 *                     `features/oversight/oversightNavigationEvents.ts`.
 *   review-summary -> the Reflect view. That is exactly where the deleted
 *                     block's own "Review summary" button went
 *                     (`setMainView('reflect')`, `mainView.tsx` before
 *                     `0e4ad118`) — the same destination, not a new one.
 *
 * `close-day` no longer force-opens the review inbox on top of the log
 * screen. The approvals count reaches the owner as the drawer's `approval`
 * row instead, which opens that same inbox on tap — one surface, in the
 * spec's own "decisions above information" order, rather than two overlays
 * racing to the front.
 *
 * Any other nudge value (e.g. `open-today`, also produced by `sw.js`) keeps
 * the pre-existing behaviour: route to the log screen and nothing more.
 */

import React from 'react';
import type { AppRoute, PageView } from '../../../types';
import { requestOpenWaitingDrawer } from '../../../features/oversight/oversightNavigationEvents';

interface UseNudgeRouteEffectInput {
    setCurrentRoute: (route: AppRoute) => void;
    setMainView: (view: PageView) => void;
}

export function useNudgeRouteEffect({
    setCurrentRoute,
    setMainView,
}: UseNudgeRouteEffectInput): void {
    React.useEffect(() => {
        if (typeof window === 'undefined') return;
        const params = new URLSearchParams(window.location.search);
        const nudge = params.get('nudge');
        if (!nudge) return;

        setCurrentRoute('main');
        setMainView(nudge === 'review-summary' ? 'reflect' : 'log');

        if (nudge === 'close-day') {
            requestOpenWaitingDrawer();
        }

        if (nudge === 'open-today') {
            // No additional modal — arriving on main/log (set above) is the
            // entire "open today" action.
        }

        params.delete('nudge');
        const nextQuery = params.toString();
        const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}`;
        window.history.replaceState({}, '', nextUrl);
    }, [setCurrentRoute, setMainView]);
}
