// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MeterDisplay — unit tests (dfes-companion-2026-07-11).
 *
 * 2026-07-19 (founder request): the Day Understanding Score X/१० + UnderstandingBar
 * MOVED OUT of MeterDisplay into shramsathi/DayUnderstandingCard, so the score can
 * lead the post-save success surface. Those score assertions now live in
 * shramsathi/__tests__/DayUnderstandingCard.test.tsx — they were moved, not dropped.
 *
 * What this file still asserts about MeterDisplay:
 *   - the flag-gate (understandingMeter OFF → renders nothing),
 *   - it NO LONGER renders the score block (no duplicate score on screen),
 *   - question-gap ranking from the client scoreVlog still behaves,
 *   - the arrival gate still reflects the rich-log count,
 *   - the tap-to-answer question card behaviour.
 *
 * Follows the vi.doMock + vi.resetModules + dynamic-import pattern used across
 * the DFES suite for toggling FEATURE_FLAGS without leaking module state.
 */
import React from 'react';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { VlogScoreDimension, VlogScore } from '../../../../domain/types/log.types';
import { DFES_TUNING } from '../../services/dfesTuning';
import { t as translate } from '../../../../i18n/translations';
import type { SelectedQuestion } from '../../services/dfesQuestionEngine';

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
 * Load MeterDisplay with FEATURE_FLAGS.understandingMeter forced and useLanguage
 * bound to the REAL Marathi translations (so the copy assertions are meaningful).
 *
 * NOTE: useDayUnderstanding is deliberately NOT mocked here — MeterDisplay no
 * longer calls it. If someone re-introduces that call, the real hook would fire
 * a network request under jsdom and the "no score block" test below fails.
 */
async function loadComponent(understandingMeter: boolean, stageQuestions = false) {
    vi.resetModules();
    vi.doMock('../../../../app/featureFlags', () => ({
        FEATURE_FLAGS: {
            understandingMeter,
            stageQuestions,
            DwcChip: false,
        },
        isFarmGeographyV2Enabled: () => false,
        isWeatherBackendFetchEnabled: () => false,
        isVoiceDoomLoopDetectorEnabled: () => true,
        IS_E2E_HARNESS_ENABLED: false,
        isE2EHarnessEnabled: () => false,
        isEnabled: () => understandingMeter,
    }));
    vi.doMock('../../../../i18n/LanguageContext', () => ({
        useLanguage: () => ({ language: 'mr', setLanguage: () => undefined, t: (k: string) => translate(k, 'mr') }),
    }));
    return import('../MeterDisplay');
}

afterEach(() => {
    cleanup();
    vi.doUnmock('../../../../app/featureFlags');
    vi.doUnmock('../../../../i18n/LanguageContext');
    vi.resetModules();
});

// =============================================================================
// TESTS
// =============================================================================

