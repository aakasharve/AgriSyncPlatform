// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane ATT-W Task 3; founder L8-C1 note "with proof and the reason") —
 * the "का दिसतंय" line of a लक्ष द्या step, and "पुढे ठरवा" on a step a followed schedule asks:
 *   - the line, for each case: one schedule with a last record; none ("अजून नोंद नाही", never "० दिवस"); two schedules; no repeat stored;
 *   - no part of the line is drawn from a missing field; an older server (no why-fields) draws no line and never throws;
 *   - the why-fields are read WHOLE OR NOT AT ALL (Zod); a null "last record" (the server said none) is kept apart from an absent one;
 *   - a step with a subscription goes to the schedule-step route, every other step to today's override route; online only, as before.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock('../../../infrastructure/api/apiFetch', () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

import { scheduleWhyLineMr, repeatLineMr, daysAgoMr } from '../scheduleWhy';
import { clearRescheduledForTests, scheduledWorkItemOf, stepLabelMr, whyOf, type ScheduledWorkItem } from '../scheduledWork';
import { buildAttentionModel } from '../attentionItems';
import { StepRow } from '../components/AttentionItemRow';
import { rescheduleStep } from '../data/rescheduleStep';

const TODAY = '2026-11-13';

const wire = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    plannedActivityId: 'step-1', farmId: 'f1', plotId: 'p1', plotName: 'प्लॉट २', cropCycleId: 'cc1', activityName: 'फवारणी', stage: 'फुलोरा',
    plannedDate: '2026-11-13', daysLate: 0, isMissed: false, ...extra,
});

const why = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    subscriptionId: 'sub-1', scheduleName: 'विद्यापीठ शेड्यूल', alsoAskedBy: null, lastSameWorkDate: '2026-11-07', repeatText: 'every_n_days:5',
    reasonKey: 'DueToday', activityId: 'act-1', originalDate: '2026-11-13', scheduleDay: 34, ...extra,
});

const stepOf = (extra: Record<string, unknown> = {}): ScheduledWorkItem => {
    const item = scheduledWorkItemOf(wire(why(extra)));
    expect(item).not.toBeNull();
    return item!;
};

beforeEach(() => { apiFetch.mockReset(); clearRescheduledForTests(); });
afterEach(() => { cleanup(); });

describe('the "का दिसतंय" line, one case at a time', () => {
    it('one schedule, a last record: schedule, its day, how often, and when it was last done', () => {
        const line = scheduleWhyLineMr(stepOf(), TODAY);

        expect(line).toBe('विद्यापीठ शेड्यूल नुसार दिवस ३४ ला फवारणी (दर ५ दिवसांनी) · शेवटची फवारणी ६ दिवसांपूर्वी');
    });

    it('one schedule, no record: "अजून नोंद नाही" - never "० दिवस"', () => {
        const line = scheduleWhyLineMr(stepOf({ lastSameWorkDate: null }), TODAY);

        expect(line).toBe('विद्यापीठ शेड्यूल नुसार दिवस ३४ ला फवारणी (दर ५ दिवसांनी) · अजून नोंद नाही');
        expect(line).not.toMatch(/[०0] दिवस/);
    });

    it('two schedules ask it: both are named once, "दोघे सांगतात"', () => {
        const line = scheduleWhyLineMr(stepOf({ alsoAskedBy: ['कृषी विभाग'] }), TODAY);

        expect(line).toBe('विद्यापीठ शेड्यूल आणि कृषी विभाग दोघे सांगतात · शेवटची फवारणी ६ दिवसांपूर्वी');
    });

    it('three schedules: "सगळे सांगतात"', () => {
        expect(scheduleWhyLineMr(stepOf({ alsoAskedBy: ['कृषी विभाग', 'माझं'] }), TODAY))
            .toBe('विद्यापीठ शेड्यूल, कृषी विभाग आणि माझं सगळे सांगतात · शेवटची फवारणी ६ दिवसांपूर्वी');
    });

    it('a last record made today or yesterday says "आज" / "काल", never a count of zero', () => {
        expect(scheduleWhyLineMr(stepOf({ lastSameWorkDate: TODAY }), TODAY)).toContain('शेवटची फवारणी आज');
        expect(scheduleWhyLineMr(stepOf({ lastSameWorkDate: '2026-11-12' }), TODAY)).toContain('शेवटची फवारणी काल');
    });

    it('no part is drawn from a missing field', () => {
        // no repeat stored -> no "(दर … दिवसांनी)"
        const noRepeat = scheduleWhyLineMr(stepOf({ repeatText: null }), TODAY);
        expect(noRepeat).toBe('विद्यापीठ शेड्यूल नुसार दिवस ३४ ला फवारणी · शेवटची फवारणी ६ दिवसांपूर्वी');
        expect(noRepeat).not.toContain('(');

        // the server did not say anything about the last record (the field is not there) -> neither "none" nor a day count
        const noLast = scheduleWhyLineMr(stepOf({ lastSameWorkDate: undefined }), TODAY);
        expect(noLast).toBe('विद्यापीठ शेड्यूल नुसार दिवस ३४ ला फवारणी (दर ५ दिवसांनी)');
        expect(noLast).not.toContain('नोंद');
        expect(noLast).not.toContain('शेवटची');

        // a record "in the future" (a wrong clock) is not drawn
        expect(scheduleWhyLineMr(stepOf({ lastSameWorkDate: '2026-11-20' }), TODAY)).toBe('विद्यापीठ शेड्यूल नुसार दिवस ३४ ला फवारणी (दर ५ दिवसांनी)');
    });

    it('a per-week repeat is worded in weeks, an unknown code is not drawn', () => {
        expect(repeatLineMr('per_week:2')).toBe('आठवड्यात २ वेळा');
        expect(repeatLineMr('every_n_days:1')).toBe('रोज');
        expect(repeatLineMr('fortnightly:2')).toBeNull();
        expect(repeatLineMr('every_n_days:0')).toBeNull();
        expect(repeatLineMr(null)).toBeNull();
        expect(daysAgoMr('2026-11-10', TODAY)).toBe('३ दिवसांपूर्वी');
    });

    it('no emoji and no AI wording in any line', () => {
        const line = scheduleWhyLineMr(stepOf({ alsoAskedBy: ['कृषी विभाग'] }), TODAY)!;

        expect(line).not.toMatch(/\p{Extended_Pictographic}/u);
        expect(line.toLowerCase()).not.toContain('ai');
    });
});

