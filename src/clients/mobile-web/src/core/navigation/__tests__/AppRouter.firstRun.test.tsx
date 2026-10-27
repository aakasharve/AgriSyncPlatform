// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I16 — FR-6, FR-7, FR-8). The first run's last
 * two steps, in the founder's order (PLR-D9 T8): … create / join → फोनच्या परवानग्या → a welcome
 * written for the ROLE. They come only once the person is IN a farm (its real role from the server);
 * with no farm the 0-farm doors (drawn by AppContent) are the screen. Back from the welcome returns to
 * the permissions. Someone who passed both long ago sees neither (P11).
 *
 * Harness as AppRouter.reviewInboxRequest.test.tsx: AppRouter's context hooks and render modules are
 * stubbed; the two first-run pages are stubbed to their props (their own suites test their content).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, act, fireEvent, cleanup } from '@testing-library/react';

const h = vi.hoisted(() => ({ prefs: {} as Record<string, unknown>, loaded: true }));

vi.mock('../../../shared/hooks/useUiPref', async () => {
    const R = await import('react');
    return {
        useUiPref: <T,>(key: string, fallback: T) => {
            const [v, setV] = R.useState<T>(() => (key in h.prefs ? (h.prefs[key] as T) : fallback));
            return [v, (n: T) => { h.prefs[key] = n; setV(n); }, h.loaded] as const;
        },
    };
});

vi.mock('../lazyComponents', () => ({
    RouteLoader: () => null,
    // Records whether the router hands the step a back at all (round-1 F1: it must not, on purpose).
    OnboardingPermissionsPage: (props: { onComplete: () => void; onBack?: () => void }) => (
        <div data-testid="stub-permissions" data-has-back={typeof props.onBack === 'function' ? 'yes' : 'no'}>
            <button type="button" onClick={props.onComplete}>perm-continue</button>
        </div>
    ),
    WelcomeScreen: ({ onContinue, onBack, farmRole, farmName }: { onContinue: () => void; onBack: () => void; farmRole: string; farmName: string }) => (
        <div data-testid="stub-role-welcome" data-role={farmRole} data-farm={farmName}>
            <button type="button" onClick={onContinue}>welcome-continue</button>
            <button type="button" onClick={onBack}>welcome-back</button>
        </div>
    ),
}));

vi.mock('../../../app/context/AppFeatureContexts', () => ({
    useAppNavigationState: () => ({
        currentRoute: 'main', setCurrentRoute: vi.fn(),
        mainView: 'log', setMainView: vi.fn(),
        logIntent: null, setLogIntent: vi.fn(), lastLabourLogIds: [],
    }),
    useAppLogState: () => ({
        logScope: { selectedCropIds: [], selectedPlotIds: [], mode: 'single', applyPolicy: 'broadcast' },
        setLogScope: vi.fn(), currentLogContext: null,
        hasActiveLogContext: false, isContextReady: false,
    }),
    useAppDataState: () => ({
        isDemoMode: false, setIsDemoMode: vi.fn(),
        farmerProfile: { operators: [], activeOperatorId: '' }, setFarmerProfile: vi.fn(),
        crops: [], mockHistory: [], realHistory: [],
        handleUpdateCrops: vi.fn(), handleAddPerson: vi.fn(), handleDeletePerson: vi.fn(),
        setLedgerDefaults: vi.fn(), ledgerDefaults: {},
        userResources: [], setUserResources: vi.fn(),
        plannedTasks: [], handleSaveTask: vi.fn(), handleUpdateTask: vi.fn(),
        showTaskCreationSheet: false, setShowTaskCreationSheet: vi.fn(),
    }),
    useAppVoiceState: () => ({
        status: 'idle', setStatus: vi.fn(), mode: 'voice', setMode: vi.fn(),
        recordingSegment: null, setRecordingSegment: vi.fn(),
        handleAudioReady: vi.fn(), handleTextReady: vi.fn(),
        error: null, errorTranscript: null,
        draftLog: null, setDraftLog: vi.fn(), provenance: null,
        voiceStreamingPhase: null, liveCaption: null,
    }),
    useAppCommandsState: () => ({ handleManualSubmit: vi.fn(), handleUpdateNote: vi.fn() }),
    useAppWeatherState: () => ({ weatherData: undefined, weatherStatus: 'idle', boundaryUnset: false, refetchWeather: vi.fn() }),
    useAppTrustState: () => ({ handleVerifyLog: vi.fn() }),
    useAppUiRuntime: () => ({ handleReset: vi.fn(), lastSavedLogSummary: [], lastSavedLogIds: [] }),
    useAppViewHelpers: () => ({ getTodayCounts: vi.fn(), getContextColorIndicator: vi.fn() }),
}));

