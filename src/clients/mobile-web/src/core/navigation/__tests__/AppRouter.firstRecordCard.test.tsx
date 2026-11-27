// @vitest-environment jsdom
/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 — repair R1-g Part 1, task 1a (founder Q5 = Option A, 27 Nov; CTO
 * rulings 1-2). After "चला, सुरुवात करूया" a farm owner (or a co-owner) gets ONE card, in his words: "आज शेतात काय काय
 * केलं?" / "जसं आठवतंय, तसं सांगा. बाकी आम्ही करू." / "बोलायला सुरुवात करा" / "नंतर सांगेन".
 *   - once, on the first run only, with its own once-only key (`shramsafal_first_record_card_v1_seen`);
 *   - a worker or a मुकादम lands where he lands today;
 *   - an installed phone that passed the first run long ago never sees it (P11);
 *   - "बोलायला सुरुवात करा" opens the normal voice entry of the real farm (the "झालेले काम सांगा" path): on a farm with no
 *     crop straight on "संपूर्ण शेत" and the mic, with crops the crop step;
 *   - "नंतर सांगेन" goes Home, and nothing is started.
 *
 * Harness as AppRouter.firstRun.test.tsx (the context hooks and render modules stubbed), but the card itself is the REAL one.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, act, fireEvent, cleanup } from '@testing-library/react';

const h = vi.hoisted(() => ({
    prefs: {} as Record<string, unknown>,
    crops: [] as unknown[],
    status: 'idle' as string,
    setCurrentRoute: (() => undefined) as (route: string) => void,
    setMainView: (() => undefined) as (view: string) => void,
    setLogScope: (() => undefined) as (scope: unknown) => void,
    setMode: (() => undefined) as (mode: string) => void,
    handleReset: (() => undefined) as () => void,
}));

vi.mock('../../../shared/hooks/useUiPref', async () => {
    const R = await import('react');
    return {
        useUiPref: <T,>(key: string, fallback: T) => {
            const [v, setV] = R.useState<T>(() => (key in h.prefs ? (h.prefs[key] as T) : fallback));
            return [v, (n: T) => { h.prefs[key] = n; setV(n); }, true] as const;
        },
    };
});

vi.mock('../../../pages/onboarding/DawnScene', () => ({ default: () => null }));

vi.mock('../lazyComponents', async () => {
    const card = await import('../../../pages/onboarding/FirstRecordCard');
    return {
        RouteLoader: () => null,
        OnboardingPermissionsPage: (props: { onComplete: () => void }) => (
            <div data-testid="stub-permissions"><button type="button" onClick={props.onComplete}>perm-continue</button></div>
        ),
        WelcomeStory: ({ onDone }: { onDone: (listened: boolean) => void }) => (
            <div data-testid="stub-voice-note"><button type="button" onClick={() => onDone(true)}>voice-done</button></div>
        ),
        WelcomeScreen: ({ onContinue, onBack, farmRole }: { onContinue: () => void; onBack: () => void; farmRole: string }) => (
            <div data-testid="stub-role-welcome" data-role={farmRole}>
                <button type="button" onClick={onContinue}>welcome-continue</button>
                <button type="button" onClick={onBack}>welcome-back</button>
            </div>
        ),
        // The REAL card: its words and its buttons are what this suite asserts.
        FirstRecordCard: card.default,
    };
});

