// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MeterDisplay — unit tests (flag-gated engine → Shram Sathi visual adapter)
 *
 * MeterDisplay is now an ADAPTER that maps the real meter engine
 * (scoreVlog output + rankMeterGaps + computeMeterArrival) onto the
 * presentational ShramSathiMeter. These tests assert the engine → visual
 * wiring (flag gate, /10 score, gaps, arrival gate) through the Shram Sathi
 * markup rather than the old placeholder testids.
 *
 * Follows the vi.doMock + vi.resetModules + dynamic-import pattern used in
 * AppRouter.feature-gate.test.tsx (the established repo convention for toggling
 * FEATURE_FLAGS between test cases without leaking module state).
 *
 * spec: ai-intelligence-plan-2026-06-25
 */
import React from 'react';
import { render, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { VlogScoreDimension, VlogScore } from '../../../../domain/types/log.types';

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
 * Load MeterDisplay with FEATURE_FLAGS.understandingMeter forced to a known value.
 * Mirrors the loadRoutesWithFlag pattern in AppRouter.feature-gate.test.tsx.
 */
async function loadComponent(understandingMeter: boolean) {
    vi.resetModules();
    vi.doMock('../../../../app/featureFlags', () => ({
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

describe('MeterDisplay', () => {
    // -------------------------------------------------------------------------
    // 1. Flag OFF → renders nothing
    // -------------------------------------------------------------------------
    it('renders nothing when FEATURE_FLAGS.understandingMeter is OFF', async () => {
        const { MeterDisplay } = await loadComponent(false);
        const { container } = render(<MeterDisplay />);
        expect(container.firstChild).toBeNull();
    });

    // -------------------------------------------------------------------------
    // 2. Flag ON + SCORED VlogScore, ARRIVED → /10 score + gaps surfaced
    // -------------------------------------------------------------------------
    it('shows the /10 score and gaps for a SCORED VlogScore when flag is ON and arrived', async () => {
        const { MeterDisplay } = await loadComponent(true);

        const score = makeScore(78, 'SCORED', [
            makeDim('DOSE', true, 0, 20),   // coverage 0 → gap surfaced
            makeDim('COST', true, 1, 12),   // fully covered → no gap
            makeDim('WHAT', true, 1, 20),   // fully covered → no gap
        ]);

        // 20 rich logs → arrived, so the arrived branch (score + gaps) renders.
        const arrivedLogs = Array.from({ length: 20 }, () => ({
            understanding: makeScore(90, 'SCORED', []),
        }));

        const { getByTestId, getAllByTestId } = render(
            <MeterDisplay score={score} allLogs={arrivedLogs} />,
        );

        // Wrapper testid preserved for consumers.
        expect(getByTestId('meter-display')).toBeTruthy();

        // 78/100 → 7.8 → rounds to 8 on the /10 face.
        const scoreEl = getByTestId('shramsathi-score');
        expect(scoreEl.textContent).toContain('१० पैकी ८');

        // DOSE gap (coverage 0) surfaced through the Shram Sathi gap list.
        expect(getAllByTestId('shramsathi-gap-question').length).toBeGreaterThan(0);
    });

    // -------------------------------------------------------------------------
    // 3. Flag ON + UNKNOWN VlogScore → meter-display shown, NO gap questions
    // -------------------------------------------------------------------------
    it('renders meter-display but no gap questions for an UNKNOWN VlogScore', async () => {
        const { MeterDisplay } = await loadComponent(true);

        const score = makeScore(null, 'UNKNOWN', [
            makeDim('DOSE', true, 0, 20),
        ]);

        // Arrived so the gap region can render — proves gaps stay empty on UNKNOWN.
        const arrivedLogs = Array.from({ length: 20 }, () => ({
            understanding: makeScore(90, 'SCORED', []),
        }));

        const { getByTestId, queryByTestId } = render(
            <MeterDisplay score={score} allLogs={arrivedLogs} />,
        );

        expect(getByTestId('meter-display')).toBeTruthy();
        // rankMeterGaps returns [] for UNKNOWN → no gap questions rendered.
        expect(queryByTestId('shramsathi-gap-question')).toBeNull();
    });

    // -------------------------------------------------------------------------
    // 4. Flag ON + few rich logs → NOT arrived → arriving silhouette + ticks
    // -------------------------------------------------------------------------
    it('shows the arriving silhouette (not arrived) with 20 progress ticks below the threshold', async () => {
        const { MeterDisplay } = await loadComponent(true);

        // Rich log = score > 50. Build 5 rich + 2 non-rich → 5/20, not arrived.
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

        const { getByTestId, getAllByTestId } = render(<MeterDisplay allLogs={allLogs} />);

        // Not arrived → the face renders as the silhouette.
        expect(getByTestId('shramsathi-face')).toHaveAttribute('data-band', 'silhouette');
        // Arrival gate renders 20 progress ticks (5 filled of 20).
        expect(getAllByTestId('shramsathi-arriving-tick')).toHaveLength(20);
    });
});
