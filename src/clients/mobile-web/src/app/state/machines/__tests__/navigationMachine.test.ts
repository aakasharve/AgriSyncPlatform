/**
 * T-IGH-04-XSTATE-NAV — navigationMachine state graph.
 *
 * Locks the navigation actor's transitions: every AppRoute is reachable via
 * NAVIGATE, deep-link replay populates `pendingNudge` and is cleared by
 * NUDGE_CONSUMED, and BROWSER_BACK / BROWSER_FORWARD walk the in-context
 * history stack. The mainView region is orthogonal and survives route changes.
 */
import { describe, it, expect } from 'vitest';
import { createActor } from 'xstate';
import {
    navigationMachine,
    selectCurrentRoute,
    selectMainView,
    selectPendingNudge,
    selectCanGoBack,
    isKnownRoute,
    isKnownNudge,
} from '../navigationMachine';

describe('navigationMachine — initial state', () => {
    it('defaults to main route + log view + no nudge when no input given', () => {
        const actor = createActor(navigationMachine, { input: undefined }).start();
        const snap = actor.getSnapshot();
        expect(selectCurrentRoute(snap)).toBe('main');
        expect(selectMainView(snap)).toBe('log');
        expect(selectPendingNudge(snap)).toBeNull();
        expect(snap.context.history).toEqual(['main']);
        expect(snap.context.future).toEqual([]);
        expect(selectCanGoBack(snap)).toBe(false);
    });

    it('seeds initialRoute and initialNudge from input', () => {
        const actor = createActor(navigationMachine, {
            input: { initialRoute: 'finance-ledger', initialNudge: 'close-day' },
        }).start();
        const snap = actor.getSnapshot();
        expect(snap.context.history).toEqual(['finance-ledger']);
        expect(selectPendingNudge(snap)).toBe('close-day');
        // route region honors the seed via context but starts at the declared
        // initial state node ('main') — initialRoute populates the history
        // stack so a subsequent NAVIGATE / replay aligns the state node.
        expect(selectCurrentRoute(snap)).toBe('main');
    });
});

