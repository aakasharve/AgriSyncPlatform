import { useState, useCallback } from 'react';
import { AppRoute, PageView } from '../../types';

// spec: 2026-07-13-labour-attendance-approval-design (Task 3.4) — carries a
// one-shot "why am I on the log page" hint across the labour -> log
// navigation. `null` is the default and today's only behaviour.
export type LogIntent = 'labour' | null;

export interface UseAppNavigationResult {
    currentRoute: AppRoute;
    setCurrentRoute: (route: AppRoute) => void;
    mainView: PageView;
    setMainView: (view: PageView) => void;
    navigateTo: (route: AppRoute, view?: PageView) => void;
    logIntent: LogIntent;
    setLogIntent: (intent: LogIntent) => void;
}

const KNOWN_ROUTES: readonly AppRoute[] = [
    'main',
    'profile',
    'settings',
    'voiceDiary',
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
    // spec: data-principle-spine-2026-05-05/06.4
    'consent',
    // spec: data-principle-spine-2026-05-05/10.4 — admin PII review queue.
    'piiReview',
];

const readInitialRouteFromUrl = (): AppRoute => {
    if (typeof window === 'undefined') {
        return 'main';
    }

    try {
        const params = new URLSearchParams(window.location.search);
        const candidate = params.get('route');
        if (candidate && (KNOWN_ROUTES as readonly string[]).includes(candidate)) {
            return candidate as AppRoute;
        }
    } catch {
        // URLSearchParams not supported — fall through
    }

    return 'main';
};

export const useAppNavigation = (): UseAppNavigationResult => {
    const [currentRoute, setCurrentRouteState] = useState<AppRoute>(readInitialRouteFromUrl);
    const [mainView, setMainView] = useState<PageView>('log');
    const [logIntent, setLogIntentState] = useState<LogIntent>(null);

    // Any route change away from the log page ('main') clears the labour
    // hint, so it never lingers into an unrelated later visit. Routing back
    // INTO 'main' is a no-op here — the caller (renderLabourRoute) sets the
    // intent explicitly right before navigating there.
    const setCurrentRoute = useCallback((route: AppRoute) => {
        setCurrentRouteState(route);
        if (route !== 'main') {
            setLogIntentState(null);
        }
    }, []);

    const navigateTo = useCallback((route: AppRoute, view?: PageView) => {
        setCurrentRoute(route);
        if (view) {
            setMainView(view);
        }
    }, [setCurrentRoute]);

    const setLogIntent = useCallback((intent: LogIntent) => {
        setLogIntentState(intent);
    }, []);

    return {
        currentRoute,
        setCurrentRoute,
        mainView,
        setMainView,
        navigateTo,
        logIntent,
        setLogIntent
    };
};
