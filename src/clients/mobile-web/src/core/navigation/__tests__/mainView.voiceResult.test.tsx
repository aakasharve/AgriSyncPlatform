// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I13) — which screen the आजची कामे tab shows after a save.
 *
 *   - a VOICE auto-save shows the ONE result screen (never the old saved card), with the sticky back;
 *   - it is shown only while it IS the latest save: a typed save afterwards gets the saved card (no stale screen);
 *   - "मागे" lands on the mic of the same plot (reset + voice mode); lane MIC-1: "आणखी सांगा", a red part and Sathi's
 *     question open THE ONE mic (`requestSpeak`) for the same plots and come back to this tab;
 *   - "बदला" opens the speak-the-change screen (`handleEditLog`, lane E1); Sathi's ONE question panel stays on the screen.
 * The result screen itself is tested in voiceResult/__tests__; here it is a recording stub of its props.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AppRouterContext } from '../routeContext';
import type { DailyLog } from '../../../types';

const stub = (label: string) => ({ default: () => React.createElement('div', { 'data-stub': label }) });
const seen: { props: Record<string, unknown> | null } = { props: null };

async function load() {
    vi.resetModules();
    vi.doMock('../../../features/voice/components/AudioRecorder', () => stub('audio'));
    vi.doMock('../../../features/voice/components/AudioRecorderStreaming', () => stub('audio-streaming'));
    vi.doMock('../../../features/voice/components/LiveCaption', () => stub('live-caption'));
    vi.doMock('../../../features/logs/components/ManualEntry', () => stub('manual-entry'));
    vi.doMock('../../../features/logs/components/LedgerRecognitionPanel', () => ({
        LedgerRecognitionPanel: (p: { savedLog?: DailyLog }) => React.createElement('div', { 'data-testid': 'ledger-recognition-panel', 'data-log': p.savedLog?.id }),
    }));
    vi.doMock('../../../features/logs/components/voiceResult/VoiceResultContainer', () => ({
        VoiceResultContainer: (p: Record<string, unknown>) => {
            seen.props = p;
            return React.createElement('div', { 'data-testid': 'voice-result-stub' }, p.questionPanel as React.ReactNode);
        },
    }));
    vi.doMock('../../../i18n/LanguageContext', () => ({ useLanguage: () => ({ language: 'mr', setLanguage: () => {}, t: (k: string) => k }) }));
    vi.doMock('../../../app/featureFlags', () => ({
        FEATURE_FLAGS: { dailyLoop: false, voiceContinuity: false, taskCloseConfirm: false, understandingMeter: false },
        IS_E2E_HARNESS_ENABLED: false,
        isE2EHarnessEnabled: () => false,
        isFarmGeographyV2Enabled: () => false,
        isWeatherBackendFetchEnabled: () => false,
        isVoiceDoomLoopDetectorEnabled: () => true,
    }));
    const mod = await import('../mainView');
    const view = await import('../voiceResultView');
    return { renderLogView: mod.renderLogView, currentVoiceResult: view.currentVoiceResult };
}

const SAVED: DailyLog = {
    id: 'LOG-1', date: '2026-10-26', fullTranscript: 'चार मजूर आले',
    context: { selection: [{ farmId: 'farm-1', cropId: 'c1', cropName: 'द्राक्ष', selectedPlotIds: ['p1'], selectedPlotNames: ['सोनाका'] }] },
    cropActivities: [], irrigation: [], labour: [{ id: 'l', count: 4 }], inputs: [], machinery: [],
} as unknown as DailyLog;

const VOICE_RESULT = { logIds: ['LOG-1'], clipId: 'clip-1', key: 'clip-1|T', unclear: [] };

function ctx(over: Partial<AppRouterContext> = {}): AppRouterContext {
    const day = { closurePercent: 0, isClosed: false, hasStarted: true, completedCount: 1, plannedCount: 1, pendingCount: 0, unverifiedCount: 0 };
    return {
        currentRoute: 'main', mainView: 'log', status: 'success', mode: 'manual', recordingSegment: null,
        weatherData: null, weatherStatus: 'idle', boundaryUnset: false, refetchWeather: () => {},
        setCurrentRoute: () => {}, todayDayState: day, yesterdayDayState: day, setShowReviewInbox: () => {}, setMainView: () => {},
        crops: [], logScope: { selectedCropIds: ['c1'], selectedPlotIds: ['p1'], mode: 'single', applyPolicy: 'broadcast' },
        setLogScope: () => {}, setMode: vi.fn(), setStatus: () => {}, hasActiveLogContext: true, isContextReady: true,
        error: null, errorTranscript: undefined, handleAudioReady: () => {}, handleTextReady: () => {}, handleManualSubmit: () => {},
        currentLogContext: null, ledgerDefaults: {}, farmerProfile: { operators: [], activeOperatorId: 'op-1' },
        draftLog: null, setDraftLog: () => {}, provenance: undefined, voiceStreamingPhase: 'idle', liveCaption: '',
        continuityLevel: null, savedPendingCaptureId: null, getTodayCounts: () => ({}), getContextColorIndicator: () => null,
        history: [SAVED], todayLogs: [SAVED], operatorNameById: new Map(), getLogContextSnapshot: () => ({ cropName: '', plotName: '' }),
        handleEditLog: vi.fn(), costSnapshot: { today: 0, cropSoFar: 0, unverifiedToday: 0 }, yesterdayCost: 0,
        setRecordingSegment: () => {}, lastSavedLogSummary: [{ logId: 'LOG-1', syncQueued: true }], lastSavedLogIds: ['LOG-1'],
        mockHistory: [], handleReset: vi.fn(), activeFarmId: 'farm-1', farmRole: 'PrimaryOwner', plannedTasks: [],
        voiceResult: VOICE_RESULT,
        ...over,
    } as unknown as AppRouterContext;
}