describe('navigationMachine — route transitions', () => {
    it('NAVIGATE moves the route region and pushes onto history', () => {
        const actor = createActor(navigationMachine, { input: undefined }).start();
        actor.send({ type: 'NAVIGATE', route: 'profile' });
        let snap = actor.getSnapshot();
        expect(selectCurrentRoute(snap)).toBe('profile');
        expect(snap.context.history).toEqual(['main', 'profile']);

        actor.send({ type: 'NAVIGATE', route: 'settings' });
        snap = actor.getSnapshot();
        expect(selectCurrentRoute(snap)).toBe('settings');
        expect(snap.context.history).toEqual(['main', 'profile', 'settings']);
        expect(selectCanGoBack(snap)).toBe(true);
    });

    it('NAVIGATE to the same route is a no-op on the history stack', () => {
        const actor = createActor(navigationMachine, { input: undefined }).start();
        actor.send({ type: 'NAVIGATE', route: 'profile' });
        actor.send({ type: 'NAVIGATE', route: 'profile' });
        const snap = actor.getSnapshot();
        expect(snap.context.history).toEqual(['main', 'profile']);
    });

    it('NAVIGATE clears the forward stack', () => {
        const actor = createActor(navigationMachine, { input: undefined }).start();
        actor.send({ type: 'NAVIGATE', route: 'profile' });
        actor.send({ type: 'NAVIGATE', route: 'settings' });
        actor.send({ type: 'BROWSER_BACK' }); // future = ['settings']
        expect(actor.getSnapshot().context.future).toEqual(['settings']);

        actor.send({ type: 'NAVIGATE', route: 'finance-manager' });
        const snap = actor.getSnapshot();
        expect(snap.context.future).toEqual([]);
        expect(selectCurrentRoute(snap)).toBe('finance-manager');
    });

    it('every AppRoute in the route grammar is reachable via NAVIGATE', () => {
        // Spec DoD #2: the machine models the full route grammar — every entry
        // from lazyComponents.ts is a state node. We assert each one transitions.
        const allRoutes = [
            'main', 'profile', 'settings', 'voice-journal', 'ai-admin', 'ops-admin',
            'schedule', 'procurement', 'income', 'test-e2e', 'finance-manager',
            'finance-ledger', 'finance-price-book', 'finance-review-inbox',
            'finance-reports', 'finance-settings', 'qr-demo', 'referrals',
            'attention', 'offline-conflicts', 'tests', 'test-detail', 'compliance',
            'service-proof', 'jobs', 'job-detail', 'worker-profile', 'farm-boundary',
        ] as const;
        for (const route of allRoutes) {
            const actor = createActor(navigationMachine, { input: undefined }).start();
            actor.send({ type: 'NAVIGATE', route });
            expect(selectCurrentRoute(actor.getSnapshot())).toBe(route);
        }
    });

    it('SET_MAIN_VIEW switches the orthogonal mainView region', () => {
        const actor = createActor(navigationMachine, { input: undefined }).start();
        expect(selectMainView(actor.getSnapshot())).toBe('log');

        actor.send({ type: 'SET_MAIN_VIEW', view: 'reflect' });
        expect(selectMainView(actor.getSnapshot())).toBe('reflect');

        actor.send({ type: 'SET_MAIN_VIEW', view: 'compare' });
        expect(selectMainView(actor.getSnapshot())).toBe('compare');
    });

    it('NAVIGATE may carry an optional view that updates both regions atomically', () => {
        const actor = createActor(navigationMachine, { input: undefined }).start();
        actor.send({ type: 'NAVIGATE', route: 'main', view: 'reflect' });
        const snap = actor.getSnapshot();
        expect(selectCurrentRoute(snap)).toBe('main');
        expect(selectMainView(snap)).toBe('reflect');
    });

    it('mainView survives navigation away and back', () => {
        const actor = createActor(navigationMachine, { input: undefined }).start();
        actor.send({ type: 'SET_MAIN_VIEW', view: 'compare' });
        actor.send({ type: 'NAVIGATE', route: 'profile' });
        actor.send({ type: 'NAVIGATE', route: 'main' });
        expect(selectMainView(actor.getSnapshot())).toBe('compare');
    });
});

describe('navigationMachine — deep-link replay', () => {
    it('DEEP_LINK_REPLAY transitions the route region and records the nudge', () => {
        const actor = createActor(navigationMachine, { input: undefined }).start();
        actor.send({
            type: 'DEEP_LINK_REPLAY',
            route: 'main',
            nudge: 'close-day',
        });
        const snap = actor.getSnapshot();
        expect(selectCurrentRoute(snap)).toBe('main');
        expect(selectPendingNudge(snap)).toBe('close-day');
    });

    it('DEEP_LINK_REPLAY without a nudge leaves pendingNudge null', () => {
        const actor = createActor(navigationMachine, { input: undefined }).start();
        actor.send({ type: 'DEEP_LINK_REPLAY', route: 'finance-ledger' });
        const snap = actor.getSnapshot();
        expect(selectCurrentRoute(snap)).toBe('finance-ledger');
        expect(selectPendingNudge(snap)).toBeNull();
    });

    it('NUDGE_CONSUMED clears the pending nudge without changing the route', () => {
        const actor = createActor(navigationMachine, { input: undefined }).start();
        actor.send({ type: 'DEEP_LINK_REPLAY', route: 'main', nudge: 'review-summary' });
        expect(selectPendingNudge(actor.getSnapshot())).toBe('review-summary');

        actor.send({ type: 'NUDGE_CONSUMED' });
        const snap = actor.getSnapshot();
        expect(selectPendingNudge(snap)).toBeNull();
        expect(selectCurrentRoute(snap)).toBe('main');
    });

    it('a fresh DEEP_LINK_REPLAY supersedes a prior unconsumed nudge', () => {
        const actor = createActor(navigationMachine, { input: undefined }).start();
        actor.send({ type: 'DEEP_LINK_REPLAY', route: 'main', nudge: 'close-day' });
        actor.send({ type: 'DEEP_LINK_REPLAY', route: 'main', nudge: 'review-summary' });
        expect(selectPendingNudge(actor.getSnapshot())).toBe('review-summary');
    });
});