vi.mock('../hooks/useAppRouterDerivations', () => ({
    useAppRouterDerivations: () => ({
        ownerDisplayName: 'Owner', operatorNameById: new Map(),
        todayDateKey: '2026-10-26', yesterdayDate: '2026-10-25', todayLogs: [],
        todayDayState: { closurePercent: 0, isClosed: true, completedCount: 0, plannedCount: 0, pendingCount: 0, unverifiedCount: 0 },
        yesterdayDayState: { closurePercent: 0, isClosed: true, completedCount: 0, plannedCount: 0, pendingCount: 0, unverifiedCount: 0 },
        costSnapshot: { today: 0, week: 0, cropSoFar: 0, perAcreRunning: 0, spendVelocityWeek: 0, unverifiedToday: 0, unverifiedTotal: 0 },
        yesterdayCost: 0, selectedScopeCropIds: [], selectedScopePlotIds: [],
        getLogContextSnapshot: () => ({ cropName: '', plotName: '' }),
    }),
}));
vi.mock('../../session/FarmContext', () => ({ useFarmContext: () => ({ currentFarmId: null }) }));
vi.mock('../simpleRoutes', () => ({ SIMPLE_ROUTE_RENDERERS: [], SimpleRoutes: () => null }));
vi.mock('../mainView', () => ({
    renderReflectView: () => <div data-testid="app-body" />,
    renderCompareView: () => null,
    renderLogView: () => null,
}));
vi.mock('../MainViewTransition', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('../globalSheets', () => ({ renderGlobalSheets: () => null }));

import AppRouter from '../AppRouter';
import { WAIT_WORDS_DELAY_MS } from '../../../features/onboarding/firstRun/FirstRunWait';

const OWNER_FARM = { name: 'आर्वे शेती', role: 'PrimaryOwner' };

beforeEach(() => {
    h.prefs = {};
    h.loaded = true;
});
afterEach(cleanup);

const mount = async (props: React.ComponentProps<typeof AppRouter>) => {
    await act(async () => { render(<AppRouter {...props} />); });
};

describe('AppRouter — the first run after the farm', () => {
    it('order: permissions FIRST, then the welcome for the REAL role, then the app', async () => {
        await mount({ firstRunFarm: OWNER_FARM, farmsKnown: true });
        expect(screen.getByTestId('stub-permissions')).toBeInTheDocument();
        expect(screen.queryByTestId('stub-role-welcome')).toBeNull();

        fireEvent.click(screen.getByText('perm-continue'));
        const hello = screen.getByTestId('stub-role-welcome');
        expect(hello).toHaveAttribute('data-role', 'PrimaryOwner');
        expect(hello).toHaveAttribute('data-farm', 'आर्वे शेती');

        fireEvent.click(screen.getByText('welcome-continue'));
        expect(screen.getByTestId('app-body')).toBeInTheDocument();
        expect(h.prefs).toEqual({ shramsafal_permissions_granted: true, shramsafal_welcome_seen: true });
    });

    it('back from the role welcome returns to the permissions, then forward again', async () => {
        h.prefs = { shramsafal_permissions_granted: true };
        await mount({ firstRunFarm: { name: 'पवार मळा', role: 'Worker' }, farmsKnown: true });
        expect(screen.getByTestId('stub-role-welcome')).toHaveAttribute('data-role', 'Worker');
        fireEvent.click(screen.getByText('welcome-back'));
        expect(screen.getByTestId('stub-permissions')).toBeInTheDocument();
        fireEvent.click(screen.getByText('perm-continue'));
        expect(screen.getByTestId('stub-role-welcome')).toBeInTheDocument();
    });

    it('the permissions step gets NO back from the real router (deviation from FR-8, reported): the farm is already made', async () => {
        await mount({ firstRunFarm: OWNER_FARM, farmsKnown: true });
        expect(screen.getByTestId('stub-permissions')).toHaveAttribute('data-has-back', 'no');
        // Reached again from the role welcome's back: still none — the welcome's back is the way here.
        fireEvent.click(screen.getByText('perm-continue'));
        fireEvent.click(screen.getByText('welcome-back'));
        expect(screen.getByTestId('stub-permissions')).toHaveAttribute('data-has-back', 'no');
    });

    it('no farm yet (0 farms, or only a request still waiting): no first-run step here — the doors are the screen', async () => {
        await mount({ firstRunFarm: null, farmsKnown: true });
        expect(screen.queryByTestId('stub-permissions')).toBeNull();
        expect(screen.queryByTestId('stub-role-welcome')).toBeNull();
        expect(h.prefs).toEqual({});
    });

    it('while the farm list has not answered, nothing is decided (no flash of a step)', async () => {
        await mount({ firstRunFarm: null, farmsKnown: false });
        expect(screen.getByTestId('first-run-wait')).toBeInTheDocument();
        expect(screen.queryByTestId('app-body')).toBeNull();
    });

    it('while the stored prefs have not been read, an installed user sees no step he passed long ago', async () => {
        h.loaded = false;
        await mount({ firstRunFarm: OWNER_FARM, farmsKnown: true });
        expect(screen.getByTestId('first-run-wait')).toBeInTheDocument();
        expect(screen.queryByTestId('stub-permissions')).toBeNull();
    });

    // Round-2 review WAIT-1: the wait used to be an empty area with no words.
    it('a real wait says the app is opening (in Marathi) after a beat; a blink stays quiet', async () => {
        vi.useFakeTimers();
        try {
            await mount({ firstRunFarm: null, farmsKnown: false });
            const wait = screen.getByTestId('first-run-wait');
            expect(wait).toHaveAttribute('role', 'status');
            // A blink (an installed phone reading its prefs): no words flashed.
            expect(wait.textContent).toBe('');
            await act(async () => { vi.advanceTimersByTime(WAIT_WORDS_DELAY_MS - 1); });
            expect(screen.queryByTestId('first-run-wait-words')).toBeNull();
            await act(async () => { vi.advanceTimersByTime(1); });
            expect(screen.getByTestId('first-run-wait-words')).toHaveTextContent('उघडत आहे…');
            expect(wait.textContent).not.toMatch(/[A-Za-z]/);
        } finally {
            vi.useRealTimers();
        }
    });

    it('an installed user who passed both before goes straight to the app (P11)', async () => {
        h.prefs = { shramsafal_permissions_granted: true, shramsafal_welcome_seen: true };
        await mount({ firstRunFarm: OWNER_FARM, farmsKnown: true });
        expect(screen.getByTestId('app-body')).toBeInTheDocument();
        expect(screen.queryByTestId('stub-permissions')).toBeNull();
        expect(screen.queryByTestId('stub-role-welcome')).toBeNull();
    });

    it('an installed user who saw the OLD welcome but not the permissions gets only the permissions', async () => {
        h.prefs = { shramsafal_welcome_seen: true };
        await mount({ firstRunFarm: OWNER_FARM, farmsKnown: true });
        fireEvent.click(screen.getByText('perm-continue'));
        expect(screen.queryByTestId('stub-role-welcome')).toBeNull();
        expect(screen.getByTestId('app-body')).toBeInTheDocument();
    });
});
