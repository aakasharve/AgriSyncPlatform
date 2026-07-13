// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MeterDisplay — unit tests (dfes-companion-2026-07-11 Slice 3b).
 *
 * The DISPLAYED farmer number is now the server /10 Day Understanding Score
 * (from useDayUnderstanding), NOT the client-side scoreVlog /100. These tests
 * assert:
 *   - score present  → "X / १०" in Devanagari, under the Sathi framing line,
 *   - score null      → NO number, a gentle Marathi pending state,
 *   - fetch fail/offline → NO number, gentle pending — and NEVER the client /100,
 *   - the 3 internal lenses are never rendered (client only ever sees `score`),
 *   - the flag-gate, arrival gate, and question-gap ranking still behave.
 *
 * Follows the vi.doMock + vi.resetModules + dynamic-import pattern used across
 * the DFES suite for toggling FEATURE_FLAGS without leaking module state.
 */
import React from 'react';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
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

// Controllable useDayUnderstanding mock — set per test.
const dayUnderstandingMock = vi.fn();

/**
 * Load MeterDisplay with FEATURE_FLAGS.understandingMeter forced, the server
 * Day-Understanding hook mocked, and useLanguage bound to the REAL Marathi
 * translations (so the framing/pending copy assertions are meaningful).
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
    vi.doMock('../../hooks/useDayUnderstanding', () => ({
        useDayUnderstanding: (...args: unknown[]) => dayUnderstandingMock(...args),
    }));
    vi.doMock('../../../../i18n/LanguageContext', () => ({
        useLanguage: () => ({ language: 'mr', setLanguage: () => undefined, t: (k: string) => translate(k, 'mr') }),
    }));
    return import('../MeterDisplay');
}

function mockDayScore(score: number | null, error: string | null = null) {
    dayUnderstandingMock.mockReturnValue({ score, isLoading: false, error, refresh: vi.fn() });
}

beforeEach(() => {
    dayUnderstandingMock.mockReset();
    mockDayScore(null);
});

afterEach(() => {
    cleanup();
    vi.doUnmock('../../../../app/featureFlags');
    vi.doUnmock('../../hooks/useDayUnderstanding');
    vi.doUnmock('../../../../i18n/LanguageContext');
    vi.resetModules();
});

// =============================================================================
// TESTS
// =============================================================================

describe('MeterDisplay (Slice 3b — server /10 Day Understanding Score)', () => {
    // -------------------------------------------------------------------------
    // 1. Flag OFF → renders nothing
    // -------------------------------------------------------------------------
    it('renders nothing when FEATURE_FLAGS.understandingMeter is OFF', async () => {
        mockDayScore(9);
        const { MeterDisplay } = await loadComponent(false);
        const { container } = render(<MeterDisplay farmId="farm-1" dayDate="2026-07-11" />);
        expect(container.firstChild).toBeNull();
    });

    // -------------------------------------------------------------------------
    // 2. Score present → "X / १०" in Devanagari + framing line; gaps still ranked
    // -------------------------------------------------------------------------
    it('shows the server score as "X / १०" with the Marathi framing line, plus question gaps', async () => {
        mockDayScore(8);
        const { MeterDisplay } = await loadComponent(true);

        const score = makeScore(78, 'SCORED', [
            makeDim('DOSE', true, 0, 20),   // coverage 0 → gap surfaced
            makeDim('COST', true, 1, 12),   // fully covered → no gap
            makeDim('WHAT', true, 1, 20),   // fully covered → no gap
        ]);

        const { getByTestId } = render(
            <MeterDisplay score={score} allLogs={[]} farmId="farm-1" dayDate="2026-07-11" />,
        );

        expect(getByTestId('day-understanding-value').textContent).toBe('८ / १०');
        // Framing = Sathi's understanding of the day, not a grade of the farmer.
        expect(getByTestId('day-understanding-intro').textContent).toContain('समजून');

        // The scoreVlog VlogScore still drives question-gap ranking...
        const gapsEl = getByTestId('meter-gaps');
        expect(gapsEl.children.length).toBeGreaterThan(0);
    });

    // -------------------------------------------------------------------------
    // 3. Score null → NO number, gentle pending, no /100 anywhere
    // -------------------------------------------------------------------------
    it('shows a gentle pending state (NO number) when the server score is null', async () => {
        mockDayScore(null);
        const { MeterDisplay } = await loadComponent(true);

        const { getByTestId, queryByTestId, container } = render(
            <MeterDisplay farmId="farm-1" dayDate="2026-07-11" />,
        );

        expect(getByTestId('day-understanding-pending').textContent).toBe('अजून समजतंय…');
        expect(queryByTestId('day-understanding-value')).toBeNull();
        // never a 0, never a client /100
        expect(container.textContent).not.toContain('/100');
        expect(container.textContent).not.toMatch(/०\s*\/\s*१०/);
    });

    // -------------------------------------------------------------------------
    // 4. Fetch failed/offline → NO number, pending — NOT the client scoreVlog /100
    // -------------------------------------------------------------------------
    it('on a failed/offline fetch shows pending and NEVER the client /100 fallback', async () => {
        mockDayScore(null, 'offline'); // hook already collapsed the error to score null
        const { MeterDisplay } = await loadComponent(true);

        // A rich VlogScore is present (score 78) — it must NOT leak as a farmer number.
        const clientScore = makeScore(78, 'SCORED', [makeDim('DOSE', true, 0, 20)]);

        const { getByTestId, queryByTestId, container } = render(
            <MeterDisplay score={clientScore} farmId="farm-1" dayDate="2026-07-11" />,
        );

        expect(getByTestId('day-understanding-pending')).toBeTruthy();
        expect(queryByTestId('day-understanding-value')).toBeNull();
        expect(container.textContent).not.toContain('/100');
        expect(container.textContent).not.toContain('78');
    });

    // -------------------------------------------------------------------------
    // 5. The 3 internal lenses are never rendered — only the /10 surfaces
    // -------------------------------------------------------------------------
    it('never renders the internal lenses — only the single /10 score', async () => {
        mockDayScore(7);
        const { MeterDisplay } = await loadComponent(true);

        const { getByTestId } = render(<MeterDisplay farmId="farm-1" dayDate="2026-07-11" />);

        const surface = getByTestId('day-understanding');
        // The only Devanagari numerals present are the score + denominator "७ / १०".
        const digits = (surface.textContent ?? '').match(/[०-९]+/g) ?? [];
        expect(digits).toEqual(['७', '१०']);
    });

    // -------------------------------------------------------------------------
    // 6. UNKNOWN VlogScore → meter-display shown, NO meter-gaps
    // -------------------------------------------------------------------------
    it('renders meter-display but no meter-gaps for an UNKNOWN VlogScore', async () => {
        mockDayScore(5);
        const { MeterDisplay } = await loadComponent(true);

        const score = makeScore(null, 'UNKNOWN', [makeDim('DOSE', true, 0, 20)]);

        const { getByTestId, queryByTestId } = render(
            <MeterDisplay score={score} allLogs={[]} farmId="farm-1" dayDate="2026-07-11" />,
        );

        expect(getByTestId('meter-display')).toBeTruthy();
        expect(queryByTestId('meter-gaps')).toBeNull();
    });

    // -------------------------------------------------------------------------
    // 7. Arrival gate still reflects the rich-log count
    // -------------------------------------------------------------------------
    it('reflects the correct rich-log count in meter-arrival', async () => {
        mockDayScore(6);
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

        const { getByTestId } = render(<MeterDisplay allLogs={allLogs} farmId="farm-1" dayDate="2026-07-11" />);

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
        mockDayScore(6);
        const { MeterDisplay } = await loadComponent(true, true);
        const onQuestionInteract = vi.fn();
        const onAnswer = vi.fn();
        const onDismiss = vi.fn();

        const { getByTestId, queryByTestId, queryAllByTestId } = render(
            <MeterDisplay
                farmId="farm-1"
                dayDate="2026-07-11"
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
        mockDayScore(6);
        const { MeterDisplay } = await loadComponent(true, true);

        const dfesQuestion = makeSelectedQuestion({
            answerOptions: [
                { value: 'low', labelMr: 'कमी' },
                { value: 'high', labelMr: 'जास्त', stageConfirmedValue: true },
            ],
        });

        const { getAllByTestId, getByTestId } = render(
            <MeterDisplay farmId="farm-1" dayDate="2026-07-11" dfesQuestion={dfesQuestion} />,
        );

        const options = getAllByTestId('shramsathi-answer-option');
        expect(options).toHaveLength(2);
        expect(options.map((el) => el.textContent)).toEqual(['कमी', 'जास्त']);
        options.forEach((el) => expect(el.style.fontFamily).toContain('Noto Sans Devanagari'));

        // Prompt still renders (as text, not the single ack button) alongside the choices.
        expect(getByTestId('shramsathi-gap-question').textContent).toBe('किती मात्रा (डोस) वापरली?');
    });

    it('tapping a tap-choice option calls onAnswer with that exact option — NOT onQuestionInteract', async () => {
        mockDayScore(6);
        const { MeterDisplay } = await loadComponent(true, true);
        const onAnswer = vi.fn();
        const onQuestionInteract = vi.fn();

        const lowOption = { value: 'low', labelMr: 'कमी' };
        const highOption = { value: 'high', labelMr: 'जास्त', stageConfirmedValue: true };
        const dfesQuestion = makeSelectedQuestion({ answerOptions: [lowOption, highOption] });

        const { getAllByTestId } = render(
            <MeterDisplay
                farmId="farm-1"
                dayDate="2026-07-11"
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
        mockDayScore(6);
        const { MeterDisplay } = await loadComponent(true, true);
        const onDismiss = vi.fn();
        const onQuestionInteract = vi.fn();
        const onAnswer = vi.fn();

        const dfesQuestion = makeSelectedQuestion({ answerOptions: [{ value: 'low', labelMr: 'कमी' }] });

        const { getByTestId } = render(
            <MeterDisplay
                farmId="farm-1"
                dayDate="2026-07-11"
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
