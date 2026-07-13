// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * LedgerRecognitionPanel — Phase 5, Task 5.9 wiring tests.
 *
 * Task 5.9 swaps the panel's internal MeterDisplay for MeterQuestionHost and
 * adds plotId/crop/todayLocalDate props (derived by mainView.tsx from the
 * saved log's context selection). These tests assert: (1) the single shared
 * useFarmerEngagement fetch still feeds both the meter's arrival gate and
 * MeterQuestionHost's questionInputs.engagement (not a hardcoded zero — this
 * worktree already has Phase 3's engagement wiring ahead of the Phase 5
 * brief's illustrative snippet, see task-43 report Reconciliation Notes);
 * (2) plotId/crop/todayLocalDate reach useDfesQuestion unchanged;
 * (3) a missing todayLocalDate falls back to "today".
 *
 * Task 3B adds: this panel is the call site for computeScheduleGap (mocked
 * here — the pure function's own behaviour is covered by
 * dfesScheduleWindow.test.ts), so these additional tests assert the panel
 * (a) calls it with (crops, allLogs, plotId, resolvedDate) and threads a real
 * result through as questionInputs.scheduleContext, (b) leaves scheduleContext
 * undefined when there's no gap, and (c) never calls it at all when the
 * stageQuestions+farmId gate is closed (flag OFF or no farm) — zero extra work
 * in that state.
 *
 * Task 4A adds: this panel is also the call site for buildWeatherContext
 * (the pure DetailedWeather -> WeatherTriggerContext projection), so these
 * additional tests assert the panel (a) threads a weather context with the
 * live windKph/rainProbNext6h/conditionText through as
 * questionInputs.weather when a `weather` prop is present, (b) leaves
 * questionInputs.weather undefined when no `weather` prop is given, and
 * (c) never builds one at all when the stageQuestions+farmId gate is closed
 * (flag OFF or no farm) — zero extra work in that state, same as
 * scheduleContext.
 *
 * Task 8 adds: this panel is the fire-once wire for "Sathi talks back" —
 * these additional tests assert (a) flag ON + unlocked + not-yet-spoken
 * speaks once and marks the farm, (b) a second render after marking never
 * speaks again, (c) `locked` never speaks, (d) flag OFF never speaks (and
 * never even checks/marks the store).
 *
 * spec: dfes-companion-2026-07-11
 */
import React from 'react';
import { render, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import type { CropProfile, DailyLog } from '../../../../types';
import type { ScheduleGapContext } from '../../services/dfesScheduleWindow';
import type { DetailedWeather } from '../../../../domain/types/weather.types';

const useFarmerEngagementMock = vi.fn();
const useDfesQuestionMock = vi.fn();
const computeScheduleGapMock = vi.fn();
const reconcileWeatherMock = vi.fn();
const speakUnlockRewardMock = vi.fn();
const wasUnlockSpokenMock = vi.fn();
const markUnlockSpokenMock = vi.fn();

vi.mock('../../hooks/useFarmerEngagement', () => ({
    useFarmerEngagement: (...args: unknown[]) => useFarmerEngagementMock(...args),
}));
vi.mock('../../hooks/useDfesQuestion', () => ({
    useDfesQuestion: (...args: unknown[]) => useDfesQuestionMock(...args),
}));
// Task 3B: mock the pure signal so these wiring tests stay focused on the
// panel's own call-site behaviour (gate + arg-threading), not schedule-gap
// arithmetic (covered separately by dfesScheduleWindow.test.ts).
vi.mock('../../services/dfesScheduleWindow', () => ({
    computeScheduleGap: (...args: unknown[]) => computeScheduleGapMock(...args),
}));
// Task 4B: mock the pure signal so these wiring tests stay focused on the
// panel's own call-site behaviour (gate + arg-threading), not severe-weather
// threshold arithmetic (covered separately by dfesWeatherReconcile.test.ts).
vi.mock('../../services/dfesWeatherReconcile', () => ({
    reconcileWeather: (...args: unknown[]) => reconcileWeatherMock(...args),
}));
// Task 8: mock the speaker + once-ever store so these wiring tests stay
// focused on the panel's own fire-once gating, not the speechSynthesis
// guard (covered by speakUnlockReward.test.ts) or the localStorage
// mechanics (covered by unlockSpeechStore.test.ts).
vi.mock('../../../../infrastructure/voice/speakUnlockReward', () => ({
    speakUnlockReward: (...args: unknown[]) => speakUnlockRewardMock(...args),
}));
vi.mock('../../../../infrastructure/storage/unlockSpeechStore', () => ({
    wasUnlockSpoken: (...args: unknown[]) => wasUnlockSpokenMock(...args),
    markUnlockSpoken: (...args: unknown[]) => markUnlockSpokenMock(...args),
}));
// The panel renders the real MeterDisplay (Slice 3b), which fetches the server
// /10 via useDayUnderstanding and reads copy via useLanguage. Mock both so these
// engagement/question wiring tests stay network-silent and provider-free.
vi.mock('../../hooks/useDayUnderstanding', () => ({
    useDayUnderstanding: () => ({ score: null, isLoading: false, error: null, refresh: vi.fn() }),
}));
vi.mock('../../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: 'en', setLanguage: () => undefined, t: (k: string) => k }),
}));

