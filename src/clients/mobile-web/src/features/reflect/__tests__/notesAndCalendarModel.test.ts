/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I6)
 *
 * निरीक्षणं व नोंदी (the chosen day's observation notes) and कामाचं कॅलेंडर (one day of the week/month
 * calendar), both from the real logs.
 */
import { describe, expect, it } from 'vitest';
import type { ObservationNote } from '../../../types';
import { activityNameOf, buildCalendarDay } from '../overview/calendarModel';
import { buildDayNotes } from '../overview/notesModel';
import { pickCrop, selectAll, toViewScope } from '../overview/reflectSelection';
import { CROPS, TODAY, TODAY_KEY, farmLog, log, task } from './reflectFixtures';

const all = toViewScope(CROPS, selectAll(CROPS));

const note = (id: string, noteType: ObservationNote['noteType'], textRaw: string, extra: Partial<ObservationNote> = {}): ObservationNote => ({
    id, plotId: 'g1', dateKey: TODAY_KEY, timestamp: '2026-10-25T03:40:00.000Z', textRaw, noteType, severity: 'normal', source: 'voice', ...extra,
});

describe('buildDayNotes', () => {
    it('lists the day\'s notes of the picked plots, problems first, with the time, the plot and who told it', () => {
        const history = [
            log({
                id: 'a', plotIds: ['g1'], meta: { createdAtISO: '', createdByOperatorId: 'op1' },
                observations: [
                    note('o1', 'observation', 'घड पोसणं चालू', { timestamp: '2026-10-25T07:10:00.000Z' }),
                    note('o2', 'issue', 'बांधाजवळ कीड', { severity: 'urgent', tags: ['कीड'] }),
                ],
            }),
            log({ id: 'b', cropId: 'cane', plotIds: ['c1'], observations: [note('o3', 'tip', 'x', { plotId: 'c1' })] }),
            log({ id: 'old', date: '2026-10-24', plotIds: ['g1'], observations: [note('o4', 'issue', 'काल')] }),
        ];
        const notes = buildDayNotes({ history, dateKey: TODAY_KEY, scope: toViewScope(CROPS, pickCrop(CROPS, 'grape')), crops: CROPS, operatorNameById: { op1: 'सुनील' } });
        expect(notes.map(n => n.id)).toEqual(['o2', 'o1']);
        expect(notes[0]).toMatchObject({ kindLabel: 'अडचण', time: 'सकाळी 9:10', place: 'सोनाका', by: 'सुनील', text: 'बांधाजवळ कीड', severityLabel: 'तातडीचं', tags: ['कीड'] });
        expect(notes[1]).toMatchObject({ kindLabel: 'निरीक्षण', time: 'दुपारी 12:40' });
    });

    it('a reminder the app wrapped in English shows the farmer\'s own words', () => {
        const history = [log({
            id: 'a', plotIds: ['g1'],
            observations: [note('r', 'reminder', 'उद्या फवारणी', { textCleaned: 'Reminder: उद्या फवारणी (Extracted from Voice)', tags: ['planned_task'], plotId: 'FARM_GLOBAL' })],
        })];
        const [n] = buildDayNotes({ history, dateKey: TODAY_KEY, scope: all, crops: CROPS, operatorNameById: {} });
        expect(n).toMatchObject({ text: 'उद्या फवारणी', kindLabel: 'आठवण', place: 'पूर्ण शेत' });
        expect(n.by).toBeUndefined();
    });

    it('a note with no time shows no time (never an invented one)', () => {
        const history = [log({ id: 'a', plotIds: ['g1'], observations: [note('o', 'observation', 'x', { timestamp: '' })] })];
        expect(buildDayNotes({ history, dateKey: TODAY_KEY, scope: all, crops: CROPS, operatorNameById: {} })[0].time).toBe('');
    });
});

