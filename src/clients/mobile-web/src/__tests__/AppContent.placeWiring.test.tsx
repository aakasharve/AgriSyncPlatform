// @vitest-environment jsdom
// spec: plr-d10-redesign-real-integration-2026-10-25 (I17, H20 / H22; PLR-D9 N3, N6)
//
// The app shell's WIRING of the one back model, which no other test reaches: the hook
// (`useAppNavigation.openPlace`) and the route table (`SimpleRoutes` + its reset key) are tested on
// their own, so pointing the bottom bar or the header's सेट-अप केंद्र back at a plain route change would
// have kept every test green and quietly lost the re-tap reset. Here the shell is mounted with its
// heavy children replaced by thin stand-ins that press the same callbacks the real ones do.
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({
    nav: {
        currentRoute: 'profile', mainView: 'log', placeResetKey: 0,
        openPlace: vi.fn(), setCurrentRoute: vi.fn(), setMainView: vi.fn(), goBack: vi.fn(),
    },
}));

vi.mock('../features/context/components/AppHeader', () => ({
    default: (p: { onNavigate: (r: string) => void }) => (
        <div>
            {/* the header's सेट-अप केंद्र button and its sync drawer's "not synced" link */}
            <button type="button" data-testid="stub-hub" onClick={() => p.onNavigate('profile')} />
            <button type="button" data-testid="stub-conflicts" onClick={() => p.onNavigate('offline-conflicts')} />
        </div>
    ),
}));
vi.mock('../features/context/components/BottomNavigation', () => ({
    default: (p: { onNavigate: (r: string) => void }) => (
        <button type="button" data-testid="stub-bar-procurement" onClick={() => p.onNavigate('procurement')} />
    ),
}));
vi.mock('../features/context/components/MeAlertRail', () => ({ default: () => null }));
vi.mock('../core/navigation/AppRouter', () => ({ default: () => null }));
vi.mock('../shared/components/ui/ActionToast', () => ({ default: () => null }));
vi.mock('../features/weather/components/WeatherReactionPrompt', () => ({ default: () => null }));
vi.mock('../features/onboarding/components/FirstFarmWizard', () => ({ default: () => null }));
vi.mock('../features/onboarding/components/MinimalOnboarding', () => ({ default: () => null }));
vi.mock('../features/onboarding/components/JoinByCodeScreen', () => ({ default: () => null }));
vi.mock('../shared/components/AiTestModeBanner', () => ({ AiTestModeBanner: () => null }));
vi.mock('../app/context/AppFeatureContexts', () => ({
    AppFeatureProviders: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../app/hooks/useTemplateCatalogSync', () => ({ useTemplateCatalogSync: () => undefined }));
vi.mock('../app/hooks/useFarmContextState', () => ({
    OPEN_CREATE_FARM_WIZARD_EVENT: 'test:open-create-farm',
    useFarmContextState: () => ({
        myFarms: undefined, pendingFarms: [], currentFarmId: 'farm-1', showFirstFarmWizard: false,
        setShowFirstFarmWizard: vi.fn(), showMinimalOnboarding: false, handleSwitchFarm: vi.fn(),
        handleWizardComplete: vi.fn(), handleJoinViaQr: vi.fn(), showJoinByCode: false,
        closeJoinByCode: vi.fn(), handleJoinComplete: vi.fn(), handleWithdrawRequest: vi.fn(),
    }),
}));
vi.mock('../app/hooks/useCapacitorKeyboard', () => ({ useCapacitorKeyboard: () => false }));
vi.mock('../app/hooks/useAndroidBackButton', () => ({ useAndroidBackButton: () => undefined }));
vi.mock('../core/navigation/useBackDismiss', () => ({ useBackDismiss: () => undefined }));
vi.mock('../app/hooks/useSavedSurfaceScrollReset', () => ({ useSavedSurfaceScrollReset: () => undefined }));
vi.mock('../app/helpers/appContentDailyCounts', () => ({ getTodayCounts: vi.fn(), getTodayPlotData: vi.fn() }));
vi.mock('../app/helpers/appContentContextDisplay', () => ({ buildContextColorIndicator: vi.fn(), buildContextDisplay: vi.fn() }));
vi.mock('../app/helpers/appContentOversightInputs', () => ({
    buildOversightHeaderInputs: () => ({ operatorNameById: {}, plotCount: 0, unverifiedCount: 0, yesterdayNotClosed: false }),
}));
vi.mock('../shared/utils/recordingPathBusy', () => ({ isRecordingPathBusy: () => false }));
vi.mock('../app/compositionRoot', () => ({
    useAgriLogApp: () => ({
        navigation: { ...h.nav },
        context: {},
        data: {
            crops: [], history: [], plannedTasks: [], dataLoaded: true,
            farmerProfile: { name: 'Purvesh Arve', operators: [], activeOperatorId: undefined },
        },
        voice: { status: 'idle' },
        weather: {
            pendingWeatherEvent: null, setPendingWeatherEvent: vi.fn(), weatherData: null, weatherStatus: 'idle',
            boundaryUnset: false, refetchWeather: vi.fn(), handleWeatherReaction: vi.fn(),
        },
        commands: {}, trust: {}, toast: null, setToast: vi.fn(), handleReset: vi.fn(),
        lastSavedLogSummary: null, lastSavedLogIds: [],
    }),
}));

import AppContent from '../AppContent';

const mount = () => <AppContent crops={[]} setCrops={vi.fn()} />;

describe('the app shell wires the bar and the header to the one back model', () => {
    let scrolled: unknown[];
    beforeEach(() => {
        h.nav.currentRoute = 'profile';
        h.nav.placeResetKey = 0;
        scrolled = [];
        HTMLElement.prototype.scrollTo = vi.fn(function scrollTo(this: HTMLElement, arg?: unknown) {
            scrolled.push(arg);
        }) as unknown as typeof HTMLElement.prototype.scrollTo;
    });
    afterEach(() => { cleanup(); vi.clearAllMocks(); });

    it('the header\'s सेट-अप केंद्र opens the PLACE (so a re-tap from inside resets it), not a plain route change', () => {
        render(mount());
        fireEvent.click(screen.getByTestId('stub-hub'));
        expect(h.nav.openPlace).toHaveBeenCalledWith('profile');
        expect(h.nav.setCurrentRoute).not.toHaveBeenCalled();
    });

    it('a bottom-bar item opens its place the same way', () => {
        render(mount());
        fireEvent.click(screen.getByTestId('stub-bar-procurement'));
        expect(h.nav.openPlace).toHaveBeenCalledWith('procurement');
        expect(h.nav.setCurrentRoute).not.toHaveBeenCalled();
    });

    it('the sync drawer\'s "not synced" link keeps the route history (its मागे returns where he was)', () => {
        render(mount());
        fireEvent.click(screen.getByTestId('stub-conflicts'));
        expect(h.nav.setCurrentRoute).toHaveBeenCalledWith('offline-conflicts');
        expect(h.nav.openPlace).not.toHaveBeenCalled();
    });

    it('a re-tap reset (same route, new reset key) opens the first screen at its TOP', () => {
        const view = render(mount());
        scrolled.length = 0;
        // re-render with nothing changed: the page keeps its scroll
        view.rerender(mount());
        expect(scrolled).toEqual([]);
        // the re-tap: same route, the reset key moves
        h.nav.placeResetKey = 1;
        view.rerender(mount());
        expect(scrolled).toEqual([{ top: 0 }]);
    });
});
