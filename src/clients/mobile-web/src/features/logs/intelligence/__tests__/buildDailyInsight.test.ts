/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * buildDailyInsight — unit tests (Task 1B TDD plan, spec:
 * dfes-companion-2026-07-11).
 *
 * Each fixture is deliberately minimal so that AT MOST ONE candidate
 * insight is renderable — this makes assertions exact without needing to
 * replicate pickDailyInsight's internal date-hash rotation (already fully
 * covered by pickDailyInsight.test.ts).
 */

import { describe, it, expect } from 'vitest';
import { buildDailyInsight } from '../buildDailyInsight';
import type { DailyLog, SelectedCropContext } from '../../../../domain/types/log.types';

// =============================================================================
// FIXTURE HELPERS
// =============================================================================

const SINGLE_PLOT_SELECTION: SelectedCropContext = {
    farmId: 'farm-1',
    cropId: 'crop-1',
    cropName: 'Grapes',
    selectedPlotIds: ['plot-1'],
    selectedPlotNames: ['Plot 1'],
};

const MULTI_PLOT_SELECTION: SelectedCropContext = {
    farmId: 'farm-1',
    cropId: 'crop-1',
    cropName: 'Grapes',
    selectedPlotIds: ['plot-1', 'plot-2'],
    selectedPlotNames: ['Plot 1', 'Plot 2'],
};

/** Minimal valid DailyLog factory — every REQUIRED field defaulted. */
function makeLog(id: string, date: string, overrides: Partial<DailyLog> = {}): DailyLog {
    return {
        id,
        date,
        context: { selection: [SINGLE_PLOT_SELECTION] },
        dayOutcome: 'WORK_RECORDED',
        cropActivities: [],
        irrigation: [],
        labour: [],
        inputs: [],
        machinery: [],
        financialSummary: { totalLabourCost: 0, totalInputCost: 0, totalMachineryCost: 0, grandTotal: 0 },
        ...overrides,
    };
}

