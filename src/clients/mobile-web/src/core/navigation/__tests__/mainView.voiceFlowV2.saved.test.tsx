// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (Task 12; amendment M5) — the log tab around the saved screen, flag ON:
 *   - the saved screen's self-move and its end button reset the flow with NO plot chosen and open पूर्ण शेतीचा आढावा (plr-d10 B6);
 *     back on the log tab it opens on the work home (the mic is never armed by it — spec V2-5);
 *   - the sticky back first takes the step from the detail page to the saved screen (tap and browser back), and leaves the
 *     surface only when there is no such step;
 *   - flag OFF: no close is handed to the screen and the sticky back is the reset, as before.
 * The result screen itself is tested in voiceResult/__tests__; here it is a recording stub of its props.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AppRouterContext } from '../routeContext';
import type { DailyLog, LogScope } from '../../../types';

const stub = (label: string) => ({ default: () => React.createElement('div', { 'data-stub': label }) });
const seen: { props: Record<string, unknown> | null } = { props: null };

async function load(voiceFlowV2: boolean) {
    vi.resetModules();
    vi.doMock('../../../features/voice/components/AudioRecorder', () => stub('audio'));
    vi.doMock('../../../features/voice/components/AudioRecorderStreaming', () => stub('audio-streaming'));
    vi.doMock('../../../features/voice/components/LiveCaption', () => stub('live-caption'));
    vi.doMock('../../../features/appUpdate/AppUpdateCard', () => ({ AppUpdateCard: () => null }));
    vi.doMock('../../../features/logs/components/LedgerRecognitionPanel', () => ({ LedgerRecognitionPanel: () => null }));
    vi.doMock('../../../features/logs/components/voiceResult/VoiceResultContainer', () => ({
        VoiceResultContainer: (p: Record<string, unknown>) => {
            seen.props = p;
            return React.createElement('div', { 'data-testid': 'voice-result-stub' });
        },
    }));
    vi.doMock('../../../i18n/LanguageContext', () => ({
        useLanguage: () => ({ language: 'mr', setLanguage: () => {}, t: (k: string) => k }),
        useOptionalLanguage: () => ({ language: 'mr' }),
    }));
    vi.doMock('../../../app/featureFlags', () => ({
        FEATURE_FLAGS: { dailyLoop: false, voiceContinuity: false, taskCloseConfirm: false, understandingMeter: false, voiceFlowV2 },
        IS_E2E_HARNESS_ENABLED: false,
        isE2EHarnessEnabled: () => false,
        isFarmGeographyV2Enabled: () => false,
        isWeatherBackendFetchEnabled: () => false,
        isVoiceDoomLoopDetectorEnabled: () => true,
    }));
    const mod = await import('../mainView');
    const back = await import('../../../features/logs/components/voiceFlowV2/detailBack');
    return { renderLogView: mod.renderLogView, back };
}

const SAVED: DailyLog = {
    id: 'LOG-1', date: '2026-10-26', fullTranscript: 'चार मजूर आले',
    context: { selection: [{ farmId: 'farm-1', cropId: 'c1', cropName: 'Grapes', selectedPlotIds: ['p1'], selectedPlotNames: ['G1'] }] },
    cropActivities: [], irrigation: [], labour: [{ id: 'l', count: 4 }], inputs: [], machinery: [],
} as unknown as DailyLog;
const CROPS = [{ id: 'c1', name: 'Grapes', plots: [{ id: 'p1', name: 'G1' }], iconName: 'Grape', color: 'emerald' }];

function ctx(over: Partial<AppRouterContext> = {}): AppRouterContext {
    const day = { closurePercent: 0, isClosed: false, hasStarted: true, completedCount: 1, plannedCount: 1, pendingCount: 0, unverifiedCount: 0 };
    return {
        currentRoute: 'main', mainView: 'log', status: 'success', mode: 'voice', recordingSegment: null,
        weatherData: null, weatherStatus: 'idle', boundaryUnset: false, refetchWeather: () => {},
        setCurrentRoute: vi.fn(), todayDayState: day, yesterdayDayState: day, setShowReviewInbox: () => {}, setMainView: () => {},
        crops: CROPS, logScope: { selectedCropIds: ['c1'], selectedPlotIds: ['p1'], mode: 'single', applyPolicy: 'broadcast' },
        setLogScope: vi.fn(), setMode: vi.fn(), setStatus: () => {}, hasActiveLogContext: true, isContextReady: true,
        error: null, errorTranscript: undefined, handleAudioReady: () => {}, handleTextReady: () => {}, handleManualSubmit: () => {},
        currentLogContext: null, ledgerDefaults: {}, farmerProfile: { operators: [], activeOperatorId: 'op-1' },
        draftLog: null, setDraftLog: () => {}, provenance: undefined, voiceStreamingPhase: 'idle', liveCaption: '',
        continuityLevel: null, savedPendingCaptureId: null, getTodayCounts: () => ({}), getContextColorIndicator: () => null,
        history: [SAVED], todayLogs: [SAVED], operatorNameById: new Map(), getLogContextSnapshot: () => ({ cropName: '', plotName: '' }),
        handleEditLog: vi.fn(), costSnapshot: { today: 0, cropSoFar: 0, unverifiedToday: 0 }, yesterdayCost: 0,
        setRecordingSegment: () => {}, lastSavedLogSummary: [{ logId: 'LOG-1', syncQueued: true }], lastSavedLogIds: ['LOG-1'],
        mockHistory: [], handleReset: vi.fn(), activeFarmId: 'farm-1', farmRole: 'PrimaryOwner', plannedTasks: [],
        setLogIntent: vi.fn(), logIntent: null,
        voiceResult: { logIds: ['LOG-1'], clipId: 'clip-1', key: 'clip-1|T', unclear: [] },
        ...over,
    } as unknown as AppRouterContext;
}

