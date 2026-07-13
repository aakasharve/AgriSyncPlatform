/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * insights — unit tests for the five pure intelligence-insight fns
 * (Task 1A TDD plan).
 *
 * Each insight gets: a render=true happy path (exact Marathi/Devanagari
 * line asserted) AND at least one render=false path (insufficient data
 * or unconfirmed scope).
 *
 * spec: dfes-companion-2026-07-11
 */

import { describe, it, expect } from 'vitest';
import {
    continuityInsight,
    costToDateInsight,
    daysSinceLastOpInsight,
    stageInsight,
    rateCheckInsight,
} from '../insights';
import type { FarmerLogEntry, FarmerCostLogEntry, RateCheckEntry } from '../insightTypes';

// =============================================================================
// continuityInsight
// =============================================================================

describe('continuityInsight', () => {
    it('sums stated quantities across matching activities (render=true, exact line)', () => {
        const logs: FarmerLogEntry[] = [
            { date: '2026-06-01', cropActivities: [{ title: 'Pruning', quantity: 10 }] },
            { date: '2026-06-05', cropActivities: [{ title: 'Pruning', quantity: 15 }] },
            { date: '2026-06-06', cropActivities: [{ title: 'Weeding', quantity: 99 }] },
        ];

        const result = continuityInsight(logs, 'Pruning', 'ओळी');

        expect(result.render).toBe(true);
        expect(result.trustLabel).toBe('derived');
        expect(result.key).toBe('continuity');
        expect(result.line).toBe('आजपर्यंत २५ ओळी पूर्ण.');
    });

    it('falls back to an occurrence count when no matching activity states a quantity', () => {
        const logs: FarmerLogEntry[] = [
            { date: '2026-06-01', cropActivities: [{ title: 'Weeding' }] },
            { date: '2026-06-02', cropActivities: [{ title: 'weeding' }] }, // case-insensitive match
            { date: '2026-06-03', cropActivities: [{ title: 'weeding' }] },
        ];

        const result = continuityInsight(logs, 'Weeding');

        expect(result.render).toBe(true);
        expect(result.line).toBe('आजपर्यंत ३ वेळा नोंद झाली.');
    });

    it('render=false when the op has never been logged', () => {
        const logs: FarmerLogEntry[] = [
            { date: '2026-06-01', cropActivities: [{ title: 'Weeding', quantity: 4 }] },
        ];

        const result = continuityInsight(logs, 'Harvesting');

        expect(result.render).toBe(false);
        expect(result.line).toBe('');
    });

    it('render=false on an empty log history', () => {
        const result = continuityInsight([], 'Pruning');
        expect(result.render).toBe(false);
    });
});

// =============================================================================
// costToDateInsight
// =============================================================================

describe('costToDateInsight', () => {
    it('sums labour + machinery (which already folds in fuel) across the season (render=true, exact line)', () => {
        const logs: FarmerCostLogEntry[] = [
            { financialSummary: { totalLabourCost: 1200, totalMachineryCost: 800.7 } },
            { financialSummary: { totalLabourCost: 900, totalMachineryCost: 300 } },
        ];

        const result = costToDateInsight(logs);

        expect(result.render).toBe(true);
        expect(result.trustLabel).toBe('derived');
        expect(result.key).toBe('cost-to-date');
        // 1200 + 800.7 + 900 + 300 = 3200.7 -> rounds to 3201
        expect(result.line).toBe('आतापर्यंत तुम्ही सांगितलेला खर्च ₹३२०१.');
    });

    it('render=false when no costs have been stated', () => {
        const logs: FarmerCostLogEntry[] = [
            { financialSummary: { totalLabourCost: 0, totalMachineryCost: 0 } },
        ];

        const result = costToDateInsight(logs);

        expect(result.render).toBe(false);
        expect(result.line).toBe('');
    });

    it('render=false on an empty log history', () => {
        const result = costToDateInsight([]);
        expect(result.render).toBe(false);
    });
});

// =============================================================================
// daysSinceLastOpInsight
// =============================================================================