describe('the work\'s name in the line', () => {
    it('a schedule\'s own Marathi title is kept; an English name still goes through the Marathi words', () => {
        expect(stepLabelMr({ activityName: 'बुरशीनाशक फवारणी' })).toBe('बुरशीनाशक फवारणी');
        expect(stepLabelMr({ activityName: 'Foliar Spray' })).toBe('फवारणी');
        expect(stepLabelMr({ activityName: 'Something new' })).toBe('काम');
        expect(scheduleWhyLineMr(stepOf({}), TODAY)).toContain('ला फवारणी');
    });
});

describe('an older server, or a story that is not whole', () => {
    it('a row with no why-fields draws no line and has none of them', () => {
        const item = scheduledWorkItemOf(wire())!;

        expect(item.subscriptionId).toBeUndefined();
        expect(scheduleWhyLineMr(item, TODAY)).toBeNull();
    });

    it('whole or nothing: one malformed why-member drops every why-field (never half a story) - but never the routing ids', () => {
        for (const bad of [{ scheduleDay: 'x' }, { reasonKey: 'Sometime' }, { alsoAskedBy: [3] }, { lastSameWorkDate: 'soon' }, { scheduleName: '' }]) {
            const item = scheduledWorkItemOf(wire(why(bad)));

            expect(item, JSON.stringify(bad)).not.toBeNull(); // the step itself is still a step
            expect(item!.scheduleName, JSON.stringify(bad)).toBeUndefined();
            expect(item!.lastSameWorkDate, JSON.stringify(bad)).toBeUndefined();
            expect(item!.reasonKey, JSON.stringify(bad)).toBeUndefined();
            expect(scheduleWhyLineMr(item!, TODAY), JSON.stringify(bad)).toBeNull();
            // fix round 1 (P009): where the step moves is read on its own - a bad why never sends "पुढे ठरवा" to the wrong door
            expect(item!.subscriptionId, JSON.stringify(bad)).toBe('sub-1');
            expect(item!.activityId, JSON.stringify(bad)).toBe('act-1');
            expect(item!.originalDate, JSON.stringify(bad)).toBe('2026-11-13');
        }
    });

    it('the routing ids are whole or nothing among themselves: one bad one and the step is not routed to the schedule-step door', () => {
        for (const bad of [{ originalDate: 'tomorrow' }, { activityId: '' }, { subscriptionId: '' }]) {
            const item = scheduledWorkItemOf(wire(why(bad)))!;

            expect(item.subscriptionId, JSON.stringify(bad)).toBeUndefined();
            expect(item.activityId, JSON.stringify(bad)).toBeUndefined();
            expect(item.originalDate, JSON.stringify(bad)).toBeUndefined();
            expect(scheduleWhyLineMr(item, TODAY), JSON.stringify(bad)).toBeNull();
        }
    });

    it('never throws on garbage', () => {
        expect(() => whyOf({ subscriptionId: 5 })).not.toThrow();
        expect(whyOf({})).toBeNull();
        expect(whyOf({ subscriptionId: null })).toBeNull();
    });

    it('keeps a null last record (the server said none) apart from an absent one', () => {
        expect(scheduledWorkItemOf(wire(why({ lastSameWorkDate: null })))!.lastSameWorkDate).toBeNull();
        const absent = { ...why(), lastSameWorkDate: undefined };
        expect('lastSameWorkDate' in scheduledWorkItemOf(wire(absent))!).toBe(false);
    });

    it('the stored row (read back from Dexie) reads the same', () => {
        const once = stepOf({ alsoAskedBy: ['कृषी विभाग'], lastSameWorkDate: null });
        const again = scheduledWorkItemOf(JSON.parse(JSON.stringify(once)))!;

        expect(again).toEqual(once);
        expect(again.lastSameWorkDate).toBeNull();
    });
});

