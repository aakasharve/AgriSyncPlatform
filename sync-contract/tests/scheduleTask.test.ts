// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 2, "Task format and three timers"; approved spec plr-d10-schedule-approved-spec-2026-11-23)
// The phone's half of the task-format contract: types and a parser only. The fixture is the text the SERVER writes (its own test, ScheduleTaskContractFixtureTests, proves the
// file equals the server's canonical JSON), so a field added on one side and not the other fails one of the two tests.
import { describe, expect, it } from 'vitest';
import fixture from './fixtures/schedule-task.contract.json';
import {
    parseScheduleChallenge,
    parseScheduleChallengesLenient,
    parseScheduleTask,
    parseScheduleTasksLenient,
    SCHEDULE_BASES,
    SCHEDULE_REPEATS,
    SCHEDULE_TASK_KINDS,
    SCHEDULE_TIMERS,
} from '../schemas/schedule-task.zod';

const tasks = fixture.tasks as Array<Record<string, unknown>>;
const challenges = fixture.challenges as Array<Record<string, unknown>>;
const task = (key: string) => tasks.find((t) => t.taskKey === key)!;
const withTiming = (key: string, patch: Record<string, unknown>) => ({ ...task(key), timing: { ...(task(key).timing as object), ...patch } });

describe('the task format, as the phone reads what the server writes', () => {
    it('parses every task and challenge of the server fixture, and loses no key', () => {
        for (const raw of tasks) {
            const parsed = parseScheduleTask(raw);
            expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
            // Nothing the server wrote is dropped on the way in: the parsed task, written out again, is the fixture.
            if (parsed.ok) expect(parsed.value).toEqual(raw);
        }
        for (const raw of challenges) {
            const parsed = parseScheduleChallenge(raw);
            expect(parsed.ok, JSON.stringify(parsed)).toBe(true);
            if (parsed.ok) expect(parsed.value).toEqual(raw);
        }
    });

    it('names the same words the server writes: five kinds, four bases, four timers, three repeats', () => {
        expect(SCHEDULE_TASK_KINDS).toEqual(['irrigation', 'nutrition', 'spray', 'work', 'observe']);
        expect(SCHEDULE_BASES).toEqual(['stated', 'our_choice', 'experience', 'assumed']);
        expect(SCHEDULE_TIMERS).toEqual(['none', 'day', 'after', 'sign']);
        expect(SCHEDULE_REPEATS).toEqual(['once', 'every_n_days', 'per_week']);
        expect(new Set(tasks.map((t) => (t.timing as { timer: string }).timer))).toEqual(new Set(SCHEDULE_TIMERS));
        expect(new Set(tasks.map((t) => t.kind))).toEqual(new Set(['spray', 'observe', 'nutrition', 'irrigation', 'work']));
    });

    it('keeps a negative day: a work before the start day is valid', () => {
        const parsed = parseScheduleTask(task('before-start'));
        expect(parsed.ok).toBe(true);
        if (parsed.ok) {
            expect(parsed.value.timing.fromDay).toBe(-20);
            expect(parsed.value.timing.toDay).toBe(-18);
        }
    });

    it('a day window keeps both ends, and an open end stays open', () => {
        const window = parseScheduleTask(task('spray-one'));
        const open = parseScheduleTask(task('open-end'));
        expect(window.ok && window.value.timing).toMatchObject({ timer: 'day', fromDay: 35, toDay: 50 });
        expect(open.ok && open.value.timing).toMatchObject({ timer: 'day', fromDay: 60, toDay: null });
    });

    it('a dayless task stays dayless: no timer, never a sample with a date', () => {
        const parsed = parseScheduleTask(task('water-one'));
        expect(parsed.ok && parsed.value.timing).toMatchObject({ timer: 'none', fromDay: null, toDay: null, afterTaskKey: null, signWords: null });
    });

    it('"after" is held by key and keeps its days; a sign keeps its words and its expected window', () => {
        const after = parseScheduleTask(task('spray-two'));
        const sign = parseScheduleTask(task('seen-one'));
        expect(after.ok && after.value.timing).toMatchObject({ timer: 'after', afterTaskKey: 'spray-one', usualDays: 4, earliestDays: 3, latestDays: 9 });
        expect(sign.ok && sign.value.timing).toMatchObject({ timer: 'sign', signWords: 'पाकळ्या फुगलेल्या दिसल्यावर', expectedFromDay: -5, expectedToDay: 9 });
    });

    it('an absent optional part never refuses a task (P9): only key, name, kind, timing and basis are required', () => {
        const bare = { taskKey: 'bare', name: 'पाणी', kind: 'irrigation', timing: { timer: 'none' }, basis: 'assumed' };
        const parsed = parseScheduleTask(bare);
        expect(parsed.ok).toBe(true);
        if (parsed.ok) {
            expect(parsed.value.steps).toEqual([]);
            expect(parsed.value.products).toEqual([]);
            expect(parsed.value.sources).toEqual([]);
            expect(parsed.value.look).toBeNull();
            expect(parsed.value.ask).toBeNull();
            expect(parsed.value.timing.repeat).toBe('once');
        }
    });
});

