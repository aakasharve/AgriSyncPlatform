import { useState, useCallback } from 'react';
import { AppRoute, PageView } from '../../types';

export interface UseAppNavigationResult {
    currentRoute: AppRoute;
    setCurrentRoute: (route: AppRoute) => void;
    mainView: PageView;
    setMainView: (view: PageView) => void;
    navigateTo: (route: AppRoute, view?: PageView) => void;
}

export const useAppNavigation = (): UseAppNavigationResult => {
    const [currentRoute, setCurrentRoute] = useState<AppRoute>('main');
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