describe('daysSinceLastOpInsight', () => {
    it('counts whole days since the last matching op strictly before the reference date (render=true, exact line)', () => {
        const logs: FarmerLogEntry[] = [
            { date: '2026-06-01', cropActivities: [{ title: 'Spraying' }] },
            { date: '2026-06-10', cropActivities: [{ title: 'Weeding' }] },
        ];

        const result = daysSinceLastOpInsight(logs, 'Spraying', '2026-06-15');

        expect(result.render).toBe(true);
        expect(result.trustLabel).toBe('derived');
        expect(result.key).toBe('days-since-last-op');
        expect(result.line).toBe('शेवटच्या वेळेनंतर १४ दिवसांनी.');
    });

    it('render=false when the op has no prior occurrence', () => {
        const logs: FarmerLogEntry[] = [
            { date: '2026-06-01', cropActivities: [{ title: 'Weeding' }] },
        ];

        const result = daysSinceLastOpInsight(logs, 'Spraying', '2026-06-15');

        expect(result.render).toBe(false);
        expect(result.line).toBe('');
    });

    it('render=false when the only occurrence is on the reference date itself (not "prior")', () => {
        const logs: FarmerLogEntry[] = [
            { date: '2026-06-15', cropActivities: [{ title: 'Spraying' }] },
        ];

        const result = daysSinceLastOpInsight(logs, 'Spraying', '2026-06-15');

        expect(result.render).toBe(false);
    });
});

// =============================================================================
// stageInsight
// =============================================================================

describe('stageInsight', () => {
    it('renders the confirmed stage chip verbatim (render=true, exact line)', () => {
        const result = stageInsight({ confirmedStage: 'फुलोरा' });

        expect(result.render).toBe(true);
        expect(result.trustLabel).toBe('confirmed');
        expect(result.key).toBe('stage');
        expect(result.line).toBe('सध्याचा टप्पा — फुलोरा.');
    });

    it('render=false when no stage has been confirmed', () => {
        const result = stageInsight({});

        expect(result.render).toBe(false);
        expect(result.line).toBe('');
    });

    it('render=false when confirmedStage is blank/whitespace-only', () => {
        const result = stageInsight({ confirmedStage: '   ' });
        expect(result.render).toBe(false);
    });
});

// =============================================================================
// rateCheckInsight
// =============================================================================

describe('rateCheckInsight', () => {
    it('renders the gentle question when scope is confirmed, >=2 comparable priors exist, and the rate is notably higher', () => {
        const current: RateCheckEntry = { rate: 1200, rateBasis: 'per_acre', scopeConfirmed: true };
        const priors: RateCheckEntry[] = [
            { rate: 900, rateBasis: 'per_acre', scopeConfirmed: true },
            { rate: 1000, rateBasis: 'per_acre', scopeConfirmed: true },
        ];

        const result = rateCheckInsight(current, priors);

        expect(result.render).toBe(true);
        expect(result.trustLabel).toBe('derived');
        expect(result.key).toBe('rate-check');
        expect(result.line).toBe('हे नेहमीपेक्षा जास्त वाटतंय — तपासा?');
    });

    it('render=false when scope is not confirmed', () => {
        const current: RateCheckEntry = { rate: 1200, rateBasis: 'per_acre', scopeConfirmed: false };
        const priors: RateCheckEntry[] = [
            { rate: 900, rateBasis: 'per_acre', scopeConfirmed: true },
            { rate: 1000, rateBasis: 'per_acre', scopeConfirmed: true },
        ];

        const result = rateCheckInsight(current, priors);

        expect(result.render).toBe(false);
        expect(result.line).toBe('');
    });

    it('render=false when fewer than 2 comparable priors exist', () => {
        const current: RateCheckEntry = { rate: 1200, rateBasis: 'per_acre', scopeConfirmed: true };
        const priors: RateCheckEntry[] = [
            { rate: 900, rateBasis: 'per_acre', scopeConfirmed: true },
        ];

        const result = rateCheckInsight(current, priors);

        expect(result.render).toBe(false);
    });

    it('render=false when the rate is not notably higher than the farmer\'s own recent average', () => {
        const current: RateCheckEntry = { rate: 950, rateBasis: 'per_acre', scopeConfirmed: true };
        const priors: RateCheckEntry[] = [
            { rate: 900, rateBasis: 'per_acre', scopeConfirmed: true },
            { rate: 1000, rateBasis: 'per_acre', scopeConfirmed: true },
        ];

        const result = rateCheckInsight(current, priors);

        expect(result.render).toBe(false);
    });

    it('render=false when priors use a different, non-comparable rate basis', () => {
        const current: RateCheckEntry = { rate: 1200, rateBasis: 'per_acre', scopeConfirmed: true };
        const priors: RateCheckEntry[] = [
            { rate: 900, rateBasis: 'per_vine', scopeConfirmed: true },
            { rate: 1000, rateBasis: 'per_vine', scopeConfirmed: true },
        ];

        const result = rateCheckInsight(current, priors);

        expect(result.render).toBe(false);
    });
});