afterEach(() => { cleanup(); vi.resetModules(); seen.props = null; });

// Each test re-imports mainView after vi.resetModules (a cold module graph); in the full parallel run that can pass
// the 15 s default, so this suite gets the longer budget whole-view suites need (I13-V1 MINOR-8).
describe('the आजची कामे tab after a save', { timeout: 60_000 }, () => {
    it('a VOICE auto-save shows the ONE result screen — not the old saved card — with the sticky back', async () => {
        const { renderLogView } = await load();
        render(<>{renderLogView(ctx())}</>);
        // The result screen is loaded on first show (lazyComponents, I13-V3 m4).
        expect(await screen.findByTestId('voice-result-stub')).toBeTruthy();
        expect(screen.queryByTestId('saved-to-ledger')).toBeNull();
        expect(screen.getByTestId('saved-back')).toBeTruthy();
        expect(seen.props).toMatchObject({ result: VOICE_RESULT, farmId: 'farm-1', farmRole: 'PrimaryOwner' });
        // spec I18 — the place is built in the screen's language (crop names follow it).
        const placeLabel = seen.props?.placeLabel as (language: string | undefined) => string;
        expect(placeLabel('mr')).toBe('द्राक्ष · सोनाका');
        // The enqueue result travels per log, so each plot's log of a recording can say if it will not reach the server.
        expect([...(seen.props?.syncQueuedById as Map<string, boolean | null>)]).toEqual([['LOG-1', true]]);
    });

    it('keeps Sathi\'s ONE question panel on the screen, for the saved log', async () => {
        const { renderLogView } = await load();
        render(<>{renderLogView(ctx())}</>);
        expect((await screen.findByTestId('ledger-recognition-panel')).getAttribute('data-log')).toBe('LOG-1');
    });

    it('a typed save AFTER it gets the saved card: the voice result is shown only while it is the latest save', async () => {
        const { renderLogView, currentVoiceResult } = await load();
        const typed = ctx({ lastSavedLogIds: ['LOG-TYPED'] });
        expect(currentVoiceResult(typed)).toBeNull();
        render(<>{renderLogView(typed)}</>);
        expect(screen.queryByTestId('voice-result-stub')).toBeNull();
        expect(screen.getByTestId('saved-to-ledger')).toBeTruthy();
    });

    it('मागे lands on the mic of the same plot; आणखी सांगा and a red part open THE ONE mic for the same plots (MIC-1)', async () => {
        const { renderLogView } = await load();
        const store = await import('../../speak/speakStore');
        store.resetSpeakStoreForTests();
        const c = ctx();
        render(<>{renderLogView(c)}</>);
        await screen.findByTestId('voice-result-stub');
        (seen.props?.onBack as () => void)();
        expect(c.handleReset).toHaveBeenCalledTimes(1);
        expect(c.setMode).toHaveBeenCalledWith('voice');
        fireEvent.click(screen.getByTestId('saved-back'));
        expect(c.handleReset).toHaveBeenCalledTimes(2);

        (seen.props?.onAddAnother as () => void)();
        expect(store.speakState().request).toMatchObject({ purpose: 'addToDay', context: { place: 'current' }, returnTo: { route: 'main', mainView: 'log' } });
        (seen.props?.onTellMore as (p: string) => void)('labour');
        expect(store.speakState().request).toMatchObject({ purpose: 'fillPart', context: { place: 'current', part: 'labour' }, returnTo: { route: 'main', mainView: 'log' } });
        // neither one resets the flow under him: the result screen stays until the new save replaces it
        expect(c.handleReset).toHaveBeenCalledTimes(2);
        store.resetSpeakStoreForTests();
    });

    it('"बदला" goes through handleEditLog (the speak-the-change screen, lane E1)', async () => {
        const { renderLogView } = await load();
        const c = ctx();
        render(<>{renderLogView(c)}</>);
        await screen.findByTestId('voice-result-stub');
        (seen.props?.onEdit as (l: DailyLog) => void)(SAVED);
        expect(c.handleEditLog).toHaveBeenCalledWith(SAVED);
    });
});
