// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lane FX-1 — founder ATT-LOG (2026-10-31, register F81) and rule CTX-1, on the real log view (`renderLogView`):
 *
 *   - the work home's हजेरी card reads the day's STORED logs by the हजेरी rule: empty until the work and the headcount
 *     are both told; its button is the "झालेले काम सांगा" step — the crop question first, never the mic;
 *   - both told: "इथे हजेरी घ्या — आज N जण" opens the हजेरी place straight on the names;
 *   - only someone who may take हजेरी sees it (the same door rule as before);
 *   - the result screen shows the same empty card when that recording states work but no headcount; its button opens
 *     the ONE mic with NO place, so the crop question comes first (CTX-1).
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AppRouterContext } from '../routeContext';
import type { DailyLog } from '../../../types';
import { getDateKey } from '../../domain/services/DateKeyService';

const stub = (label: string) => ({ default: () => React.createElement('div', { 'data-stub': label }) });
const seen: { props: Record<string, unknown> | null } = { props: null };

async function load() {
    vi.resetModules();
    vi.doMock('../../../features/voice/components/AudioRecorder', () => stub('audio'));
    vi.doMock('../../../features/voice/components/AudioRecorderStreaming', () => stub('audio-streaming'));
    vi.doMock('../../../features/voice/components/LiveCaption', () => stub('live-caption'));
    vi.doMock('../../../features/appUpdate/AppUpdateCard', () => ({ AppUpdateCard: () => null }));
    vi.doMock('../../../features/logs/components/LedgerRecognitionPanel', () => ({ LedgerRecognitionPanel: () => null }));
    vi.doMock('../../../features/logs/components/voiceResult/VoiceResultContainer', () => ({
        VoiceResultContainer: (p: Record<string, unknown>) => {
            seen.props = p;
            return React.createElement('div', { 'data-testid': 'voice-result-stub' }, p.extras as React.ReactNode);
        },
    }));
    vi.doMock('../../../i18n/LanguageContext', () => ({
        useLanguage: () => ({ language: 'mr', setLanguage: () => {}, t: (k: string) => k }),
        useOptionalLanguage: () => ({ language: 'mr' }),
    }));
    vi.doMock('../../../app/featureFlags', () => ({
        FEATURE_FLAGS: { dailyLoop: false, voiceContinuity: false, taskCloseConfirm: false, understandingMeter: false },
        IS_E2E_HARNESS_ENABLED: false,
        isE2EHarnessEnabled: () => false,
        isFarmGeographyV2Enabled: () => false,
        isWeatherBackendFetchEnabled: () => false,
        isVoiceDoomLoopDetectorEnabled: () => true,
    }));
    const mod = await import('../mainView');
    const speak = await import('../../speak/speakStore');
    const opening = await import('../../../features/labour/labourOpening');
    return { renderLogView: mod.renderLogView, speak, opening };
}

const TODAY = getDateKey();
const SEL = { selection: [{ farmId: 'farm-1', cropId: 'c1', cropName: 'Grapes', selectedPlotIds: ['p1'], selectedPlotNames: ['G1'] }] };
const entry = (id: string, over: Partial<DailyLog>): DailyLog => ({
    id, date: TODAY, context: SEL, cropActivities: [], irrigation: [], labour: [], inputs: [], machinery: [], ...over,
} as unknown as DailyLog);
const WORK = entry('LOG-W', { cropActivities: [{ id: 'a', title: 'Weeding', status: 'completed' }] as DailyLog['cropActivities'] });
const COUNT = entry('LOG-C', { labour: [{ id: 'l', type: 'HIRED', count: 5 }] as DailyLog['labour'] });
const CROPS = [{ id: 'c1', name: 'Grapes', plots: [{ id: 'p1', name: 'G1' }], iconName: 'Grape', color: 'emerald' }];

function ctx(over: Partial<AppRouterContext> = {}): AppRouterContext {
    const day = { closurePercent: 0, isClosed: false, hasStarted: true, completedCount: 1, plannedCount: 1, pendingCount: 0, unverifiedCount: 0 };
    return {
        currentRoute: 'main', mainView: 'log', status: 'idle', mode: 'voice', recordingSegment: null,
        weatherData: null, weatherStatus: 'idle', boundaryUnset: false, refetchWeather: () => {},
        setCurrentRoute: vi.fn(), todayDayState: day, yesterdayDayState: day, setShowReviewInbox: () => {}, setMainView: () => {},
        crops: CROPS, logScope: { selectedCropIds: [], selectedPlotIds: [], mode: 'single', applyPolicy: 'broadcast' },
        setLogScope: vi.fn(), setMode: vi.fn(), setStatus: () => {}, hasActiveLogContext: false, isContextReady: true,
        error: null, errorTranscript: undefined, handleAudioReady: () => {}, handleTextReady: () => {}, handleManualSubmit: () => {},
        currentLogContext: null, ledgerDefaults: {}, farmerProfile: { operators: [], activeOperatorId: 'op-1' },
        draftLog: null, setDraftLog: () => {}, provenance: undefined, voiceStreamingPhase: 'idle', liveCaption: '',
        continuityLevel: null, savedPendingCaptureId: null, getTodayCounts: () => ({}), getContextColorIndicator: () => null,
        history: [], todayLogs: [], operatorNameById: new Map(), getLogContextSnapshot: () => ({ cropName: '', plotName: '' }),
        handleEditLog: vi.fn(), costSnapshot: { today: 0, cropSoFar: 0, unverifiedToday: 0 }, yesterdayCost: 0,
        setRecordingSegment: () => {}, lastSavedLogSummary: [], lastSavedLogIds: [],
        mockHistory: [], handleReset: vi.fn(), activeFarmId: 'farm-1', farmRole: 'PrimaryOwner', plannedTasks: [],
        setLogIntent: vi.fn(), logIntent: null,
        canOpenAttendanceFromHome: true, openPlace: vi.fn(),
        ...over,
    } as unknown as AppRouterContext;
}