describe('buildCalendarDay', () => {
    it('one chip per record in the crop\'s colour, with the plot and the main work', () => {
        const history = [
            log({ id: 'a', plotIds: ['g2'], context: { selection: [{ cropId: 'grape', cropName: 'द्राक्ष', selectedPlotIds: ['g2'], selectedPlotNames: ['थॉम्पसन'] }] }, cropActivities: [{ id: 'x', title: 'छाटणी' }] }),
            log({ id: 'b', cropId: 'cane', plotIds: ['c1'], irrigation: [{ id: 'i', method: 'drip', source: 'Well' }] }),
        ];
        const day = buildCalendarDay({ date: TODAY, history, crops: CROPS, scope: all, dueTasks: [], today: TODAY });
        expect(day.chips).toEqual([
            { logId: 'a', color: 'bg-purple-500', plotLabel: 'थॉम्पसन', plotIndex: 1, activity: 'छाटणी' },
            { logId: 'b', color: 'bg-emerald-500', plotLabel: 'ऊस १', plotIndex: 0, activity: 'पाणी' },
        ]);
        expect(day.cropColors).toEqual(['bg-purple-500', 'bg-emerald-500']);
        expect(day.isToday).toBe(true);
        expect(day.empty).toBe(false);
    });

    it('follows the picked plots', () => {
        const history = [log({ id: 'b', cropId: 'cane', plotIds: ['c1'], cropActivities: [{ id: 'x', title: 'x' }] })];
        const day = buildCalendarDay({ date: TODAY, history, crops: CROPS, scope: toViewScope(CROPS, pickCrop(CROPS, 'grape')), dueTasks: [], today: TODAY });
        expect(day.chips).toEqual([]);
        expect(day.empty).toBe(true);
    });

    it('a whole-day stop, rain and whole-farm work are each marked', () => {
        const history = [
            log({ id: 'a', plotIds: ['g1'], disturbance: { scope: 'FULL_DAY', group: 'WEATHER', reason: 'पाऊस', blockedSegments: [] } }),
            log({ id: 'w', cropId: 'cane', plotIds: ['c1'], weatherSnapshot: { current: { iconCode: 'rain' } } as never }),
            farmLog({ id: 'f', cropActivities: [{ id: 'x', title: 'पाइपलाइन' }] }),
        ];
        const day = buildCalendarDay({ date: TODAY, history, crops: CROPS, scope: toViewScope(CROPS, pickCrop(CROPS, 'grape')), dueTasks: [], today: TODAY });
        expect(day.blocked).toEqual({ groupLabel: 'हवामान', reason: 'पाऊस' });
        expect(day.rainy).toBe(true);
        expect(day.farmWide).toBe(true);
    });

    it('a to-do sits on its due day', () => {
        const day = buildCalendarDay({
            date: TODAY, history: [], crops: CROPS, scope: all, today: TODAY,
            dueTasks: [task('t1', 'फवारणी', { dueDate: TODAY_KEY }), task('t2', 'उद्याचं', { dueDate: '2026-10-26' })],
        });
        expect(day.due).toEqual([{ id: 't1', title: 'फवारणी' }]);
        expect(day.empty).toBe(false);
    });
});

describe('activityNameOf', () => {
    it('the farmer\'s own work name first, then a plain Marathi word for the bucket', () => {
        expect(activityNameOf(log({ id: 'a', cropActivities: [{ id: 'x', title: 'खुरपणी' }] }))).toBe('खुरपणी');
        expect(activityNameOf(log({ id: 'b', inputs: [{ id: 'i', type: 'fertilizer' } as never] }))).toBe('खत');
        expect(activityNameOf(log({ id: 'c', inputs: [{ id: 'i', type: 'fungicide' } as never] }))).toBe('फवारणी');
        expect(activityNameOf(log({ id: 'd', labour: [{ id: 'l', type: 'HIRED', count: 2 }] }))).toBe('मजूर');
        expect(activityNameOf(log({ id: 'e', machinery: [{ id: 'm', type: 'tractor', ownership: 'owned' }] }))).toBe('ट्रॅक्टर');
        expect(activityNameOf(log({ id: 'f' }))).toBe('नोंद');
    });
});