const engagementDto = {
    currentStreak: 3, longestStreak: 5, totalShramPoints: 40,
    lastAccountedDate: '2026-07-10', totalRichDays: 12, unlockStatus: 'unlocked' as const,
};

/** Minimal valid DailyLog fixture (Task 4B widened `savedLog` to the full DailyLog type). */
function makeSavedLog(overrides: Partial<DailyLog> = {}): DailyLog {
    return {
        id: 'log-1', date: '2026-07-11',
        context: { selection: [] },
        dayOutcome: 'WORK_RECORDED',
        cropActivities: [], irrigation: [], labour: [], inputs: [], machinery: [],
        financialSummary: { totalLabourCost: 0, totalInputCost: 0, totalMachineryCost: 0, grandTotal: 0 },
        ...overrides,
    };
}

async function loadComponent(stageQuestions = true, spokenUnlockReward = false) {
    vi.resetModules();
    vi.doMock('../../../../app/featureFlags', () => ({
        FEATURE_FLAGS: {
            understandingMeter: true,
            stageQuestions,
            disciplineSystem: false,
            DwcChip: false,
            voiceContinuity: false,
            spokenUnlockReward,
        },
        isFarmGeographyV2Enabled: () => false,
        isWeatherBackendFetchEnabled: () => false,
        isVoiceDoomLoopDetectorEnabled: () => true,
        IS_E2E_HARNESS_ENABLED: false,
        isE2EHarnessEnabled: () => false,
        isEnabled: () => true,
    }));
    return import('../LedgerRecognitionPanel');
}

beforeEach(() => {
    useFarmerEngagementMock.mockReset();
    useDfesQuestionMock.mockReset();
    computeScheduleGapMock.mockReset();
    reconcileWeatherMock.mockReset();
    speakUnlockRewardMock.mockReset();
    wasUnlockSpokenMock.mockReset();
    markUnlockSpokenMock.mockReset();
    useFarmerEngagementMock.mockReturnValue({ engagement: engagementDto, isLoading: false, error: null, refresh: vi.fn() });
    useDfesQuestionMock.mockReturnValue({ selected: null, loading: false, recordOutcome: vi.fn() });
    computeScheduleGapMock.mockReturnValue(null);
    reconcileWeatherMock.mockReturnValue(null);
    wasUnlockSpokenMock.mockReturnValue(false);
});

afterEach(() => {
    cleanup();
    vi.doUnmock('../../../../app/featureFlags');
    vi.resetModules();
});

