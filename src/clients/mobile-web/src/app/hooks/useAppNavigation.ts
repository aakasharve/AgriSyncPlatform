import { useState, useCallback, useRef } from 'react';
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
    // spec: 2026-07-13-labour-attendance-approval-design (Task 3.5) — ids of
    // the log(s) saved while `logIntent === 'labour'`. Unlike logIntent (which
    // is cleared by the very setCurrentRoute('labour') hop this depends on),
    // this SURVIVES that hop so the labour management page can render a
    // "just logged" summary after the auto-return from the log page. Cleared
    // the moment the farmer navigates away from 'labour' so it never
    // resurfaces on an unrelated later visit.
    lastLabourLogIds: string[];
    setLastLabourLogIds: (ids: string[]) => void;
    // spec: 2026-08-25-prod-cutover-waves — Android hardware Back. Steps back
    // through the app's own route history. Returns true if it moved (or
    // changed the home tab back to 'log'), false at the root so the caller can
    // exit the app. Moves nothing but the route/tab: it never touches queued
    // or unsaved data.
    goBack: () => boolean;
    /** A screen's own back button: where he came from, else `fallback` (WP-6). */
    goBackOr: (fallback: AppRoute) => void;
    /**
     * spec: plr-d10-redesign-real-integration-2026-10-25 (I17, PLR-D9 N3/N6) — the bottom bar and
     * the header's सेट-अप केंद्र button. Opens a place on top of the home tabs (so its मागे returns
     * to the tab he was on); tapping the place he is ALREADY in returns it to its first screen.
     */
    openPlace: (route: AppRoute) => void;
    /** Bumped when a place is re-opened from the bar: the router remounts it at its first screen. */
    placeResetKey: number;
}

const MAX_HISTORY = 20;

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
    const [lastLabourLogIds, setLastLabourLogIdsState] = useState<string[]>([]);
    const [placeResetKey, setPlaceResetKey] = useState(0);
    // Back-button history. Refs (not state): reading them must not re-render,
    // and goBack must see the latest value without a stale closure.
    const routeRef = useRef<AppRoute>(currentRoute);
    const mainViewRef = useRef<PageView>(mainView);
    const historyRef = useRef<AppRoute[]>([]);
    // spec: plr-d10-redesign-real-integration-2026-10-25 (I17, H19) — हजेरी's "बोलून हजेरी" is a round
    // trip THROUGH the log page: हजेरी → log (the mic) → back to हजेरी once saved (or via its "back to
    // हजेरी" banner). Arriving on the log page clears the history (it is home), so without this the
    // farmer's मागे on हजेरी afterwards landed on the log page instead of where he had opened हजेरी from
    // (the hub). The history he had on हजेरी is kept across that one hop and handed back on return;
    // any other move forgets it.
    const labourHopRef = useRef<AppRoute[] | null>(null);

    // Any route change away from the log page ('main') clears the labour
    // hint, so it never lingers into an unrelated later visit. Routing back
    // INTO 'main' is a no-op here — the caller (renderLabourRoute) sets the
    // intent explicitly right before navigating there.
    //
    // Task 3.5: symmetrically, any route change AWAY FROM 'labour' clears
    // lastLabourLogIds — it must survive the 'labour' arrival itself (the
    // save-completion hop sets it right alongside routing there), but not
    // linger once the farmer leaves the feature.
    const applyRoute = useCallback((route: AppRoute) => {
        routeRef.current = route;
        setCurrentRouteState(route);
        if (route !== 'main') {
            setLogIntentState(null);
        }
        if (route !== 'labour') {
            setLastLabourLogIdsState(prev => (prev.length > 0 ? [] : prev));
        }
    }, []);

    // Records history for hardware Back. Home ('main') is the root: arriving
    // there clears history. Going back to the page you just came from pops
    // instead of pushing, so an in-page "back to hub" button cannot build a
    // ping-pong that Back would then replay.
    const setCurrentRoute = useCallback((route: AppRoute) => {
        const from = routeRef.current;
        if (route !== from) {
            const history = historyRef.current;
            const labourHop = labourHopRef.current;
            labourHopRef.current = null;
            if (route === 'main') {
                if (from === 'labour') labourHopRef.current = [...history];
                history.length = 0;
            } else if (route === 'labour' && from === 'main' && labourHop) {
                historyRef.current = labourHop;
            } else if (history[history.length - 1] === route) {
                history.pop();
            } else {
                history.push(from);
                if (history.length > MAX_HISTORY) history.shift();
            }
        }
        applyRoute(route);
    }, [applyRoute]);

    const setMainViewTracked = useCallback((view: PageView) => {
        mainViewRef.current = view;
        setMainView(view);
    }, []);

    // spec: plr-d10-redesign-real-integration-2026-10-25 (WP-6) — a screen's OWN back
    // button. It returns to wherever the farmer actually came from (the route history),
    // and only when there is no history does it go to the screen's usual parent. Before,
    // every in-page back went to a fixed parent: open a money page from the farm overview
    // and "back" landed on the finance menu, a screen he had never been on.
    const goBackOr = useCallback((fallback: AppRoute): void => {
        labourHopRef.current = null;
        const history = historyRef.current;
        if (history.length > 0) {
            applyRoute(history.pop() as AppRoute);
            return;
        }
        applyRoute(fallback);
    }, [applyRoute]);

    // spec: plr-d10-redesign-real-integration-2026-10-25 (I17) — the approved preview's `openPlace`
    // (PLR-D9 app/appNav.ts): a place opened from the bottom bar or the header sits on the home tabs,
    // not on whatever place he was in, so its मागे returns to the tab (the tab he was on is kept:
    // `mainView` is untouched). Tapping the place he is already in — even deep inside it (a setup page,
    // the schedule editor) — takes him back to its first screen, which before did nothing at all.
    const openPlace = useCallback((route: AppRoute): void => {
        if (route === routeRef.current) {
            if (route !== 'main') setPlaceResetKey(k => k + 1);
            return;
        }
        if (route === 'main') {
            setCurrentRoute('main');
            return;
        }
        labourHopRef.current = null;
        historyRef.current = ['main'];
        applyRoute(route);
    }, [applyRoute, setCurrentRoute]);

    const goBack = useCallback((): boolean => {
        const history = historyRef.current;
        if (history.length > 0 || routeRef.current !== 'main') labourHopRef.current = null;
        if (history.length > 0) {
            applyRoute(history.pop() as AppRoute);
            return true;
        }
        if (routeRef.current !== 'main') {
            applyRoute('main');
            return true;
        }
        if (mainViewRef.current !== 'log') {
            setMainViewTracked('log');
            return true;
        }
        return false;
    }, [applyRoute, setMainViewTracked]);

    const navigateTo = useCallback((route: AppRoute, view?: PageView) => {
        setCurrentRoute(route);
        if (view) {
            setMainViewTracked(view);
        }
    }, [setCurrentRoute, setMainViewTracked]);

    const setLogIntent = useCallback((intent: LogIntent) => {
        setLogIntentState(intent);
    }, []);

    const setLastLabourLogIds = useCallback((ids: string[]) => {
        setLastLabourLogIdsState(ids);
    }, []);

    return {
        currentRoute,
        setCurrentRoute,
        mainView,
        setMainView: setMainViewTracked,
        navigateTo,
        logIntent,
        setLogIntent,
        lastLabourLogIds,
        setLastLabourLogIds,
        goBack,
        goBackOr,
        openPlace,
        placeResetKey
    };
};