afterEach(() => { cleanup(); vi.resetModules(); seen.props = null; });

describe('voice flow v2 — around the saved screen', { timeout: 60_000 }, () => {
    it('B6: the self-move opens पूर्ण शेतीचा आढावा after the reset with no plot chosen; the log tab then opens on the work home', async () => {
        const { renderLogView } = await load(true);
        const c = ctx({ setMainView: vi.fn() });
        render(<>{renderLogView(c)}</>);
        await screen.findByTestId('voice-result-stub');
        (seen.props?.onAutoClose as () => void)();
        expect(c.handleReset).toHaveBeenCalledTimes(1);
        expect(c.setMode).toHaveBeenCalledWith('voice');
        expect(c.setMainView).toHaveBeenCalledTimes(1);
        expect(c.setMainView).toHaveBeenCalledWith('reflect');
        const scope = (c.setLogScope as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as LogScope;
        expect(scope).toMatchObject({ selectedCropIds: [], selectedPlotIds: [] });

        cleanup();
        render(<>{renderLogView(ctx({ status: 'idle', logScope: scope, hasActiveLogContext: false, voiceResult: undefined, lastSavedLogIds: [] }))}</>);
        expect(screen.getByTestId('log-entry-flow').getAttribute('data-step')).toBe('home');
    });

    it('B6: the end button does the same: reset, no plot chosen, पूर्ण शेतीचा आढावा', async () => {
        const { renderLogView } = await load(true);
        const c = ctx({ setMainView: vi.fn() });
        render(<>{renderLogView(c)}</>);
        await screen.findByTestId('voice-result-stub');
        (seen.props?.onFinish as () => void)();
        expect(c.handleReset).toHaveBeenCalledTimes(1);
        expect(c.setMainView).toHaveBeenCalledWith('reflect');
        expect((c.setLogScope as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]).toMatchObject({ selectedCropIds: [], selectedPlotIds: [] });
    });

    it('the sticky back takes the step from the detail page first, then leaves the surface', async () => {
        const { renderLogView, back } = await load(true);
        back.resetDetailBackForTests();
        const c = ctx();
        render(<>{renderLogView(c)}</>);
        await screen.findByTestId('voice-result-stub');
        const leave = vi.fn();
        back.holdDetailBack(leave);
        fireEvent.click(screen.getByTestId('saved-back'));
        expect(leave).toHaveBeenCalledTimes(1);
        expect(c.handleReset).not.toHaveBeenCalled();
        fireEvent.click(screen.getByTestId('saved-back'));
        expect(c.handleReset).toHaveBeenCalledTimes(1);
    });

    it('the browser back takes the same step, and keeps the bar\'s history entry for the next back', async () => {
        const { renderLogView, back } = await load(true);
        back.resetDetailBackForTests();
        const c = ctx();
        render(<>{renderLogView(c)}</>);
        await screen.findByTestId('voice-result-stub');
        const leave = vi.fn();
        back.holdDetailBack(leave);
        window.history.replaceState(null, '');
        act(() => { window.dispatchEvent(new PopStateEvent('popstate')); });
        expect(leave).toHaveBeenCalledTimes(1);
        expect(c.handleReset).not.toHaveBeenCalled();
        expect((window.history.state as Record<string, unknown> | null)?.agrisyncSavedBackTrap).toBe(true);
        act(() => { window.dispatchEvent(new PopStateEvent('popstate')); });
        expect(c.handleReset).toHaveBeenCalledTimes(1);
    });

    it('flag OFF: no close is handed to the screen, and the sticky back is the reset as before', async () => {
        const { renderLogView, back } = await load(false);
        back.resetDetailBackForTests();
        const c = ctx();
        render(<>{renderLogView(c)}</>);
        await screen.findByTestId('voice-result-stub');
        expect(seen.props?.onAutoClose).toBeUndefined();
        expect(seen.props?.onFinish).toBeUndefined();
        const leave = vi.fn();
        back.holdDetailBack(leave);
        fireEvent.click(screen.getByTestId('saved-back'));
        expect(leave).not.toHaveBeenCalled();
        expect(c.handleReset).toHaveBeenCalledTimes(1);
    });
});