describe('LedgerRecognitionPanel (Phase 5, Task 5.9)', () => {
    it('threads plotId, crop, todayLocalDate, and the real fetched engagement into useDfesQuestion', async () => {
        const { LedgerRecognitionPanel } = await loadComponent();
        render(
            <LedgerRecognitionPanel
                farmId="farm-1"
                plotId="plot-9"
                crop="grapes"
                todayLocalDate="2026-07-11"
                savedLog={makeSavedLog({ understanding: { score: 78, outcome: 'SCORED', dimensions: [] } })}
                allLogs={[]}
            />,
        );

        expect(useFarmerEngagementMock).toHaveBeenCalledWith('farm-1');
        expect(useDfesQuestionMock).toHaveBeenCalledWith(
            'farm-1',
            'plot-9',
            expect.objectContaining({
                crop: 'grapes',
                todayLocalDate: '2026-07-11',
                engagement: { totalRichDays: 12, unlockStatus: 'unlocked' },
            }),
            true,
        );
    });

    it('falls back to today\'s date and empty crop when not provided', async () => {
        const { LedgerRecognitionPanel } = await loadComponent();
        const todayIso = new Date().toISOString().slice(0, 10);
        render(<LedgerRecognitionPanel farmId="farm-1" allLogs={[]} />);

        expect(useDfesQuestionMock).toHaveBeenCalledWith(
            'farm-1',
            null,
            expect.objectContaining({ crop: '', todayLocalDate: todayIso }),
            true,
        );
    });

    it('falls back to a zero-default engagement for the question inputs when useFarmerEngagement has not resolved yet', async () => {
        useFarmerEngagementMock.mockReturnValue({ engagement: null, isLoading: true, error: null, refresh: vi.fn() });
        const { LedgerRecognitionPanel } = await loadComponent();
        render(<LedgerRecognitionPanel farmId="farm-1" allLogs={[]} />);

        expect(useDfesQuestionMock).toHaveBeenCalledWith(
            'farm-1',
            null,
            expect.objectContaining({ engagement: { totalRichDays: 0, unlockStatus: 'locked' } }),
            true,
        );
    });

    it('renders the panel wrapper', async () => {
        const { LedgerRecognitionPanel } = await loadComponent();
        const { getByTestId } = render(<LedgerRecognitionPanel farmId="farm-1" allLogs={[]} />);
        expect(getByTestId('ledger-recognition-panel')).toBeTruthy();
    });
});

describe('LedgerRecognitionPanel — schedule-gap wiring (Task 3B, spec: dfes-companion-2026-07-11)', () => {
    const crops: CropProfile[] = [];
    const history: DailyLog[] = [];

    it('calls computeScheduleGap with (crops, allLogs, plotId, resolvedDate) and threads a real gap through as questionInputs.scheduleContext', async () => {
        const gap: ScheduleGapContext = {
            category: 'FOLIAR_SPRAY',
            categoryLabelMr: 'फवारणी',
            plannedItemName: 'Spray A',
        };
        computeScheduleGapMock.mockReturnValue(gap);
        const { LedgerRecognitionPanel } = await loadComponent();
        render(
            <LedgerRecognitionPanel
                farmId="farm-1"
                plotId="plot-9"
                todayLocalDate="2026-07-11"
                crops={crops}
                allLogs={history}
            />,
        );

        expect(computeScheduleGapMock).toHaveBeenCalledWith(crops, history, 'plot-9', '2026-07-11');
        const [, , questionInputs] = useDfesQuestionMock.mock.calls[0];
        expect(questionInputs.scheduleContext).toEqual(gap);
    });

    it('leaves questionInputs.scheduleContext undefined when computeScheduleGap finds no gap', async () => {
        computeScheduleGapMock.mockReturnValue(null);
        const { LedgerRecognitionPanel } = await loadComponent();
        render(
            <LedgerRecognitionPanel farmId="farm-1" plotId="plot-9" crops={crops} allLogs={history} />,
        );

        const [, , questionInputs] = useDfesQuestionMock.mock.calls[0];
        expect(questionInputs.scheduleContext).toBeUndefined();
    });

    it('never calls computeScheduleGap when stageQuestions is OFF — zero extra work in a flag-off production build', async () => {
        const { LedgerRecognitionPanel } = await loadComponent(false);
        render(
            <LedgerRecognitionPanel farmId="farm-1" plotId="plot-9" crops={crops} allLogs={history} />,
        );

        expect(computeScheduleGapMock).not.toHaveBeenCalled();
        const [, , questionInputs] = useDfesQuestionMock.mock.calls[0];
        expect(questionInputs.scheduleContext).toBeUndefined();
    });

    it('never calls computeScheduleGap when farmId is null, even with stageQuestions ON', async () => {
        const { LedgerRecognitionPanel } = await loadComponent(true);
        render(
            <LedgerRecognitionPanel farmId={null} plotId="plot-9" crops={crops} allLogs={history} />,
        );

        expect(computeScheduleGapMock).not.toHaveBeenCalled();
    });
});

