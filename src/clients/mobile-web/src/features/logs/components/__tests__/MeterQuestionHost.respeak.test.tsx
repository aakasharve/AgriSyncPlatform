// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FOUNDER DECISION 3 — "no taps before he speaks". Tapping the question takes the farmer to
 * the microphone with the question still visible; what he says there is his answer.
 *
 * The second test is the load-bearing one. `ssf.question_events` is append-only by
 * privilege, so a row written on the TAP can never afterwards acquire the answer text —
 * writing on tap permanently guarantees `response = NULL`, which is why every row ever
 * written has one. `writes NO question_events row on the tap itself` is what stops that
 * being reintroduced.
 *
 * spec: dfes-companion-2026-07-11 (wave-3.7)
 */
import React from 'react';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

const useDfesQuestionMock = vi.fn();
const recordOutcome = vi.fn();

vi.mock('../../hooks/useDfesQuestion', () => ({
    useDfesQuestion: (...args: unknown[]) => useDfesQuestionMock(...args),
}));
vi.mock('../../hooks/useDayUnderstanding', () => ({
    useDayUnderstanding: () => ({ score: null, isLoading: false, error: null, refresh: vi.fn() }),
}));
vi.mock('../../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: 'en', setLanguage: () => undefined, t: (k: string) => k }),
}));
// The real telemetry client — spied so "no row was written" is a claim about the actual
// POST, not about a mock of the thing under test.
vi.mock('../../services/dfesQuestionApi', () => ({
    recordQuestionEvent: vi.fn().mockResolvedValue({ id: 'qe-1' }),
    fetchRecentQuestionEvents: vi.fn().mockResolvedValue([]),
}));

import { recordQuestionEvent } from '../../services/dfesQuestionApi';

const ackOnlyQuestion = {
    question: {
        questionKey: 'gap.dose', crop: 'grapes', lens: 'Execution', depthLevel: 1, priority: 4,
        cooldownDays: 7, questionType: 'TEXT', answerModes: 'text', safetyClass: 'NONE',
        triggerType: 'Gap', anchorDateType: null,
        agronomistApproved: true, marathiApproved: true, promptMr: 'औषध किती वापरलं?',
    },
    resolvedPromptMr: 'औषध किती वापरलं?',
    triggerReason: 'gap: DOSE',
    weatherContext: null,
    expectedStage: null,
    actualStageApplicability: null,
    // No answerOptions — the ack-only branch, which is the respeak surface.
};

async function loadComponent() {
    vi.resetModules();
    vi.doMock('../../../../app/featureFlags', () => ({
        FEATURE_FLAGS: {
            understandingMeter: true, stageQuestions: true, DwcChip: false,
            disciplineSystem: false, voiceContinuity: false,
        },
        isFarmGeographyV2Enabled: () => false,
        isWeatherBackendFetchEnabled: () => false,
        isVoiceDoomLoopDetectorEnabled: () => true,
        IS_E2E_HARNESS_ENABLED: false,
        isE2EHarnessEnabled: () => false,
        isEnabled: () => true,
    }));
    return import('../MeterQuestionHost');
}

const props = {
    farmId: 'farm-1',
    plotId: 'plot-1',
    questionInputs: {
        crop: 'grapes',
        todayLocalDate: '2026-08-16',
        sourceLogId: 'log-1',
        engagement: { totalRichDays: 0, unlockStatus: 'locked' as const },
    },
};

beforeEach(() => {
    useDfesQuestionMock.mockReset();
    recordOutcome.mockReset();
    vi.mocked(recordQuestionEvent).mockClear();
    useDfesQuestionMock.mockReturnValue({
        selected: ackOnlyQuestion, loading: false, recordOutcome,
        shownAtUtc: '2026-08-16T04:00:00.000Z',
    });
});

afterEach(() => {
    cleanup();
    vi.doUnmock('../../../../app/featureFlags');
    vi.resetModules();
});

describe('answering by speaking again (founder decision 3)', () => {
    it('takes the farmer to the microphone with the question still visible', async () => {
        const { MeterQuestionHost } = await loadComponent();
        const goToMic = vi.fn();

        render(<MeterQuestionHost {...props} onAnswerBySpeaking={goToMic} />);
        fireEvent.click(screen.getByTestId('shramsathi-gap-question'));

        expect(goToMic).toHaveBeenCalledWith(expect.objectContaining({
            questionKey: 'gap.dose',
            farmId: 'farm-1',
            plotId: 'plot-1',
            sourceLogId: 'log-1',
            shownAtUtc: '2026-08-16T04:00:00.000Z',
            stashedLocalDate: '2026-08-16',
        }));
        // The prompt travels WITH him — that is what "still visible" means at this layer.
        expect(goToMic.mock.calls[0][0].selected.resolvedPromptMr).toBe('औषध किती वापरलं?');
    });

    it('writes NO question_events row on the tap itself', async () => {
        const { MeterQuestionHost } = await loadComponent();

        render(<MeterQuestionHost {...props} onAnswerBySpeaking={vi.fn()} />);
        fireEvent.click(screen.getByTestId('shramsathi-gap-question'));

        // The table is append-only: a row written now could never acquire the answer text.
        expect(recordQuestionEvent).not.toHaveBeenCalled();
        expect(recordOutcome).not.toHaveBeenCalled();
    });

    it('falls back to the bare acknowledgement when no respeak handler is wired', async () => {
        const { MeterQuestionHost } = await loadComponent();

        render(<MeterQuestionHost {...props} />);
        fireEvent.click(screen.getByTestId('shramsathi-gap-question'));

        // An ack-only surface (a caller that has no route to the mic) must keep working
        // exactly as it did — this change adds a path, it does not remove one.
        expect(recordOutcome).toHaveBeenCalledWith(
            expect.objectContaining({ skipped: false, dailyLogId: 'log-1' }));
    });
});
