/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I15; inventory S5, S6, S7, S8, S11, S12, S16)
 *
 * The शेड्यूल model, computed from a real-shaped server schedule (mapped by the real TemplateCatalog) and
 * real-shaped logs. Pins: every log of a day counts (not only the first), a gone day with nothing done is
 * MISSED, the owed list is computed (and cleared by a later doing of the same part), done-but-not-asked is
 * जास्तीचं, a weekly task is weekly (not daily), nothing is expected after the schedule ends, and the
 * counts on the three big buttons.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { getTemplateById, setScheduleTemplatesFromReferenceData } from '../../../../infrastructure/reference/TemplateCatalog';
import type { CropScheduleTemplate } from '../../scheduler.types';
import { addDays } from '../scheduleDates';
import {
    PART_LABEL, aheadItemCount, buildScheduleModel, dayVerdict, extrasOn, normalizeInstance, owedWork, partsDone, pastDays,
    stageTally, todayOf, upcomingDays, type ScheduleModel,
} from '../scheduleModel';
import { REF, SERVER_TEMPLATE, SPRAY_TEMPLATE, SPRAY_TEMPLATE_ID, TEMPLATE_ID, TODAY, activity, fert, log, plot, spray, water, work } from './scheduleFixtures';

let template: CropScheduleTemplate;
const k = (day: number) => addDays(REF, day);

beforeAll(() => {
    setScheduleTemplatesFromReferenceData([SERVER_TEMPLATE, SPRAY_TEMPLATE]);
    template = getTemplateById(TEMPLATE_ID)!;
});

const typed = { meta: { createdAtISO: '2026-10-17T03:30:00Z', provenance: { source: 'manual' as const, timestamp: '2026-10-17T03:30:00Z' } } };
const LOGS = () => [
    log(k(0), work(), typed),                 // day 0, FIRST log: work only
    log(k(0), water()),                       // day 0, SECOND log: the irrigation (the old grid never read it)
    log(k(3), water(), {}, 'plot-2'),         // another plot's irrigation — not this plot's
    log(k(4), water()),                       // day 4: irrigation nobody asked for → जास्तीचं; clears day 3's miss
    log(k(6), water(), { deletion: { deletedAtISO: 'x', deletedByOperatorId: 'o', reason: 'r' } }), // deleted
    log('', water()),                         // no date: on no day
    log(k(7), work('gap_recorded')),          // day 7: "could not weed" is not weeding
];

const build = (logs = LOGS(), todayKey = TODAY): ScheduleModel =>
    buildScheduleModel({ template, instance: plot().schedule, plotId: 'plot-1', logs, todayKey });

describe('शेड्यूल model — where you are (S3)', () => {
    it('day 9 of 40, two stages in Marathi, the current one with its own filled bar', () => {
        const m = build();
        expect(m.todayDay).toBe(9);
        expect(m.totalDays).toBe(40);
        expect(m.progressPct).toBe(23);
        expect(m.stages.map(s => [s.name, s.from, s.to, s.current, s.filledPct])).toEqual([
            ['छाटणीनंतर', 0, 14, true, 67],
            ['फूट वाढ', 15, 39, false, 0],
        ]);
        expect(m.currentStage?.name).toBe('छाटणीनंतर');
    });
});

