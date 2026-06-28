// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * MeterDisplay — unit tests (1d-infra flag-gate scaffold)
 *
 * Follows the vi.doMock + vi.resetModules + dynamic-import pattern used in
 * AppRouter.feature-gate.test.tsx (the established repo convention for toggling
 * FEATURE_FLAGS between test cases without leaking module state).
 *
 * spec: ai-intelligence-plan-2026-06-25
 */
import React from 'react';
import { render, cleanup } from '@testing-library/react';
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
    // 2. Flag ON + SCORED VlogScore → score shown + gaps non-empty
    // -------------------------------------------------------------------------
    it('shows score and gaps for a SCORED VlogScore when flag is ON', async () => {
        const { MeterDisplay } = await loadComponent(true);

        const score = makeScore(78, 'SCORED', [
            makeDim('DOSE', true, 0, 20),   // coverage 0 → gap surfaced
            makeDim('COST', true, 1, 12),   // fully covered → no gap
            makeDim('WHAT', true, 1, 20),   // fully covered → no gap
        ]);

        const { getByTestId } = render(<MeterDisplay score={score} allLogs={[]} />);

        const scoreEl = getByTestId('meter-score');
        expect(scoreEl.textContent).toContain('78/100');
        expect(scoreEl.textContent).toContain('SCORED');

        const gapsEl = getByTestId('meter-gaps');
        expect(gapsEl.children.length).toBeGreaterThan(0);
    });

    // -------------------------------------------------------------------------
    // 3. Flag ON + UNKNOWN VlogScore → meter-display shown, NO meter-gaps
    // -------------------------------------------------------------------------
    it('renders meter-display but no meter-gaps for an UNKNOWN VlogScore', async () => {
        const { MeterDisplay } = await loadComponent(true);

        const score = makeScore(null, 'UNKNOWN', [
            makeDim('DOSE', true, 0, 20),
        ]);

        const { getByTestId, queryByTestId } = render(
            <MeterDisplay score={score} allLogs={[]} />,
        );

        expect(getByTestId('meter-display')).toBeTruthy();
        expect(queryByTestId('meter-gaps')).toBeNull();
    });

    // -------------------------------------------------------------------------
    // 4. Flag ON + allLogs with several rich logs → arrival reflects rich count
    // -------------------------------------------------------------------------
    it('reflects the correct rich-log count in meter-arrival', async () => {
        const { MeterDisplay } = await loadComponent(true);

        // Rich log = score > 50. Build 5 rich + 2 non-rich.
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
        expect(arrivalEl.textContent).toContain('5/20');
    });
});
