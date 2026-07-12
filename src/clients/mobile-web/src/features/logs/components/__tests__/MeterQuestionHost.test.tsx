// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MeterQuestionHost — unit tests (Phase 5, Task 5.9).
 *
 * Asserts the host calls useDfesQuestion at component top-level with the
 * flag-derived `enabled` gate (stageQuestions AND a farmId), threads the
 * selected question + engagement through to MeterDisplay, and that tapping
 * the resulting combined card fires recordOutcome({ skipped: false }).
 *
 * Mocks useDfesQuestion directly (rather than the deeper dfesQuestionApi) so
 * these tests stay focused on MeterQuestionHost's own wiring; the hook's own
 * fetch-gating and telemetry-recording behaviour is covered by
 * useDfesQuestion.test.tsx. featureFlags is mocked via the established
 * vi.doMock + vi.resetModules + dynamic-import pattern (see
 * MeterDisplay.dfes.test.tsx) since featureFlags.ts's env read form is not
 * reachable by vi.stubEnv in this repo.
 *
 * spec: dfes-companion-2026-07-11
 */
import React from 'react';
import { render, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import type { VlogScore } from '../../../../domain/types/log.types';

const useDfesQuestionMock = vi.fn();

vi.mock('../../hooks/useDfesQuestion', () => ({
    useDfesQuestion: (...args: unknown[]) => useDfesQuestionMock(...args),
}));

const score: VlogScore = {
    score: 78,
    outcome: 'SCORED',
    dimensions: [{ dimension: 'DOSE', applicable: true, weight: 20, coverage: 0, confidenceFactor: 1, contribution: 0 }],
};

const arrivedLogs: Array<{ understanding?: VlogScore }> = Array.from({ length: 25 }, () => ({
    understanding: { score: 90, outcome: 'SCORED', dimensions: [] },
}));

/** Load MeterQuestionHost with FEATURE_FLAGS.stageQuestions/understandingMeter forced. */
async function loadComponent(understandingMeter: boolean, stageQuestions: boolean) {
    vi.resetModules();
    vi.doMock('../../../../app/featureFlags', () => ({
        FEATURE_FLAGS: {
            understandingMeter,
            stageQuestions,
            DwcChip: false,
            disciplineSystem: false,
            voiceContinuity: false,
        },
        isFarmGeographyV2Enabled: () => false,
        isWeatherBackendFetchEnabled: () => false,
        isVoiceDoomLoopDetectorEnabled: () => true,
        IS_E2E_HARNESS_ENABLED: false,
        isE2EHarnessEnabled: () => false,
        isEnabled: () => understandingMeter,
    }));
    return import('../MeterQuestionHost');
}

beforeEach(() => {
    useDfesQuestionMock.mockReset();
    useDfesQuestionMock.mockReturnValue({ selected: null, loading: false, recordOutcome: vi.fn() });
});

afterEach(() => {
    cleanup();
    vi.doUnmock('../../../../app/featureFlags');
    vi.resetModules();
});

describe('MeterQuestionHost (Phase 5, Task 5.9)', () => {
    it('gates the hook on stageQuestions AND a non-null farmId', async () => {
        const { MeterQuestionHost } = await loadComponent(true, true);
        render(
            <MeterQuestionHost
                farmId="farm-1"
                plotId="plot-1"
                score={score}
                allLogs={arrivedLogs}
                questionInputs={{
                    crop: 'grapes',
                    todayLocalDate: '2026-07-11',
                    score,
                    engagement: { totalRichDays: 0, unlockStatus: 'locked' },
                }}
            />,
        );
        expect(useDfesQuestionMock).toHaveBeenCalledWith(
            'farm-1', 'plot-1',
            expect.objectContaining({ crop: 'grapes', todayLocalDate: '2026-07-11' }),
            true,
        );
    });

    it('disables the hook when stageQuestions is OFF, even with a farmId present', async () => {
        const { MeterQuestionHost } = await loadComponent(true, false);
        render(
            <MeterQuestionHost
                farmId="farm-1"
                plotId={null}
                allLogs={arrivedLogs}
                questionInputs={{ crop: 'grapes', todayLocalDate: '2026-07-11', engagement: { totalRichDays: 0, unlockStatus: 'locked' } }}
            />,
        );
        expect(useDfesQuestionMock).toHaveBeenCalledWith('farm-1', null, expect.anything(), false);
    });

    it('disables the hook when farmId is null, even with stageQuestions ON', async () => {
        const { MeterQuestionHost } = await loadComponent(true, true);
        render(
            <MeterQuestionHost
                farmId={null}
                plotId={null}
                allLogs={arrivedLogs}
                questionInputs={{ crop: '', todayLocalDate: '2026-07-11', engagement: { totalRichDays: 0, unlockStatus: 'locked' } }}
            />,
        );
        expect(useDfesQuestionMock).toHaveBeenCalledWith('', null, expect.anything(), false);
    });

    it('threads the selected question into MeterDisplay and fires recordOutcome({ skipped: false }) on tap', async () => {
        const recordOutcome = vi.fn();
        useDfesQuestionMock.mockReturnValue({
            selected: {
                question: {
                    questionKey: 'gap.dose', crop: 'grapes', lens: 'INPUTS', depthLevel: 1, priority: 4,
                    cooldownDays: 7, questionType: 'TEXT', answerModes: 'text', safetyClass: 'NONE',
                    agronomistApproved: true, marathiApproved: true, promptMr: 'किती डोस दिला?',
                },
                resolvedPromptMr: 'किती डोस दिला?',
                triggerReason: 'gap DOSE leverage 20',
                weatherContext: null,
                expectedStage: null,
                actualStageApplicability: null,
            },
            loading: false,
            recordOutcome,
        });
        const { MeterQuestionHost } = await loadComponent(true, true);
        const { getByTestId } = render(
            <MeterQuestionHost
                farmId="farm-1"
                plotId="plot-1"
                score={score}
                allLogs={arrivedLogs}
                questionInputs={{ crop: 'grapes', todayLocalDate: '2026-07-11', score, engagement: { totalRichDays: 0, unlockStatus: 'locked' } }}
            />,
        );

        const card = getByTestId('shramsathi-gap-question');
        expect(card.textContent).toBe('किती डोस दिला?');

        fireEvent.click(card);
        expect(recordOutcome).toHaveBeenCalledTimes(1);
        expect(recordOutcome).toHaveBeenCalledWith({ skipped: false });
    });

    it('returns null (renders nothing) when understandingMeter is OFF, regardless of stageQuestions', async () => {
        const { MeterQuestionHost } = await loadComponent(false, true);
        const { container } = render(
            <MeterQuestionHost
                farmId="farm-1"
                plotId="plot-1"
                allLogs={arrivedLogs}
                questionInputs={{ crop: 'grapes', todayLocalDate: '2026-07-11', engagement: { totalRichDays: 0, unlockStatus: 'locked' } }}
            />,
        );
        expect(container.firstChild).toBeNull();
    });
});
