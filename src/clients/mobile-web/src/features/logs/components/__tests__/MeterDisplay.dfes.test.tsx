// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MeterDisplay — DFES combined-question wiring (Phase 5, Task 5.8)
 *
 * Asserts that when BOTH understandingMeter AND stageQuestions are ON and the
 * meter is arrived, MeterDisplay prefers the approved combined D8 question
 * (dfesQuestion.resolvedPromptMr) over the raw placeholder gap cards, and that
 * tapping the card fires onQuestionInteract.
 *
 * Reconciliation note (repo-is-truth, mirrors dfesTuning.test.ts): featureFlags.ts
 * reads env via `(import.meta as ViteEnvShape).env?.[key]` — a cast form Vitest's
 * built-in import.meta.env stub plugin cannot rewrite, so `vi.stubEnv` cannot
 * reach it. This suite mocks the `featureFlags` module directly instead (the
 * same vi.doMock + vi.resetModules + dynamic-import pattern already used by
 * MeterDisplay.test.tsx and dfesTuning.test.ts), which is the established,
 * working way to control FEATURE_FLAGS deterministically in this repo.
 *
 * spec: dfes-companion-2026-07-11
 */
import React from 'react';
import { render, cleanup, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { VlogScoreDimension, VlogScore } from '../../../../domain/types/log.types';
import { DFES_TUNING } from '../../services/dfesTuning';
import { selectDailyQuestion } from '../../services/dfesQuestionEngine';

// =============================================================================
// HELPERS
// =============================================================================

/** Build a minimal VlogScoreDimension. */
function makeDim(
    dimension: string,
    applicable: boolean,
    coverage: 0 | 0.5 | 1,
    weight: number,
): VlogScoreDimension {
    return {
        dimension,
        applicable,
        weight,
        coverage,
        confidenceFactor: 1,
        contribution: applicable ? weight * coverage * 1 : 0,
    };
}

/** Build a minimal VlogScore fixture. */
function makeScore(
    score: number | null,
    outcome: VlogScore['outcome'],
    dims: VlogScoreDimension[],
): VlogScore {
    return { score, outcome, dimensions: dims };
}

/**
 * Load MeterDisplay with FEATURE_FLAGS.understandingMeter and .stageQuestions
 * forced to known values. Mirrors the loadComponent pattern in
 * MeterDisplay.test.tsx, extended with the Phase 5 flag.
 */
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
    return import('../MeterDisplay');
}

afterEach(() => {
    cleanup();
    vi.doUnmock('../../../../app/featureFlags');
    vi.resetModules();
});

// =============================================================================
// TESTS
// =============================================================================

describe('MeterDisplay — DFES combined question (Phase 5, Task 5.8)', () => {
    it('shows the combined dfesQuestion card (approved copy) ahead of raw gap cards and fires onQuestionInteract on tap', async () => {
        const { MeterDisplay } = await loadComponent(true, true);

        const score = makeScore(78, 'SCORED', [
            makeDim('DOSE', true, 0, 20), // would otherwise surface a raw gap card
        ]);

        // richDayThreshold rich logs → arrived, so the arrived branch (score + gaps) renders.
        // Reuses the same arrived-fixture shape as the sibling MeterDisplay suite.
        const arrivedLogs = Array.from({ length: DFES_TUNING.richDayThreshold }, () => ({
            understanding: makeScore(90, 'SCORED', []),
        }));

        const dfesQuestion = selectDailyQuestion({
            crop: 'grapes',
            todayLocalDate: '2026-07-11',
            score,
            engagement: { totalRichDays: 0, unlockStatus: 'locked' },
            recentEvents: [],
        });
        expect(dfesQuestion).not.toBeNull();

        const onQuestionInteract = vi.fn();

        const { getByTestId, getAllByTestId } = render(
            <MeterDisplay
                score={score}
                allLogs={arrivedLogs}
                dfesQuestion={dfesQuestion}
                onQuestionInteract={onQuestionInteract}
            />,
        );

        // Exactly ONE combined card — the approved copy, not the raw placeholder gaps.
        const cards = getAllByTestId('shramsathi-gap-question');
        expect(cards).toHaveLength(1);
        expect(cards[0].textContent).toBe(dfesQuestion!.resolvedPromptMr);

        fireEvent.click(getByTestId('shramsathi-gap-question'));
        expect(onQuestionInteract).toHaveBeenCalledTimes(1);
    });

    it('falls back to raw gap cards when stageQuestions is OFF even if a dfesQuestion is supplied', async () => {
        const { MeterDisplay } = await loadComponent(true, false);

        const score = makeScore(78, 'SCORED', [
            makeDim('DOSE', true, 0, 20),
        ]);
        const arrivedLogs = Array.from({ length: DFES_TUNING.richDayThreshold }, () => ({
            understanding: makeScore(90, 'SCORED', []),
        }));
        const dfesQuestion = selectDailyQuestion({
            crop: 'grapes',
            todayLocalDate: '2026-07-11',
            score,
            engagement: { totalRichDays: 0, unlockStatus: 'locked' },
            recentEvents: [],
        });

        const { getByTestId } = render(
            <MeterDisplay score={score} allLogs={arrivedLogs} dfesQuestion={dfesQuestion} />,
        );

        // Flag OFF → raw gap card copy (DOSE placeholder), not the bank's resolvedPromptMr card path.
        const card = getByTestId('shramsathi-gap-question');
        expect(card).toBeTruthy();
        expect(card).not.toHaveAttribute('role', 'button');
    });
});
