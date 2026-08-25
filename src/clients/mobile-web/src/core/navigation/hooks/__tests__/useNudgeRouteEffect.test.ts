// spec: owner-oversight-loop (finding F3)
// @vitest-environment jsdom
//
// The `?nudge=...` deep-links are LIVE: `shared/services/NotificationService.ts`
// schedules a 19:00 notification whose `data.url` is `/?nudge=close-day`, and
// `public/sw.js`'s `notificationclick` handler turns its two action buttons
// into `/?nudge=review-summary` and `/?nudge=close-day`. Before this fix both
// branches wrote `showCloseDaySummary` / `showCloseYesterdaySummary` — flags
// whose only readers commit `0e4ad118` deleted — so tapping the notification
// navigated to the log screen and then did nothing at all.
//
// These tests pin the two destinations, so a future edit that re-points them
// at another dead flag fails a NAMED test rather than a code review:
//
//   close_day_nudge_opens_the_waiting_drawer
//   review_summary_nudge_opens_the_reflect_view
//
// The waiting drawer is owned by `AppHeader`, outside this provider tree, so
// "opens it" is observable here exactly as production observes it: the
// `OPEN_WAITING_DRAWER_EVENT` window event `AppHeader` listens for
// (`features/oversight/oversightNavigationEvents.ts`).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

import { useNudgeRouteEffect } from '../useNudgeRouteEffect';
import { OPEN_WAITING_DRAWER_EVENT } from '../../../../features/oversight/oversightNavigationEvents';

function renderWithSearch(search: string) {
    window.history.replaceState({}, '', `/${search}`);
    const setCurrentRoute = vi.fn();
    const setMainView = vi.fn();
    renderHook(() => useNudgeRouteEffect({ setCurrentRoute, setMainView }));
    return { setCurrentRoute, setMainView };
}

let drawerRequests: number;
const countDrawerRequest = () => { drawerRequests += 1; };

beforeEach(() => {
    drawerRequests = 0;
    window.addEventListener(OPEN_WAITING_DRAWER_EVENT, countDrawerRequest);
});

afterEach(() => {
    window.removeEventListener(OPEN_WAITING_DRAWER_EVENT, countDrawerRequest);
    window.history.replaceState({}, '', '/');
});

describe('useNudgeRouteEffect — every nudge lands somewhere real (F3)', () => {
    it('close_day_nudge_opens_the_waiting_drawer', () => {
        const { setCurrentRoute, setMainView } = renderWithSearch('?nudge=close-day');

        // Spec §4.2 routes the whole Daily Closure card into the waiting
        // drawer, so that is the destination — asserted by the request the
        // drawer's owner actually listens for, not by an internal flag.
        expect(drawerRequests).toBe(1);
        expect(setCurrentRoute).toHaveBeenCalledWith('main');
        expect(setMainView).toHaveBeenCalledWith('log');
    });

    it('review_summary_nudge_opens_the_reflect_view', () => {
        const { setCurrentRoute, setMainView } = renderWithSearch('?nudge=review-summary');

        // The same destination the deleted "Yesterday not fully closed"
        // block's own "Review summary" button used before `0e4ad118`.
        expect(setCurrentRoute).toHaveBeenCalledWith('main');
        expect(setMainView).toHaveBeenCalledWith('reflect');
        // ...and it does NOT open the drawer — the two nudges are distinct
        // destinations, so neither test can pass on the other's behaviour.
        expect(drawerRequests).toBe(0);
    });

    it('an_unrecognised_nudge_still_only_routes_to_the_log_screen', () => {
        // `sw.js` also produces `/?nudge=open-today`, which this hook has
        // never had a branch for. Pre-existing behaviour, pinned so the F3
        // rewrite cannot have silently changed it.
        const { setCurrentRoute, setMainView } = renderWithSearch('?nudge=open-today');

        expect(setCurrentRoute).toHaveBeenCalledWith('main');
        expect(setMainView).toHaveBeenCalledWith('log');
        expect(drawerRequests).toBe(0);
    });

    it('no nudge param is a complete no-op', () => {
        const { setCurrentRoute, setMainView } = renderWithSearch('?other=1');

        expect(setCurrentRoute).not.toHaveBeenCalled();
        expect(setMainView).not.toHaveBeenCalled();
        expect(drawerRequests).toBe(0);
        expect(window.location.search).toBe('?other=1');
    });

    it('strips the nudge param so back/forward cannot re-trigger it', () => {
        renderWithSearch('?nudge=close-day&keep=yes');

        expect(window.location.search).toBe('?keep=yes');
    });
});