vi.mock('../../../app/context/AppFeatureContexts', () => ({
    useAppNavigationState: () => ({
        currentRoute: 'main', setCurrentRoute: h.setCurrentRoute,
        mainView: 'log', setMainView: h.setMainView,
        logIntent: null, setLogIntent: vi.fn(), lastLabourLogIds: [],
    }),
    useAppLogState: () => ({
        logScope: { selectedCropIds: [], selectedPlotIds: [], mode: 'single', applyPolicy: 'broadcast' },
        setLogScope: h.setLogScope, currentLogContext: null,
        hasActiveLogContext: false, isContextReady: false,
    }),
    useAppDataState: () => ({
        isDemoMode: false, setIsDemoMode: vi.fn(),
        farmerProfile: { operators: [], activeOperatorId: '' }, setFarmerProfile: vi.fn(),
        crops: h.crops, mockHistory: [], realHistory: [],
        handleUpdateCrops: vi.fn(), handleAddPerson: vi.fn(), handleDeletePerson: vi.fn(),
        setLedgerDefaults: vi.fn(), ledgerDefaults: {},
        userResources: [], setUserResources: vi.fn(),
        plannedTasks: [], handleSaveTask: vi.fn(), handleUpdateTask: vi.fn(),
        showTaskCreationSheet: false, setShowTaskCreationSheet: vi.fn(),
    }),
    useAppVoiceState: () => ({
        status: h.status, setStatus: vi.fn(), mode: 'voice', setMode: h.setMode,
        recordingSegment: null, setRecordingSegment: vi.fn(),
        handleAudioReady: vi.fn(), handleTextReady: vi.fn(),
        error: null, errorTranscript: null,
        draftLog: null, setDraftLog: vi.fn(), provenance: null,
        voiceStreamingPhase: null, liveCaption: null,
    }),
    useAppCommandsState: () => ({ handleManualSubmit: vi.fn(), handleUpdateNote: vi.fn() }),
    useAppWeatherState: () => ({ weatherData: undefined, weatherStatus: 'idle', boundaryUnset: false, refetchWeather: vi.fn() }),
    useAppTrustState: () => ({ handleVerifyLog: vi.fn() }),
    useAppUiRuntime: () => ({ handleReset: h.handleReset, lastSavedLogSummary: [], lastSavedLogIds: [] }),
    useAppViewHelpers: () => ({ getTodayCounts: vi.fn(), getContextColorIndicator: vi.fn() }),
}));

