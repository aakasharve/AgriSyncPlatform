// @vitest-environment jsdom
//
// spec: dfes-companion-2026-07-11
//
// renderLogView — Task 5 "राहिलं → झालं" suggest-and-confirm task close, wired
// onto the "Saved to Ledger" success card.
//
// Proves the wiring contract:
//   • taskCloseConfirm OFF → findConfirmableTaskCloses is NEVER called (not
//     just hidden) and no TaskCloseConfirm card renders.
//   • taskCloseConfirm ON + a candidate → the card renders with the task's
//     title; tapping होय calls ctx.handleUpdateTask(taskId, {status:'done',
//     completedAt}) — the SAME mutation ToDoTasksBlock's toggle uses — and
//     emits one traceability log event. Tapping नाही does NOT call
//     handleUpdateTask (task stays pending, no penalty) and hides the card.
//   • taskCloseConfirm ON + no candidate → matcher is called but nothing
//     renders (no false positive surfaced).
//
// Heavy success-card children are stubbed; the recognition panel becomes a
// recognizable marker. featureFlags, the taskAutoClose matcher, and the
// observability logger are mocked (matcher logic itself is separately unit
// -tested in taskAutoClose.test.ts). Mirrors the mock-then-dynamic-import
// pattern in mainView.successClarity.test.tsx.
import React from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { AppRouterContext } from '../routeContext';
import type { PlannedTask } from '../../../types';

const stub = (label: string) => ({
    default: () => React.createElement('div', { 'data-stub': label }),
});

function makeTask(overrides: Partial<PlannedTask> = {}): PlannedTask {
    return {
        id: 'task-1',
        title: 'Pruning',
        plotId: 'plot-a',
        cropId: 'crop-1',
        priority: 'normal',
        status: 'pending',
        sourceType: 'manual',
        createdAt: '2026-07-01T06:00:00.000Z',
        dueDate: '2026-07-14',
        ...overrides,
    };
}

