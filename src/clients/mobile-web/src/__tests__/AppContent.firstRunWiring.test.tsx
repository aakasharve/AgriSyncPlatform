// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I16 — FR-3, FR-6/7, FR-8; round-1 review F3 /
 * FR-3-a). AppContent's own wiring of the first run, with the REAL 0-farm screen (MinimalOnboarding →
 * FirstFarmDoors) and AppRouter stubbed to the props it is handed:
 *   - the doors' "← मागे" ends the session (AuthProvider logout) — but only after "बाहेर पडा";
 *   - the farm handed to the first run's last steps is the OPEN farm (its server role), falling back to
 *     the first listed farm when the stored one is not listed; none while the list is unknown;
 *   - while the join door is open, the first-run steps wait (its own answer is on screen).
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

const h = vi.hoisted(() => ({
    logout: vi.fn(async () => undefined),
    farmState: {} as Record<string, unknown>,
}));

vi.mock('../app/providers/AuthProvider', () => ({ useAuth: () => ({ logout: h.logout }) }));
vi.mock('../app/hooks/useFarmContextState', () => ({
    OPEN_CREATE_FARM_WIZARD_EVENT: 'test:open-create-farm-wizard',
    useFarmContextState: () => h.farmState,
}));
vi.mock('../core/navigation/AppRouter', () => ({
    default: ({ firstRunFarm, farmsKnown }: { firstRunFarm?: { name: string; role: string } | null; farmsKnown?: boolean }) => (
        <div data-testid="router" data-farm={firstRunFarm?.name ?? ''} data-role={firstRunFarm?.role ?? ''} data-known={String(farmsKnown)} />
    ),
}));
vi.mock('../app/compositionRoot', () => ({
    useAgriLogApp: () => ({
        navigation: { currentRoute: 'main', mainView: 'log', setCurrentRoute: vi.fn(), setMainView: vi.fn(), goBack: vi.fn() },
        context: {},
        data: {
            crops: [], history: [], plannedTasks: [], dataLoaded: true,
            farmerProfile: { name: 'पुरुषोत्तम', operators: [], activeOperatorId: '' },
        },
        voice: { status: 'idle' },
        weather: {
            pendingWeatherEvent: null, setPendingWeatherEvent: vi.fn(), handleWeatherReaction: vi.fn(),
            weatherData: undefined, weatherStatus: 'idle', boundaryUnset: false, refetchWeather: vi.fn(),
        },
        commands: {}, trust: {}, toast: null, setToast: vi.fn(),
        handleReset: vi.fn(), lastSavedLogSummary: [], lastSavedLogIds: [],
    }),
}));
vi.mock('../app/context/AppFeatureContexts', () => ({
    AppFeatureProviders: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('../app/helpers/appContentOversightInputs', () => ({
    buildOversightHeaderInputs: () => ({ operatorNameById: new Map(), plotCount: 0, unverifiedCount: 0, yesterdayNotClosed: false }),
}));
vi.mock('../app/helpers/appContentContextDisplay', () => ({ buildContextColorIndicator: vi.fn(), buildContextDisplay: vi.fn() }));
vi.mock('../app/hooks/useTemplateCatalogSync', () => ({ useTemplateCatalogSync: vi.fn() }));
vi.mock('../app/hooks/useCapacitorKeyboard', () => ({ useCapacitorKeyboard: () => false }));
vi.mock('../app/hooks/useAndroidBackButton', () => ({ useAndroidBackButton: vi.fn() }));
vi.mock('../core/navigation/useBackDismiss', () => ({ useBackDismiss: vi.fn() }));
vi.mock('../app/hooks/useSavedSurfaceScrollReset', () => ({ useSavedSurfaceScrollReset: vi.fn() }));
vi.mock('../features/context/components/BottomNavigation', () => ({ default: () => null }));
vi.mock('../features/context/components/AppHeader', () => ({ default: () => null }));
vi.mock('../features/context/components/MeAlertRail', () => ({ default: () => null }));
vi.mock('../shared/components/ui/ActionToast', () => ({ default: () => null }));
vi.mock('../features/weather/components/WeatherReactionPrompt', () => ({ default: () => null }));
vi.mock('../features/onboarding/components/FirstFarmWizard', () => ({ default: () => null }));
vi.mock('../shared/components/AiTestModeBanner', () => ({ AiTestModeBanner: () => null }));
vi.mock('../pages/onboarding/DawnScene', () => ({ default: () => null }));
vi.mock('../features/onboarding/components/JoinByCodeScreen', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../features/onboarding/components/JoinByCodeScreen')>()),
    default: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div data-testid="join-door" /> : null),
}));

