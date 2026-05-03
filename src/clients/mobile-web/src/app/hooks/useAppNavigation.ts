/**
 * T-IGH-04-XSTATE-NAV — thin adapter over `navigationMachine`.
 *
 * Pre-task this hook owned `useState` for `currentRoute` / `mainView` and read
 * `window.location` to seed the initial route. After the migration, all of
 * that state lives in the XState navigation actor (see
 * `app/state/machines/navigationMachine.ts`); this hook is the React adapter
 * the existing component tree consumes via `useAppNavigationState()`.
 *
 * Consumers (`AppContent`, `AppRouter`, `AppHeader`, `BottomNavigation`,
 * `compositionRoot`) keep the same five-field API — `currentRoute`,
 * `setCurrentRoute`, `mainView`, `setMainView`, `navigateTo` — so the
 * orchestration change stays invisible to callers and the do-not-regress
 * testid list (Sub-plan 04) holds.
 *
 * Browser back/forward integration: this hook installs a single `popstate`
 * listener that translates `history.back()` / `history.forward()` into actor
 * events (`BROWSER_BACK` / `BROWSER_FORWARD`). The actor's history stack drives
 * the routing snapshot; the listener is the only browser-history bridge.
 */
import { useCallback, useEffect } from 'react';
import { useSelector } from '@xstate/react';
import { getRootStore } from '../state/RootStore';
import {
    selectCurrentRoute,
    selectMainView,
} from '../state/machines/navigationMachine';
import type { AppRoute, PageView } from '../../types';

export interface UseAppNavigationResult {
    currentRoute: AppRoute;
    setCurrentRoute: (route: AppRoute) => void;
    mainView: PageView;
    setMainView: (view: PageView) => void;
    navigateTo: (route: AppRoute, view?: PageView) => void;
}

export const useAppNavigation = (): UseAppNavigationResult => {
    const navigation = getRootStore().navigation;
    const currentRoute = useSelector(navigation, selectCurrentRoute);
    const mainView = useSelector(navigation, selectMainView);

    const setCurrentRoute = useCallback(
        (route: AppRoute) => navigation.send({ type: 'NAVIGATE', route }),
        [navigation],
    );
    const setMainView = useCallback(
        (view: PageView) => navigation.send({ type: 'SET_MAIN_VIEW', view }),
        [navigation],
    );
    const navigateTo = useCallback(
        (route: AppRoute, view?: PageView) =>
            navigation.send({ type: 'NAVIGATE', route, view }),
        [navigation],
    );

    // Bridge browser history to actor events. The popstate handler can't tell
    // back from forward — we infer by inspecting whether the new state.idx is
    // lower than the previous one.
    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        let lastIdx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
        const onPopState = () => {
            const nextIdx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
            if (nextIdx < lastIdx) {
                navigation.send({ type: 'BROWSER_BACK' });
            } else {
                navigation.send({ type: 'BROWSER_FORWARD' });
            }
            lastIdx = nextIdx;
        };
        window.addEventListener('popstate', onPopState);
        return () => window.removeEventListener('popstate', onPopState);
    }, [navigation]);

    return { currentRoute, setCurrentRoute, mainView, setMainView, navigateTo };
};
