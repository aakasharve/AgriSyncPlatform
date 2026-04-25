import { useState, useCallback } from 'react';
import { AppRoute, PageView } from '../../types';

export interface UseAppNavigationResult {
    currentRoute: AppRoute;
    setCurrentRoute: (route: AppRoute) => void;
    mainView: PageView;
    setMainView: (view: PageView) => void;
    navigateTo: (route: AppRoute, view?: PageView) => void;
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
    const [currentRoute, setCurrentRoute] = useState<AppRoute>(readInitialRouteFromUrl);
    const [mainView, setMainView] = useState<PageView>('log');

    const navigateTo = useCallback((route: AppRoute, view?: PageView) => {
        setCurrentRoute(route);
        if (view) {
            setMainView(view);
        }
    }, []);

    return {
        currentRoute,
        setCurrentRoute,
        mainView,
        setMainView,
        navigateTo
    };
};