describe('शेड्यूल model — done / missed / extra at the four-part level', () => {
    it('reads EVERY log of a day: the irrigation in the second log of day 0 counts', () => {
        const d0 = build().byKey.get(k(0))!;
        expect(d0.cells.irrigation.status).toBe('done');
        expect(d0.cells.work.status).toBe('done');
        expect(dayVerdict(d0)).toBe('allDone');
    });

    it('a gone day with an expected part not done is MISSED (computed, the old grid never said it)', () => {
        const m = build();
        expect(m.byKey.get(k(3))!.cells.irrigation.status).toBe('missed'); // plot-2's log does not count
        expect(m.byKey.get(k(6))!.cells.irrigation.status).toBe('missed'); // the deleted log does not count
        expect(m.byKey.get(k(8))!.cells.spray.status).toBe('missed');
        expect(m.byKey.get(k(7))!.cells.work.status).toBe('missed');        // a told gap is not done
        expect(dayVerdict(m.byKey.get(k(8))!)).toBe('missed');
    });

    it('done but not asked that day is जास्तीचं', () => {
        const d4 = build().byKey.get(k(4))!;
        expect(d4.items).toHaveLength(0);
        expect(d4.cells.irrigation.status).toBe('extra');
        expect(extrasOn(d4)).toEqual(['irrigation']);
    });

    it('today expected-but-not-yet is due, a coming day is planned; titles are Marathi', () => {
        const m = build();
        const today = todayOf(m)!;
        expect(today.items.map(i => [i.part, i.title, i.detail])).toEqual([['irrigation', 'ठिबक सिंचन', null]]);
        expect(today.cells.irrigation.status).toBe('due');
        expect(m.byKey.get(k(12))!.cells.irrigation.status).toBe('planned');
    });

    it('each task carries the schedule\'s own name when it says more than the title ("Fungicide spray")', () => {
        const d8 = build().byKey.get(k(8))!;
        expect(d8.items.map(i => [i.part, i.title, i.detail])).toEqual([['spray', 'फवारणी', 'बुरशीनाशक फवारणी']]);
    });

    it('partsDone: spray input → फवारणी, fertilizer → खत, a blocked irrigation is not water', () => {
        expect([...partsDone([log(k(1), spray())])]).toEqual(['spray']);
        expect([...partsDone([log(k(1), fert())])]).toEqual(['nutrition']);
        const blocked = log(k(1), { irrigation: [{ id: 'irr_blocked_1', method: '', source: '' }] } as never);
        expect(partsDone([blocked]).has('irrigation')).toBe(false);
    });

    it('partsDone: a spray-titled activity is फवारणी only, never the कामे the schedule asked for; workers on the plot are कामे', () => {
        expect([...partsDone([log(k(1), activity('Fungicide spray'))])]).toEqual(['spray']);
        expect([...partsDone([log(k(1), activity('फवारणी केली'))])]).toEqual(['spray']);
        expect([...partsDone([log(k(1), activity('Weeding'))])]).toEqual(['work']);
        expect([...partsDone([log(k(1), { labour: [{ id: 'l1' }] } as never)])]).toEqual(['work']);
        // On day 7 (weeding expected) a spray activity alone leaves the weeding राहिलं.
        const m = build([log(k(7), activity('Fungicide spray'))]);
        expect(m.byKey.get(k(7))!.cells.work.status).toBe('missed');
    });
});

describe('आधी राहिलेलं काम (S6) — computed, cleared when the part is done later', () => {
    it('lists irrigation (day 6), spray (day 8) and weeding (day 7); day 3 is gone because day 4 watered', () => {
        const owed = owedWork(build());
        expect(owed.map(o => [o.part, o.title, o.lastDay, o.times])).toEqual([
            ['irrigation', 'ठिबक सिंचन', 6, 1],
            ['spray', 'फवारणी', 8, 1],
            ['work', 'खुरपणी', 7, 1],
        ]);
    });

    it('watering today clears the owed irrigation; nothing typed in can add one', () => {
        const owed = owedWork(build([...LOGS(), log(TODAY, water())]));
        expect(owed.map(o => o.part)).toEqual(['spray', 'work']);
    });

    it('two DIFFERENT sprays owed on one day stay two lines, each with the schedule\'s own name', () => {
        const sprays = getTemplateById(SPRAY_TEMPLATE_ID)!;
        const m = buildScheduleModel({ template: sprays, instance: { ...plot().schedule, templateId: SPRAY_TEMPLATE_ID }, plotId: 'plot-1', logs: [], todayKey: TODAY });
        expect(owedWork(m).map(o => [o.part, o.title, o.detail, o.lastDay])).toEqual([
            ['spray', 'फवारणी', 'भुरीसाठी फवारणी', 0],
            ['spray', 'फवारणी', 'थ्रिप्ससाठी फवारणी', 0],
        ]);
    });
});

