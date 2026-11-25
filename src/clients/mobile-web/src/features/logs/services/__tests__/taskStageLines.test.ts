/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 12, "ShramSathi asks from the schedule") - the stage questions read from the task the plot follows or owns.
 * Phone half of the proofs: askOnlyWithSource, ownExperienceIsLabelled, shownDayNotShiftedTwice (the server half is SathiAsksFromScheduleRealPostgresTests).
 */
import { describe, expect, it } from 'vitest';
import { parseScheduleTask, type ScheduleTaskContent } from '../../../../../../../../sync-contract/schemas/schedule-task.zod';
import type { DayCardsDetail } from '../../../scheduler/dayCards/dayCardsTypes';
import { NO_TASK_FORMAT, OWN_EXPERIENCE_LABEL_MR, taskStageLines } from '../taskStageLines';

const task = (over: Record<string, unknown>): ScheduleTaskContent => {
    const r = parseScheduleTask({
        taskKey: 't-look', name: 'कळी तपासणी', kind: 'observe', basis: 'stated', stageIndex: 0, order: 0,
        timing: { timer: 'day', fromDay: 40, toDay: 40, repeat: 'once' },
        look: { sign: 'कळ्या फुटलेल्या दिसतात' }, ...over,
    });
    if (!r.ok) throw new Error(r.error);
    return r.value;
};

const BOOK = [{ document: 'gap-table-grapes-2013', page: '19' }];

const reference = (tasks: ScheduleTaskContent[]): DayCardsDetail => ({
    templateId: '11111111-1111-4111-8111-111111111111', chainId: null, version: 1, contentHash: 'h', kind: 'reference', name: 'द्राक्ष', cropKey: 'grape',
    madeBy: { ownerType: 'INSTITUTION', label: null }, check: { state: 'Checked', isChecked: true, checkedBy: null, checkedAtUtc: null },
    stages: [], challenges: [], skipped: 0,
    tasks: tasks.map(t => ({ task: t, contentHash: 'x', shown: { from: null, to: null, expectedFrom: null, expectedTo: null, repeatEnd: null }, doseChecked: true })),
});

const ask = (reftasks: ScheduleTaskContent[], own: ScheduleTaskContent[], shownDay = 41) =>
    taskStageLines({ reference: reftasks.length ? reference(reftasks) : null, ownWorks: own.map(t => ({ task: t, state: 'active' as const })), shownDay });

describe('askOnlyWithSource', () => {
    it('a reference task that names no source document is never asked', () => {
        expect(ask([task({ sources: [] })], []).lines).toEqual([]);
        // a blank document cannot even be read as a task by this phone (the schema refuses it), so it is never asked either
        expect(parseScheduleTask({ taskKey: 'x', name: 'x', kind: 'observe', basis: 'stated', timing: { timer: 'none', repeat: 'once' }, sources: [{ document: '  ', page: '3' }] }).ok).toBe(false);
    });

    it('a reference task that is our own choice or an assumption is not asked, even with a document beside it', () => {
        expect(ask([task({ basis: 'our_choice', sources: BOOK })], []).lines).toEqual([]);
        expect(ask([task({ basis: 'assumed', sources: BOOK })], []).lines).toEqual([]);
    });

    it('a reference task with a source is asked, and the line shows the document and the page in Devanagari digits', () => {
        const [line] = ask([task({ sources: BOOK })], []).lines;
        expect(line.lineId).toBe('task:t-look:look');
        expect(line.sourceLabelMr).toBe('स्रोत: gap-table-grapes-2013, पान १९');
        expect(line.askMr).toBe('कळ्या फुटलेल्या दिसतात — दिसलं का?');
        expect(line.takesSignEvent).toBe(false); // a reference task is not an own work: no task event can be written for it
    });

    it('the look and the ask are two questions of their own', () => {
        const both = task({ sources: BOOK, ask: { question: 'फुटवा किती दिसतो?', answers: [] } });
        expect(ask([both], []).lines.map(l => [l.lineId, l.part])).toEqual([['task:t-look:ask', 'ask'], ['task:t-look:look', 'look']]);
        expect(ask([both], []).lines.find(l => l.part === 'ask')?.askMr).toBe('फुटवा किती दिसतो?');
    });

    it('a task with no sign to look for and no question has nothing to ask', () => {
        expect(ask([task({ sources: BOOK, look: { where: 'द्राक्षवेल' } })], []).lines).toEqual([]);
    });

    it('a plot with neither a task-format schedule nor a work of its own has no task format: the embedded json stays its fallback', () => {
        expect(ask([], [])).toBe(NO_TASK_FORMAT);
        expect(ask([], []).hasTaskFormat).toBe(false);
    });

    it('a plot that follows a task-format schedule uses it even on a day with no question (the json is then never used)', () => {
        const none = ask([task({ sources: BOOK })], [], 7);
        expect(none.hasTaskFormat).toBe(true);
        expect(none.lines).toEqual([]);
    });
});

