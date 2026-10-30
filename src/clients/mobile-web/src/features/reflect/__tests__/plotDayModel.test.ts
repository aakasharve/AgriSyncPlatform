/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I6; lane RF2 — the founder's screen 1)
 *
 * प्लॉटनिहाय काम — one card per plot for the chosen day, built from the real log. Lane RF2: the eight numbered squares
 * are gone; the card shows ONLY what happened, as chips in the result screen's parts, values as said, never a number
 * summed across recordings (P4), never the record's own money (the server ledger's figure is passed in). It keeps the
 * status (confirmed only when every recording is), how many times the day was told, the plot's identity and the
 * same non-deleted set of logs the day view shows (review B006).
 */
import { describe, expect, it } from 'vitest';
import { LogVerificationStatus, type DailyLog } from '../../../types';
import type { MoneyFigure } from '../overview/moneyModel';
import { buildDayCardCore, buildPlotDayCard, dayChipsOf, placeDayLogs } from '../overview/plotDayModel';
import { farmLogFilter } from '../day/dayRecordings';
import { plotRefsInScope, selectAll, toViewScope } from '../overview/reflectSelection';
import { CROPS, TODAY, TODAY_KEY, farmLog, log, money } from './reflectFixtures';

const scope = toViewScope(CROPS, selectAll(CROPS));
const [g1, g2] = plotRefsInScope(CROPS, scope);
const meta = (hhmm: string, who = 'op') => ({ createdAtISO: `2026-10-25T${hhmm}:00.000Z`, createdByOperatorId: who });
const kinds = (chips: { kind: string }[]) => chips.map(c => c.kind);
const textsOf = (chips: { kind: string; text: string }[], kind: string) => chips.filter(c => c.kind === kind).map(c => c.text);