describe('a task that holds two timers, or a timer that does not hold together, is refused', () => {
    it.each([
        ['a day and a sign', withTiming('spray-one', { signWords: 'फुलोरा' })],
        ['a day and an after', withTiming('spray-one', { afterTaskKey: 'x' })],
        ['no timer yet with a day', withTiming('water-one', { fromDay: 1 })],
        ['a sign with a usual day', withTiming('seen-one', { usualDays: 3 })],
        ['a window that ends before it starts', withTiming('spray-one', { fromDay: 5, toDay: 4 })],
        ['a day timer with no first day', withTiming('spray-one', { fromDay: null })],
        ['an after with no key', withTiming('spray-two', { afterTaskKey: null })],
        ['an after whose earliest is after its latest', withTiming('spray-two', { earliestDays: 9, latestDays: 3 })],
        ['a sign with no words', withTiming('seen-one', { signWords: null })],
        ['an expected end with no start', withTiming('seen-one', { expectedFromDay: null })],
        ['a once-only work with an interval', withTiming('open-end', { repeatInterval: 3 })],
        ['a repeat with no number', withTiming('spray-one', { repeatInterval: null })],
        ['per week above 7', withTiming('spray-two', { repeatInterval: 8 })],
        ['two ends of one repeat', withTiming('spray-one', { repeatEndSign: 'फळे पक्व' })],
        ['a day far beyond 3650', withTiming('spray-one', { fromDay: 4000 })],
    ])('refuses %s', (_name, raw) => {
        expect(parseScheduleTask(raw).ok).toBe(false);
    });

    it('refuses an unknown kind, an unknown timer and a blank name or key', () => {
        expect(parseScheduleTask({ ...task('spray-one'), kind: 'harvest' }).ok).toBe(false);
        expect(parseScheduleTask(withTiming('spray-one', { timer: 'weather' })).ok).toBe(false);
        expect(parseScheduleTask({ ...task('spray-one'), name: '   ' }).ok).toBe(false);
        expect(parseScheduleTask({ ...task('spray-one'), taskKey: 'has space' }).ok).toBe(false);
        expect(parseScheduleTask({ ...task('spray-one'), basis: 'guess' }).ok).toBe(false);
        expect(parseScheduleTask(null).ok).toBe(false);
        expect(parseScheduleTask('x').ok).toBe(false);
    });

    it('never throws on garbage, and says where it failed', () => {
        for (const garbage of [undefined, 1, [], {}, { taskKey: 5 }]) {
            const parsed = parseScheduleTask(garbage);
            expect(parsed.ok).toBe(false);
            if (!parsed.ok) expect(parsed.error.length).toBeGreaterThan(0);
        }
    });
});

describe('the lenient list parser: an unreadable task is skipped and counted, the others still show', () => {
    it('keeps the readable ones and counts the rest', () => {
        const mixed = [task('spray-one'), { ...task('seen-one'), kind: 'a-kind-a-newer-server-added' }, task('before-start'), { nonsense: true }];

        const result = parseScheduleTasksLenient(mixed);

        expect(result.tasks.map((t) => t.taskKey)).toEqual(['spray-one', 'before-start']);
        expect(result.skipped).toBe(2);
    });

    it('reads a missing or non-list value as no tasks (an old server sends none), and ignores a key a newer server adds', () => {
        expect(parseScheduleTasksLenient(undefined)).toEqual({ tasks: [], skipped: 0 });
        expect(parseScheduleTasksLenient(null)).toEqual({ tasks: [], skipped: 0 });
        expect(parseScheduleTasksLenient({})).toEqual({ tasks: [], skipped: 0 });
        expect(parseScheduleChallengesLenient('x')).toEqual({ challenges: [], skipped: 0 });

        const withNewKey = parseScheduleTask({ ...task('spray-one'), aKeyFromTheFuture: 1 });
        expect(withNewKey.ok).toBe(true);
        if (withNewKey.ok) expect('aKeyFromTheFuture' in withNewKey.value).toBe(false);
    });

    it('counts unreadable challenges the same way', () => {
        const result = parseScheduleChallengesLenient([challenges[0], { ...challenges[1], challengeKey: '' }]);
        expect(result.challenges.map((c) => c.challengeKey)).toEqual(['mildew']);
        expect(result.skipped).toBe(1);
    });
});