describe('ownExperienceIsLabelled', () => {
    it('a hand-made work with no document is asked and says it is his own experience, never a book, an institution or ShramSafal', () => {
        const mine = task({ taskKey: 'mine', basis: 'experience', sources: [] });
        const [line] = ask([], [mine]).lines;
        expect(line.sourceLabelMr).toBe(OWN_EXPERIENCE_LABEL_MR);
        expect(line.sourceLabelMr).toBe('स्रोत: तुमचा अनुभव');
        expect(line.sourceLabelMr).not.toMatch(/श्रमसफल|ShramSafal|gap-|ICAR/i);
        expect(line.kind).toBe('own-by-hand');
    });

    it('a hand-made work that is not written as experience, and has no document, is not asked', () => {
        expect(ask([], [task({ taskKey: 'mine', basis: 'stated', sources: [] })]).lines).toEqual([]);
    });

    it('a taken work keeps the source of its origin and is not relabelled as his own experience', () => {
        const taken = task({ taskKey: 't-look', basis: 'stated', sources: BOOK, origin: 'take:0123456789abcdef0123456789abcdef' });
        const [line] = ask([task({ sources: BOOK })], [taken]).lines;
        expect(line.kind).toBe('own-taken');
        expect(line.sourceLabelMr).toBe('स्रोत: gap-table-grapes-2013, पान १९');
        expect(line.sourceLabelMr).not.toBe(OWN_EXPERIENCE_LABEL_MR);
    });

    it('a taken work whose origin names no document is not asked (and is not called his experience)', () => {
        const taken = task({ taskKey: 't-look', basis: 'experience', sources: [], origin: 'take:0123456789abcdef0123456789abcdef' });
        expect(ask([], [taken]).lines).toEqual([]);
    });

    it('his own copy wins over the reference task of the same key (he owns it)', () => {
        const taken = task({ taskKey: 't-look', basis: 'stated', sources: BOOK, origin: 'take:0123456789abcdef0123456789abcdef' });
        expect(ask([task({ sources: BOOK })], [taken]).lines.map(l => l.kind)).toEqual(['own-taken']);
    });

    it('a removed own work is not asked', () => {
        const mine = task({ taskKey: 'mine', basis: 'experience', sources: [] });
        const result = taskStageLines({ reference: null, ownWorks: [{ task: mine, state: 'removed' }], shownDay: 41 });
        expect(result).toBe(NO_TASK_FORMAT);
    });

    it('only an own work that waits for a sign takes a task event', () => {
        const sign = task({ taskKey: 'flower', basis: 'experience', timing: { timer: 'sign', signWords: 'फुलोरा', expectedFromDay: 38, expectedToDay: 44, repeat: 'once' } });
        const [line] = ask([], [sign], 41).lines;
        expect(line.takesSignEvent).toBe(true);
        expect(ask([], [task({ taskKey: 'mine', basis: 'experience' })], 41).lines[0].takesSignEvent).toBe(false);
    });
});

describe('shownDayNotShiftedTwice', () => {
    const stored40 = task({ sources: BOOK, timing: { timer: 'day', fromDay: 40, toDay: 40, repeat: 'once' } });

    it('a task stored at day 40 (shown 41) is asked on shown day 41, never on 40 or 42', () => {
        expect(ask([stored40], [], 41).lines).toHaveLength(1);
        expect(ask([stored40], [], 40).lines).toEqual([]);
        expect(ask([stored40], [], 42).lines).toEqual([]);
    });

    it('a task stored at day 0 (the start day, shown 1) is asked on shown day 1, never on 0 or 2', () => {
        const start = task({ sources: BOOK, timing: { timer: 'day', fromDay: 0, toDay: 0, repeat: 'once' } });
        expect(ask([start], [], 1).lines).toHaveLength(1);
        expect(ask([start], [], 0).lines).toEqual([]);
        expect(ask([start], [], 2).lines).toEqual([]);
    });

    it('a window is read as stored days: a window of 40 to 42 is asked on shown days 41, 42 and 43 and no other', () => {
        const wide = task({ sources: BOOK, timing: { timer: 'day', fromDay: 40, toDay: 42, repeat: 'once' } });
        expect([40, 41, 42, 43, 44].filter(d => ask([wide], [], d).lines.length > 0)).toEqual([41, 42, 43]);
    });

    it('a sign task is asked only inside the window the sign is expected in, in stored days', () => {
        const sign = task({ sources: BOOK, timing: { timer: 'sign', signWords: 'फुलोरा', expectedFromDay: 38, expectedToDay: 44, repeat: 'once' } });
        expect([38, 39, 40, 45, 46].filter(d => ask([sign], [], d).lines.length > 0)).toEqual([39, 40, 45]);
    });

    it('a task with no day (after another work, none yet, a sign with no expected window) is never given one', () => {
        const noDay = task({ sources: BOOK, timing: { timer: 'none', repeat: 'once' } });
        const bareSign = task({ taskKey: 'bare', sources: BOOK, timing: { timer: 'sign', signWords: 'फुलोरा', repeat: 'once' } });
        for (const d of [1, 41, 90]) {
            expect(ask([noDay, bareSign], [], d).lines).toEqual([]);
        }
    });
});
