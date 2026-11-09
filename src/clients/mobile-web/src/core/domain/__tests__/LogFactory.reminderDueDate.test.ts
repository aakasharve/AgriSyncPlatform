/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-4 Task 2; founder D-29) - a reminder's due date comes from a CLEAR cue
 * only, never "today by default".
 *
 * `LogFactory` used to file every typed reminder note (and the plain-whole-farm one) under the log's own day
 * (`dueDate: data.date`) - the day it was WRITTEN, not a day he said. It stays undated now (the server makes the same reminder with no
 * date, and an undated reminder is never late). A spoken cue still becomes a day ("उद्या" -> tomorrow); an unclear one stays undated.
 */
import { describe, expect, it } from 'vitest';
import { LogFactory } from '../LogFactory';
import type { Clock } from '../services/Clock';
import type { AgriLogResponse, CropProfile, FarmerProfile, LogScope, ObservationNote } from '../../../types';

const FIXED_ISO = '2026-07-13T06:00:00.000Z';
const fixedClock: Clock = { now: () => new Date(FIXED_ISO), nowISO: () => FIXED_ISO, nowEpoch: () => new Date(FIXED_ISO).getTime() };
const profile = { activeOperatorId: 'owner', trust: { reviewPolicy: 'AUTO_APPROVE_ALL', requirePinForVerification: false }, operators: [] } as unknown as FarmerProfile;
const crops = [{
    id: 'crop-grapes', name: 'Grapes', iconName: 'grapes', color: 'purple',
    plots: [{ id: 'plot-a', name: 'Plot A', baseline: { unit: 'Acre' } }], supportedTasks: [], workflow: [],
}] as unknown as CropProfile[];
const onePlot: LogScope = { selectedPlotIds: ['plot-a'], selectedCropIds: ['crop-grapes'], mode: 'single', applyPolicy: 'broadcast' };
const wholeFarm: LogScope = { selectedPlotIds: [], selectedCropIds: ['FARM_GLOBAL'], mode: 'single', applyPolicy: 'broadcast' };

const reminderNote = { id: 'obs-1', textRaw: 'ठिबकची नळी तपासायची', noteType: 'reminder', severity: 'normal' } as unknown as ObservationNote;

describe('a typed reminder is not filed under the log\'s day', () => {
    it('on a plot: the reminder note becomes a to-do with NO due date (not the day it was written)', () => {
        const logs = LogFactory.createFromManualEntry({ date: '2026-07-13', observations: [reminderNote] }, onePlot, crops, profile, fixedClock);
        const task = logs.flatMap(l => l.plannedTasks ?? []).find(t => t.title === 'ठिबकची नळी तपासायची');
        expect(task).toBeDefined();
        expect(task!.dueDate).toBeUndefined();
    });

    it('on the whole farm: the same', () => {
        const logs = LogFactory.createFromManualEntry({ date: '2026-07-13', observations: [reminderNote] }, wholeFarm, crops, profile, fixedClock);
        const task = logs.flatMap(l => l.plannedTasks ?? []).find(t => t.title === 'ठिबकची नळी तपासायची');
        expect(task).toBeDefined();
        expect(task!.dueDate).toBeUndefined();
    });
});

const voice = (dueHint: string | undefined): AgriLogResponse => ({
    summary: '', dayOutcome: 'WORK_RECORDED', cropActivities: [], irrigation: [], labour: [], inputs: [], machinery: [], activityExpenses: [],
    plannedTasks: [{ title: 'फवारणी', dueHint, category: 'maintenance', sourceText: '', systemInterpretation: '' }], missingSegments: [],
} as AgriLogResponse);

describe('a spoken cue becomes a day only when it is clear', () => {
    const make = (dueHint: string | undefined) =>
        LogFactory.createFromVoiceResult(voice(dueHint), onePlot, crops, profile, undefined, undefined, fixedClock, undefined, true)[0].plannedTasks!.find(t => t.title === 'फवारणी')!;

    it('"उद्या" is tomorrow', () => expect(make('उद्या').dueDate).toBe('2026-07-14'));
    it('an unclear cue is undated', () => {
        expect(make('नंतर').dueDate).toBeUndefined();
        expect(make('या आठवड्यात').dueDate).toBeUndefined();
        expect(make(undefined).dueDate).toBeUndefined();
    });
});