describe('LedgerRecognitionPanel — weather-trigger wiring (Task 4A, spec: dfes-companion-2026-07-11)', () => {
    const highWindWeather: DetailedWeather = {
        locationName: 'Farm Center',
        current: {
            fetchedAt: '2026-07-11T06:00:00Z',
            lat: 19.1, lon: 74.7, provider: 'tomorrow.io',
            current: {
                tempC: 30, humidity: 55, windKph: 30, precipMm: 0,
                conditionText: 'Windy', iconCode: '1000',
            },
            forecast: { rainProb: 70 },
        },
        forecast: [],
        history: [],
        advisory: { title: 'Weather Advisory', content: 'Conditions tailored for groundwork.' },
    };

    it('threads windKph/rainProbNext6h/conditionText from the live weather prop into questionInputs.weather', async () => {
        const { LedgerRecognitionPanel } = await loadComponent();
        render(
            <LedgerRecognitionPanel
                farmId="farm-1"
                plotId="plot-9"
                todayLocalDate="2026-07-11"
                allLogs={[]}
                weather={highWindWeather}
            />,
        );

        const [, , questionInputs] = useDfesQuestionMock.mock.calls[0];
        expect(questionInputs.weather).toEqual({
            windKph: 30,
            rainProbNext6h: 70,
            conditionText: 'Windy',
        });
    });

    it('leaves questionInputs.weather undefined when no weather prop is given', async () => {
        const { LedgerRecognitionPanel } = await loadComponent();
        render(<LedgerRecognitionPanel farmId="farm-1" allLogs={[]} />);

        const [, , questionInputs] = useDfesQuestionMock.mock.calls[0];
        expect(questionInputs.weather).toBeUndefined();
    });

    it('never builds a weather context when stageQuestions is OFF — zero extra work in a flag-off production build', async () => {
        const { LedgerRecognitionPanel } = await loadComponent(false);
        render(
            <LedgerRecognitionPanel farmId="farm-1" allLogs={[]} weather={highWindWeather} />,
        );

        const [, , questionInputs] = useDfesQuestionMock.mock.calls[0];
        expect(questionInputs.weather).toBeUndefined();
    });

    it('never builds a weather context when farmId is null, even with stageQuestions ON', async () => {
        const { LedgerRecognitionPanel } = await loadComponent(true);
        render(
            <LedgerRecognitionPanel farmId={null} allLogs={[]} weather={highWindWeather} />,
        );

        const [, , questionInputs] = useDfesQuestionMock.mock.calls[0];
        expect(questionInputs.weather).toBeUndefined();
    });
});

describe('LedgerRecognitionPanel — weather-reconcile wiring (Task 4B, spec: dfes-companion-2026-07-11)', () => {
    const severeWeatherSavedLog: DailyLog = makeSavedLog({
        weatherStamp: {
            id: 'ws-1', plotId: 'plot-9', timestampLocal: '2026-07-11T06:00:00', timestampProvider: '2026-07-11T06:00:00Z',
            provider: 'tomorrow.io', tempC: 26, humidity: 80, windKph: 20, precipMm: 25, cloudCoverPct: 90,
            conditionText: 'Heavy rain', iconCode: '1000', rainProbNext6h: 90,
        },
        // no disturbance logged — the "no logged impact" half of the signal.
    });

    it('threads a real weatherReconcileContext from a severe-weather savedLog with no disturbance', async () => {
        const context = { severity: 'severe' as const, reason: 'precipMm 25 >= 15' };
        reconcileWeatherMock.mockReturnValue(context);
        const { LedgerRecognitionPanel } = await loadComponent();
        render(
            <LedgerRecognitionPanel
                farmId="farm-1"
                plotId="plot-9"
                todayLocalDate="2026-07-11"
                allLogs={[]}
                savedLog={severeWeatherSavedLog}
            />,
        );

        expect(reconcileWeatherMock).toHaveBeenCalledWith(severeWeatherSavedLog);
        const [, , questionInputs] = useDfesQuestionMock.mock.calls[0];
        expect(questionInputs.weatherReconcileContext).toEqual(context);
    });

    it('leaves questionInputs.weatherReconcileContext undefined when reconcileWeather finds nothing', async () => {
        reconcileWeatherMock.mockReturnValue(null);
        const { LedgerRecognitionPanel } = await loadComponent();
        render(
            <LedgerRecognitionPanel farmId="farm-1" plotId="plot-9" allLogs={[]} savedLog={severeWeatherSavedLog} />,
        );

        const [, , questionInputs] = useDfesQuestionMock.mock.calls[0];
        expect(questionInputs.weatherReconcileContext).toBeUndefined();
    });

    it('never calls reconcileWeather when stageQuestions is OFF — zero extra work in a flag-off production build', async () => {
        const { LedgerRecognitionPanel } = await loadComponent(false);
        render(
            <LedgerRecognitionPanel farmId="farm-1" allLogs={[]} savedLog={severeWeatherSavedLog} />,
        );

        expect(reconcileWeatherMock).not.toHaveBeenCalled();
        const [, , questionInputs] = useDfesQuestionMock.mock.calls[0];
        expect(questionInputs.weatherReconcileContext).toBeUndefined();
    });

    it('never calls reconcileWeather when farmId is null, even with stageQuestions ON', async () => {
        const { LedgerRecognitionPanel } = await loadComponent(true);
        render(
            <LedgerRecognitionPanel farmId={null} allLogs={[]} savedLog={severeWeatherSavedLog} />,
        );

        expect(reconcileWeatherMock).not.toHaveBeenCalled();
    });
});

