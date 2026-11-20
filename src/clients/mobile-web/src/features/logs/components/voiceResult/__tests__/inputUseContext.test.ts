/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: facts-card-input-truth-2026-11-19 (lane FACTS-1) - the day of the season and the stage of one use, from the plot's own schedule.
 * Never invented (P4): no crop, no plot, no schedule = no day and no stage. A date before day 0 has no day. P7: a record is only read.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { setScheduleTemplatesFromReferenceData } from '../../../../../infrastructure/reference/TemplateCatalog';
import type { DailyLog } from '../../../../../types';
import { REF, SERVER_TEMPLATE, TEMPLATE_ID, crop, log, plot, water } from '../../../../scheduler/schedulePage/__tests__/scheduleFixtures';
import { addDays } from '../../../../scheduler/schedulePage/scheduleDates';
import { useContextFor } from '../inputUseContext';

beforeAll(() => { setScheduleTemplatesFromReferenceData([SERVER_TEMPLATE]); });

const logOn = (date: string, selection?: DailyLog['context']): DailyLog => {
    const l = log(date, water());
    return { ...l, context: selection ?? { selection: [{ cropId: 'crop-1', cropName: 'Grapes', selectedPlotIds: ['plot-1'], selectedPlotNames: ['A'] }] } } as DailyLog;
};
const NOCHOICES = new Map();

describe('useContextFor', () => {
    it('Context_DayCountedFromTheSchedulesDayZero_WithTheStageThatDayIsIn', () => {
        const c = useContextFor({ log: logOn(addDays(REF, 9)), crops: [crop()], choices: NOCHOICES })!;
        expect(c.day).toBe(9);
        expect(c.refType).toBe('PRUNING');
        expect(c.stageName).toBe('छाटणीनंतर');
        expect(c.cropName).toBe('Grapes');
        expect(c.dateKey).toBe(addDays(REF, 9));
    });

    it('Context_NextStage_IsTheOneThatStartsLater_WithDaysToGo', () => {
        const c = useContextFor({ log: logOn(addDays(REF, 12)), crops: [crop()], choices: NOCHOICES })!;
        expect(c.nextStage).toEqual({ name: 'फूट वाढ', inDays: 3 });
    });

    it('Context_DayZeroItself_IsDayZero', () => {
        expect(useContextFor({ log: logOn(REF), crops: [crop()], choices: NOCHOICES })!.day).toBe(0);
    });

    it('Context_BeforeDayZero_HasNoDay_NeverANegativeOne', () => {
        const c = useContextFor({ log: logOn(addDays(REF, -4)), crops: [crop()], choices: NOCHOICES })!;
        expect(c.day).toBeNull();
    });

    it('Context_RecordedShifts_MoveTheDay_LikeTheSchedulePage', () => {
        const shifted = plot({ scheduleShifts: [{ id: 's1', plotId: 'plot-1', date: addDays(REF, 5), shiftDays: 2, reason: 'WEATHER' }] });
        const c = useContextFor({ log: logOn(addDays(REF, 9)), crops: [crop([shifted])], choices: NOCHOICES })!;
        expect(c.day).toBe(7);
    });

    it('Context_WholeFarmRecord_SaysNothingAboutDayOrStage', () => {
        const farm = logOn(REF, { selection: [{ cropId: 'FARM_GLOBAL', cropName: '', selectedPlotIds: [], selectedPlotNames: [] }] });
        const c = useContextFor({ log: farm, crops: [crop()], choices: NOCHOICES })!;
        expect(c.day).toBeNull(); expect(c.stageName).toBeNull(); expect(c.refType).toBeNull();
    });

    it('Context_PlotNotOnThisPhone_SaysNothing', () => {
        const other = logOn(REF, { selection: [{ cropId: 'crop-1', cropName: 'Grapes', selectedPlotIds: ['plot-9'], selectedPlotNames: ['Z'] }] });
        const c = useContextFor({ log: other, crops: [crop()], choices: NOCHOICES })!;
        expect(c.day).toBeNull(); expect(c.cropName).toBe('Grapes');
    });

    it('Context_AnUnreadableStoredSchedule_NeverBreaksTheScreen', () => {
        const broken = plot({ schedule: 'not a schedule' as unknown as never });
        expect(() => useContextFor({ log: logOn(REF), crops: [crop([broken])], choices: NOCHOICES })).not.toThrow();
    });

    it('Context_NoLog_IsNull_AndTheLogIsNeverChanged', () => {
        expect(useContextFor({ log: undefined, crops: [crop()], choices: NOCHOICES })).toBeNull();
        const l = logOn(addDays(REF, 9)); const before = JSON.stringify(l);
        useContextFor({ log: l, crops: [crop()], choices: NOCHOICES });
        expect(JSON.stringify(l)).toBe(before);
    });

    it('Context_ChosenScheduleOnTheServer_OutranksThePlotsOwn_ForDayZero', () => {
        const choices = new Map([['plot-1', { templateId: TEMPLATE_ID, referenceDate: addDays(REF, 2), pending: false }]]);
        const c = useContextFor({ log: logOn(addDays(REF, 9)), crops: [crop()], choices: choices as never })!;
        expect(c.day).toBe(7);
    });
});