describe('MeterDisplay (question + gap surface)', () => {
    // -------------------------------------------------------------------------
    // 1. Flag OFF → renders nothing
    // -------------------------------------------------------------------------
    it('renders nothing when FEATURE_FLAGS.understandingMeter is OFF', async () => {
        const { MeterDisplay } = await loadComponent(false);
        const { container } = render(<MeterDisplay />);
        expect(container.firstChild).toBeNull();
    });

    // -------------------------------------------------------------------------
    // 2. Question gaps still ranked from the client scoreVlog
    // -------------------------------------------------------------------------
    it('ranks question gaps from the client VlogScore', async () => {
        const { MeterDisplay } = await loadComponent(true);

        const score = makeScore(78, 'SCORED', [
            makeDim('DOSE', true, 0, 20),   // coverage 0 → gap surfaced
            makeDim('COST', true, 1, 12),   // fully covered → no gap
            makeDim('WHAT', true, 1, 20),   // fully covered → no gap
        ]);

        const { getByTestId } = render(<MeterDisplay score={score} allLogs={[]} />);

        const gapsEl = getByTestId('meter-gaps');
        expect(gapsEl.children.length).toBeGreaterThan(0);
    });

    // -------------------------------------------------------------------------
    // 3. The score block has MOVED OUT — MeterDisplay must never render it again
    //    (otherwise the farmer sees the score twice on the success surface).
    // -------------------------------------------------------------------------
    it('no longer renders the Day Understanding score block (it moved to DayUnderstandingCard)', async () => {
        const { MeterDisplay } = await loadComponent(true);

        // A rich client VlogScore is present — it must not leak as a farmer number either.
        const clientScore = makeScore(78, 'SCORED', [makeDim('DOSE', true, 0, 20)]);

        const { queryByTestId, container } = render(<MeterDisplay score={clientScore} />);

        expect(queryByTestId('meter-score')).toBeNull();
        expect(queryByTestId('day-understanding')).toBeNull();
        expect(queryByTestId('day-understanding-value')).toBeNull();
        expect(queryByTestId('day-understanding-intro')).toBeNull();
        expect(queryByTestId('day-understanding-pending')).toBeNull();
        expect(queryByTestId('understanding-bar')).toBeNull();
        expect(container.textContent).not.toContain('/100');
        expect(container.textContent).not.toContain('78');
        expect(container.textContent).not.toMatch(/\/\s*१०/);
    });

    // -------------------------------------------------------------------------
    // 4. UNKNOWN VlogScore → meter-display shown, NO meter-gaps
    // -------------------------------------------------------------------------
    it('renders meter-display but no meter-gaps for an UNKNOWN VlogScore', async () => {
        const { MeterDisplay } = await loadComponent(true);

        const score = makeScore(null, 'UNKNOWN', [makeDim('DOSE', true, 0, 20)]);

        const { getByTestId, queryByTestId } = render(<MeterDisplay score={score} allLogs={[]} />);

        expect(getByTestId('meter-display')).toBeTruthy();
        expect(queryByTestId('meter-gaps')).toBeNull();
    });

    // -------------------------------------------------------------------------
    // 5. Arrival gate still reflects the rich-log count
    // -------------------------------------------------------------------------
    it('reflects the correct rich-log count in meter-arrival', async () => {
        const { MeterDisplay } = await loadComponent(true);

        const richScore = makeScore(80, 'SCORED', []);
        const poorScore = makeScore(30, 'SCORED', []);
        const unknownScore = makeScore(null, 'UNKNOWN', []);

        const allLogs: Array<{ understanding?: VlogScore }> = [
            { understanding: richScore },
            { understanding: richScore },
            { understanding: richScore },
            { understanding: richScore },
            { understanding: richScore },
            { understanding: poorScore },
            { understanding: unknownScore },
        ];

        const { getByTestId } = render(<MeterDisplay allLogs={allLogs} />);

        const arrivalEl = getByTestId('meter-arrival');
        expect(arrivalEl.textContent).toContain(`5/${DFES_TUNING.richDayThreshold}`);
    });
});

// =============================================================================
// TAP-TO-ANSWER (Task 2A, spec: dfes-companion-2026-07-11)
// =============================================================================

/** Minimal, fully-typed SelectedQuestion fixture; override per test. */
function makeSelectedQuestion(overrides: Partial<SelectedQuestion> = {}): SelectedQuestion {
    return {
        question: {
            questionKey: 'gap.dose', crop: '*', triggerType: 'Gap', questionType: 'gap_fill',
            lens: 'Execution', depthLevel: 1, priority: 4, cooldownDays: 3, answerModes: 'voice',
            safetyClass: 'informational', anchorDateType: 'log_date',
            agronomistApproved: true, marathiApproved: true,
            promptMr: 'किती मात्रा (डोस) वापरली?',
        },
        resolvedPromptMr: 'किती मात्रा (डोस) वापरली?',
        triggerReason: 'test',
        weatherContext: null,
        expectedStage: null,
        actualStageApplicability: null,
        ...overrides,
    };
}

