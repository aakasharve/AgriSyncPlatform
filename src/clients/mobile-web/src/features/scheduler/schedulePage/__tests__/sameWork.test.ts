/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 10; slice 9 finding) - works of the plot's followed versions that share a task key are ONE card with a
 * pick-the-source choice; works with the same name and kind under different keys are one card too. Each source keeps its own day.
 */
import { describe, expect, it } from 'vitest';
import { parseScheduleTask } from '../../../../../../../../sync-contract/schemas/schedule-task.zod';
import { shownDayOfStored, type DayCardsDetail } from '../../dayCards/dayCardsTypes';
import { groupSameWork } from '../sameWork';

const task = (taskKey: string, name: string, from: number, kind = 'work') => {
    const r = parseScheduleTask({ taskKey, name, kind, basis: 'stated', timing: { timer: 'day', fromDay: from, toDay: from, repeat: 'once' }, sources: [{ document: 'पुस्तिका' }] });
    if (!r.ok) throw new Error(r.error);
    return r.value;
};
const detail = (id: string, name: string, checked: boolean, tasks: ReturnType<typeof task>[]): DayCardsDetail => ({
    templateId: id, chainId: null, version: 1, contentHash: 'h' + id, kind: 'reference', name, cropKey: 'grape', madeBy: { ownerType: null, label: null },
    check: { state: checked ? 'Checked' : 'NotChecked', isChecked: checked, checkedBy: null, checkedAtUtc: null }, stages: [],
    tasks: tasks.map(t => ({ task: t, contentHash: 'x', shown: { from: shownDayOfStored(t.timing.fromDay), to: shownDayOfStored(t.timing.toDay), expectedFrom: null, expectedTo: null, repeatEnd: null }, doseChecked: checked })),
    challenges: [], skipped: 0,
});

describe('groupSameWork', () => {
    it('joins the same key of two versions into one group with two sources, each with its own day', () => {
        const a = detail('A', 'संस्था', true, [task('prune', 'छाटणी', 0), task('only-a', 'फक्त अ', 3)]);
        const b = detail('B', 'तज्ज्ञ', false, [task('prune', 'छाटणी', 2)]);
        const groups = groupSameWork([a, b]);
        expect(groups).toHaveLength(1);
        expect(groups[0].key).toBe('prune');
        expect(groups[0].sources.map(s => [s.versionId, s.storedDay, s.checked])).toEqual([['A', 0, true], ['B', 2, false]]);
    });
    it('joins works with the same name and kind under different keys', () => {
        const a = detail('A', 'a', true, [task('k1', 'पाणी देणे', 5, 'irrigation')]);
        const b = detail('B', 'b', true, [task('k2', ' पाणी देणे ', 6, 'irrigation')]);
        expect(groupSameWork([a, b])[0].sources.map(s => s.task.taskKey)).toEqual(['k1', 'k2']);
    });
    it('does not join the same name of another kind, and keeps no single-source group', () => {
        const a = detail('A', 'a', true, [task('k1', 'काम', 5, 'work')]);
        const b = detail('B', 'b', true, [task('k2', 'काम', 5, 'spray')]);
        expect(groupSameWork([a, b])).toEqual([]);
    });
    it('one version alone gives no group', () => {
        expect(groupSameWork([detail('A', 'a', true, [task('x', 'y', 1)])])).toEqual([]);
    });
});
