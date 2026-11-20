// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane HONESTY-1, item H3; doctrine P7 - attribution never changes a reported quantity)
 *
 * The saved card's "जण ×N" chip is a count of PEOPLE. It used to be the number of labour ROWS in the log, so "मजुरांनी काम केलं"
 * (a row, no number said) printed "जण ×1" and three rows with no number printed "जण ×3". The chip now shows the head
 * count that was said or recorded (the app's one rule, `sumLabourHeadcount`) and nothing at all when none was.
 */
import React from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { AppRouterContext } from '../routeContext';
import type { DailyLog } from '../../../types';

const stub = (label: string) => ({ default: () => React.createElement('div', { 'data-stub': label }) });

async function load() {
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
    vi.doMock('../../../features/logs/components/LedgerRecognitionPanel', () => ({
        LedgerRecognitionPanel: () => React.createElement('div', { 'data-testid': 'ledger-recognition-panel' }),
    }));
    vi.doMock('../../../features/logs/components/shramsathi/VoiceSavedReassurance', () => stub('voice-saved'));
    vi.doMock('../../../i18n/LanguageContext', () => ({
        useLanguage: () => ({ language: 'mr', setLanguage: () => {}, t: (k: string) => k }),
    }));
    vi.doMock('../../../app/featureFlags', () => ({
        FEATURE_FLAGS: { dailyLoop: false, voiceContinuity: false },
        IS_E2E_HARNESS_ENABLED: false,
        isE2EHarnessEnabled: () => false,
        isFarmGeographyV2Enabled: () => false,
        isWeatherBackendFetchEnabled: () => false,
        isVoiceDoomLoopDetectorEnabled: () => true,
    }));
    return (await import('../mainView')).renderLogView;
}

const savedWith = (labour: unknown[], extra: Record<string, unknown> = {}): DailyLog => ({
    id: 'LOG-1', date: '2026-10-26',
    context: { selection: [{ cropId: 'c1', cropName: 'Grapes', selectedPlotIds: ['p1'], selectedPlotNames: ['सोनाका'] }] },
    cropActivities: [], irrigation: [], labour, inputs: [], machinery: [], ...extra,
} as unknown as DailyLog);

function ctxFor(log: DailyLog): AppRouterContext {
    const day = { closurePercent: 0, isClosed: false, hasStarted: true, completedCount: 0, plannedCount: 0, pendingCount: 0, unverifiedCount: 0 };
    return {
        currentRoute: 'main', mainView: 'log', status: 'success', mode: 'voice', recordingSegment: null,
        weatherData: null, weatherStatus: 'idle', boundaryUnset: false, refetchWeather: () => {}, setCurrentRoute: () => {},
        ownerDisplayName: 'Owner', todayDayState: day, yesterdayDayState: day, showCloseDaySummary: false,
        setShowCloseDaySummary: () => {}, showCloseYesterdaySummary: false, setShowCloseYesterdaySummary: () => {},
        setShowReviewInbox: () => {}, setMainView: () => {}, crops: [],
        logScope: { selectedCropIds: [], selectedPlotIds: [], mode: 'single', applyPolicy: 'broadcast' },
        setLogScope: () => {}, setMode: () => {}, setStatus: () => {}, hasActiveLogContext: false, isContextReady: false,
        error: null, errorTranscript: undefined, handleAudioReady: () => {}, handleTextReady: () => {}, handleManualSubmit: () => {},
        currentLogContext: null, ledgerDefaults: {}, farmerProfile: { operators: [], activeOperatorId: '' }, draftLog: null,
        setDraftLog: () => {}, provenance: undefined, voiceStreamingPhase: 'idle', liveCaption: '', continuityLevel: null,
        savedPendingCaptureId: null, getTodayCounts: () => ({}), getContextColorIndicator: () => null,
        history: [log], todayLogs: [log], operatorNameById: new Map(), getLogContextSnapshot: () => ({ cropName: '', plotName: '' }),
        handleEditLog: () => {}, costSnapshot: { today: 0, cropSoFar: 0, unverifiedToday: 0 }, yesterdayCost: 0,
        setRecordingSegment: () => {},
        lastSavedLogSummary: [{ logId: log.id, cropId: null, cropName: 'Grapes', plotName: 'सोनाका' }],
        lastSavedLogIds: [log.id], mockHistory: [], handleReset: () => {},
    } as unknown as AppRouterContext;
}

afterEach(() => { cleanup(); vi.resetModules(); });

describe('H3 - the saved card chip "जण" counts people, never labour rows', { timeout: 60_000 }, () => {
    it('rows with NO number said: no chip - three rows are not three people', async () => {
        const renderLogView = await load();
        render(<>{renderLogView(ctxFor(savedWith([{ id: 'a', type: 'HIRED' }, { id: 'b', type: 'HIRED' }, { id: 'c', type: 'HIRED' }])))}</>);
        expect(screen.getByTestId('saved-to-ledger')).toBeInTheDocument();
        expect(screen.queryByText(/जण/)).toBeNull();
    });

    it('one row that states 4 people: the chip says 4 (a number said, not a row count)', async () => {
        const renderLogView = await load();
        render(<>{renderLogView(ctxFor(savedWith([{ id: 'a', type: 'HIRED', count: 4 }])))}</>);
        expect(screen.getByText('जण ×4')).toBeInTheDocument();
    });

    it('three rows stating 4, 2 and (3 men and 1 woman): the chip says the 10 people said, never 3 rows', async () => {
        const renderLogView = await load();
        render(<>{renderLogView(ctxFor(savedWith([
            { id: 'a', type: 'HIRED', count: 4 },
            { id: 'b', type: 'HIRED', count: 2 },
            { id: 'c', type: 'HIRED', maleCount: 3, femaleCount: 1 },
        ])))}</>);
        expect(screen.getByText('जण ×10')).toBeInTheDocument();
        expect(screen.queryByText('जण ×3')).toBeNull();
    });

    it('P7: naming people never shrinks the said number - 8 said, 3 named = 8', async () => {
        const renderLogView = await load();
        render(<>{renderLogView(ctxFor(savedWith([{ id: 'a', type: 'HIRED', count: 8, workerNames: ['रमेश', 'सीता', 'बाळू'] }])))}</>);
        expect(screen.getByText('जण ×8')).toBeInTheDocument();
    });

    it('a known figure among unknown rows is not poisoned: one row says 5, two say nothing = 5', async () => {
        const renderLogView = await load();
        render(<>{renderLogView(ctxFor(savedWith([{ id: 'a', type: 'HIRED', count: 5 }, { id: 'b', type: 'HIRED' }, { id: 'c', type: 'HIRED' }])))}</>);
        expect(screen.getByText('जण ×5')).toBeInTheDocument();
    });

    it('the other chips are untouched: water still counts its rows, and a no-number labour row adds no chip', async () => {
        const renderLogView = await load();
        render(<>{renderLogView(ctxFor(savedWith([{ id: 'a', type: 'HIRED' }], { irrigation: [{ id: 'i1', method: 'Drip', source: 'well' }] })))}</>);
        expect(screen.getByText('पाणी ×1')).toBeInTheDocument();
        expect(screen.queryByText(/जण/)).toBeNull();
    });
});