describe('navigationMachine — back / forward', () => {
    it('BROWSER_BACK pops the history stack to the previous route', () => {
        const actor = createActor(navigationMachine, { input: undefined }).start();
        actor.send({ type: 'NAVIGATE', route: 'profile' });
        actor.send({ type: 'NAVIGATE', route: 'settings' });

        actor.send({ type: 'BROWSER_BACK' });
        let snap = actor.getSnapshot();
        expect(selectCurrentRoute(snap)).toBe('profile');
        expect(snap.context.history).toEqual(['main', 'profile']);
        expect(snap.context.future).toEqual(['settings']);

        actor.send({ type: 'BROWSER_BACK' });
        snap = actor.getSnapshot();
        expect(selectCurrentRoute(snap)).toBe('main');
        expect(snap.context.history).toEqual(['main']);
        expect(snap.context.future).toEqual(['profile', 'settings']);
    });

    it('BROWSER_BACK is a no-op when at the bottom of the stack', () => {
        const actor = createActor(navigationMachine, { input: undefined }).start();
        actor.send({ type: 'BROWSER_BACK' });
        const snap = actor.getSnapshot();
        expect(selectCurrentRoute(snap)).toBe('main');
        expect(snap.context.history).toEqual(['main']);
    });

    it('BROWSER_FORWARD replays the future stack', () => {
        const actor = createActor(navigationMachine, { input: undefined }).start();
        actor.send({ type: 'NAVIGATE', route: 'profile' });
        actor.send({ type: 'NAVIGATE', route: 'settings' });
        actor.send({ type: 'BROWSER_BACK' });
        actor.send({ type: 'BROWSER_BACK' });

        actor.send({ type: 'BROWSER_FORWARD' });
        let snap = actor.getSnapshot();
        expect(selectCurrentRoute(snap)).toBe('profile');
        expect(snap.context.history).toEqual(['main', 'profile']);

        actor.send({ type: 'BROWSER_FORWARD' });
        snap = actor.getSnapshot();
        expect(selectCurrentRoute(snap)).toBe('settings');
        expect(snap.context.future).toEqual([]);
    });

    it('BROWSER_FORWARD is a no-op when the future stack is empty', () => {
        const actor = createActor(navigationMachine, { input: undefined }).start();
        actor.send({ type: 'NAVIGATE', route: 'profile' });
        actor.send({ type: 'BROWSER_FORWARD' });
        const snap = actor.getSnapshot();
        expect(selectCurrentRoute(snap)).toBe('profile');
    });
});

describe('navigationMachine — RESET', () => {
    it('RESET clears history, future, nudge and returns to main + log', () => {
        const actor = createActor(navigationMachine, { input: undefined }).start();
        actor.send({ type: 'NAVIGATE', route: 'finance-ledger' });
        actor.send({ type: 'SET_MAIN_VIEW', view: 'reflect' });
        actor.send({ type: 'DEEP_LINK_REPLAY', route: 'main', nudge: 'close-day' });

        actor.send({ type: 'RESET' });
        const snap = actor.getSnapshot();
        expect(selectCurrentRoute(snap)).toBe('main');
        expect(selectMainView(snap)).toBe('log');
        expect(selectPendingNudge(snap)).toBeNull();
        expect(snap.context.history).toEqual(['main']);
        expect(snap.context.future).toEqual([]);
    });
});

describe('navigationMachine — type guards', () => {
    it('isKnownRoute accepts the full route grammar', () => {
        expect(isKnownRoute('main')).toBe(true);
        expect(isKnownRoute('finance-review-inbox')).toBe(true);
        expect(isKnownRoute('worker-profile')).toBe(true);
    });

    it('isKnownRoute rejects unknown values', () => {
        expect(isKnownRoute('does-not-exist')).toBe(false);
        expect(isKnownRoute('')).toBe(false);
    });

    it('isKnownNudge accepts only close-day and review-summary', () => {
        expect(isKnownNudge('close-day')).toBe(true);
        expect(isKnownNudge('review-summary')).toBe(true);
        expect(isKnownNudge('something-else')).toBe(false);
    });
});
