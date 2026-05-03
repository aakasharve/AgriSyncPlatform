/**
 * T-IGH-04-XSTATE-NAV — navigation actor.
 *
 * Replaces the `useAppNavigation` hook (which read `window.location.pathname`
 * and toggled scattered `currentRoute` / `mainView` `useState` cells) with a
 * single XState v5 actor wired into RootStore. AppHeader, BottomNavigation,
 * AppRouter, and the rest of the route-aware UI subscribe to the actor via
 * `useSelector`.
 *
 * Design — two parallel regions:
 *   route     — every entry from `core/navigation/lazyComponents.ts` is a
 *               concrete state node ('main', 'profile', 'settings', …).
 *               The state graph IS the route grammar; ad-hoc route strings
 *               cannot leak in via guards.
 *   mainView  — orthogonal view ('log' | 'reflect' | 'compare') used by
 *               the bottom-nav inside the `main` route. Lives outside the
 *               `route` region because BottomNavigation reads it regardless
 *               of what route is mounted (it's a UI affordance, not a route).
 *
 * Context — keeps a back/forward history stack so the deep-link replay flow
 * (and the browser back button) can replay through the machine instead of
 * the AppRouter cracking open `window.history` directly.
 *
 * The full route list mirrors `domain/types/farm.types.ts` `AppRoute` — every
 * member is a state node here. If `lazyComponents.ts` adds a route in the
 * future, the matching `AppRoute` literal lands here automatically (TS keeps
 * us honest via the discriminated event payload).
 */
import { setup, assign, type ActorRefFrom } from 'xstate';
import type { AppRoute, PageView } from '../../../domain/types/farm.types';

/** URL nudge codes accepted via `?nudge=…` deep-link replay. */
export type NavNudge = 'close-day' | 'review-summary';

export interface NavigationContext {
    /** Back stack for browser-back / history.back support. Newest at end. */
    history: AppRoute[];
    /** Forward stack — populated when the user goes back. Cleared on NAVIGATE. */
    future: AppRoute[];
    /**
     * Pending nudge consumed by `useNudgeRouteEffect`. Set by `DEEP_LINK_REPLAY`
     * and cleared by `NUDGE_CONSUMED` after the AppRouter has opened the matching
     * sheet. Lives in context (not as a state node) because nudges are a one-shot
     * side-effect surface, not a routing destination.
     */
    pendingNudge: NavNudge | null;
}

export type NavigationEvent =
    | { type: 'NAVIGATE'; route: AppRoute; view?: PageView }
    | { type: 'SET_MAIN_VIEW'; view: PageView }
    | { type: 'BROWSER_BACK' }
    | { type: 'BROWSER_FORWARD' }
    | { type: 'DEEP_LINK_REPLAY'; route: AppRoute; nudge?: NavNudge | null }
    | { type: 'NUDGE_CONSUMED' }
    | { type: 'RESET' };

export interface NavigationInput {
    initialRoute?: AppRoute;
    initialView?: PageView;
    initialNudge?: NavNudge | null;
}

const KNOWN_ROUTES: readonly AppRoute[] = [
    'main',
    'profile',
    'settings',
    'voice-journal',
    'ai-admin',
    'ops-admin',
    'schedule',
    'procurement',
    'income',
    'test-e2e',
    'finance-manager',
    'finance-ledger',
    'finance-price-book',
    'finance-review-inbox',
    'finance-reports',
    'finance-settings',
    'qr-demo',
    'referrals',
    'attention',
    'offline-conflicts',
    'tests',
    'test-detail',
    'compliance',
    'service-proof',
    'jobs',
    'job-detail',
    'worker-profile',
    'farm-boundary',
];

export function isKnownRoute(value: string): value is AppRoute {
    return (KNOWN_ROUTES as readonly string[]).includes(value);
}

const KNOWN_NUDGES: readonly NavNudge[] = ['close-day', 'review-summary'];

export function isKnownNudge(value: string): value is NavNudge {
    return (KNOWN_NUDGES as readonly string[]).includes(value);
}

/**
 * Parse the current `window.location` into an actor input. Used by RootStore
 * during browser bootstrap; tests construct input by hand.
 */
