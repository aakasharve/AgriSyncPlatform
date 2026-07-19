// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DayUnderstandingCard — unit tests (spec: dfes-companion-2026-07-11).
 *
 * These assertions MOVED here verbatim from MeterDisplay.test.tsx when the score
 * block was lifted out of MeterDisplay (founder request 2026-07-19) so the Day
 * Understanding Score can lead the post-save success surface. The contract is
 * unchanged:
 *   - flag OFF        → renders nothing (inert + network-silent in production),
 *   - score present   → "X / १०" in Devanagari, under the Sathi framing line,
 *   - score null      → NO number, a gentle Marathi pending state,
 *   - fetch fail/offline → NO number, gentle pending — and NEVER the client /100,
 *   - the 3 internal lenses are never rendered (client only ever sees the /10),
 *   - this component is the SINGLE owner of the useDayUnderstanding fetch, and it
 *     passes (farmId, dayDate, savedLogId) straight through to it.
 *
 * Follows the vi.doMock + vi.resetModules + dynamic-import pattern used across
 * the DFES suite for toggling FEATURE_FLAGS without leaking module state.
 */
import React from 'react';
import { render, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { t as translate } from '../../../../../i18n/translations';

// Controllable useDayUnderstanding mock — set per test.
const dayUnderstandingMock = vi.fn();

/**
 * Load DayUnderstandingCard with FEATURE_FLAGS.understandingMeter forced, the
 * server Day-Understanding hook mocked, and useLanguage bound to the REAL Marathi
 * translations (so the framing/pending copy assertions are meaningful).
 */
async function loadComponent(understandingMeter: boolean) {
    vi.resetModules();
    vi.doMock('../../../../../app/featureFlags', () => ({
        FEATURE_FLAGS: {
            understandingMeter,
            DwcChip: false,
        },
        isFarmGeographyV2Enabled: () => false,
        isWeatherBackendFetchEnabled: () => false,
        isVoiceDoomLoopDetectorEnabled: () => true,
        IS_E2E_HARNESS_ENABLED: false,
        isE2EHarnessEnabled: () => false,
        isEnabled: () => understandingMeter,
    }));
    vi.doMock('../../../hooks/useDayUnderstanding', () => ({
        useDayUnderstanding: (...args: unknown[]) => dayUnderstandingMock(...args),
    }));
    vi.doMock('../../../../../i18n/LanguageContext', () => ({
        useLanguage: () => ({ language: 'mr', setLanguage: () => undefined, t: (k: string) => translate(k, 'mr') }),
    }));
    return import('../DayUnderstandingCard');
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
    vi.doUnmock('../../../../../app/featureFlags');
    vi.doUnmock('../../../hooks/useDayUnderstanding');
    vi.doUnmock('../../../../../i18n/LanguageContext');
    vi.resetModules();
});

// =============================================================================
// TESTS
// =============================================================================

describe('DayUnderstandingCard (server /10 Day Understanding Score)', () => {
    // -------------------------------------------------------------------------
    // 1. Flag OFF → renders nothing
    // -------------------------------------------------------------------------
    it('renders nothing when FEATURE_FLAGS.understandingMeter is OFF', async () => {
        mockDayScore(9);
        const { DayUnderstandingCard } = await loadComponent(false);
        const { container } = render(<DayUnderstandingCard farmId="farm-1" dayDate="2026-07-11" />);
        expect(container.firstChild).toBeNull();
    });

    // -------------------------------------------------------------------------
    // 2. Score present → "X / १०" in Devanagari + framing line + the bar
    // -------------------------------------------------------------------------
    it('shows the server score as "X / १०" with the Marathi framing line', async () => {
        mockDayScore(8);
        const { DayUnderstandingCard } = await loadComponent(true);

        const { getByTestId } = render(<DayUnderstandingCard farmId="farm-1" dayDate="2026-07-11" />);

        expect(getByTestId('day-understanding-value').textContent).toBe('८ / १०');
        // Framing = Sathi's understanding of the day, not a grade of the farmer.
        expect(getByTestId('day-understanding-intro').textContent).toContain('समजून');
        // The founder-approved bar renders under the number.
        expect(getByTestId('understanding-bar')).toBeTruthy();
        expect(getByTestId('understanding-bar').getAttribute('aria-label')).toBe('8 / 10');
    });

    // -------------------------------------------------------------------------
    // 3. Score null → NO number, gentle pending, no /100 anywhere
    // -------------------------------------------------------------------------
    it('shows a gentle pending state (NO number) when the server score is null', async () => {
        mockDayScore(null);
        const { DayUnderstandingCard } = await loadComponent(true);

        const { getByTestId, queryByTestId, container } = render(
            <DayUnderstandingCard farmId="farm-1" dayDate="2026-07-11" />,
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
        const { DayUnderstandingCard } = await loadComponent(true);

        const { getByTestId, queryByTestId, container } = render(
            <DayUnderstandingCard farmId="farm-1" dayDate="2026-07-11" />,
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
        const { DayUnderstandingCard } = await loadComponent(true);

        const { getByTestId } = render(<DayUnderstandingCard farmId="farm-1" dayDate="2026-07-11" />);

        const surface = getByTestId('day-understanding');
        // The only Devanagari numerals present are the score + denominator "७ / १०".
        const digits = (surface.textContent ?? '').match(/[०-९]+/g) ?? [];
        expect(digits).toEqual(['७', '१०']);
    });

    // -------------------------------------------------------------------------
    // 6. This component owns the fetch — farmId/dayDate/savedLogId go straight in.
    //    savedLogId is BUGFIX_2026-07-19's refetch key: without it the score
    //    fetch races the save and never retries on the same day.
    // -------------------------------------------------------------------------
    it('passes farmId, dayDate and savedLogId (the refetch key) into useDayUnderstanding', async () => {
        mockDayScore(6);
        const { DayUnderstandingCard } = await loadComponent(true);

        render(<DayUnderstandingCard farmId="farm-1" dayDate="2026-07-11" savedLogId="log-42" />);

        expect(dayUnderstandingMock).toHaveBeenCalledWith('farm-1', '2026-07-11', 'log-42');
    });

    it('normalises a missing farm to null rather than skipping the hook call', async () => {
        mockDayScore(null);
        const { DayUnderstandingCard } = await loadComponent(true);

        render(<DayUnderstandingCard farmId={null} />);

        expect(dayUnderstandingMock).toHaveBeenCalledWith(null, undefined, undefined);
    });
});