describe('buildPlotDayCard — only what happened, as chips', () => {
    it('no record for the day: no chips, no money, no status — the card says so instead of showing zeros', () => {
        const card = buildPlotDayCard(g1, [], scope, TODAY_KEY, TODAY);
        expect(card.log).toBeUndefined();
        expect(card.status).toBe('empty');
        expect(card.chips).toEqual([]);
        expect(card.recordings).toBe(0);
        expect(card.money).toBeUndefined();
        expect(card.confirmed).toBeUndefined();
    });

    it('one recording: a chip per part it told, in the result screen order, values as said; no part it did not tell', () => {
        const day = log({
            id: 'l1', meta: meta('03:00'),
            cropActivities: [{ id: 'a', title: 'छाटणी' }],
            irrigation: [{ id: 'i', method: 'drip', source: 'Well', durationHours: 2 }],
            labour: [{ id: 'lb', type: 'HIRED', count: 6 }],
            machinery: [{ id: 'm', type: 'tractor', ownership: 'owned', hoursUsed: 3 }],
            observations: [
                { id: 'o1', plotId: 'g1', dateKey: TODAY_KEY, timestamp: '', textRaw: 'पानं पिवळी', noteType: 'observation', severity: 'normal', source: 'voice' },
            ],
            financialSummary: money(1800),
        } as Partial<DailyLog> & { id: string });
        const card = buildPlotDayCard(g1, [day], scope, TODAY_KEY, TODAY);
        expect(card.status).toBe('worked');
        expect(kinds(card.chips)).toEqual(['crop', 'labour', 'irrigation', 'machinery', 'observation']);
        expect(textsOf(card.chips, 'crop')).toEqual(['छाटणी']);
        expect(textsOf(card.chips, 'labour')).toEqual(['6 जण']);
        expect(textsOf(card.chips, 'irrigation')).toEqual(['2 तास']);
        expect(textsOf(card.chips, 'machinery')).toEqual(['ट्रॅक्टर · 3 तास']);
        // the farmer's note is an "निरीक्षण" chip, not an amber box
        expect(textsOf(card.chips, 'observation')).toEqual(['पानं पिवळी']);
        // the record's own money (₹1800) is never a chip: the ledger's figure is, and none was passed
        expect(card.chips.some(c => c.kind === 'expense')).toBe(false);
        expect(card.money).toBeUndefined();
    });

    it('P4 — labour told in two recordings is TWO chips, each as said; never one summed number (never 3 + 2)', () => {
        const morning = log({ id: 'm', meta: meta('03:00'), labour: [{ id: 'l1', type: 'HIRED', femaleCount: 5, maleCount: 2 }] });
        const evening = log({ id: 'e', meta: meta('11:00', 'op2'), labour: [{ id: 'l2', type: 'HIRED', count: 10 }] });
        const card = buildPlotDayCard(g1, [evening, morning], scope, TODAY_KEY, TODAY);
        const labour = card.chips.filter(c => c.kind === 'labour');
        expect(labour).toHaveLength(2);
        expect(labour.map(c => c.text)).toEqual([expect.stringContaining('5'), '10 जण']);
        expect(JSON.stringify(card.chips)).not.toContain('17');
        expect(new Set(labour.map(c => c.recordingKey)).size).toBe(2);
        expect(card.recordings).toBe(2);
        expect(card.log?.id).toBe('m'); // morning first
    });

    it('crop work is names, not amounts: the day\'s work names share ONE chip, each name once', () => {
        const a = log({ id: 'a', meta: meta('03:00'), cropActivities: [{ id: 'x', title: 'छाटणी' }] });
        const b = log({ id: 'b', meta: meta('08:00'), cropActivities: [{ id: 'y', title: 'फवारणी' }, { id: 'z', title: 'छाटणी' }] });
        const card = buildPlotDayCard(g1, [a, b], scope, TODAY_KEY, TODAY);
        expect(textsOf(card.chips, 'crop')).toEqual(['छाटणी · फवारणी']);
    });

    it('an item the server could not verify keeps its mark; it is never folded into a verified chip', () => {
        const day = log({ id: 'u', meta: meta('03:00'), labour: [{ id: 'l1', type: 'HIRED', count: 4 }, { id: 'l2', type: 'HIRED', count: 2, provenanceVerified: false }] });
        const labour = buildPlotDayCard(g1, [day], scope, TODAY_KEY, TODAY).chips.filter(c => c.kind === 'labour');
        expect(labour.map(c => [c.text, c.verified])).toEqual([['4 जण', true], ['2 जण', false]]);
    });

    it('a stoppage is a chip of its own; a whole-day stop marks the card stopped', () => {
        const day = log({ id: 'l3', meta: meta('03:00'), disturbance: { scope: 'FULL_DAY', group: 'WEATHER', reason: 'पाऊस', blockedSegments: ['irrigation'] } });
        const card = buildPlotDayCard(g1, [day], scope, TODAY_KEY, TODAY);
        expect(card.status).toBe('blocked');
        expect(card.stoppedReason).toBe('पाऊस');
        expect(card.chips).toEqual([expect.objectContaining({ kind: 'blocker', text: 'पाऊस' })]);
    });

    it("lane RF: the money is the ledger's figure for that plot-day; none, or one he may not see, shows nothing", () => {
        const day = log({ id: 'l5', financialSummary: money(9999), cropActivities: [{ id: 'a', title: 'खुरपणी' }] });
        const ledger: MoneyFigure = { amount: 1750, hidden: false, partial: ['notOnServer'] };
        expect(buildPlotDayCard(g1, [day], scope, TODAY_KEY, TODAY, ledger).money).toEqual(ledger);
        expect(buildPlotDayCard(g1, [day], scope, TODAY_KEY, TODAY, { amount: null, hidden: false, partial: [] }).money).toBeUndefined();
        // hidden money stays hidden: no figure reaches the card at all
        expect(buildPlotDayCard(g1, [day], scope, TODAY_KEY, TODAY, { amount: null, hidden: true, partial: [] }).money).toBeUndefined();
        expect(JSON.stringify(buildPlotDayCard(g1, [day], scope, TODAY_KEY, TODAY, { amount: null, hidden: true, partial: [] }).chips)).not.toContain('9999');
    });

    it('lane RF: confirmed only when every recording of the plot-day is', () => {
        const verified = { required: true, status: LogVerificationStatus.VERIFIED };
        const a = log({ id: 'a', meta: meta('03:00'), verification: verified });
        const b = log({ id: 'b', meta: meta('08:00') });
        expect(buildPlotDayCard(g1, [a, b], scope, TODAY_KEY, TODAY)).toMatchObject({ confirmed: false, recordings: 2 });
        expect(buildPlotDayCard(g1, [a, { ...b, verification: verified }], scope, TODAY_KEY, TODAY).confirmed).toBe(true);
    });

    it("review B006: a deleted record is never the card's — nothing told, no chips, no status", () => {
        const gone = log({ id: 'gone', meta: meta('03:00'), cropActivities: [{ id: 'a', title: 'छाटणी' }], deletion: { deletedAtISO: '2026-10-25T04:00:00.000Z' } as DailyLog['deletion'] });
        expect(buildPlotDayCard(g1, [gone], scope, TODAY_KEY, TODAY)).toMatchObject({ status: 'empty', chips: [], recordings: 0 });
    });

    it('day of the season and the area, as before', () => {
        expect(buildPlotDayCard(g1, [], scope, TODAY_KEY, TODAY).dayLabel).toBe('दिवस 25');
        expect(buildPlotDayCard(g2, [], scope, TODAY_KEY, TODAY).dayLabel).toBe('जमीन तयारी');
        const withArea = { ...g1, plot: { ...g1.plot!, baseline: { totalArea: 2.5, unit: 'Acre' as const } } };
        expect(buildPlotDayCard(withArea, [], scope, TODAY_KEY, TODAY).area).toBe('2.5 एकर');
    });

    it('reads only the chosen plot and the chosen day', () => {
        const other = log({ id: 'other', plotIds: ['g2'], cropActivities: [{ id: 'a', title: 'x' }] });
        const yesterday = log({ id: 'y', date: '2026-10-24', plotIds: ['g1'], cropActivities: [{ id: 'a', title: 'x' }] });
        expect(buildPlotDayCard(g1, [other, yesterday], scope, TODAY_KEY, TODAY).chips).toEqual([]);
    });
});