import AppContent from '../AppContent';

const farm = (farmId: string, name: string, role: string) =>
    ({ farmId, name, role, farmCode: null, subscription: null, status: 'Active' });

const state = (over: Record<string, unknown>) => ({
    myFarms: [], pendingFarms: [], currentFarmId: null,
    showFirstFarmWizard: false, setShowFirstFarmWizard: vi.fn(),
    showMinimalOnboarding: false, setShowMinimalOnboarding: vi.fn(),
    handleSwitchFarm: vi.fn(), handleWizardComplete: vi.fn(), handleJoinViaQr: vi.fn(),
    showJoinByCode: false, closeJoinByCode: vi.fn(), handleJoinComplete: vi.fn(),
    handleWithdrawRequest: vi.fn(async () => undefined),
    ...over,
});

const mount = () => render(<AppContent crops={[]} setCrops={vi.fn()} />);

beforeEach(() => {
    h.logout.mockClear();
    h.farmState = state({});
});
afterEach(cleanup);

describe('AppContent — the first run, as wired', () => {
    it('0 farms: the doors\' "← मागे" signs out only after "बाहेर पडा" — never on the first tap', () => {
        h.farmState = state({ myFarms: [], showMinimalOnboarding: true });
        mount();
        expect(screen.getByTestId('first-farm-doors')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'मागे' }));
        expect(h.logout).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'इथेच राहा' }));
        expect(h.logout).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'मागे' }));
        fireEvent.click(screen.getByRole('button', { name: 'बाहेर पडा' }));
        expect(h.logout).toHaveBeenCalledTimes(1);
    });

    it('a person whose only seat is a request still waiting sees the doors with the waiting message, and no farm goes to the first run', () => {
        h.farmState = state({
            myFarms: [], showMinimalOnboarding: true,
            pendingFarms: [{ farmId: 'f-req', name: 'पवार शेती', role: 'Worker', farmCode: null, subscription: null, status: 'PendingApproval' }],
        });
        mount();
        expect(screen.getByTestId('first-farm-waiting')).toHaveTextContent('विनंती पाठवली');
        expect(screen.getByTestId('router')).toHaveAttribute('data-farm', '');
        expect(screen.getByTestId('router')).toHaveAttribute('data-known', 'true');
    });

    it('the first run is handed the OPEN farm with its server role', () => {
        h.farmState = state({ myFarms: [farm('f1', 'पवार मळा', 'Worker'), farm('f2', 'आर्वे शेती', 'PrimaryOwner')], currentFarmId: 'f2' });
        mount();
        expect(screen.getByTestId('router')).toHaveAttribute('data-farm', 'आर्वे शेती');
        expect(screen.getByTestId('router')).toHaveAttribute('data-role', 'PrimaryOwner');
    });

    it('a stored farm that is not listed falls back to the first listed farm (never a farm he is not in)', () => {
        h.farmState = state({ myFarms: [farm('f1', 'पवार मळा', 'Mukadam')], currentFarmId: 'f-gone' });
        mount();
        expect(screen.getByTestId('router')).toHaveAttribute('data-farm', 'पवार मळा');
        expect(screen.getByTestId('router')).toHaveAttribute('data-role', 'Mukadam');
    });

    it('while the farm list is unknown, no farm and "not known" go to the first run', () => {
        h.farmState = state({ myFarms: null });
        mount();
        expect(screen.getByTestId('router')).toHaveAttribute('data-farm', '');
        expect(screen.getByTestId('router')).toHaveAttribute('data-known', 'false');
    });

    it('while the join door is open, the first-run steps wait (its own answer is on screen)', () => {
        h.farmState = state({ myFarms: [farm('f1', 'पवार मळा', 'Worker')], currentFarmId: 'f1', showJoinByCode: true });
        mount();
        expect(screen.getByTestId('join-door')).toBeInTheDocument();
        expect(screen.getByTestId('router')).toHaveAttribute('data-farm', '');
    });
});
