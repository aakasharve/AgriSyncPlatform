/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I15, round-2 finding V2-07)
 *
 * A routine falls on the days the server plans it on, not from its stage's first day. The catalog used to
 * drop a periodic activity's own start / end day, so the शेड्यूल page expected a spray of days 18–35 from
 * day 16 (राहिलं on day 16, जास्तीचं on the day he really sprayed), and the demo farm's "Thrips Control
 * Spray" (offset 7) on day 0. The rule now matches the server's PlanDerivationEngine (`AlignFirstDueDay`).
 * Old and hand-made schedules (no days of their own) behave exactly as before (P11).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getTemplateById, setScheduleTemplatesFromReferenceData } from '../../../../infrastructure/reference/TemplateCatalog';
import { derivePlannedItemsForDay, derivePlannedItemsForStage } from '../../planning/ClientPlanEngine';
import type { CropScheduleTemplate, PlotScheduleInstance } from '../../scheduler.types';
import { addDays } from '../scheduleDates';
import { buildScheduleModel } from '../scheduleModel';
import { REF, SERVER_TEMPLATE, SPRAY_TEMPLATE, log, spray } from './scheduleFixtures';

/** The static catalog's shape: a spray on days 18–35 every 5 days, weeding once a week on days 20–34, in a stage of days 16–40. */
const RANGED_ID = '0d6c2d55-5c3e-4c1b-9d2a-1f7e3b9a0c01';
const RANGED = {
    id: RANGED_ID, name: 'Grapes - Ranged Test', cropType: 'Grapes', totalDays: 41,
    stages: [{ name: 'Post Pruning', startDay: 0, endDay: 15 }, { name: 'Canopy Build', startDay: 16, endDay: 40 }],
    activities: [
        { name: 'Spraying', category: 'Spraying', stageName: 'Canopy Build', startDay: 18, endDay: 35, frequencyMode: 'every_n_days', intervalDays: 5 },
        { name: 'Manual weeding', category: 'Weeding', stageName: 'Canopy Build', startDay: 20, endDay: 34, frequencyMode: 'per_week', intervalDays: 1 },
    ],
    versionHash: 'x',
};

/** The server's DB schedules (GetScheduleTemplatesHandler): a bare offset, sent as startDay = endDay. */
const OFFSET_ID = '5e1b7a90-2c44-4d7e-8b1f-3a9c6d2e4f02';
const OFFSET = {
    id: OFFSET_ID, name: 'Grapes - Spray', cropType: 'Grapes', totalDays: 30,
    stages: [{ name: 'Pre-Flowering', startDay: 0, endDay: 29 }],
    activities: [
        { name: 'Powdery Mildew Spray', category: 'Spraying', stageName: 'Pre-Flowering', startDay: 0, endDay: 0, frequencyMode: 'every_n_days', intervalDays: 14 },
        { name: 'Thrips Control Spray', category: 'Spraying', stageName: 'Pre-Flowering', startDay: 7, endDay: 7, frequencyMode: 'every_n_days', intervalDays: 14 },
        { name: 'Botrytis Spray', category: 'Spraying', stageName: 'Pre-Flowering', startDay: 10, endDay: 10, frequencyMode: 'every_n_days', intervalDays: 14 },
    ],
    versionHash: 'x',
};

const instance = (templateId: string, extra: Partial<PlotScheduleInstance> = {}): PlotScheduleInstance => ({
    id: 'sch', plotId: 'plot-1', templateId, referenceType: 'PRUNING', referenceDate: REF, stageOverrides: [], expectationOverrides: [], ...extra,
});

/** Day → the schedule's own task names expected that day, over days `from`..`to`. */
function plan(t: CropScheduleTemplate, inst: PlotScheduleInstance, from: number, to: number): Array<[number, string[]]> {
    const out: Array<[number, string[]]> = [];
    for (let d = from; d <= to; d++) {
        const names = derivePlannedItemsForDay(t, inst, d).plannedItems.map(i => i.notes ?? '');
        if (names.length) out.push([d, names]);
    }
    return out;
}
const daysOf = (rows: Array<[number, string[]]>, name: string) => rows.filter(([, n]) => n.includes(name)).map(([d]) => d);

beforeAll(() => setScheduleTemplatesFromReferenceData([RANGED, OFFSET]));
afterAll(() => setScheduleTemplatesFromReferenceData([SERVER_TEMPLATE, SPRAY_TEMPLATE]));