describe('MeterDisplay — tap-to-answer (Task 2A)', () => {
    it('a question with NO answerOptions keeps today\'s exact behaviour — single ack button fires onQuestionInteract only', async () => {
        const { MeterDisplay } = await loadComponent(true, true);
        const onQuestionInteract = vi.fn();
        const onAnswer = vi.fn();
        const onDismiss = vi.fn();

        const { getByTestId, queryByTestId, queryAllByTestId } = render(
            <MeterDisplay
                dfesQuestion={makeSelectedQuestion()}
                onQuestionInteract={onQuestionInteract}
                onAnswer={onAnswer}
                onDismiss={onDismiss}
            />,
        );

        expect(queryAllByTestId('shramsathi-answer-option')).toHaveLength(0);
        expect(queryByTestId('shramsathi-answer-card')).toBeNull();

        fireEvent.click(getByTestId('shramsathi-gap-question'));
        expect(onQuestionInteract).toHaveBeenCalledTimes(1);
        expect(onAnswer).not.toHaveBeenCalled();
        expect(onDismiss).not.toHaveBeenCalled();
    });

    it('a question WITH answerOptions renders one tap-choice button per option (Marathi labelMr, Noto Sans Devanagari)', async () => {
        const { MeterDisplay } = await loadComponent(true, true);

        const dfesQuestion = makeSelectedQuestion({
            answerOptions: [
                { value: 'low', labelMr: 'कमी' },
                { value: 'high', labelMr: 'जास्त', stageConfirmedValue: true },
            ],
        });

        const { getAllByTestId, getByTestId } = render(<MeterDisplay dfesQuestion={dfesQuestion} />);

        const options = getAllByTestId('shramsathi-answer-option');
        expect(options).toHaveLength(2);
        expect(options.map((el) => el.textContent)).toEqual(['कमी', 'जास्त']);
        options.forEach((el) => expect(el.style.fontFamily).toContain('Noto Sans Devanagari'));

        // Prompt still renders (as text, not the single ack button) alongside the choices.
        expect(getByTestId('shramsathi-gap-question').textContent).toBe('किती मात्रा (डोस) वापरली?');
    });

    it('tapping a tap-choice option calls onAnswer with that exact option — NOT onQuestionInteract', async () => {
        const { MeterDisplay } = await loadComponent(true, true);
        const onAnswer = vi.fn();
        const onQuestionInteract = vi.fn();

        const lowOption = { value: 'low', labelMr: 'कमी' };
        const highOption = { value: 'high', labelMr: 'जास्त', stageConfirmedValue: true };
        const dfesQuestion = makeSelectedQuestion({ answerOptions: [lowOption, highOption] });

        const { getAllByTestId } = render(
            <MeterDisplay
                dfesQuestion={dfesQuestion}
                onAnswer={onAnswer}
                onQuestionInteract={onQuestionInteract}
            />,
        );

        const options = getAllByTestId('shramsathi-answer-option');
        fireEvent.click(options[1]);

        expect(onAnswer).toHaveBeenCalledTimes(1);
        expect(onAnswer).toHaveBeenCalledWith(highOption);
        expect(onQuestionInteract).not.toHaveBeenCalled();
    });

    it('the "नंतर" dismiss affordance on a tap-choice question calls onDismiss — NOT onQuestionInteract/onAnswer', async () => {
        const { MeterDisplay } = await loadComponent(true, true);
        const onDismiss = vi.fn();
        const onQuestionInteract = vi.fn();
        const onAnswer = vi.fn();

        const dfesQuestion = makeSelectedQuestion({ answerOptions: [{ value: 'low', labelMr: 'कमी' }] });

        const { getByTestId } = render(
            <MeterDisplay
                dfesQuestion={dfesQuestion}
                onDismiss={onDismiss}
                onQuestionInteract={onQuestionInteract}
                onAnswer={onAnswer}
            />,
        );

        fireEvent.click(getByTestId('shramsathi-answer-dismiss'));
        expect(onDismiss).toHaveBeenCalledTimes(1);
        expect(onQuestionInteract).not.toHaveBeenCalled();
        expect(onAnswer).not.toHaveBeenCalled();
    });
});