afterEach(() => { cleanup(); vi.resetModules(); seen.props = null; });

describe('ATT-LOG on the work home', { timeout: 60_000 }, () => {
    it('nothing stored today: the empty card; its button opens the crop question (the "झालेले काम सांगा" step), not the mic', async () => {
        const { renderLogView } = await load();
        const c = ctx();
        render(<>{renderLogView(c)}</>);
        expect(screen.getByTestId('attendance-card')).toHaveAttribute('data-state', 'empty');
        fireEvent.click(screen.getByTestId('attendance-card-tell'));
        expect(screen.getByTestId('log-entry-flow')).toHaveAttribute('data-step', 'crop');
        expect(screen.getByTestId('flow-sathi-question')).toHaveTextContent('कोणत्या पिकावर काम झालं ?');
        expect(screen.queryByTestId('flow-mic-anchor')).toBeNull();
        expect(c.openPlace).not.toHaveBeenCalled();
    });

    it('today\'s stored work, no headcount: "किती जण होते ते सांगा", which also starts on the crop question', async () => {
        const { renderLogView } = await load();
        render(<>{renderLogView(ctx({ history: [WORK] }))}</>);
        expect(screen.getByTestId('attendance-card-work')).toHaveTextContent('काम सांगितलं — खुरपणी');
        fireEvent.click(screen.getByTestId('attendance-card-tell'));
        expect(screen.getByTestId('log-entry-flow')).toHaveAttribute('data-step', 'crop');
    });

    it('both stored: "इथे हजेरी घ्या — आज 5 जण" opens the हजेरी place straight on the names', async () => {
        const { renderLogView, opening } = await load();
        const c = ctx({ history: [WORK, COUNT] });
        render(<>{renderLogView(c)}</>);
        expect(screen.getByTestId('attendance-card-ready')).toHaveTextContent('इथे हजेरी घ्या — आज 5 जण');
        fireEvent.click(screen.getByTestId('attendance-card'));
        expect(c.openPlace).toHaveBeenCalledWith('labour');
        expect(opening.peekLabourOpening()).toBe('names');
        opening.clearLabourOpening();
    });

    it('"हजेरी वही बघा" opens the हजेरी place as the old door did (its hub, not the names)', async () => {
        const { renderLogView, opening } = await load();
        const c = ctx({ history: [WORK, COUNT] });
        render(<>{renderLogView(c)}</>);
        fireEvent.click(screen.getByTestId('attendance-card-register'));
        expect(c.openPlace).toHaveBeenCalledWith('labour');
        expect(opening.peekLabourOpening()).toBeNull();
    });

    it('someone who may not take हजेरी gets no card (the same door rule as before)', async () => {
        const { renderLogView } = await load();
        render(<>{renderLogView(ctx({ canOpenAttendanceFromHome: false, history: [WORK] }))}</>);
        expect(screen.getByTestId('home-tell')).toBeInTheDocument();
        expect(screen.queryByTestId('attendance-card')).toBeNull();
    });
});

describe('ATT-LOG on the result screen after he speaks', { timeout: 60_000 }, () => {
    const result = (id: string) => ({ voiceResult: { logIds: [id], clipId: 'clip', key: `${id}|T`, unclear: [] }, lastSavedLogIds: [id], status: 'success' as const });

    it('this recording states work but no headcount: the same empty card; its button opens the ONE mic with no place (crop first)', async () => {
        const { renderLogView, speak } = await load();
        speak.resetSpeakStoreForTests();
        render(<>{renderLogView(ctx({ history: [WORK], ...result('LOG-W') } as Partial<AppRouterContext>))}</>);
        await screen.findByTestId('voice-result-stub');
        expect(screen.getByTestId('attendance-card')).toHaveAttribute('data-state', 'work-told');
        fireEvent.click(screen.getByTestId('attendance-card-tell'));
        const request = speak.speakState().request;
        expect(request).toMatchObject({ purpose: 'fillPart', context: { part: 'labour' }, returnTo: { route: 'main', mainView: 'log' } });
        expect(request?.context.place).toBeUndefined();
        speak.resetSpeakStoreForTests();
    });

    it('no card when the recording states the headcount, or the day already has one, or for someone who may not take हजेरी', async () => {
        const { renderLogView } = await load();
        const both = entry('LOG-B', { cropActivities: WORK.cropActivities, labour: COUNT.labour });
        render(<>{renderLogView(ctx({ history: [both], ...result('LOG-B') } as Partial<AppRouterContext>))}</>);
        await screen.findByTestId('voice-result-stub');
        expect(screen.queryByTestId('attendance-card')).toBeNull();
        cleanup();
        render(<>{renderLogView(ctx({ history: [COUNT, WORK], ...result('LOG-W') } as Partial<AppRouterContext>))}</>);
        await screen.findByTestId('voice-result-stub');
        expect(screen.queryByTestId('attendance-card')).toBeNull();
        cleanup();
        render(<>{renderLogView(ctx({ history: [WORK], canOpenAttendanceFromHome: false, ...result('LOG-W') } as Partial<AppRouterContext>))}</>);
        await screen.findByTestId('voice-result-stub');
        expect(screen.queryByTestId('attendance-card')).toBeNull();
    });
});