describe('a routine keeps its own days (V2-07)', () => {
    it('the catalog carries the start day always, the end day only when it is a real range', () => {
        const ranged = getTemplateById(RANGED_ID)!.periodicExpectations;
        expect(ranged.map(p => [p.notes, p.startDay, p.endDay])).toEqual([['Spraying', 18, 35], ['Manual weeding', 20, 34]]);
        const offset = getTemplateById(OFFSET_ID)!.periodicExpectations;
        expect(offset.map(p => [p.notes, p.startDay, p.endDay])).toEqual([
            ['Powdery Mildew Spray', 0, undefined], ['Thrips Control Spray', 7, undefined], ['Botrytis Spray', 10, undefined],
        ]);
    });

    it('a spray of days 18–35 every 5 days falls on 18, 23, 28, 33 — not 16, 21, 26, 31 from the stage start', () => {
        const rows = plan(getTemplateById(RANGED_ID)!, instance(RANGED_ID), 0, 60);
        expect(daysOf(rows, 'Spraying')).toEqual([18, 23, 28, 33]);
    });

    it('the demo farm\'s offsets: Thrips from day 7, Botrytis from day 10, each every 14 days to the stage end', () => {
        const rows = plan(getTemplateById(OFFSET_ID)!, instance(OFFSET_ID), 0, 29);
        expect(daysOf(rows, 'Powdery Mildew Spray')).toEqual([0, 14, 28]);
        expect(daysOf(rows, 'Thrips Control Spray')).toEqual([7, 21]);
        expect(daysOf(rows, 'Botrytis Spray')).toEqual([10, 24]);
    });

    it('a plot\'s own stage change moves the routine with its stage', () => {
        const moved = instance(RANGED_ID, { stageOverrides: [{ stageId: getTemplateById(RANGED_ID)!.stages[1].id, customDayStart: 18, customDayEnd: 42 }] });
        expect(daysOf(plan(getTemplateById(RANGED_ID)!, moved, 0, 60), 'Spraying')).toEqual([20, 25, 30, 35]);
    });

    it('the stage list (comparison) uses the same days', () => {
        const items = derivePlannedItemsForStage(getTemplateById(RANGED_ID)!, instance(RANGED_ID, { referenceDate: '2020-01-01' }), getTemplateById(RANGED_ID)!.stages[1].id);
        expect(items.filter(i => i.notes === 'Spraying').map(i => i.dueDate)).toEqual([18, 23, 28, 33]);
        expect(items.filter(i => i.notes === 'Manual weeding').map(i => i.dueDate)).toEqual([20, 27, 34]);
    });

    it('a hand-made schedule with no days of its own is unchanged: from the stage start, over the whole stage', () => {
        const base = getTemplateById(RANGED_ID)!;
        const handMade: CropScheduleTemplate = {
            ...base, id: 'hand-made',
            periodicExpectations: [{ id: 'pe-h', stageId: base.stages[1].id, operationTypeId: 'op_spray_gen', frequencyMode: 'EVERY_N_DAYS', frequencyValue: 5, notes: 'Spraying' }],
        };
        expect(daysOf(plan(handMade, instance('hand-made'), 0, 40), 'Spraying')).toEqual([16, 21, 26, 31, 36]);
    });
});

describe('the शेड्यूल page reads the same days', () => {
    const k = (d: number) => addDays(REF, d);

    it('spraying on the server\'s day 18 is झालं there; day 16 expected nothing (no राहिलं, no जास्तीचं)', () => {
        const m = buildScheduleModel({ template: getTemplateById(RANGED_ID)!, instance: instance(RANGED_ID), plotId: 'plot-1', logs: [log(k(18), spray())], todayKey: k(25) });
        expect(m.byKey.get(k(16))!.cells.spray.status).toBe('none');
        expect(m.byKey.get(k(18))!.cells.spray.status).toBe('done');
        expect(m.byKey.get(k(23))!.cells.spray.status).toBe('missed');
    });

    it('a weekly routine with its own first day is weekly from THAT day (20, 27, 34), never daily', () => {
        const m = buildScheduleModel({ template: getTemplateById(RANGED_ID)!, instance: instance(RANGED_ID), plotId: 'plot-1', logs: [], todayKey: k(25) });
        expect(m.days.filter(d => d.cells.work.items.length > 0).map(d => d.day)).toEqual([20, 27, 34]);
    });
});
