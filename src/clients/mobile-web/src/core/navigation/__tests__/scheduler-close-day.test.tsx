// spec: owner-oversight-loop (finding F3)
// @vitest-environment jsdom
//
// SchedulerPage's "Close Day" button used to route to the log screen and set
// `showCloseDaySummary` — a flag whose only readers commit `0e4ad118` deleted
// when spec §4.2 moved the Daily Closure card into the waiting drawer. The
// button navigated away from the scheduler and then rendered nothing.
//
// `scheduler_close_day_opens_the_waiting_drawer` pins its real destination.
// The drawer is owned by `AppHeader` (a sibling of `<AppFeatureProviders>` in
// `AppContent.tsx`), so "opens it" is observed here the same way production
// observes it: the `OPEN_WAITING_DRAWER_EVENT` window event.
//
// Same technique as `settings-migration-routes.test.tsx` beside this file —
// call the route render function and invoke the prop off the returned
// element, rather than mounting the whole lazy `SchedulerPage`.
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { AppRouterContext } from '../routeContext';
import { renderScheduleRoute } from '../simpleRoutes';
import { OPEN_WAITING_DRAWER_EVENT } from '../../../features/oversight/oversightNavigationEvents';

let drawerRequests: number;
const countDrawerRequest = () => { drawerRequests += 1; };

beforeEach(() => {
    drawerRequests = 0;
    window.addEventListener(OPEN_WAITING_DRAWER_EVENT, countDrawerRequest);
});

afterEach(() => {
    window.removeEventListener(OPEN_WAITING_DRAWER_EVENT, countDrawerRequest);
});

describe('SchedulerPage "Close Day" (F3)', () => {
    it('scheduler_close_day_opens_the_waiting_drawer', () => {
        const setCurrentRoute = vi.fn();
        const setMainView = vi.fn();
        const ctx = {
            currentRoute: 'schedule',
            setCurrentRoute,
            setMainView,
            crops: [],
            history: [],
            plannedTasks: [],
            userResources: [],
            handleUpdateCrops: vi.fn(),
            setUserResources: vi.fn(),
            setShowTaskCreationSheet: vi.fn(),
        } as unknown as AppRouterContext;

        const node = renderScheduleRoute(ctx) as React.ReactElement<{
            children: React.ReactElement<{ onCloseDay: () => void }>;
        }>;
        expect(node).not.toBeNull();

        node.props.children.props.onCloseDay();

        expect(drawerRequests).toBe(1);
        // ...and it stays on the scheduler. The drawer is an overlay, not a
        // route change (`OversightOverlay.tsx`), so the page underneath is
        // never unmounted and there is nothing to navigate back from.
        expect(setCurrentRoute).not.toHaveBeenCalled();
        expect(setMainView).not.toHaveBeenCalled();
    });
});
