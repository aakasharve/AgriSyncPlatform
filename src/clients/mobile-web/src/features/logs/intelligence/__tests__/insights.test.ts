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

    // -- FIX 1 [CRITICAL]: never count not-done work as done --------------

    it('render=false when the only matching activity is gap_recorded (an explicit miss, not done work)', () => {
        const logs: FarmerLogEntry[] = [
            { date: '2026-06-01', cropActivities: [{ title: 'Pruning', quantity: 5, status: 'gap_recorded' }] },
        ];

        const result = continuityInsight(logs, 'Pruning');

        expect(result.render).toBe(false);
        expect(result.line).toBe('');
    });

    it('render=false when the only matching activity is pending (not yet done)', () => {
        const logs: FarmerLogEntry[] = [
            { date: '2026-06-01', cropActivities: [{ title: 'Pruning', quantity: 5, status: 'pending' }] },
        ];

        const result = continuityInsight(logs, 'Pruning');

        expect(result.render).toBe(false);
        expect(result.line).toBe('');
    });

    it('excludes a partial activity from the पूर्ण (fully-done) total — पूर्ण must not overclaim partial work', () => {
        const logs: FarmerLogEntry[] = [
            { date: '2026-06-01', cropActivities: [{ title: 'Pruning', quantity: 10, status: 'completed' }] },
            { date: '2026-06-02', cropActivities: [{ title: 'Pruning', quantity: 999, status: 'partial' }] },
        ];

        const result = continuityInsight(logs, 'Pruning', 'ओळी');

        expect(result.render).toBe(true);
        expect(result.line).toBe('आजपर्यंत १० ओळी पूर्ण.');
    });

    it('counts only the completed activity when mixed with a gap_recorded one', () => {
        const logs: FarmerLogEntry[] = [
            { date: '2026-06-01', cropActivities: [{ title: 'Pruning', quantity: 10, status: 'completed' }] },
            { date: '2026-06-02', cropActivities: [{ title: 'Pruning', quantity: 50, status: 'gap_recorded' }] },
        ];

        const result = continuityInsight(logs, 'Pruning', 'ओळी');

        expect(result.render).toBe(true);
        expect(result.line).toBe('आजपर्यंत १० ओळी पूर्ण.');
    });

    it('treats an undefined status (legacy log) as recorded-done, still counted', () => {
        const logs: FarmerLogEntry[] = [
            { date: '2026-06-01', cropActivities: [{ title: 'Pruning', quantity: 10 }] },
        ];

        const result = continuityInsight(logs, 'Pruning', 'ओळी');

        expect(result.render).toBe(true);
        expect(result.line).toBe('आजपर्यंत १० ओळी पूर्ण.');
    });

    // -- FIX 4 [IMPORTANT]: round fractional quantity sums -----------------

    it('rounds a fractional quantity sum before formatting (2.5 + 2.4 = 4.9 -> ५, not ४)', () => {
        const logs: FarmerLogEntry[] = [
            { date: '2026-06-01', cropActivities: [{ title: 'Spraying', quantity: 2.5, status: 'completed' }] },
            { date: '2026-06-02', cropActivities: [{ title: 'Spraying', quantity: 2.4, status: 'completed' }] },
        ];

        const result = continuityInsight(logs, 'Spraying');

        expect(result.render).toBe(true);
        expect(result.line).toBe('आजपर्यंत ५ वेळा नोंद झाली.');
    });
});

// =============================================================================
// costToDateInsight
// =============================================================================