async function loadRenderLogView(taskCloseConfirm: boolean, findConfirmableTaskClosesImpl: (...args: unknown[]) => unknown) {
    vi.resetModules();

    vi.doMock('../../../features/context/components/CropSelector', () => ({
        default: () => React.createElement('div', { 'data-stub': 'crop-selector' }),
        CropSymbol: () => null,
    }));
    vi.doMock('../../../shared/components/ui/InputMethodToggle', () => stub('input-toggle'));
    vi.doMock('../../../features/weather/components/WeatherWidget', () => stub('weather'));
    vi.doMock('../../../features/voice/components/AudioRecorder', () => stub('audio'));
    vi.doMock('../../../features/voice/components/AudioRecorderStreaming', () => stub('audio-streaming'));
    vi.doMock('../../../features/voice/components/LiveCaption', () => stub('live-caption'));
    vi.doMock('../../../features/logs/components/ManualEntry', () => stub('manual-entry'));
    vi.doMock('../../../features/logs/components/DailyLogCard', () => stub('daily-log-card'));
    vi.doMock('../../../features/logs/components/LedgerRecognitionPanel', () => ({
        LedgerRecognitionPanel: () =>
            React.createElement('div', { 'data-testid': 'ledger-recognition-panel' }),
    }));
    vi.doMock('../../../features/logs/components/shramsathi/VoiceSavedReassurance', () => stub('voice-saved'));

    vi.doMock('../../../i18n/LanguageContext', () => ({
        useLanguage: () => ({ language: 'mr', setLanguage: () => {}, t: (k: string) => k }),
    }));

    vi.doMock('../../../app/featureFlags', () => ({
        FEATURE_FLAGS: { dailyLoop: false, voiceContinuity: false, taskCloseConfirm },
        IS_E2E_HARNESS_ENABLED: false,
        isE2EHarnessEnabled: () => false,
        isFarmGeographyV2Enabled: () => false,
        isWeatherBackendFetchEnabled: () => false,
        isVoiceDoomLoopDetectorEnabled: () => true,
    }));

    const findConfirmableTaskCloses = vi.fn(findConfirmableTaskClosesImpl);
    vi.doMock('../../../features/logs/services/taskAutoClose', () => ({
        findConfirmableTaskCloses,
        TASK_CLOSE_STALE_DAYS: 21,
    }));

    const loggerInfo = vi.fn();
    vi.doMock('../../../infrastructure/observability/Logger', () => ({
        logger: { info: loggerInfo, warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    }));

    const mod = await import('../mainView');
    return { renderLogView: mod.renderLogView, findConfirmableTaskCloses, loggerInfo };
}

function makeCtx(overrides: Partial<AppRouterContext> = {}): AppRouterContext {
    const today = {
        closurePercent: 40,
        isClosed: false,
        // wave-2.4 follow-up: this day HAS begun (5 planned, 3 done) — the
        // not-started state is exercised in mainView.dailyLoop.test.tsx.
        hasStarted: true,
        completedCount: 3,
        plannedCount: 5,
        pendingCount: 2,
        unverifiedCount: 0,
    };
    const yesterday = { ...today, isClosed: false, pendingCount: 2 };

    return {
        currentRoute: 'main',
        mainView: 'log',
        status: 'success',
        mode: 'voice',
        recordingSegment: null,
        weatherData: null,
        weatherStatus: 'idle',
        boundaryUnset: false,
        refetchWeather: () => {},
        setCurrentRoute: () => {},
        ownerDisplayName: 'Owner',
        todayDayState: today,
        yesterdayDayState: yesterday,
        showCloseDaySummary: false,
        setShowCloseDaySummary: () => {},
        showCloseYesterdaySummary: false,
        setShowCloseYesterdaySummary: () => {},
        setShowReviewInbox: () => {},
        setMainView: () => {},
        crops: [],
        logScope: { selectedCropIds: [], selectedPlotIds: [], mode: 'single', applyPolicy: 'broadcast' },
        setLogScope: () => {},
        setMode: () => {},
        setStatus: () => {},
        hasActiveLogContext: false,
        isContextReady: false,
        error: null,
        errorTranscript: undefined,
        handleAudioReady: () => {},
        handleTextReady: () => {},
        handleManualSubmit: () => {},
        currentLogContext: null,
        ledgerDefaults: {},
        farmerProfile: { operators: [], activeOperatorId: '' },
        draftLog: null,
        setDraftLog: () => {},
        provenance: undefined,
        voiceStreamingPhase: 'idle',
        liveCaption: '',
        continuityLevel: null,
        savedPendingCaptureId: null,
        getTodayCounts: () => ({}),
        getContextColorIndicator: () => null,
        plannedTasks: [],
        handleUpdateTask: () => {},
        history: [],
        todayLogs: [],
        operatorNameById: new Map(),
        getLogContextSnapshot: () => ({ cropName: '', plotName: '' }),
        handleEditLog: () => {},
        costSnapshot: { today: 0, cropSoFar: 0, unverifiedToday: 0 },
        yesterdayCost: 0,
        setRecordingSegment: () => {},
        lastSavedLogSummary: [],
        lastSavedLogIds: [],
        mockHistory: [],
        handleReset: () => {},
        ...overrides,
    } as unknown as AppRouterContext;
}

afterEach(() => {
    cleanup();
    vi.resetModules();
});

describe('renderLogView — Task 5 suggest-and-confirm task close (success card)', () => {
    it('OFF: findConfirmableTaskCloses is never called and no card renders', async () => {
        const { renderLogView, findConfirmableTaskCloses } = await loadRenderLogView(false, () => []);
        render(<>{renderLogView(makeCtx())}</>);

        expect(screen.getByTestId('saved-to-ledger')).toBeInTheDocument();
        expect(screen.queryByTestId('task-close-confirm')).toBeNull();
        expect(findConfirmableTaskCloses).not.toHaveBeenCalled();
    });

    it('ON + no candidate: matcher is called but nothing renders (no false positive)', async () => {
        const { renderLogView, findConfirmableTaskCloses } = await loadRenderLogView(true, () => []);
        render(<>{renderLogView(makeCtx())}</>);

        expect(findConfirmableTaskCloses).toHaveBeenCalled();
        expect(screen.queryByTestId('task-close-confirm')).toBeNull();
    });

    it('ON + a candidate: card renders with the task title, positioned in the success card', async () => {
        const task = makeTask();
        const { renderLogView } = await loadRenderLogView(true, () => [
            { task, matchedActivityTitle: 'Pruning done today' },
        ]);
        render(<>{renderLogView(makeCtx())}</>);

        const card = screen.getByTestId('task-close-confirm');
        expect(card).toBeInTheDocument();
        expect(screen.getByTestId('task-close-confirm-title')).toHaveTextContent('Pruning');
    });

    it('होय calls handleUpdateTask(taskId, {status:"done", completedAt}) and emits ONE traceability log event', async () => {
        const task = makeTask();
        const handleUpdateTask = vi.fn();
        const { renderLogView, loggerInfo } = await loadRenderLogView(true, () => [
            { task, matchedActivityTitle: 'Pruning done today' },
        ]);
        render(<>{renderLogView(makeCtx({ handleUpdateTask }))}</>);

        fireEvent.click(screen.getByTestId('task-close-confirm-yes'));

        expect(handleUpdateTask).toHaveBeenCalledTimes(1);
        const [taskId, updates] = handleUpdateTask.mock.calls[0];
        expect(taskId).toBe('task-1');
        expect(updates).toMatchObject({ status: 'done' });
        expect(typeof updates.completedAt).toBe('string');

        expect(loggerInfo).toHaveBeenCalledTimes(1);
        expect(loggerInfo.mock.calls[0][0]).toBe('task_close.confirmed');
    });

    it('नाही does NOT call handleUpdateTask (task stays pending, no penalty) and hides the card', async () => {
        const task = makeTask();
        const handleUpdateTask = vi.fn();
        const { renderLogView } = await loadRenderLogView(true, () => [
            { task, matchedActivityTitle: 'Pruning done today' },
        ]);
        render(<>{renderLogView(makeCtx({ handleUpdateTask }))}</>);

        fireEvent.click(screen.getByTestId('task-close-confirm-no'));

        expect(handleUpdateTask).not.toHaveBeenCalled();
        expect(screen.queryByTestId('task-close-confirm')).toBeNull();
    });
});
