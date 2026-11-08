/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-3 fix round 1, L001; founder D-24d) - the rule that bounds the task
 * reference to the visit its door opened: the home tabs, the log view, the farm the door was tapped on; and a saved log counts for
 * the task only when it was made after the door was tapped.
 */
import { describe, expect, it } from 'vitest';
import { savedForTask, taskReferenceHolds, type CompletingTask } from '../doneFlow/completingTask';

const task: CompletingTask = {
    plannedWorkId: 't1', farmId: 'farm-a', title: 'युरिया', plotIds: ['p1'], savedAtStart: null, openedAtISO: '2026-11-09T06:00:00.000Z',
};
const visit = { route: 'main', mainView: 'log', farmId: 'farm-a' };

describe('taskReferenceHolds - the visit the door opened', () => {
    it('holds on the log view of the home tabs, on the same farm', () => {
        expect(taskReferenceHolds(task, visit)).toBe(true);
    });

    it('does not hold on another tab, another screen, another farm, or with no task', () => {
        expect(taskReferenceHolds(task, { ...visit, mainView: 'reflect' })).toBe(false);
        expect(taskReferenceHolds(task, { ...visit, mainView: 'compare' })).toBe(false);
        expect(taskReferenceHolds(task, { ...visit, route: 'settings' })).toBe(false);
        expect(taskReferenceHolds(task, { ...visit, route: 'plan-work' })).toBe(false);
        expect(taskReferenceHolds(task, { ...visit, farmId: 'farm-b' })).toBe(false);
        expect(taskReferenceHolds(task, { ...visit, farmId: null })).toBe(false);
        expect(taskReferenceHolds(null, visit)).toBe(false);
    });
});

describe('savedForTask - only a recording made after the door counts', () => {
    const made = (id: string, createdAtISO?: string) => ({ id, meta: createdAtISO ? { createdAtISO } : undefined });

    it('keeps the logs made after the door, drops the older ones', () => {
        const history = [made('new', '2026-11-09T06:05:00.000Z'), made('old', '2026-11-08T06:00:00.000Z')];
        expect(savedForTask(task, ['new', 'old'], history)).toEqual(['new']);
        expect(savedForTask(task, ['old'], history)).toEqual([]);
    });

    it('a log this phone cannot read yet is taken as new (the save writes the history first, so this is only a gap)', () => {
        expect(savedForTask(task, ['x'], [])).toEqual(['x']);
        expect(savedForTask(task, ['y'], [made('y')])).toEqual(['y']);
    });
});