describe('expected vs done for this stage (S7) and the three counts (S5)', () => {
    it('one count per day + part, no "partly"', () => {
        const m = build();
        expect(stageTally(m)).toEqual({ expected: 6, done: 2, missed: 4, extra: 1 });
        expect(stageTally(m, 'irrigation')).toEqual({ expected: 3, done: 1, missed: 2, extra: 1 });
        expect(stageTally(m, 'nutrition')).toEqual({ expected: 0, done: 0, missed: 0, extra: 0 });
        expect(PART_LABEL).toEqual({ irrigation: 'सिंचन', nutrition: 'खत', spray: 'फवारणी', work: 'कामे' });
    });

    it('look-ahead: 3 days holds the day-12 irrigation; 8 days adds the weekly weeding and two fertigations', () => {
        const m = build();
        expect(upcomingDays(m, 3).map(d => d.day)).toEqual([12]);
        expect(upcomingDays(m, 8).map(d => [d.day, d.items.map(i => i.part)])).toEqual([
            [12, ['irrigation']], [14, ['work']], [15, ['nutrition']], [17, ['nutrition']],
        ]);
        expect(aheadItemCount(m, 8)).toBe(4);
    });

    it('a weekly task is weekly (days 0, 7, 14), not every day as the raw engine returns it', () => {
        const weeding = build().days.filter(d => d.cells.work.items.length > 0).map(d => d.day);
        expect(weeding).toEqual([0, 7, 14]);
    });

    it('past days newest first (S8)', () => {
        expect(pastDays(build()).slice(0, 3).map(d => d.day)).toEqual([8, 7, 6]);
    });
});

describe('edges', () => {
    it('after the schedule\'s last day nothing is expected (the old grid repeated the last stage)', () => {
        const m = build([], addDays(REF, 45));
        expect(m.days.filter(d => d.day > 39).every(d => d.items.length === 0)).toBe(true);
        expect(m.stages.every(s => s.past)).toBe(true);
    });

    it('"you are here" only inside a stage: none after the end (the last stage is still what झालं compares) and none before day 0', () => {
        const after = build([], addDays(REF, 45));
        expect([after.currentStage, after.ended, after.tallyStage?.name]).toEqual([null, true, 'फूट वाढ']);
        expect(after.stages.some(s => s.current)).toBe(false);
        const before = build([], addDays(REF, -3));
        expect([before.todayDay, before.currentStage, before.tallyStage, before.ended]).toEqual([-3, null, null, false]);
        expect(stageTally(before)).toEqual({ expected: 0, done: 0, missed: 0, extra: 0 });
    });

    it('land-preparation days: the list starts 15 days before day 0, nothing is expected there, work done shows as done', () => {
        const m = build([log(k(-5), work())]);
        expect(m.days[0].key).toBe(k(-15));
        expect(m.days[0].prep).toBe(true);
        expect(m.byKey.get(k(0))!.prep).toBe(false);
        const d = m.byKey.get(k(-5))!;
        expect([d.items.length, d.cells.work.status]).toEqual([0, 'extra']);
        expect(stageTally(m)).toEqual({ expected: 6, done: 0, missed: 6, extra: 0 }); // prep work never counts for a stage
        expect(pastDays(m).map(x => x.day).slice(-2)).toEqual([-14, -15]);
    });

    it('a recorded schedule shift moves the plan day', () => {
        const m = buildScheduleModel({ template, instance: plot().schedule, plotId: 'plot-1', logs: [], todayKey: TODAY,
            shifts: [{ id: 's', plotId: 'plot-1', date: k(3), shiftDays: 2, reason: 'WEATHER' }] });
        expect(m.todayDay).toBe(7);
    });

    it('an old phone\'s schedule saved by the old editor (wizard object) is read, not crashed on', () => {
        const old = { cropId: 'crop-1', plotId: 'plot-1', plantationDate: REF, stages: [], selectedTemplateId: TEMPLATE_ID, name: 'My New Schedule' };
        const inst = normalizeInstance(old, { plotId: 'plot-1', templateId: TEMPLATE_ID, referenceType: 'PRUNING', referenceDate: TODAY });
        expect(inst).toMatchObject({ referenceDate: REF, templateId: TEMPLATE_ID, stageOverrides: [], expectationOverrides: [] });
        expect(buildScheduleModel({ template, instance: inst, plotId: 'plot-1', logs: [], todayKey: TODAY }).todayDay).toBe(9);
    });
});
