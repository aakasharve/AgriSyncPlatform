/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 10, item 6) - "पाहणीच्या आठवणी" is filled from the followed schedule's own look and question fields: only works due
 * on the day that carry one.
 */
import { describe, expect, it } from 'vitest';
import { parseScheduleTask } from '../../../../../../../../sync-contract/schemas/schedule-task.zod';
import { shownDayOfStored, type DayCardsDetail } from '../../dayCards/dayCardsTypes';
import { looksDueOn } from '../ScheduleTabCards';

const t = (key: string, from: number, to: number, extra: Record<string, unknown>) => {
    const r = parseScheduleTask({ taskKey: key, name: key, kind: 'observe', basis: 'stated', timing: { timer: 'day', fromDay: from, toDay: to, repeat: 'once' }, sources: [{ document: 'd' }], ...extra });
    if (!r.ok) throw new Error(r.error);
    return { task: r.value, contentHash: 'x', shown: { from: shownDayOfStored(from), to: shownDayOfStored(to), expectedFrom: null, expectedTo: null, repeatEnd: null }, doseChecked: false };
};
const detail = { tasks: [t('q', 10, 12, { ask: { question: 'किती कळ्या फुटल्या?' } }), t('l', 10, 10, { look: { sign: 'कळी' } }), t('plain', 10, 10, {}), t('later', 20, 20, { ask: { question: 'x' } })] } as unknown as DayCardsDetail;

describe('looksDueOn', () => {
    it('counts only works due that day with a question or a look', () => {
        expect(looksDueOn(detail, 10).map(x => x.task.taskKey)).toEqual(['q', 'l']);
        expect(looksDueOn(detail, 12).map(x => x.task.taskKey)).toEqual(['q']);
        expect(looksDueOn(detail, 15)).toEqual([]);
    });
});