describe('costToDateInsight', () => {
    it('sums grandTotal (fractional, rounds) across the season (render=true, exact line)', () => {
        const logs: FarmerCostLogEntry[] = [
            { financialSummary: { grandTotal: 1200 } },
            { financialSummary: { grandTotal: 2000.7 } },
        ];

        const result = costToDateInsight(logs);

        expect(result.render).toBe(true);
        expect(result.trustLabel).toBe('derived');
        expect(result.key).toBe('cost-to-date');
        // 1200 + 2000.7 = 3200.7 -> rounds to 3201
        expect(result.line).toBe('आतापर्यंत तुम्ही सांगितलेला खर्च ₹३२०१.');
    });

    it('render=false when no costs have been stated', () => {
        const logs: FarmerCostLogEntry[] = [
            { financialSummary: { grandTotal: 0 } },
        ];

        const result = costToDateInsight(logs);

        expect(result.render).toBe(false);
        expect(result.line).toBe('');
    });

    it('render=false on an empty log history', () => {
        const result = costToDateInsight([]);
        expect(result.render).toBe(false);
    });

    // -- FIX 2 [CRITICAL]: honest all-in total, not labour+machinery only --

    it('an input-only (fertilizer) day is NOT dropped — grandTotal is the honest all-in figure', () => {
        // Concrete bug this closes: a fertilizer-only day has
        // totalLabourCost=0, totalMachineryCost=0, but the farmer DID
        // state a ₹5000 input cost (grandTotal=5000). The old
        // labour+machinery-only sum computed 0 -> render:false, hiding a
        // cost the farmer explicitly told the app.
        const logs: FarmerCostLogEntry[] = [
            { financialSummary: { grandTotal: 5000 } },
        ];

        const result = costToDateInsight(logs);

        expect(result.render).toBe(true);
        expect(result.line).toBe('आतापर्यंत तुम्ही सांगितलेला खर्च ₹५०००.');
    });

    it('sums grandTotal across two days (5000 + 2000 = 7000)', () => {
        const logs: FarmerCostLogEntry[] = [
            { financialSummary: { grandTotal: 5000 } },
            { financialSummary: { grandTotal: 2000 } },
        ];

        const result = costToDateInsight(logs);

        expect(result.render).toBe(true);
        expect(result.line).toBe('आतापर्यंत तुम्ही सांगितलेला खर्च ₹७०००.');
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

    // -- FIX 1 [CRITICAL]: never anchor on not-done work --------------------

    it('render=false when the only matching prior op is gap_recorded (an explicit miss, not "did this")', () => {
        const logs: FarmerLogEntry[] = [
            { date: '2026-06-01', cropActivities: [{ title: 'Spraying', status: 'gap_recorded' }] },
        ];

        const result = daysSinceLastOpInsight(logs, 'Spraying', '2026-06-15');

        expect(result.render).toBe(false);
        expect(result.line).toBe('');
    });

    it('render=false when the only matching prior op is pending (not yet done)', () => {
        const logs: FarmerLogEntry[] = [
            { date: '2026-06-01', cropActivities: [{ title: 'Spraying', status: 'pending' }] },
        ];

        const result = daysSinceLastOpInsight(logs, 'Spraying', '2026-06-15');

        expect(result.render).toBe(false);
        expect(result.line).toBe('');
    });

    it('anchors on a partial occurrence — they did do it, at least partly', () => {
        const logs: FarmerLogEntry[] = [
            { date: '2026-06-01', cropActivities: [{ title: 'Spraying', status: 'partial' }] },
        ];

        const result = daysSinceLastOpInsight(logs, 'Spraying', '2026-06-15');

        expect(result.render).toBe(true);
        expect(result.line).toBe('शेवटच्या वेळेनंतर १४ दिवसांनी.');
    });

    it('skips a more-recent gap_recorded occurrence and anchors on the next-most-recent qualifying one', () => {
        const logs: FarmerLogEntry[] = [
            { date: '2026-06-01', cropActivities: [{ title: 'Spraying', status: 'completed' }] },
            { date: '2026-06-10', cropActivities: [{ title: 'Spraying', status: 'gap_recorded' }] },
        ];

        const result = daysSinceLastOpInsight(logs, 'Spraying', '2026-06-15');

        expect(result.render).toBe(true);
        expect(result.line).toBe('शेवटच्या वेळेनंतर १४ दिवसांनी.');
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
    it('renders the gentle question when scope is confirmed, >=2 SAME-OP comparable priors exist, and the rate is notably higher', () => {
        const current: RateCheckEntry = { rate: 1200, rateBasis: 'per_acre', scopeConfirmed: true, opType: 'Harvesting' };
        const priors: RateCheckEntry[] = [
            { rate: 900, rateBasis: 'per_acre', scopeConfirmed: true, opType: 'Harvesting' },
            { rate: 1000, rateBasis: 'per_acre', scopeConfirmed: true, opType: 'Harvesting' },
        ];

        const result = rateCheckInsight(current, priors);

        expect(result.render).toBe(true);
        expect(result.trustLabel).toBe('derived');
        expect(result.key).toBe('rate-check');
        expect(result.line).toBe('हे नेहमीपेक्षा जास्त वाटतंय — तपासा?');
    });

    it('render=false when scope is not confirmed', () => {
        const current: RateCheckEntry = { rate: 1200, rateBasis: 'per_acre', scopeConfirmed: false, opType: 'Harvesting' };
        const priors: RateCheckEntry[] = [
            { rate: 900, rateBasis: 'per_acre', scopeConfirmed: true, opType: 'Harvesting' },
            { rate: 1000, rateBasis: 'per_acre', scopeConfirmed: true, opType: 'Harvesting' },
        ];

        const result = rateCheckInsight(current, priors);

        expect(result.render).toBe(false);
        expect(result.line).toBe('');
    });

    it('render=false when fewer than 2 comparable priors exist', () => {
        const current: RateCheckEntry = { rate: 1200, rateBasis: 'per_acre', scopeConfirmed: true, opType: 'Harvesting' };
        const priors: RateCheckEntry[] = [
            { rate: 900, rateBasis: 'per_acre', scopeConfirmed: true, opType: 'Harvesting' },
        ];

        const result = rateCheckInsight(current, priors);

        expect(result.render).toBe(false);
    });

    it('render=false when the rate is not notably higher than the farmer\'s own recent average', () => {
        const current: RateCheckEntry = { rate: 950, rateBasis: 'per_acre', scopeConfirmed: true, opType: 'Harvesting' };
        const priors: RateCheckEntry[] = [
            { rate: 900, rateBasis: 'per_acre', scopeConfirmed: true, opType: 'Harvesting' },
            { rate: 1000, rateBasis: 'per_acre', scopeConfirmed: true, opType: 'Harvesting' },
        ];

        const result = rateCheckInsight(current, priors);

        expect(result.render).toBe(false);
    });

    it('render=false when priors use a different, non-comparable rate basis', () => {
        const current: RateCheckEntry = { rate: 1200, rateBasis: 'per_acre', scopeConfirmed: true, opType: 'Harvesting' };
        const priors: RateCheckEntry[] = [
            { rate: 900, rateBasis: 'per_vine', scopeConfirmed: true, opType: 'Harvesting' },
            { rate: 1000, rateBasis: 'per_vine', scopeConfirmed: true, opType: 'Harvesting' },
        ];

        const result = rateCheckInsight(current, priors);

        expect(result.render).toBe(false);
    });

    // -- FIX 3 [IMPORTANT]: comparable priors must be the SAME operation --

    it('render=false when priors share the rateBasis but are a DIFFERENT operation (harvesting vs pruning)', () => {
        const current: RateCheckEntry = { rate: 1200, rateBasis: 'per_acre', scopeConfirmed: true, opType: 'Harvesting' };
        const priors: RateCheckEntry[] = [
            { rate: 900, rateBasis: 'per_acre', scopeConfirmed: true, opType: 'Pruning' },
            { rate: 1000, rateBasis: 'per_acre', scopeConfirmed: true, opType: 'Pruning' },
        ];

        const result = rateCheckInsight(current, priors);

        expect(result.render).toBe(false);
        expect(result.line).toBe('');
    });

    it('renders when >=2 priors are the SAME operation and rateBasis, above threshold (case-insensitive op match)', () => {
        const current: RateCheckEntry = { rate: 1200, rateBasis: 'per_acre', scopeConfirmed: true, opType: 'Harvesting' };
        const priors: RateCheckEntry[] = [
            { rate: 900, rateBasis: 'per_acre', scopeConfirmed: true, opType: 'Harvesting' },
            { rate: 1000, rateBasis: 'per_acre', scopeConfirmed: true, opType: 'harvesting' },
        ];

        const result = rateCheckInsight(current, priors);

        expect(result.render).toBe(true);
        expect(result.line).toBe('हे नेहमीपेक्षा जास्त वाटतंय — तपासा?');
    });
});
