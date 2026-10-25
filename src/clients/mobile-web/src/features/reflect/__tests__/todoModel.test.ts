/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I6)
 *
 * करायची कामे — the real planned tasks (the task store + the tasks carried by the chosen day's logs; a
 * spoken or written reminder reaches this list as an `observation_derived` task) as ONE to-do list read by
 * time: late → today → later → no date → done.
 */
import { describe, expect, it } from 'vitest';
import { buildTodoList, mergeTasks, toggledTask } from '../overview/todoModel';
import { pickCrop, selectAll, toViewScope } from '../overview/reflectSelection';
import { CROPS, TODAY_KEY, task } from './reflectFixtures';

const all = toViewScope(CROPS, selectAll(CROPS));
const build = (tasks: ReturnType<typeof task>[], scope = all, wholeFarm = true) =>
    buildTodoList({ tasks, storeIds: new Set(tasks.map(t => t.id)), crops: CROPS, scope, wholeFarm, todayKey: TODAY_KEY });

describe('buildTodoList', () => {
    it('reads by time: late, today, later (soonest first), no date, then done', () => {
        const list = build([
            task('later2', 'खताचा दुसरा हप्ता', { dueDate: '2026-10-28' }),
            task('late', 'पाणी द्यायचं', { dueDate: '2026-10-23' }),
            task('today', 'फवारणी', { dueDate: TODAY_KEY }),
            task('later1', 'विद्राव्य खत', { dueDate: '2026-10-26' }),
            task('nodate', 'नळी तपासायची'),
            task('done', 'बांधणी', { dueDate: '2026-10-22', status: 'done' }),
            task('cancel', 'जुनं काम', { status: 'cancelled' }),
        ]);
        expect(list.late.map(t => t.id)).toEqual(['late']);
        expect(list.today.map(t => t.id)).toEqual(['today']);
        expect(list.later.map(t => t.id)).toEqual(['later1', 'later2']);
        expect(list.noDate.map(t => t.id)).toEqual(['nodate']);
        expect(list.done.map(t => t.id)).toEqual(['done', 'cancel']);
        expect(list.openCount).toBe(5);
        expect(list.total).toBe(7);
    });

    it('says when, in words — never a made-up date', () => {
        const list = build([
            task('late', 'a', { dueDate: '2026-10-23' }),
            task('today', 'b', { dueDate: TODAY_KEY }),
            task('tomorrow', 'c', { dueDate: '2026-10-26' }),
            task('later', 'd', { dueDate: '2026-10-29' }),
            task('nodate', 'e'),
            task('cancel', 'f', { status: 'cancelled' }),
        ]);
        expect(list.late[0].dueText).toBe('2 दिवस उशीर');
        expect(list.today[0].dueText).toBe('आज');
        expect(list.later[0].dueText).toBe('उद्या');
        expect(list.later[1].dueText).toBe('गुरुवार, 29 ऑक्टो');
        expect(list.noDate[0].dueText).toBe('तारीख नाही');
        expect(list.done[0].dueText).toBe('रद्द');
    });

    it('marks urgency, kind and where it came from', () => {
        const list = build([
            task('u', 'a', { priority: 'urgent', dueDate: TODAY_KEY }),
            task('h', 'b', { priority: 'high', dueDate: TODAY_KEY }),
            task('r', 'c', { sourceType: 'observation_derived', dueDate: TODAY_KEY }),
            task('s', 'd', { sourceType: 'schedule', dueDate: TODAY_KEY }),
        ]);
        const byId = Object.fromEntries(list.today.map(t => [t.id, t]));
        expect(byId.u.priorityLabel).toBe('तातडीचं');
        expect(byId.h.priorityLabel).toBe('महत्त्वाचं');
        expect(byId.s.priorityLabel).toBeUndefined();
        expect(byId.r.kindLabel).toBe('आठवण');
        expect(byId.s.kindLabel).toBe('काम');
        expect(byId.s.fromLabel).toBe('शेड्यूलमधून');
    });

    it('names the place: plot · crop with the crop colour, or the whole farm', () => {
        const list = build([
            task('p', 'a', { plotId: 'g2', cropId: 'grape' }),
            task('f', 'b', { plotId: 'FARM_GLOBAL', cropId: 'FARM_GLOBAL' }),
        ]);
        const byId = Object.fromEntries(list.noDate.map(t => [t.id, t]));
        expect(byId.p.place).toEqual({ label: 'थॉम्पसन · द्राक्ष', color: 'bg-purple-500' });
        expect(byId.f.place).toEqual({ label: 'पूर्ण शेत' });
    });

    it('a narrowed view keeps whole-farm to-dos and hides other crops\' plots', () => {
        const cane = toViewScope(CROPS, pickCrop(CROPS, 'cane'));
        const list = build([
            task('g', 'grape work', { plotId: 'g1', cropId: 'grape' }),
            task('c', 'cane work', { plotId: 'c1', cropId: 'cane' }),
            task('f', 'farm work', { plotId: 'FARM_GLOBAL', cropId: 'FARM_GLOBAL' }),
        ], cane, false);
        expect(list.noDate.map(t => t.id)).toEqual(['c', 'f']);
    });

    it('only a task the task store holds can be ticked from here (ticking any other one would change nothing)', () => {
        const list = buildTodoList({
            tasks: [task('stored', 'a'), task('logOnly', 'b')],
            storeIds: new Set(['stored']),
            crops: CROPS, scope: all, wholeFarm: true, todayKey: TODAY_KEY,
        });
        const byId = Object.fromEntries(list.noDate.map(t => [t.id, t]));
        expect(byId.stored.canToggle).toBe(true);
        expect(byId.logOnly.canToggle).toBe(false);
    });
});

describe('mergeTasks', () => {
    it('the task store wins over a stale copy carried inside a log (a tick done in the store must not be undone on screen)', () => {
        const merged = mergeTasks([task('t', 'a', { status: 'done' })], [task('t', 'a', { status: 'pending' }), task('x', 'b')]);
        expect(merged.map(t => [t.id, t.status])).toEqual([['t', 'done'], ['x', 'pending']]);
    });
});

describe('toggledTask', () => {
    it('pending → done with the time; done → pending without it', () => {
        const now = new Date('2026-10-25T06:30:00.000Z');
        const done = toggledTask(task('t', 'a'), now);
        expect(done).toMatchObject({ id: 't', status: 'done', completedAt: '2026-10-25T06:30:00.000Z' });
        const undone = toggledTask(done, now);
        expect(undone.status).toBe('pending');
        expect(undone.completedAt).toBeUndefined();
    });
});
