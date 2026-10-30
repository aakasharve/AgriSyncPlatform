/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane E1) — "बदला" by speaking: the merge rule, pure.
 *
 *   - his words are read as a normal utterance in the entry's crop / plot (the log factory, the entry's own plot);
 *   - every bucket present in that reading REPLACES the same bucket; a bucket he did not mention stays exactly as it was;
 *   - labour keeps each engagement's identity by position (so it travels as a labour correction);
 *   - planned work brings its mirrored reminder notes, and the old mirrors go;
 *   - before → after is read the result screen's way; a changed dose reads as a change ("इथरेल 300" → "इथरेल 350");
 *   - a confirmed entry's new version is not confirmed (a confirmation is for the version it was given for);
 *   - a हजेरी-door record is refused (lane F1's rule).
 */
import { describe, expect, it } from 'vitest';
import { LogVerificationStatus, type AgriLogResponse, type CropProfile, type DailyLog, type FarmerProfile } from '../../../../../types';
import {
    blockerChange, correctionRows, goneValues, isLabourDoorLog, mergeCorrection, revisionUpdates, saysAnything, scopeOfLog, spokenAsLog,
} from '../correctionModel';

let n = 0;
const idGen = { generate: () => `id-${++n}` };
const clock = { nowISO: () => '2026-10-25T10:00:00.000Z', now: () => new Date('2026-10-25T10:00:00.000Z') } as never;
const CROPS = [{ id: 'grape', name: 'Grapes', iconName: 'Grapes', color: 'bg-purple-500', supportedTasks: [], workflow: [], plots: [{ id: 'g1', name: 'सोनाका', baseline: {}, schedule: {} }] }] as unknown as CropProfile[];
const PROFILE = { activeOperatorId: 'me', operators: [{ id: 'me', name: 'मी', role: 'PRIMARY_OWNER' }], trust: {} } as unknown as FarmerProfile;

const entry = (over: Partial<DailyLog> = {}): DailyLog => ({
    id: 'log-1',
    date: '2026-10-25',
    context: { selection: [{ cropId: 'grape', cropName: 'Grapes', selectedPlotIds: ['g1'], selectedPlotNames: ['सोनाका'] }] },
    dayOutcome: 'WORK_RECORDED',
    fullTranscript: 'इथरेल 300 मिली फवारलं, ठिबक दोन तास',
    cropActivities: [{ id: 'a', title: 'फवारणी' }],
    irrigation: [{ id: 'w', method: 'drip', source: 'Well', durationHours: 2 }],
    labour: [{ id: 'lb', type: 'HIRED', count: 5, labourAssignmentId: 'asg-1' }],
    inputs: [{ id: 'in', method: 'Spray', mix: [], productName: 'इथरेल', quantity: 300, unit: 'ml' }],
    machinery: [],
    activityExpenses: [],
    meta: { createdAtISO: '2026-10-25T08:00:00.000Z', createdByOperatorId: 'me' },
    ...over,
} as DailyLog);

const draft = (over: Partial<AgriLogResponse>): AgriLogResponse => ({
    summary: '', dayOutcome: 'WORK_RECORDED', cropActivities: [], irrigation: [], labour: [], inputs: [], machinery: [], activityExpenses: [], missingSegments: [],
    ...over,
});

const merge = (log: DailyLog, d: AgriLogResponse) => {
    const fresh = spokenAsLog(d, log, { crops: CROPS, profile: PROFILE, clock, idGen })!;
    return mergeCorrection(log, d, fresh, idGen);
};

describe('the merge rule — a bucket he mentions is replaced, the rest stays', () => {
    it('"इथरेल 300 नाही, 350 मिली": inputs replaced; water, labour, crop work unchanged (not even re-written)', () => {
        const log = entry();
        const m = merge(log, draft({ fullTranscript: 'इथरेल 300 नाही, 350 मिली', inputs: [{ id: 'x', method: 'Spray', mix: [], productName: 'इथरेल', quantity: 350, unit: 'ml' }] }));
        expect(m.replaced).toEqual(['inputs']);
        expect(Object.keys(m.updates)).toEqual(['inputs']);
        expect(m.updates.inputs?.[0]).toMatchObject({ productName: 'इथरेल', quantity: 350, unit: 'ml' });
        expect(m.after.irrigation).toBe(log.irrigation);
        expect(m.after.labour).toBe(log.labour);
        expect(m.after.cropActivities).toBe(log.cropActivities);
        // the entry keeps HIS words (the recording's own transcript)
        expect(m.after.fullTranscript).toBe(log.fullTranscript);
    });

    it('labour said again with as many rows keeps the engagement\'s identity (a correction the server takes)', () => {
        const m = merge(entry(), draft({ labour: [{ id: 'new', type: 'HIRED', count: 8 }] }));
        expect(m.updates.labour).toEqual([expect.objectContaining({ id: 'lb', labourAssignmentId: 'asg-1', count: 8 })]);
    });

    it('labour said with a different number of rows is new rows (the save then says it stays on this phone)', () => {
        const m = merge(entry(), draft({ labour: [{ id: 'x1', type: 'HIRED', count: 3 }, { id: 'x2', type: 'HIRED', count: 2 }] }));
        expect(m.updates.labour).toHaveLength(2);
        expect(m.updates.labour?.some(l => l.labourAssignmentId)).toBe(false);
    });

    it('KNOWN LIMIT: "पाच बायका पण होत्या" replaces the whole labour part, it does not add to it', () => {
        const m = merge(entry(), draft({ labour: [{ id: 'x', type: 'HIRED', femaleCount: 5 }] }));
        expect(m.after.labour).toHaveLength(1);
        expect(m.after.labour[0].femaleCount).toBe(5);
        expect(m.after.labour[0].count).toBeUndefined();
    });

    it('planned work brings its mirrored reminder; the old mirror goes; his own notes stay', () => {
        const log = entry({
            plannedTasks: [{ id: 't-old', title: 'उद्या खत', status: 'pending', priority: 'normal', sourceType: 'ai_extracted', createdAt: '' } as never],
            observations: [
                { id: 'o-mine', plotId: 'g1', dateKey: '2026-10-25', timestamp: '', textRaw: 'पानं पिवळी', noteType: 'observation', severity: 'normal', source: 'voice' },
                { id: 'o-mirror', plotId: 'g1', dateKey: '2026-10-25', timestamp: '', textRaw: 'उद्या खत', noteType: 'reminder', severity: 'normal', source: 'voice', tags: ['planned_task'] },
            ],
        });
        const m = merge(log, draft({ plannedTasks: [{ title: 'उद्या फवारणी', category: 'general', sourceText: 'उद्या फवारणी', systemInterpretation: '' }] }));
        expect(m.replaced).toEqual(['plannedTasks']);
        expect(m.after.plannedTasks?.map(t => t.title)).toEqual(['उद्या फवारणी']);
        const notes = m.after.observations ?? [];
        expect(notes.find(o => o.id === 'o-mine')).toBeDefined();
        expect(notes.find(o => o.id === 'o-mirror')).toBeUndefined();
        expect(notes.some(o => o.textRaw === 'उद्या फवारणी' && (o.tags ?? []).includes('planned_task'))).toBe(true);
    });

    it('nothing understood: nothing to change (no bucket, no stoppage)', () => {
        expect(saysAnything(draft({}))).toBe(false);
        expect(saysAnything(draft({ inputs: [{ id: 'x' } as never] }))).toBe(true);
        expect(saysAnything(draft({ disturbance: { scope: 'FULL_DAY', group: 'WEATHER', reason: 'पाऊस', blockedSegments: [] } }))).toBe(true);
    });

    it('the entry\'s own crop and plot are the scope (the whole farm for a farm-wide entry)', () => {
        expect(scopeOfLog(entry())).toMatchObject({ selectedCropIds: ['grape'], selectedPlotIds: ['g1'] });
        const farm = entry({ context: { selection: [{ cropId: 'FARM_GLOBAL', cropName: '', selectedPlotIds: [], selectedPlotNames: [] }] } });
        expect(scopeOfLog(farm)).toMatchObject({ selectedCropIds: ['FARM_GLOBAL'], selectedPlotIds: [] });
    });
});

describe.each(['mr', 'en'] as const)('before → after, the result screen\'s way (%s)', language => {
    it('a changed dose reads as a change; the old value is the one struck through; an unmentioned part is unchanged', () => {
        const log = entry();
        const m = merge(log, draft({ inputs: [{ id: 'x', method: 'Spray', mix: [], productName: 'इथरेल', quantity: 350, unit: 'ml' }] }));
        const rows = correctionRows(log, m.after, { language });
        const inputs = rows.find(r => r.part === 'inputs')!;
        expect(inputs.changed).toBe(true);
        const ml = language === 'en' ? 'ml' : 'मिली';
        expect(goneValues(inputs, language)).toEqual([`इथरेल 300 ${ml}`]);
        expect(rows.find(r => r.part === 'irrigation')!.changed).toBe(false);
        expect(rows.find(r => r.part === 'labour')!.changed).toBe(false);
        expect(rows.find(r => r.part === 'crop')!.changed).toBe(false);
    });

    it('money he may not see stays "—" on both sides', () => {
        const log = entry({ labour: [{ id: 'lb', type: 'HIRED', count: 5, totalCost: 1500, labourAssignmentId: 'asg-1' }] });
        const m = merge(log, draft({ labour: [{ id: 'x', type: 'HIRED', count: 6, totalCost: 1800 }] }));
        const rows = correctionRows(log, m.after, { hideMoney: true, language });
        expect(JSON.stringify(rows)).not.toMatch(/1500|1800/);
    });

    it('a stoppage he adds reads as changed', () => {
        const log = entry();
        const m = merge(log, draft({ disturbance: { scope: 'PARTIAL', group: 'WEATHER', reason: 'पाऊस', blockedSegments: [] } }));
        expect(blockerChange(log, m.after).changed).toBe(true);
    });
});

describe('the new version and its status', () => {
    it('a confirmed entry: the new version says "पक्कं नाही" (a confirmation is for the version it was given for)', () => {
        const log = entry({ verification: { required: true, status: LogVerificationStatus.VERIFIED } });
        const m = merge(log, draft({ inputs: [{ id: 'x', method: 'Spray', mix: [], productName: 'इथरेल', quantity: 350, unit: 'ml' }] }));
        expect(revisionUpdates(log, m).verification).toEqual({ status: LogVerificationStatus.DRAFT, required: true });
    });

    it('an unconfirmed entry: only the changed buckets travel', () => {
        const log = entry();
        const m = merge(log, draft({ inputs: [{ id: 'x', method: 'Spray', mix: [], productName: 'इथरेल', quantity: 350, unit: 'ml' }] }));
        expect(Object.keys(revisionUpdates(log, m))).toEqual(['inputs']);
    });

    it('a हजेरी-door record is refused (lane F1)', () => {
        expect(isLabourDoorLog(entry({ captureScope: 'labour' }))).toBe(true);
        expect(isLabourDoorLog(entry())).toBe(false);
    });
});