describe('LedgerRecognitionPanel — spoken unlock reward (Task 8, spec: dfes-companion-2026-07-11)', () => {
    it('speaks once and marks the farm when flag ON + unlocked + not yet spoken', async () => {
        useFarmerEngagementMock.mockReturnValue({
            engagement: { ...engagementDto, unlockStatus: 'unlocked' as const },
            isLoading: false, error: null, refresh: vi.fn(),
        });
        wasUnlockSpokenMock.mockReturnValue(false);
        const { LedgerRecognitionPanel } = await loadComponent(true, true);
        render(<LedgerRecognitionPanel farmId="farm-1" allLogs={[]} />);

        expect(wasUnlockSpokenMock).toHaveBeenCalledWith('farm-1');
        expect(speakUnlockRewardMock).toHaveBeenCalledTimes(1);
        expect(typeof speakUnlockRewardMock.mock.calls[0][0]).toBe('string');
        expect(markUnlockSpokenMock).toHaveBeenCalledWith('farm-1');
    });

    it('never speaks again once the farm is already marked as spoken (remount-safe)', async () => {
        useFarmerEngagementMock.mockReturnValue({
            engagement: { ...engagementDto, unlockStatus: 'unlocked' as const },
            isLoading: false, error: null, refresh: vi.fn(),
        });
        wasUnlockSpokenMock.mockReturnValue(true);
        const { LedgerRecognitionPanel } = await loadComponent(true, true);
        render(<LedgerRecognitionPanel farmId="farm-1" allLogs={[]} />);

        expect(speakUnlockRewardMock).not.toHaveBeenCalled();
        expect(markUnlockSpokenMock).not.toHaveBeenCalled();
    });

    it('never speaks while locked', async () => {
        useFarmerEngagementMock.mockReturnValue({
            engagement: { ...engagementDto, unlockStatus: 'locked' as const },
            isLoading: false, error: null, refresh: vi.fn(),
        });
        wasUnlockSpokenMock.mockReturnValue(false);
        const { LedgerRecognitionPanel } = await loadComponent(true, true);
        render(<LedgerRecognitionPanel farmId="farm-1" allLogs={[]} />);

        expect(speakUnlockRewardMock).not.toHaveBeenCalled();
        expect(markUnlockSpokenMock).not.toHaveBeenCalled();
    });

    it('never speaks when the flag is OFF, even if unlocked and not yet spoken — byte-equivalent no-op', async () => {
        useFarmerEngagementMock.mockReturnValue({
            engagement: { ...engagementDto, unlockStatus: 'unlocked' as const },
            isLoading: false, error: null, refresh: vi.fn(),
        });
        wasUnlockSpokenMock.mockReturnValue(false);
        const { LedgerRecognitionPanel } = await loadComponent(true, false);
        render(<LedgerRecognitionPanel farmId="farm-1" allLogs={[]} />);

        expect(wasUnlockSpokenMock).not.toHaveBeenCalled();
        expect(speakUnlockRewardMock).not.toHaveBeenCalled();
        expect(markUnlockSpokenMock).not.toHaveBeenCalled();
    });

    it('never speaks when farmId is null, even with the flag ON and unlocked', async () => {
        useFarmerEngagementMock.mockReturnValue({
            engagement: { ...engagementDto, unlockStatus: 'unlocked' as const },
            isLoading: false, error: null, refresh: vi.fn(),
        });
        wasUnlockSpokenMock.mockReturnValue(false);
        const { LedgerRecognitionPanel } = await loadComponent(true, true);
        render(<LedgerRecognitionPanel farmId={null} allLogs={[]} />);

        expect(wasUnlockSpokenMock).not.toHaveBeenCalled();
        expect(speakUnlockRewardMock).not.toHaveBeenCalled();
    });
});