vi.mock('../hooks/useAppRouterDerivations', () => ({
    useAppRouterDerivations: () => ({
        ownerDisplayName: 'Owner', operatorNameById: new Map(),
        todayDateKey: '2026-11-28', yesterdayDate: '2026-11-27', todayLogs: [],
        todayDayState: { closurePercent: 0, isClosed: true, completedCount: 0, plannedCount: 0, pendingCount: 0, unverifiedCount: 0 },
        yesterdayDayState: { closurePercent: 0, isClosed: true, completedCount: 0, plannedCount: 0, pendingCount: 0, unverifiedCount: 0 },
        costSnapshot: { today: 0, week: 0, cropSoFar: 0, perAcreRunning: 0, spendVelocityWeek: 0, unverifiedToday: 0, unverifiedTotal: 0 },
        yesterdayCost: 0, selectedScopeCropIds: [], selectedScopePlotIds: [],
        getLogContextSnapshot: () => ({ cropName: '', plotName: '' }),
    }),
}));
vi.mock('../../session/FarmContext', () => ({ useFarmContext: () => ({ currentFarmId: 'farm-1' }) }));
vi.mock('../simpleRoutes', () => ({ SIMPLE_ROUTE_RENDERERS: [], SimpleRoutes: () => null }));
vi.mock('../mainView', () => ({
    renderReflectView: () => <div data-testid="app-body" />,
    renderCompareView: () => null,
    renderLogView: () => null,
}));
vi.mock('../MainViewTransition', () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('../globalSheets', () => ({ renderGlobalSheets: () => null }));

import AppRouter from '../AppRouter';
import { clearEntryOpening, peekEntryOpening } from '../../../features/logs/components/entry/entryOpening';

const CARD_KEY = 'shramsafal_first_record_card_v1_seen';
const OWNER_FARM = { name: 'आर्वे शेती', role: 'PrimaryOwner' };
/** The prefs of a NEW phone that has just heard the voice note: a joiner's role welcome, or the primary owner's card, is next. */
const AT_WELCOME = { shramsafal_permissions_granted: true, shramsafal_welcome_voice_v1_seen: true };
const WHOLE_FARM = { selectedCropIds: ['FARM_GLOBAL'], selectedPlotIds: [], mode: 'single', applyPolicy: 'broadcast' };
const NO_PLACE = { selectedCropIds: [], selectedPlotIds: [], mode: 'single', applyPolicy: 'broadcast' };
const GRAPES = { id: 'grape', name: 'द्राक्ष', iconName: 'Grape', plots: [{ id: 'g1', name: 'सोनाका' }] };

beforeEach(() => {
    h.prefs = {};
    h.crops = [];
    h.status = 'idle';
    h.setCurrentRoute = vi.fn();
    h.setMainView = vi.fn();
    h.setLogScope = vi.fn();
    h.setMode = vi.fn();
    h.handleReset = vi.fn();
    clearEntryOpening();
});
afterEach(() => { cleanup(); clearEntryOpening(); });

const mount = async (firstRunFarm: { name: string; role: string } | null = OWNER_FARM) => {
    await act(async () => { render(<AppRouter firstRunFarm={firstRunFarm} farmsKnown />); });
};
const textOf = (testId: string) => screen.getByTestId(testId).textContent ?? '';

describe('R1-g 1a — the first-record card after "चला, सुरुवात करूया"', () => {
    // Repair R3 lane S2 (V6a-B; R1 §05): the primary owner has no role welcome any more — the card follows the voice note.
    it('the primary owner: the card, in his own words, right after the voice note (no role welcome)', async () => {
        h.prefs = { ...AT_WELCOME };
        await mount();
        expect(screen.queryByTestId('stub-role-welcome')).toBeNull();
        expect(screen.getByTestId('first-record-card')).toBeInTheDocument();
        expect(screen.queryByTestId('app-body')).toBeNull();
        expect(textOf('first-record-title')).toBe('आज शेतात काय काय केलं?');
        expect(textOf('first-record-line')).toBe('जसं आठवतंय, तसं सांगा. बाकी आम्ही करू.');
        expect(textOf('first-record-start')).toBe('बोलायला सुरुवात करा');
        expect(textOf('first-record-later')).toBe('नंतर सांगेन');
        // Nothing is written until he answers it (the welcome's "not seen" is what keeps it due).
        expect(h.prefs[CARD_KEY]).toBeUndefined();
        expect(h.prefs.shramsafal_welcome_seen).toBeUndefined();
    });

    it('the primary owner: the app closed while the card showed — it shows again on the next open', async () => {
        h.prefs = { ...AT_WELCOME };
        await mount();
        expect(screen.getByTestId('first-record-card')).toBeInTheDocument();
        cleanup();
        await mount();
        expect(screen.getByTestId('first-record-card')).toBeInTheDocument();
    });

    it('a co-owner sees it too ("the farm owner"); a worker and a मुकादम land where they land today', async () => {
        h.prefs = { ...AT_WELCOME };
        await mount({ name: 'पवार मळा', role: 'SecondaryOwner' });
        fireEvent.click(screen.getByText('welcome-continue'));
        expect(screen.getByTestId('first-record-card')).toBeInTheDocument();
        cleanup();
        for (const role of ['Worker', 'Mukadam']) {
            h.prefs = { ...AT_WELCOME };
            await mount({ name: 'पवार मळा', role });
            fireEvent.click(screen.getByText('welcome-continue'));
            expect(screen.queryByTestId('first-record-card'), role).toBeNull();
            expect(screen.getByTestId('app-body')).toBeInTheDocument();
            expect(h.prefs[CARD_KEY], role).toBeUndefined();
            cleanup();
        }
    });

    it('"नंतर सांगेन": Home, the card is never shown again, and nothing is started', async () => {
        h.prefs = { ...AT_WELCOME };
        await mount();
        fireEvent.click(screen.getByTestId('first-record-later'));
        expect(screen.queryByTestId('first-record-card')).toBeNull();
        expect(screen.getByTestId('app-body')).toBeInTheDocument();
        expect(h.prefs[CARD_KEY]).toBe(true);
        expect(h.prefs.shramsafal_welcome_seen).toBe(true);
        expect(h.setLogScope).not.toHaveBeenCalled();
        expect(h.setMode).not.toHaveBeenCalled();
        expect(peekEntryOpening()).toBeNull();
        // Home is the log tab (the router was already on it: no hop made)
        expect(h.setCurrentRoute).not.toHaveBeenCalled();
        expect(h.setMainView).not.toHaveBeenCalled();
        cleanup();
        // The next open goes straight to the app: nothing nags later.
        await mount();
        expect(screen.queryByTestId('first-record-card')).toBeNull();
        expect(screen.getByTestId('app-body')).toBeInTheDocument();
    });

    it('P11: an installed phone that passed the first run long ago never sees the card, and nothing is written', async () => {
        h.prefs = { ...AT_WELCOME, shramsafal_welcome_seen: true };
        await mount();
        expect(screen.getByTestId('app-body')).toBeInTheDocument();
        expect(screen.queryByTestId('first-record-card')).toBeNull();
        expect(h.prefs).toEqual({ ...AT_WELCOME, shramsafal_welcome_seen: true });
    });

    it('P11: an installed phone that has the voice note still to hear goes straight in after it, with no card', async () => {
        h.prefs = { shramsafal_permissions_granted: true, shramsafal_welcome_seen: true };
        await mount();
        fireEvent.click(screen.getByText('voice-done'));
        expect(screen.getByTestId('app-body')).toBeInTheDocument();
        expect(screen.queryByTestId('first-record-card')).toBeNull();
        expect(h.prefs[CARD_KEY]).toBeUndefined();
    });

    it('the app closed while the card showed: it shows again on the next open (it was not answered)', async () => {
        h.prefs = { ...AT_WELCOME, shramsafal_welcome_seen: true, [CARD_KEY]: false };
        await mount();
        expect(screen.getByTestId('first-record-card')).toBeInTheDocument();
    });

    it('a co-owner: its "मागे" returns to the welcome, and forward again to the card', async () => {
        h.prefs = { ...AT_WELCOME };
        await mount({ name: 'पवार मळा', role: 'SecondaryOwner' });
        fireEvent.click(screen.getByText('welcome-continue'));
        fireEvent.click(screen.getByTestId('first-run-back'));
        expect(screen.getByTestId('stub-role-welcome')).toBeInTheDocument();
        expect(screen.queryByTestId('first-record-card')).toBeNull();
        fireEvent.click(screen.getByText('welcome-continue'));
        expect(screen.getByTestId('first-record-card')).toBeInTheDocument();
    });

    it('the primary owner: its "मागे" returns to the permissions (the step before), and forward again to the card', async () => {
        h.prefs = { ...AT_WELCOME };
        await mount();
        fireEvent.click(screen.getByTestId('first-run-back'));
        expect(screen.getByTestId('stub-permissions')).toBeInTheDocument();
        expect(screen.queryByTestId('first-record-card')).toBeNull();
        fireEvent.click(screen.getByText('perm-continue'));
        expect(screen.getByTestId('first-record-card')).toBeInTheDocument();
        expect(screen.queryByTestId('stub-role-welcome')).toBeNull();
    });
});

describe('R1-g 1a — "बोलायला सुरुवात करा" opens the normal voice entry of the real farm', () => {
    it('a farm with no crop: straight on "संपूर्ण शेत" and the mic (no one-tile question)', async () => {
        h.prefs = { ...AT_WELCOME };
        h.crops = [];
        await mount();
        fireEvent.click(screen.getByTestId('first-record-start'));
        expect(screen.queryByTestId('first-record-card')).toBeNull();
        expect(screen.getByTestId('app-body')).toBeInTheDocument();
        expect(h.prefs[CARD_KEY]).toBe(true);
        // The log tab, in voice mode, on the whole farm: the entry flow opens on its mic step (LogEntryFlow's own rule).
        expect(h.setLogScope).toHaveBeenCalledTimes(1);
        expect(h.setLogScope).toHaveBeenCalledWith(WHOLE_FARM);
        expect(h.setMode).toHaveBeenCalledWith('voice');
        expect(h.setMainView).toHaveBeenCalledWith('log');
        expect(peekEntryOpening()).toBeNull();
    });

    it('a farm with crops: the normal crop step, as "झालेले काम सांगा" opens it', async () => {
        h.prefs = { ...AT_WELCOME };
        h.crops = [GRAPES];
        await mount();
        fireEvent.click(screen.getByTestId('first-record-start'));
        expect(screen.getByTestId('app-body')).toBeInTheDocument();
        expect(h.setLogScope).toHaveBeenCalledTimes(1);
        expect(h.setLogScope).toHaveBeenCalledWith(NO_PLACE);
        expect(h.setMode).toHaveBeenCalledWith('voice');
        expect(h.setMainView).toHaveBeenCalledWith('log');
        // The log tab's entry flow is asked to open on the crop question (read once when it mounts).
        expect(peekEntryOpening()).toBe('crop');
    });
});
