/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * closureReceiptProjection — unit tests (WP-4 Track C display, Task 10)
 *
 * Proves the pure projection that a ClosureReceiptCard renders:
 *   - reuses deriveVisibleBucketsFromParseResult (flips it DEAD -> LIVE)
 *   - reuses buildWorkDoneProjection for the work-done rows
 *   - surfaces totals (from financialSummary), weather stamp, and the
 *     understanding VlogScore, all from a saved DailyLog.
 *
 * Logic only — no rendering here (the card is a dumb view over this shape).
 *
 * spec: ai-intelligence-plan-2026-06-25
 */

import { describe, it, expect } from 'vitest';
import { buildClosureReceipt } from '../closureReceiptProjection';
// Import the (previously DEAD) derivation directly so this test also documents
// that the projection consumes it — flipping it LIVE.
import { deriveVisibleBucketsFromParseResult } from '../bucketDerivation';
import type { DailyLog, VlogScore } from '../../../../domain/types/log.types';
import type { WeatherStamp } from '../../../../domain/types/weather.types';

// =============================================================================
// FIXTURES
// =============================================================================

const WEATHER: WeatherStamp = {
    id: 'ws-1',
    plotId: 'plot-1',
    timestampLocal: '2026-07-02T08:00:00',
    timestampProvider: '2026-07-02T08:00:00',
    provider: 'mock',
    tempC: 28,
    humidity: 60,
    windKph: 5,
    precipMm: 0,
    cloudCoverPct: 10,
    conditionText: 'Clear',
    iconCode: '01d',
    rainProbNext6h: 5,
};

const SCORE: VlogScore = {
    score: 72,
    outcome: 'SCORED',
    dimensions: [],
};

/** Minimal DailyLog with an irrigation + input + labour, weather + score. */
function makeLog(overrides: Partial<DailyLog> = {}): DailyLog {
    return {
        id: 'log-1',
        date: '2026-07-02',
        context: { selection: [] },
        dayOutcome: 'WORK_RECORDED',
        cropActivities: [
            { id: 'ca-1', title: 'Pruning', workTypes: ['Pruning'] },
        ],
        irrigation: [
            { id: 'ir-1', method: 'drip', source: 'borewell', durationHours: 4 },
        ],
        labour: [
            { id: 'lb-1', type: 'HIRED', count: 3, activity: 'Weeding', totalCost: 900 },
        ],
        inputs: [
            {
                id: 'in-1',
                method: 'Spray',
                mix: [{ id: 'mx-1', productName: 'Bavistin', dose: 2, unit: 'g/L' }],
            },
        ],
        machinery: [],
        activityExpenses: [],
        financialSummary: {
            totalLabourCost: 900,
            totalInputCost: 300,
            totalMachineryCost: 0,
            grandTotal: 1200,
        },
        weatherStamp: WEATHER,
        understanding: SCORE,
        ...overrides,
    };
}

// =============================================================================
// TESTS
// =============================================================================

describe('buildClosureReceipt', () => {
    it('returns buckets, workDone, totals, weather and score', () => {
        const log = makeLog();
        const receipt = buildClosureReceipt(log);

        expect(receipt.buckets).toEqual(
            expect.arrayContaining(['workDone', 'irrigation', 'inputs', 'labour']),
        );
        expect(receipt.workDone.length).toBeGreaterThan(0);
        expect(receipt.totals.grandTotal).toBe(1200);
        expect(receipt.weather).toBe(WEATHER);
        expect(receipt.score).toBe(SCORE);
    });

    it('derives buckets identically to deriveVisibleBucketsFromParseResult (now LIVE)', () => {
        const log = makeLog();
        const receipt = buildClosureReceipt(log);

        // The projection MUST reuse the (previously dead) shared derivation, so
        // the two must agree exactly — this is what flips it DEAD -> LIVE.
        const expected = deriveVisibleBucketsFromParseResult({
            summary: '',
            dayOutcome: log.dayOutcome,
            cropActivities: log.cropActivities,
            irrigation: log.irrigation,
            labour: log.labour,
            inputs: log.inputs,
            machinery: log.machinery,
            activityExpenses: log.activityExpenses ?? [],
            missingSegments: [],
        });
        expect(receipt.buckets).toEqual(expected);
    });

    it('computes totals from event costs when financialSummary is absent', () => {
        const log = makeLog({ financialSummary: undefined as never });
        const receipt = buildClosureReceipt(log);

        // labour 900 + input 0 (no cost field) + machinery 0 + expenses 0
        expect(receipt.totals.grandTotal).toBe(900);
        expect(receipt.totals.totalLabourCost).toBe(900);
    });

    it('handles an empty/quiet day without throwing (no buckets, zero totals)', () => {
        const log = makeLog({
            cropActivities: [],
            irrigation: [],
            labour: [],
            inputs: [],
            machinery: [],
            activityExpenses: [],
            disturbance: undefined,
            observations: [],
            plannedTasks: [],
            financialSummary: {
                totalLabourCost: 0,
                totalInputCost: 0,
                totalMachineryCost: 0,
                grandTotal: 0,
            },
            understanding: undefined,
            weatherStamp: undefined,
        });
        const receipt = buildClosureReceipt(log);

        expect(receipt.buckets).toEqual([]);
        expect(receipt.workDone).toEqual([]);
        expect(receipt.totals.grandTotal).toBe(0);
        expect(receipt.weather).toBeUndefined();
        expect(receipt.score).toBeUndefined();
    });
});
