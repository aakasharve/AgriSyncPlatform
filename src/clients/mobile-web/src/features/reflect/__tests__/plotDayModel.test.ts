/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I6)
 *
 * प्लॉटनिहाय काम — one card per plot for the chosen day, built from the real log. The card carries every
 * fact the old CompactCropCard carried (8 buckets, stopped day, note, water state, day of the season,
 * weather, money, trust status). What it must never do: turn "not recorded" into a number (P4).
 */
import { describe, expect, it } from 'vitest';
import { buildPlotDayCard } from '../overview/plotDayModel';
import { plotRefsInScope, selectAll, toViewScope } from '../overview/reflectSelection';
import { CROPS, TODAY, TODAY_KEY, log, money } from './reflectFixtures';

const scope = toViewScope(CROPS, selectAll(CROPS));
const [g1, g2] = plotRefsInScope(CROPS, scope);

describe('buildPlotDayCard', () => {
    it('no record for the day: no counts, no money — the card says so instead of showing zeros', () => {
        const card = buildPlotDayCard(g1, [], scope, TODAY_KEY, TODAY);
        expect(card.log).toBeUndefined();
        expect(card.status).toBe('empty');
        expect(card.counts).toBeNull();
        expect(card.money).toBeUndefined();
    });

    it('counts the eight buckets from the log', () => {
        const day = log({
            id: 'l1',
            plotIds: ['g1'],
            cropActivities: [{ id: 'a', title: 'छाटणी' }],
            irrigation: [{ id: 'i', method: 'drip', source: 'Well', durationHours: 2 }],
            labour: [{ id: 'lb', type: 'HIRED', count: 6 }],
            inputs: [{ id: 'in' } as never, { id: 'in2' } as never],
            machinery: [{ id: 'm', type: 'tractor', ownership: 'owned' }],
            activityExpenses: [{ id: 'e', reason: 'diesel', items: [] }],
            observations: [
                { id: 'o1', plotId: 'g1', dateKey: TODAY_KEY, timestamp: '', textRaw: 'पानं पिवळी', noteType: 'observation', severity: 'normal', source: 'voice' },
                { id: 'o2', plotId: 'g1', dateKey: TODAY_KEY, timestamp: '', textRaw: 'उद्या फवारणी', noteType: 'reminder', severity: 'normal', source: 'voice' },
            ],
            financialSummary: money(1800, 650),
        });
        const card = buildPlotDayCard(g1, [day], scope, TODAY_KEY, TODAY);
        expect(card.status).toBe('worked');
        expect(card.counts).toEqual({ work: 1, water: 1, labour: 6, inputs: 2, machine: 1, cost: 1, notes: 2, reminders: 1 });
        expect(card.money).toBe(2450);
        expect(card.note).toBe('पानं पिवळी');
    });

    it('labour told without a headcount is UNKNOWN, never 0', () => {
        const day = log({ id: 'l2', plotIds: ['g1'], labour: [{ id: 'lb', type: 'HIRED' }] });
        const card = buildPlotDayCard(g1, [day], scope, TODAY_KEY, TODAY);
        expect(card.counts?.labour).toBeUndefined();
        expect(card.status).toBe('worked');
    });

    it('a whole-day stop shows the reason instead of the buckets', () => {
        const day = log({ id: 'l3', plotIds: ['g1'], disturbance: { scope: 'FULL_DAY', group: 'WEATHER', reason: 'पाऊस', blockedSegments: ['irrigation'] } });
        const card = buildPlotDayCard(g1, [day], scope, TODAY_KEY, TODAY);
        expect(card.status).toBe('blocked');
        expect(card.stoppedReason).toBe('पाऊस');
    });

    it('a record with no cost carries no money pill', () => {
        const day = log({ id: 'l4', plotIds: ['g1'], cropActivities: [{ id: 'a', title: 'खुरपणी' }] });
        expect(buildPlotDayCard(g1, [day], scope, TODAY_KEY, TODAY).money).toBeUndefined();
    });

    it('day of the season comes from the plot start date, in Marathi', () => {
        expect(buildPlotDayCard(g1, [], scope, TODAY_KEY, TODAY).dayLabel).toBe('दिवस 25');
        // no start date and no prep date: the season day is not known — say "जमीन तयारी", invent no day number
        expect(buildPlotDayCard(g2, [], scope, TODAY_KEY, TODAY).dayLabel).toBe('जमीन तयारी');
    });

    it('the plot\'s area when the plot records one, in its own unit; nothing when it does not', () => {
        const withArea = { ...g1, plot: { ...g1.plot!, baseline: { totalArea: 2.5, unit: 'Acre' as const } } };
        expect(buildPlotDayCard(withArea, [], scope, TODAY_KEY, TODAY).area).toBe('2.5 एकर');
        const guntha = { ...g1, plot: { ...g1.plot!, baseline: { totalArea: 20, unit: 'Guntha' as const } } };
        expect(buildPlotDayCard(guntha, [], scope, TODAY_KEY, TODAY).area).toBe('20 गुंठे');
        expect(buildPlotDayCard(g2, [], scope, TODAY_KEY, TODAY).area).toBeUndefined();
    });

    it('reads only the chosen plot and the chosen day', () => {
        const other = log({ id: 'other', plotIds: ['g2'], cropActivities: [{ id: 'a', title: 'x' }] });
        const yesterday = log({ id: 'y', date: '2026-10-24', plotIds: ['g1'], cropActivities: [{ id: 'a', title: 'x' }] });
        expect(buildPlotDayCard(g1, [other, yesterday], scope, TODAY_KEY, TODAY).log).toBeUndefined();
    });
});