describe('buildDailyInsight', () => {
    // -- (a) a completed op yields a continuity insight line ----------------

    it('a completed op (no cost, no unit stated) yields the continuity insight, occurrence-count wording', () => {
        const savedLog = makeLog('log-1', '2026-07-13', {
            cropActivities: [{ id: 'a1', title: 'Pruning', quantity: 5, status: 'completed' }],
        });

        const result = buildDailyInsight([savedLog], savedLog, '2026-07-13');

        expect(result).not.toBeNull();
        expect(result?.key).toBe('continuity');
        // quantity=5, no `unit` stated on the activity -> no unitLabel passed,
        // so continuityInsight falls back to its own occurrence-count wording.
        expect(result?.line).toBe('आजपर्यंत ५ वेळा नोंद झाली.');
    });

    it('a completed op with a stated unit yields the continuity line carrying that real unit verbatim', () => {
        // Real persisted data holds English unit strings (see
        // services/__tests__/calibrationFixtures.ts) — buildDailyInsight
        // passes it through as unitLabel verbatim, never translating it.
        const savedLog = makeLog('log-1', '2026-07-13', {
            cropActivities: [{ id: 'a1', title: 'Pruning', quantity: 5, unit: 'rows', status: 'completed' }],
        });

        const result = buildDailyInsight([savedLog], savedLog, '2026-07-13');

        expect(result?.key).toBe('continuity');
        expect(result?.line).toBe('आजपर्यंत ५ rows पूर्ण.');
    });

    // -- (b) a gap_recorded-only op is NOT counted as done -------------------

    it('a gap_recorded-only op is NOT counted as done — no false continuity/days-since claim', () => {
        const savedLog = makeLog('log-1', '2026-07-13', {
            cropActivities: [{ id: 'a1', title: 'Pruning', quantity: 5, status: 'gap_recorded' }],
        });

        const result = buildDailyInsight([savedLog], savedLog, '2026-07-13');

        // Were the gap_recorded entry (wrongly) counted, continuity would
        // render true here. With no other data, the honest result is null.
        expect(result).toBeNull();
    });

    // -- (c) a fertilizer-only day still yields a cost insight ---------------

    it('a fertilizer-only day (grandTotal>0, no cropActivities/labour) still yields the cost insight', () => {
        const savedLog = makeLog('log-1', '2026-07-13', {
            cropActivities: [],
            financialSummary: { totalLabourCost: 0, totalInputCost: 5000, totalMachineryCost: 0, grandTotal: 5000 },
        });

        const result = buildDailyInsight([savedLog], savedLog, '2026-07-13');

        expect(result?.key).toBe('cost-to-date');
        expect(result?.line).toBe('आतापर्यंत तुम्ही सांगितलेला खर्च ₹५०००.');
    });

    // -- (d) same date => same pick (determinism) ----------------------------

    it('is deterministic — the same history/savedLog/date always returns the same pick', () => {
        const savedLog = makeLog('log-1', '2026-07-13', {
            cropActivities: [{ id: 'a1', title: 'Pruning', quantity: 5, status: 'completed' }],
            financialSummary: { totalLabourCost: 0, totalInputCost: 3000, totalMachineryCost: 0, grandTotal: 3000 },
        });
        const history = [savedLog];

        const first = buildDailyInsight(history, savedLog, '2026-07-13');
        const second = buildDailyInsight(history, savedLog, '2026-07-13');

        expect(first).not.toBeNull();
        expect(second).toEqual(first);
    });

    // -- (e) no savedLog / empty history => null -----------------------------

    it('no savedLog and empty history => null (nothing derivable)', () => {
        const result = buildDailyInsight([], undefined, '2026-07-13');
        expect(result).toBeNull();
    });

    // -- (f) an op with no derivable opType does not crash / skips continuity+days-since --

    it('no derivable opType on savedLog => continuity/days-since are never invoked (carry-note N2), even when history has a blank-titled activity that WOULD false-match an empty opType', () => {
        // A malformed historical activity with a blank title + a large stated
        // quantity — if buildDailyInsight ever called continuityInsight with
        // an empty-string opType (the exact bug carry-note N2 forbids), this
        // blank title would wrongly match and the fact would render true.
        const staleLog = makeLog('log-0', '2026-07-01', {
            cropActivities: [{ id: 'a0', title: '', quantity: 999, status: 'completed' }],
        });
        const savedLog = makeLog('log-1', '2026-07-13', {
            cropActivities: [], // no title => opType is not derivable
        });

        const result = buildDailyInsight([staleLog, savedLog], savedLog, '2026-07-13');

        expect(result).toBeNull();
    });

    // -- stage: honestly wired, always false today (no DailyLog field carries it) --

    it('stage insight never fires — no DailyLog field carries a farmer-confirmed stage today (honest, expected)', () => {
        const savedLog = makeLog('log-1', '2026-07-13', {
            cropActivities: [], // opType undefined, cost 0 (default) => every
        });                     // candidate (including stage) stays false.

        const result = buildDailyInsight([savedLog], savedLog, '2026-07-13');

        expect(result).toBeNull();
    });

    // -- rate-check: fires only when cleanly derivable + scope-confirmed -----
    //
    // savedLog's cropActivities entry is `gap_recorded` (not `completed`) so
    // that ONLY the opType is derived from it (derivePrimaryOpType reads the
    // title only, regardless of status) while continuity/days-since — which
    // DO gate on status — stay false, isolating rate-check as the sole
    // candidate these two tests are exercising.

    it('rate-check fires when the current op is scope-confirmed, >=2 same-op priors exist, and the rate is notably higher', () => {
        const priorA = makeLog('log-a', '2026-06-01', {
            labour: [{ id: 'l-a', type: 'CONTRACT', activity: 'Harvesting', rate: 900, rateBasis: 'per_acre' }],
        });
        const priorB = makeLog('log-b', '2026-06-05', {
            labour: [{ id: 'l-b', type: 'CONTRACT', activity: 'Harvesting', rate: 1000, rateBasis: 'per_acre' }],
        });
        const savedLog = makeLog('log-c', '2026-07-13', {
            cropActivities: [{ id: 'a1', title: 'Harvesting', status: 'gap_recorded' }],
            labour: [{ id: 'l-c', type: 'CONTRACT', activity: 'Harvesting', rate: 1300, rateBasis: 'per_acre' }],
        });

        const result = buildDailyInsight([priorA, priorB, savedLog], savedLog, '2026-07-13');

        expect(result?.key).toBe('rate-check');
        expect(result?.line).toBe('हे नेहमीपेक्षा जास्त वाटतंय — तपासा?');
    });

    it('rate-check is skipped when the current log does not resolve to a single, unambiguous plot', () => {
        const priorA = makeLog('log-a', '2026-06-01', {
            labour: [{ id: 'l-a', type: 'CONTRACT', activity: 'Harvesting', rate: 900, rateBasis: 'per_acre' }],
        });
        const priorB = makeLog('log-b', '2026-06-05', {
            labour: [{ id: 'l-b', type: 'CONTRACT', activity: 'Harvesting', rate: 1000, rateBasis: 'per_acre' }],
        });
        const savedLog = makeLog('log-c', '2026-07-13', {
            context: { selection: [MULTI_PLOT_SELECTION] }, // ambiguous multi-plot scope
            cropActivities: [{ id: 'a1', title: 'Harvesting', status: 'gap_recorded' }],
            labour: [{ id: 'l-c', type: 'CONTRACT', activity: 'Harvesting', rate: 1300, rateBasis: 'per_acre' }],
        });

        const result = buildDailyInsight([priorA, priorB, savedLog], savedLog, '2026-07-13');

        // scopeConfirmed=false => rateCheckInsight itself renders false; with
        // no other candidate data, the honest overall result is null.
        expect(result).toBeNull();
    });
});