describe('the line on the page', () => {
    it('is drawn under the step, and the red count is not touched', () => {
        const steps = [stepOf(), scheduledWorkItemOf(wire({ plannedActivityId: 'step-2' }))!];
        const model = buildAttentionModel({
            cards: [], scheduledWork: { items: steps, asOfUtc: '2026-11-13T03:30:00.000Z' }, todos: { late: [], today: [] }, farmId: 'f1', todayKey: TODAY,
        });

        expect(model.total).toBe(2);
        expect(model.counts.todaySteps).toBe(2);
        const withWhy = model.today.find(i => i.kind === 'step' && i.step.plannedActivityId === 'step-1');
        const without = model.today.find(i => i.kind === 'step' && i.step.plannedActivityId === 'step-2');
        expect(withWhy && withWhy.kind === 'step' ? withWhy.why : null).toContain('नुसार दिवस ३४ ला');
        expect(without && without.kind === 'step' ? without.why : 'x').toBeUndefined();
    });

    it('StepRow draws the line when given one and nothing when not; the buttons stay 44px', () => {
        const step = stepOf();
        const { rerender } = render(<StepRow step={step} label="फवारणी" dueText="आज" tone="today" why="विद्यापीठ शेड्यूल नुसार दिवस ३४ ला फवारणी" onRecord={() => undefined} onMove={async () => undefined} />);

        expect(screen.getByTestId('attention-why-step-1')).toHaveTextContent('विद्यापीठ शेड्यूल नुसार दिवस ३४ ला फवारणी');
        expect(screen.getByTestId('attention-record-step-1').className).toContain('min-h-[44px]');
        expect(screen.getByTestId('attention-later-step-1').className).toContain('min-h-[44px]');

        rerender(<StepRow step={step} label="फवारणी" dueText="आज" tone="today" onRecord={() => undefined} onMove={async () => undefined} />);
        expect(screen.queryByTestId('attention-why-step-1')).toBeNull();
    });
});

describe('"पुढे ठरवा": which route a step goes to', () => {
    it('a step a followed schedule asks goes to the schedule-step route with its ids and two days', async () => {
        apiFetch.mockResolvedValue({ ok: true, status: 200 });

        await rescheduleStep(stepOf(), '2026-11-14');

        expect(apiFetch).toHaveBeenCalledTimes(1);
        const [url, init] = apiFetch.mock.calls[0] as [string, { method: string; body: string }];
        expect(url).toBe('/shramsafal/farms/f1/schedule-steps/move');
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body)).toEqual({ subscriptionId: 'sub-1', activityId: 'act-1', originalDate: '2026-11-13', newDate: '2026-11-14' });
        expect(init.body).not.toContain('reason');
    });

    it('a step whose why is malformed still goes to the schedule-step route (P009)', async () => {
        apiFetch.mockResolvedValue({ ok: true, status: 200 });
        const item = scheduledWorkItemOf(wire(why({ lastSameWorkDate: 'soon' })))!;

        await rescheduleStep(item, '2026-11-14');

        const [url] = apiFetch.mock.calls[0] as [string];
        expect(url).toBe('/shramsafal/farms/f1/schedule-steps/move');
    });

    it('every other step goes to today\'s override route, unchanged', async () => {
        apiFetch.mockResolvedValue({ ok: true, status: 200 });
        const plain = scheduledWorkItemOf(wire({ plannedActivityId: 'planned-9' }))!;

        await rescheduleStep(plain, '2026-11-14');

        const [url, init] = apiFetch.mock.calls[0] as [string, { method: string; body: string }];
        expect(url).toBe('/shramsafal/planned-activities/planned-9/override');
        expect(JSON.parse(init.body)).toMatchObject({ farmId: 'f1', newPlannedDate: '2026-11-14' });
    });

    it('a refusal is thrown, so the step stays on the page with its words (online only, nothing queued)', async () => {
        apiFetch.mockResolvedValue({ ok: false, status: 400 });

        await expect(rescheduleStep(stepOf(), '2026-11-14')).rejects.toThrow('HTTP 400');
        apiFetch.mockResolvedValue({ ok: false, status: 403 });
        await expect(rescheduleStep(stepOf(), '2026-11-14')).rejects.toThrow('HTTP 403');
    });
});
