// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I14 — CMP-3 = H05 = P-1 = MU-21)
 *
 * The ORIGINAL H05 bug was a missing wire: `OversightNavCards` could hide a tab, but `AppContent` never told
 * `AppHeader` which. This pins that wire: the app shell reads the person's role on the CURRENT farm and hands
 * `AppHeader` the hidden tabs (a worker: तुलना), and nothing for an owner. Everything around `AppHeader` is a
 * stub; `AppHeader` → `OversightNavCards` is covered in `compareHiddenForWorker.test.tsx`.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

const h = vi.hoisted(() => ({
    role: 'Worker' as string | undefined,
    headerProps: [] as Array<{ hiddenViews?: readonly string[] }>,
}));
const { Nothing } = vi.hoisted(() => ({ Nothing: () => null }));
vi.mock('../../../features/context/components/AppHeader', () => ({
    default: (props: { hiddenViews?: readonly string[] }) => { h.headerProps.push(props); return null; },
}));
vi.mock('../../../features/context/components/BottomNavigation', () => ({ default: Nothing }));
vi.mock('../../../features/context/components/MeAlertRail', () => ({ default: Nothing }));
vi.mock('../AppRouter', () => ({ default: Nothing }));
vi.mock('../../../shared/components/ui/ActionToast', () => ({ default: Nothing }));
vi.mock('../../../features/weather/components/WeatherReactionPrompt', () => ({ default: Nothing }));
vi.mock('../../../features/onboarding/components/FirstFarmWizard', () => ({ default: Nothing }));
vi.mock('../../../features/onboarding/components/MinimalOnboarding', () => ({ default: Nothing }));
vi.mock('../../../features/onboarding/components/JoinByCodeScreen', () => ({ default: Nothing }));
vi.mock('../../../shared/components/AiTestModeBanner', () => ({ AiTestModeBanner: Nothing }));
vi.mock('../../../app/context/AppFeatureContexts', () => ({ AppFeatureProviders: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../../../app/hooks/useTemplateCatalogSync', () => ({ useTemplateCatalogSync: () => undefined }));
vi.mock('../../../app/hooks/useCapacitorKeyboard', () => ({ useCapacitorKeyboard: () => false }));
vi.mock('../../../app/hooks/useAndroidBackButton', () => ({ useAndroidBackButton: () => undefined }));
vi.mock('../useBackDismiss', () => ({ useBackDismiss: () => undefined }));
vi.mock('../../../app/hooks/useSavedSurfaceScrollReset', () => ({ useSavedSurfaceScrollReset: () => undefined }));
vi.mock('../../../app/helpers/appContentOversightInputs', () => ({
    buildOversightHeaderInputs: () => ({ operatorNameById: new Map(), plotCount: 0, unverifiedCount: 0, yesterdayNotClosed: false }),
}));
vi.mock('../../../app/hooks/useFarmContextState', () => ({
    OPEN_CREATE_FARM_WIZARD_EVENT: 'test:open-create-farm',
    useFarmContextState: () => ({
        myFarms: [{ farmId: 'farm-1', name: 'आर्वे शेत' }], pendingFarms: [], currentFarmId: 'farm-1',
        showFirstFarmWizard: false, setShowFirstFarmWizard: vi.fn(), showMinimalOnboarding: false,
        handleSwitchFarm: vi.fn(), handleWizardComplete: vi.fn(), handleJoinViaQr: vi.fn(),
        showJoinByCode: false, closeJoinByCode: vi.fn(), handleJoinComplete: vi.fn(), handleWithdrawRequest: vi.fn(),
    }),
}));
vi.mock('../../../app/compositionRoot', () => ({
    useAgriLogApp: () => ({
        navigation: { currentRoute: 'main', mainView: 'log', setCurrentRoute: vi.fn(), setMainView: vi.fn(), goBack: vi.fn() },
        context: {},
        data: { crops: [], history: [], plannedTasks: [], farmerProfile: { operators: [], activeOperatorId: '' }, dataLoaded: true },
        voice: { status: 'idle' },
        weather: { weatherData: undefined, weatherStatus: 'idle', boundaryUnset: false, refetchWeather: vi.fn(), pendingWeatherEvent: null, setPendingWeatherEvent: vi.fn() },
        commands: {}, trust: {}, toast: null, setToast: vi.fn(), handleReset: vi.fn(), lastSavedLogSummary: [], lastSavedLogIds: [],
    }),
}));
vi.mock('../../session/FarmContext', () => ({
    useOptionalFarmContext: () => ({ currentFarm: h.role ? { farmId: 'farm-1', role: h.role } : null }),
}));

import AppContent from '../../../AppContent';

afterEach(() => { cleanup(); h.headerProps.length = 0; });

const renderShell = (role: string | undefined) => {
    h.role = role;
    render(<AppContent crops={[]} setCrops={vi.fn()} />);
    return h.headerProps.at(-1);
};

describe('the app shell hands AppHeader the tabs this person may not open', () => {
    it('a worker on the current farm: तुलना is hidden in the switcher', () => {
        expect(renderShell('Worker')?.hiddenViews).toEqual(['compare']);
    });

    it('an owner or a mukadam: nothing hidden', () => {
        expect(renderShell('PrimaryOwner')?.hiddenViews).toEqual([]);
        cleanup();
        expect(renderShell('Mukadam')?.hiddenViews).toEqual([]);
    });

    it('role not known yet (no /me/context answer): nothing hidden — the documented fail-open limit', () => {
        expect(renderShell(undefined)?.hiddenViews).toEqual([]);
    });
});