describe('the "संपूर्ण शेत" card (lane RF2) — whole-farm work has a home', () => {
    it('takes the day\'s whole-farm logs, never a plot\'s', () => {
        const farm = farmLog({ id: 'f', meta: meta('04:00'), activityExpenses: [{ id: 'e', reason: 'डिझेल', totalAmount: 800, items: [] }], labour: [{ id: 'l', type: 'HIRED', count: 3 }] } as never);
        const plotDay = log({ id: 'p', meta: meta('05:00'), labour: [{ id: 'l2', type: 'HIRED', count: 9 }] });
        const logs = placeDayLogs([farm, plotDay], TODAY_KEY, farmLogFilter(new Set()));
        expect(logs.map(l => l.id)).toEqual(['f']);
        const card = buildDayCardCore(logs);
        expect(textsOf(card.chips, 'labour')).toEqual(['3 जण']);
        expect(card.chips.some(c => c.kind === 'expense')).toBe(false); // money: the ledger's only
        expect(card.recordings).toBe(1);
    });

    it('a crop that has no plot keeps its own logs on its own card', () => {
        const cropLevel = log({ id: 'c', cropId: 'flowers', plotIds: [] });
        expect(placeDayLogs([cropLevel], TODAY_KEY, farmLogFilter(new Set(['flowers'])))).toEqual([]);
        expect(placeDayLogs([cropLevel], TODAY_KEY, farmLogFilter(new Set()))).toHaveLength(1);
    });
});

describe('dayChipsOf — a spray keeps its amount as said, the result screen\'s way', () => {
    it('Marathi: the product with its dose, "इथरेल · 300 मिली"', () => {
        const day = log({ id: 's', meta: meta('03:00'), inputs: [{ id: 'in', method: 'Spray', productName: 'इथरेल', quantity: 300, unit: 'ml' } as never] });
        const [chip] = dayChipsOf([day], 'mr').filter(c => c.kind === 'inputs');
        expect(chip.text).toBe('इथरेल · 300 मिली');
    });

    it('English: a product label in English letters with the English unit, "Ethrel · 300 ml" (review B009)', () => {
        const day = log({ id: 's', meta: meta('03:00'), inputs: [{ id: 'in', method: 'Spray', productName: 'Ethrel', quantity: 300, unit: 'ml' } as never] });
        const [chip] = dayChipsOf([day], 'en').filter(c => c.kind === 'inputs');
        expect(chip.text).toBe('Ethrel · 300 ml');
    });
});

describe('dayChipsOf — fix pass (review B007, founder live test D1 / D2)', () => {
    it('B007: within one recording a value said twice shows twice ("5 जण · 5 जण"), never merged into one', () => {
        const day = log({ id: 'd', meta: meta('03:00'), labour: [{ id: 'a', type: 'HIRED', count: 5 }, { id: 'b', type: 'CONTRACT', count: 5 }] });
        const labour = dayChipsOf([day], 'mr').filter(c => c.kind === 'labour');
        expect(labour.map(c => c.text)).toEqual(['5 जण · 5 जण']);
    });

    it('D1: an older record kept only as task lines gives its part a LABEL chip, never the free text of its task line', () => {
        const old = log({ id: 'o', meta: meta('03:00'), legacyPartial: true, cropActivities: [{ id: 'c', title: 'टोरस + मँकोझेब स्प्रे केले. थ्रिप्स दिसत होते.' }] } as never);
        const chips = dayChipsOf([old], 'mr');
        expect(chips).toEqual([expect.objectContaining({ kind: 'crop', text: '' })]);
        expect(JSON.stringify(chips)).not.toContain('थ्रिप्स');
    });

    it('D2: a label-only chip shows ONCE per card however many recordings told that part; values still never merge across recordings', () => {
        const a = log({ id: 'a', meta: meta('03:00'), legacyPartial: true, irrigation: [{ id: 'w', notes: 'Method: Drip' }] } as never);
        const b = log({ id: 'b', meta: meta('05:00', 'op2'), legacyPartial: true, irrigation: [{ id: 'w2', notes: 'Method: Drip' }] } as never);
        const c = log({ id: 'c', meta: meta('07:00'), labour: [{ id: 'l1', type: 'HIRED', count: 4 }] });
        const d = log({ id: 'e', meta: meta('09:00', 'op3'), labour: [{ id: 'l2', type: 'HIRED', count: 4 }] });
        const chips = dayChipsOf([a, b, c, d], 'mr');
        expect(chips.filter(x => x.kind === 'irrigation')).toEqual([expect.objectContaining({ text: '' })]);
        expect(chips.filter(x => x.kind === 'labour').map(x => x.text)).toEqual(['4 जण', '4 जण']);
    });
});