export function readNavigationInputFromLocation(): NavigationInput {
    if (typeof window === 'undefined') {
        return { initialRoute: 'main', initialView: 'log', initialNudge: null };
    }
    try {
        const params = new URLSearchParams(window.location.search);
        const routeCandidate = params.get('route');
        const initialRoute = routeCandidate && isKnownRoute(routeCandidate)
            ? routeCandidate
            : 'main';
        const nudgeCandidate = params.get('nudge');
        const initialNudge = nudgeCandidate && isKnownNudge(nudgeCandidate)
            ? nudgeCandidate
            : null;
        return { initialRoute, initialView: 'log', initialNudge };
    } catch {
        return { initialRoute: 'main', initialView: 'log', initialNudge: null };
    }
}

export const navigationMachine = setup({
    types: {} as {
        context: NavigationContext;
        events: NavigationEvent;
        input?: NavigationInput;
    },
    actions: {
        pushHistory: assign({
            history: ({ context, event }) => {
                if (event.type !== 'NAVIGATE') return context.history;
                // Don't double-push the same route consecutively.
                const last = context.history[context.history.length - 1];
                if (last === event.route) return context.history;
                return [...context.history, event.route];
            },
            future: ({ context, event }) => {
                if (event.type !== 'NAVIGATE') return context.future;
                // Forward stack invalidated on a fresh navigation.
                return [];
            },
        }),
        popHistory: assign({
            history: ({ context, event }) => {
                if (event.type !== 'BROWSER_BACK') return context.history;
                if (context.history.length <= 1) return context.history;
                return context.history.slice(0, -1);
            },
            future: ({ context, event }) => {
                if (event.type !== 'BROWSER_BACK') return context.future;
                if (context.history.length <= 1) return context.future;
                const popped = context.history[context.history.length - 1];
                return [popped, ...context.future];
            },
        }),
        replayForward: assign({
            history: ({ context, event }) => {
                if (event.type !== 'BROWSER_FORWARD') return context.history;
                if (context.future.length === 0) return context.history;
                const next = context.future[0];
                return [...context.history, next];
            },
            future: ({ context, event }) => {
                if (event.type !== 'BROWSER_FORWARD') return context.future;
                if (context.future.length === 0) return context.future;
                return context.future.slice(1);
            },
        }),
        replaceHistoryWithReplayedRoute: assign({
            history: ({ context, event }) => {
                if (event.type !== 'DEEP_LINK_REPLAY') return context.history;
                const last = context.history[context.history.length - 1];
                if (last === event.route) return context.history;
                return [...context.history, event.route];
            },
            future: () => [],
        }),
        recordNudge: assign({
            pendingNudge: ({ event }) => {
                if (event.type !== 'DEEP_LINK_REPLAY') return null;
                return event.nudge ?? null;
            },
        }),
        clearNudge: assign({ pendingNudge: () => null }),
        resetHistory: assign({
            history: () => ['main' as AppRoute],
            future: () => [],
            pendingNudge: () => null,
        }),
    },
    guards: {
        canGoBack: ({ context }) => context.history.length > 1,
        canGoForward: ({ context }) => context.future.length > 0,
    },
}).createMachine({
    id: 'navigation',
    type: 'parallel',
    context: ({ input }) => ({
        history: [input?.initialRoute ?? 'main'],
        future: [],
        pendingNudge: input?.initialNudge ?? null,
    }),
    states: {
        // ----------------------------------------------------------------
        // ROUTE region — every AppRoute is a real state node, so the machine
        // graph IS the route grammar. Cross-route transitions live on the
        // region root via `on.NAVIGATE` so we don't repeat them 28 times.
        // ----------------------------------------------------------------
        route: {
            initial: 'main',
            on: {
                NAVIGATE: [
                    { target: '.main', guard: ({ event }) => event.route === 'main', actions: 'pushHistory' },
                    { target: '.profile', guard: ({ event }) => event.route === 'profile', actions: 'pushHistory' },
                    { target: '.settings', guard: ({ event }) => event.route === 'settings', actions: 'pushHistory' },
                    { target: '.voice-journal', guard: ({ event }) => event.route === 'voice-journal', actions: 'pushHistory' },
                    { target: '.ai-admin', guard: ({ event }) => event.route === 'ai-admin', actions: 'pushHistory' },
                    { target: '.ops-admin', guard: ({ event }) => event.route === 'ops-admin', actions: 'pushHistory' },
                    { target: '.schedule', guard: ({ event }) => event.route === 'schedule', actions: 'pushHistory' },
                    { target: '.procurement', guard: ({ event }) => event.route === 'procurement', actions: 'pushHistory' },
                    { target: '.income', guard: ({ event }) => event.route === 'income', actions: 'pushHistory' },
                    { target: '.test-e2e', guard: ({ event }) => event.route === 'test-e2e', actions: 'pushHistory' },
                    { target: '.finance-manager', guard: ({ event }) => event.route === 'finance-manager', actions: 'pushHistory' },
                    { target: '.finance-ledger', guard: ({ event }) => event.route === 'finance-ledger', actions: 'pushHistory' },
                    { target: '.finance-price-book', guard: ({ event }) => event.route === 'finance-price-book', actions: 'pushHistory' },
                    { target: '.finance-review-inbox', guard: ({ event }) => event.route === 'finance-review-inbox', actions: 'pushHistory' },
                    { target: '.finance-reports', guard: ({ event }) => event.route === 'finance-reports', actions: 'pushHistory' },
                    { target: '.finance-settings', guard: ({ event }) => event.route === 'finance-settings', actions: 'pushHistory' },
                    { target: '.qr-demo', guard: ({ event }) => event.route === 'qr-demo', actions: 'pushHistory' },
                    { target: '.referrals', guard: ({ event }) => event.route === 'referrals', actions: 'pushHistory' },
                    { target: '.attention', guard: ({ event }) => event.route === 'attention', actions: 'pushHistory' },
                    { target: '.offline-conflicts', guard: ({ event }) => event.route === 'offline-conflicts', actions: 'pushHistory' },
                    { target: '.tests', guard: ({ event }) => event.route === 'tests', actions: 'pushHistory' },
                    { target: '.test-detail', guard: ({ event }) => event.route === 'test-detail', actions: 'pushHistory' },
                    { target: '.compliance', guard: ({ event }) => event.route === 'compliance', actions: 'pushHistory' },
                    { target: '.service-proof', guard: ({ event }) => event.route === 'service-proof', actions: 'pushHistory' },
                    { target: '.jobs', guard: ({ event }) => event.route === 'jobs', actions: 'pushHistory' },
                    { target: '.job-detail', guard: ({ event }) => event.route === 'job-detail', actions: 'pushHistory' },
                    { target: '.worker-profile', guard: ({ event }) => event.route === 'worker-profile', actions: 'pushHistory' },
                    { target: '.farm-boundary', guard: ({ event }) => event.route === 'farm-boundary', actions: 'pushHistory' },
                ],
                BROWSER_BACK: [
                    { target: '.main', guard: ({ context }) => context.history.length > 1 && context.history[context.history.length - 2] === 'main', actions: 'popHistory' },
                    { target: '.profile', guard: ({ context }) => context.history.length > 1 && context.history[context.history.length - 2] === 'profile', actions: 'popHistory' },
                    { target: '.settings', guard: ({ context }) => context.history.length > 1 && context.history[context.history.length - 2] === 'settings', actions: 'popHistory' },
                    { target: '.voice-journal', guard: ({ context }) => context.history.length > 1 && context.history[context.history.length - 2] === 'voice-journal', actions: 'popHistory' },
                    { target: '.ai-admin', guard: ({ context }) => context.history.length > 1 && context.history[context.history.length - 2] === 'ai-admin', actions: 'popHistory' },
                    { target: '.ops-admin', guard: ({ context }) => context.history.length > 1 && context.history[context.history.length - 2] === 'ops-admin', actions: 'popHistory' },
                    { target: '.schedule', guard: ({ context }) => context.history.length > 1 && context.history[context.history.length - 2] === 'schedule', actions: 'popHistory' },
                    { target: '.procurement', guard: ({ context }) => context.history.length > 1 && context.history[context.history.length - 2] === 'procurement', actions: 'popHistory' },
                    { target: '.income', guard: ({ context }) => context.history.length > 1 && context.history[context.history.length - 2] === 'income', actions: 'popHistory' },
                    { target: '.test-e2e', guard: ({ context }) => context.history.length > 1 && context.history[context.history.length - 2] === 'test-e2e', actions: 'popHistory' },
                    { target: '.finance-manager', guard: ({ context }) => context.history.length > 1 && context.history[context.history.length - 2] === 'finance-manager', actions: 'popHistory' },
                    { target: '.finance-ledger', guard: ({ context }) => context.history.length > 1 && context.history[context.history.length - 2] === 'finance-ledger', actions: 'popHistory' },
                    { target: '.finance-price-book', guard: ({ context }) => context.history.length > 1 && context.history[context.history.length - 2] === 'finance-price-book', actions: 'popHistory' },
                    { target: '.finance-review-inbox', guard: ({ context }) => context.history.length > 1 && context.history[context.history.length - 2] === 'finance-review-inbox', actions: 'popHistory' },
                    { target: '.finance-reports', guard: ({ context }) => context.history.length > 1 && context.history[context.history.length - 2] === 'finance-reports', actions: 'popHistory' },
                    { target: '.finance-settings', guard: ({ context }) => context.history.length > 1 && context.history[context.history.length - 2] === 'finance-settings', actions: 'popHistory' },
                    { target: '.qr-demo', guard: ({ context }) => context.history.length > 1 && context.history[context.history.length - 2] === 'qr-demo', actions: 'popHistory' },
                    { target: '.referrals', guard: ({ context }) => context.history.length > 1 && context.history[context.history.length - 2] === 'referrals', actions: 'popHistory' },
                    { target: '.attention', guard: ({ context }) => context.history.length > 1 && context.history[context.history.length - 2] === 'attention', actions: 'popHistory' },
                    { target: '.offline-conflicts', guard: ({ context }) => context.history.length > 1 && context.history[context.history.length - 2] === 'offline-conflicts', actions: 'popHistory' },
                    { target: '.tests', guard: ({ context }) => context.history.length > 1 && context.history[context.history.length - 2] === 'tests', actions: 'popHistory' },
                    { target: '.test-detail', guard: ({ context }) => context.history.length > 1 && context.history[context.history.length - 2] === 'test-detail', actions: 'popHistory' },
                    { target: '.compliance', guard: ({ context }) => context.history.length > 1 && context.history[context.history.length - 2] === 'compliance', actions: 'popHistory' },
                    { target: '.service-proof', guard: ({ context }) => context.history.length > 1 && context.history[context.history.length - 2] === 'service-proof', actions: 'popHistory' },
                    { target: '.jobs', guard: ({ context }) => context.history.length > 1 && context.history[context.history.length - 2] === 'jobs', actions: 'popHistory' },
                    { target: '.job-detail', guard: ({ context }) => context.history.length > 1 && context.history[context.history.length - 2] === 'job-detail', actions: 'popHistory' },
                    { target: '.worker-profile', guard: ({ context }) => context.history.length > 1 && context.history[context.history.length - 2] === 'worker-profile', actions: 'popHistory' },
                    { target: '.farm-boundary', guard: ({ context }) => context.history.length > 1 && context.history[context.history.length - 2] === 'farm-boundary', actions: 'popHistory' },
                ],
                BROWSER_FORWARD: [
                    { target: '.main', guard: ({ context }) => context.future[0] === 'main', actions: 'replayForward' },
                    { target: '.profile', guard: ({ context }) => context.future[0] === 'profile', actions: 'replayForward' },
                    { target: '.settings', guard: ({ context }) => context.future[0] === 'settings', actions: 'replayForward' },
                    { target: '.voice-journal', guard: ({ context }) => context.future[0] === 'voice-journal', actions: 'replayForward' },
                    { target: '.ai-admin', guard: ({ context }) => context.future[0] === 'ai-admin', actions: 'replayForward' },
                    { target: '.ops-admin', guard: ({ context }) => context.future[0] === 'ops-admin', actions: 'replayForward' },
                    { target: '.schedule', guard: ({ context }) => context.future[0] === 'schedule', actions: 'replayForward' },
                    { target: '.procurement', guard: ({ context }) => context.future[0] === 'procurement', actions: 'replayForward' },
                    { target: '.income', guard: ({ context }) => context.future[0] === 'income', actions: 'replayForward' },
                    { target: '.test-e2e', guard: ({ context }) => context.future[0] === 'test-e2e', actions: 'replayForward' },
                    { target: '.finance-manager', guard: ({ context }) => context.future[0] === 'finance-manager', actions: 'replayForward' },
                    { target: '.finance-ledger', guard: ({ context }) => context.future[0] === 'finance-ledger', actions: 'replayForward' },
                    { target: '.finance-price-book', guard: ({ context }) => context.future[0] === 'finance-price-book', actions: 'replayForward' },
                    { target: '.finance-review-inbox', guard: ({ context }) => context.future[0] === 'finance-review-inbox', actions: 'replayForward' },
                    { target: '.finance-reports', guard: ({ context }) => context.future[0] === 'finance-reports', actions: 'replayForward' },
                    { target: '.finance-settings', guard: ({ context }) => context.future[0] === 'finance-settings', actions: 'replayForward' },
                    { target: '.qr-demo', guard: ({ context }) => context.future[0] === 'qr-demo', actions: 'replayForward' },
                    { target: '.referrals', guard: ({ context }) => context.future[0] === 'referrals', actions: 'replayForward' },
                    { target: '.attention', guard: ({ context }) => context.future[0] === 'attention', actions: 'replayForward' },
                    { target: '.offline-conflicts', guard: ({ context }) => context.future[0] === 'offline-conflicts', actions: 'replayForward' },
                    { target: '.tests', guard: ({ context }) => context.future[0] === 'tests', actions: 'replayForward' },
                    { target: '.test-detail', guard: ({ context }) => context.future[0] === 'test-detail', actions: 'replayForward' },
                    { target: '.compliance', guard: ({ context }) => context.future[0] === 'compliance', actions: 'replayForward' },
                    { target: '.service-proof', guard: ({ context }) => context.future[0] === 'service-proof', actions: 'replayForward' },
                    { target: '.jobs', guard: ({ context }) => context.future[0] === 'jobs', actions: 'replayForward' },
                    { target: '.job-detail', guard: ({ context }) => context.future[0] === 'job-detail', actions: 'replayForward' },
                    { target: '.worker-profile', guard: ({ context }) => context.future[0] === 'worker-profile', actions: 'replayForward' },
                    { target: '.farm-boundary', guard: ({ context }) => context.future[0] === 'farm-boundary', actions: 'replayForward' },
                ],
                DEEP_LINK_REPLAY: [
                    { target: '.main', guard: ({ event }) => event.route === 'main', actions: ['replaceHistoryWithReplayedRoute', 'recordNudge'] },
                    { target: '.profile', guard: ({ event }) => event.route === 'profile', actions: ['replaceHistoryWithReplayedRoute', 'recordNudge'] },
                    { target: '.settings', guard: ({ event }) => event.route === 'settings', actions: ['replaceHistoryWithReplayedRoute', 'recordNudge'] },
                    { target: '.voice-journal', guard: ({ event }) => event.route === 'voice-journal', actions: ['replaceHistoryWithReplayedRoute', 'recordNudge'] },
                    { target: '.ai-admin', guard: ({ event }) => event.route === 'ai-admin', actions: ['replaceHistoryWithReplayedRoute', 'recordNudge'] },
                    { target: '.ops-admin', guard: ({ event }) => event.route === 'ops-admin', actions: ['replaceHistoryWithReplayedRoute', 'recordNudge'] },
                    { target: '.schedule', guard: ({ event }) => event.route === 'schedule', actions: ['replaceHistoryWithReplayedRoute', 'recordNudge'] },
                    { target: '.procurement', guard: ({ event }) => event.route === 'procurement', actions: ['replaceHistoryWithReplayedRoute', 'recordNudge'] },
                    { target: '.income', guard: ({ event }) => event.route === 'income', actions: ['replaceHistoryWithReplayedRoute', 'recordNudge'] },
                    { target: '.test-e2e', guard: ({ event }) => event.route === 'test-e2e', actions: ['replaceHistoryWithReplayedRoute', 'recordNudge'] },
                    { target: '.finance-manager', guard: ({ event }) => event.route === 'finance-manager', actions: ['replaceHistoryWithReplayedRoute', 'recordNudge'] },
                    { target: '.finance-ledger', guard: ({ event }) => event.route === 'finance-ledger', actions: ['replaceHistoryWithReplayedRoute', 'recordNudge'] },
                    { target: '.finance-price-book', guard: ({ event }) => event.route === 'finance-price-book', actions: ['replaceHistoryWithReplayedRoute', 'recordNudge'] },
                    { target: '.finance-review-inbox', guard: ({ event }) => event.route === 'finance-review-inbox', actions: ['replaceHistoryWithReplayedRoute', 'recordNudge'] },
                    { target: '.finance-reports', guard: ({ event }) => event.route === 'finance-reports', actions: ['replaceHistoryWithReplayedRoute', 'recordNudge'] },
                    { target: '.finance-settings', guard: ({ event }) => event.route === 'finance-settings', actions: ['replaceHistoryWithReplayedRoute', 'recordNudge'] },
                    { target: '.qr-demo', guard: ({ event }) => event.route === 'qr-demo', actions: ['replaceHistoryWithReplayedRoute', 'recordNudge'] },
                    { target: '.referrals', guard: ({ event }) => event.route === 'referrals', actions: ['replaceHistoryWithReplayedRoute', 'recordNudge'] },
                    { target: '.attention', guard: ({ event }) => event.route === 'attention', actions: ['replaceHistoryWithReplayedRoute', 'recordNudge'] },
                    { target: '.offline-conflicts', guard: ({ event }) => event.route === 'offline-conflicts', actions: ['replaceHistoryWithReplayedRoute', 'recordNudge'] },
                    { target: '.tests', guard: ({ event }) => event.route === 'tests', actions: ['replaceHistoryWithReplayedRoute', 'recordNudge'] },
                    { target: '.test-detail', guard: ({ event }) => event.route === 'test-detail', actions: ['replaceHistoryWithReplayedRoute', 'recordNudge'] },
                    { target: '.compliance', guard: ({ event }) => event.route === 'compliance', actions: ['replaceHistoryWithReplayedRoute', 'recordNudge'] },
                    { target: '.service-proof', guard: ({ event }) => event.route === 'service-proof', actions: ['replaceHistoryWithReplayedRoute', 'recordNudge'] },
                    { target: '.jobs', guard: ({ event }) => event.route === 'jobs', actions: ['replaceHistoryWithReplayedRoute', 'recordNudge'] },
                    { target: '.job-detail', guard: ({ event }) => event.route === 'job-detail', actions: ['replaceHistoryWithReplayedRoute', 'recordNudge'] },
                    { target: '.worker-profile', guard: ({ event }) => event.route === 'worker-profile', actions: ['replaceHistoryWithReplayedRoute', 'recordNudge'] },
                    { target: '.farm-boundary', guard: ({ event }) => event.route === 'farm-boundary', actions: ['replaceHistoryWithReplayedRoute', 'recordNudge'] },
                ],
                NUDGE_CONSUMED: { actions: 'clearNudge' },
                RESET: { target: '.main', actions: 'resetHistory' },
            },
            states: {
                main: {},
                profile: {},
                settings: {},
                'voice-journal': {},
                'ai-admin': {},
                'ops-admin': {},
                schedule: {},
                procurement: {},
                income: {},
                'test-e2e': {},
                'finance-manager': {},
                'finance-ledger': {},
                'finance-price-book': {},
                'finance-review-inbox': {},
                'finance-reports': {},
                'finance-settings': {},
                'qr-demo': {},
                referrals: {},
                attention: {},
                'offline-conflicts': {},
                tests: {},
                'test-detail': {},
                compliance: {},
                'service-proof': {},
                jobs: {},
                'job-detail': {},
                'worker-profile': {},
                'farm-boundary': {},
            },
        },
        // ----------------------------------------------------------------
        // MAIN VIEW region — orthogonal sub-state of the `main` route used by
        // BottomNavigation. Modeled as its own region (vs. nested under `main`)
        // because the bottom-nav reads it regardless of which route is mounted,
        // and we want it to survive a navigate-away-and-back.
        // ----------------------------------------------------------------
        mainView: {
            initial: 'log',
            on: {
                SET_MAIN_VIEW: [
                    { target: '.log', guard: ({ event }) => event.view === 'log' },
                    { target: '.reflect', guard: ({ event }) => event.view === 'reflect' },
                    { target: '.compare', guard: ({ event }) => event.view === 'compare' },
                ],
                NAVIGATE: [
                    { target: '.log', guard: ({ event }) => event.view === 'log' },
                    { target: '.reflect', guard: ({ event }) => event.view === 'reflect' },
                    { target: '.compare', guard: ({ event }) => event.view === 'compare' },
                ],
                RESET: { target: '.log' },
            },
            states: {
                log: {},
                reflect: {},
                compare: {},
            },
        },
    },
});

export type NavigationActor = ActorRefFrom<typeof navigationMachine>;

/**
 * Selector helpers — keep snapshot-shape knowledge in one place so callers
 * don't need to know about the parallel state structure.
 */
export const selectCurrentRoute = (
    snapshot: ReturnType<NavigationActor['getSnapshot']>,
): AppRoute => {
    const value = snapshot.value as { route: AppRoute };
    return value.route;
};

export const selectMainView = (
    snapshot: ReturnType<NavigationActor['getSnapshot']>,
): PageView => {
    const value = snapshot.value as { mainView: PageView };
    return value.mainView;
};

export const selectPendingNudge = (
    snapshot: ReturnType<NavigationActor['getSnapshot']>,
): NavNudge | null => snapshot.context.pendingNudge;

export const selectCanGoBack = (
    snapshot: ReturnType<NavigationActor['getSnapshot']>,
): boolean => snapshot.context.history.length > 1;
