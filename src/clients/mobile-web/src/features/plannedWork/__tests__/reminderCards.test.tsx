// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane REM-1 Task 5; founder D-78, D-79, D-84 = 1; R14-R16) - the reminder list and its cards, on the real
 * `TodoSection` and `buildTodoList`:
 *   - the chips (सगळ्या · नियोजनातून · शेड्यूलमधून · नोंदीतून) filter the list, with their counts;
 *   - each card says who made it and when ("‹नाव› · ‹तारीख›, ‹वेळ›", farm time, Devanagari digits in Marathi mode) and where it came from
 *     ("बोलण्यातून — G1ची नोंद", "अर्धवट राहिलेलं");
 *   - "ऐका" only when the server says he may hear the source voice; the ShramSafal-rule line when a voice exists that he may not hear; nothing when
 *     there is no voice;
 *   - money words withheld: the rule card, no words;
 *   - the marked maker's line and the chosen-people line (D-84 = 1);
 *   - one tap on "काढा" hides the row, says "आठवण काढली · परत आणा" and sends the removal only when the way back has passed; "परत आणा" sends nothing;
 *   - Marathi mode shows only Marathi, English mode only English.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { PlannedTask } from '../../../types';

const h = vi.hoisted(() => ({ language: 'mr' as 'mr' | 'en' }));
vi.mock('../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: h.language, setLanguage: () => {}, t: (k: string) => k }),
    useOptionalLanguage: () => ({ language: h.language }),
}));
// The original-voice door is its own tested component (it asks the server for the voice); here only its presence and its label matter.
vi.mock('../../logs/components/originalVoice/OriginalVoiceButton', () => ({
    default: ({ dailyLogId, farmId, playLabel }: { dailyLogId: string; farmId: string; playLabel?: string }) => (
        <button type="button" data-testid={`ov-play-${dailyLogId}`} data-farm={farmId}>{playLabel ?? 'play'}</button>
    ),
}));

import { TodoSection, REMOVE_UNDO_MS } from '../../reflect/overview/TodoSection';
import { buildTodoList, tickableIds } from '../../reflect/overview/todoModel';
import { chipCounts, chipOf, matchesChip, reminderLines, whenText } from '../reminders/reminderModel';
import { plannedWorkWords } from '../plannedWorkWords';

afterEach(() => { cleanup(); vi.useRealTimers(); });
beforeEach(() => { h.language = 'mr'; });

const LOG = '66666666-6666-4666-8666-666666666661';
type Reminder = NonNullable<NonNullable<PlannedTask['listSource']>['reminder']>;

const reminder = (over: Partial<Reminder> = {}): Reminder => ({
    category: 'FromLogs', kind: 'Spoken', createdByUserId: 'u-raju', createdByName: 'राजू', createdAtUtc: '2026-11-08T05:45:00.000Z',
    sourceDailyLogId: LOG, mayPlayVoice: null, wordsWithheld: false, makerAlwaysShown: false, fromChosenPeopleRecord: false, ...over,
});

const task = (id: string, title: string, r: Reminder | null, over: Partial<PlannedTask> = {}): PlannedTask => ({
    id, title, plotId: 'FARM_GLOBAL', cropId: 'FARM_GLOBAL', priority: 'normal', status: 'pending',
    sourceType: r?.kind === 'Spoken' ? 'ai_extracted' : r?.kind === 'Leftover' ? 'observation_derived' : 'manual', createdAt: '2026-11-08',
    listSource: { scope: 'Unspecified', tickable: true, keptOnPhone: false, farmId: '55555555-5555-4555-8555-555555555551', ...(r ? { reminder: r } : {}) }, ...over,
} as PlannedTask);

const spoken = task('t-spoken', 'पाईप बघायचा', reminder());
const leftover = task('t-left', 'फवारणी', reminder({ kind: 'Leftover' }));
const planning = task('t-plan', 'खत आणायचं', reminder({ category: 'FromPlanning', kind: 'Typed', sourceDailyLogId: null, createdByName: 'सीमा' }));
const schedule = task('t-sched', 'छाटणी', reminder({ category: 'FromSchedule', kind: null, sourceDailyLogId: null, createdByName: null, createdAtUtc: null }));

const drawList = (tasks: PlannedTask[], onRemove = vi.fn()) => {
    const list = buildTodoList({ tasks, storeIds: tickableIds(tasks), crops: [], scope: { viewCrops: [], viewPlots: {} }, wholeFarm: true, todayKey: '2026-11-08' });
    render(<TodoSection list={list} onToggle={vi.fn()} onRemove={onRemove} />);
    return onRemove;
};

describe('the chips (D-79: three sources, shown clearly)', () => {
    it('sorts each task by its source and counts them', () => {
        expect([spoken, leftover, planning, schedule].map(chipOf)).toEqual(['logs', 'logs', 'planning', 'schedule']);
        expect(chipCounts([spoken, leftover, planning, schedule])).toEqual({ all: 4, planning: 1, schedule: 1, logs: 2 });
        expect(matchesChip(spoken, 'all')).toBe(true);
        expect(matchesChip(spoken, 'planning')).toBe(false);
    });

    it('a task of the demo list has no category: its old source words sort it', () => {
        const old = { id: 'd', title: 'x', plotId: 'p', cropId: 'c', priority: 'normal', status: 'pending', sourceType: 'schedule', createdAt: '' } as PlannedTask;
        expect(chipOf(old)).toBe('schedule');
        expect(chipOf({ ...old, sourceType: 'ai_extracted' } as PlannedTask)).toBe('logs');
        expect(chipOf({ ...old, sourceType: 'manual' } as PlannedTask)).toBe('planning');
    });

    it('one tap on a chip shows only that source, the counts stay, and सगळ्या brings everything back', () => {
        drawList([spoken, leftover, planning, schedule]);
        const chips = screen.getByTestId('reminder-chips');
        for (const [chip, label] of [['all', 'सगळ्या'], ['planning', 'नियोजनातून'], ['schedule', 'शेड्यूलमधून'], ['logs', 'नोंदीतून']]) {
            expect(within(chips).getByTestId(`reminder-chips-${chip}`)).toHaveTextContent(label);
        }

        expect(within(chips).getByTestId('reminder-chips-logs')).toHaveTextContent('(२)');
        expect(screen.getByTestId('todo-row-t-spoken')).toBeInTheDocument();
        expect(screen.getByTestId('todo-row-t-plan')).toBeInTheDocument();

        fireEvent.click(within(chips).getByTestId('reminder-chips-logs'));
        expect(screen.getByTestId('todo-row-t-spoken')).toBeInTheDocument();
        expect(screen.getByTestId('todo-row-t-left')).toBeInTheDocument();
        expect(screen.queryByTestId('todo-row-t-plan')).toBeNull();
        expect(screen.queryByTestId('todo-row-t-sched')).toBeNull();
        expect(within(chips).getByTestId('reminder-chips-logs')).toHaveAttribute('aria-pressed', 'true');
        expect(within(chips).getByTestId('reminder-chips-planning')).toHaveTextContent('(१)');

        fireEvent.click(within(chips).getByTestId('reminder-chips-planning'));
        expect(screen.getByTestId('todo-row-t-plan')).toBeInTheDocument();
        expect(screen.queryByTestId('todo-row-t-spoken')).toBeNull();

        fireEvent.click(within(chips).getByTestId('reminder-chips-schedule'));
        expect(screen.getByTestId('todo-row-t-sched')).toBeInTheDocument();

        fireEvent.click(within(chips).getByTestId('reminder-chips-all'));
        for (const id of ['t-spoken', 't-left', 't-plan', 't-sched']) expect(screen.getByTestId(`todo-row-${id}`)).toBeInTheDocument();
    });

    it('a chip with nothing in it says so instead of drawing an empty page', () => {
        drawList([spoken]);
        fireEvent.click(screen.getByTestId('reminder-chips-schedule'));
        expect(screen.getByTestId('todo-chip-empty')).toBeInTheDocument();
        expect(screen.queryByTestId('todo-row-t-spoken')).toBeNull();
    });
});

describe('a card says who made it, when, and where it came from', () => {
    it('Marathi: "‹नाव› · ‹तारीख›, ‹वेळ›" in farm time with Devanagari digits, and the source line', () => {
        drawList([spoken, leftover]);
        // 2026-11-08T05:45Z = 11:15 in India.
        const byline = screen.getByTestId('todo-byline-t-spoken').textContent ?? '';
        expect(byline.startsWith('राजू · ')).toBe(true);
        expect(byline).toContain('८');
        expect(byline).toContain('सकाळी ११:१५');
        expect(byline).not.toMatch(/[0-9A-Za-z]/);
        expect(screen.getByTestId('todo-source-t-spoken')).toHaveTextContent('बोलण्यातून');
        expect(screen.getByTestId('todo-source-t-left')).toHaveTextContent('अर्धवट राहिलेलं');
    });

    it('English: the same facts in English only', () => {
        h.language = 'en';
        drawList([spoken, leftover]);
        const byline = screen.getByTestId('todo-byline-t-spoken').textContent ?? '';
        expect(byline.startsWith('राजू · ')).toBe(true);
        expect(byline.slice('राजू · '.length)).not.toMatch(/[ऀ-ॿ]/);
        expect(byline).toMatch(/Nov/);
        expect(screen.getByTestId('todo-source-t-spoken')).toHaveTextContent('From speech');
        expect(screen.getByTestId('todo-source-t-left')).toHaveTextContent('Left unfinished');
    });

    it('says the plot of the record when it knows one, and nothing it was not told', () => {
        const words = plannedWorkWords('mr').reminders;
        expect(reminderLines(spoken, 'mr', 'G1 · द्राक्ष')!.sourceLine).toBe(words.fromSpoken('G1'));
        expect(words.fromSpoken('G1')).toBe('बोलण्यातून — G1ची नोंद');
        expect(reminderLines(spoken, 'mr')!.sourceLine).toBe('बोलण्यातून');
        const unnamed = reminderLines(task('x', 'y', reminder({ createdByName: null, createdAtUtc: null })), 'mr')!;
        expect(unnamed.byline).toBeNull();
        expect(whenText(null, 'mr')).toBe('');
        expect(whenText('not a date', 'mr')).toBe('');
        expect(reminderLines(task('d', 'demo', null), 'mr')).toBeNull();
    });
});

describe('"ऐका" and the voice rule (R15; the voice is never copied)', () => {
    it('shows "ऐका" only when the server says he may hear it, and asks the original-voice door for THAT log', () => {
        drawList([task('t-can', 'पाईप', reminder({ mayPlayVoice: true }))]);
        const button = within(screen.getByTestId('todo-listen-t-can')).getByTestId(`ov-play-${LOG}`);
        expect(button).toHaveTextContent('ऐका');
        expect(button).toHaveAttribute('data-farm', '55555555-5555-4555-8555-555555555551');
        expect(screen.queryByTestId('todo-voice-rule-t-can')).toBeNull();
    });

    it('a recording he may not hear: no button, the ShramSafal rule line instead', () => {
        drawList([task('t-no', 'पाईप', reminder({ mayPlayVoice: false }))]);
        expect(screen.queryByTestId('todo-listen-t-no')).toBeNull();
        expect(screen.getByTestId('todo-voice-rule-t-no')).toHaveTextContent('श्रमसफलच्या नियमानुसार हा आवाज तुम्हाला ऐकता येत नाही');
    });

    it('no recording to speak of: neither the button nor the rule line (P5, P4)', () => {
        drawList([task('t-none', 'पाईप', reminder({ mayPlayVoice: null }))]);
        expect(screen.queryByTestId('todo-listen-t-none')).toBeNull();
        expect(screen.queryByTestId('todo-voice-rule-t-none')).toBeNull();
        // And a typed reminder with no log at all.
        expect(reminderLines(planning, 'mr')!.voice).toBe('none');
    });

    it('the rule line in English is English only', () => {
        h.language = 'en';
        drawList([task('t-no', 'pipe', reminder({ mayPlayVoice: false }))]);
        expect(screen.getByTestId('todo-voice-rule-t-no')).toHaveTextContent("By ShramSafal's rule you cannot listen to this voice");
    });
});

describe('money words withheld (R16, D-66)', () => {
    it('shows the rule card and no words', () => {
        drawList([task('t-money', '', reminder({ wordsWithheld: true, mayPlayVoice: false }))]);
        expect(screen.getByTestId('todo-money-withheld-t-money')).toBeInTheDocument();
        expect(screen.queryByText('पाईप')).toBeNull();
        expect(screen.queryByTestId('todo-voice-rule-t-money')).toBeNull();
        expect(screen.queryByTestId('todo-listen-t-money')).toBeNull();
    });
});

describe('the two D-84 = 1 lines', () => {
    it('a marked maker\'s card reads that everyone on the plot sees it', () => {
        drawList([task('t-marked', 'पाईप', reminder({ makerAlwaysShown: true }))]);
        expect(screen.getByTestId('todo-marked-t-marked')).toHaveTextContent('मालकाच्या मांडणीनुसार ही आठवण या प्लॉटवरच्या सगळ्यांना दिसते.');
        expect(screen.queryByTestId('todo-chosen-t-marked')).toBeNull();
    });

    it('a reminder from a record kept for chosen people says it stays with them, and never claims the other line', () => {
        drawList([task('t-chosen', 'पाईप', reminder({ fromChosenPeopleRecord: true, makerAlwaysShown: true }))]);
        expect(screen.getByTestId('todo-chosen-t-chosen')).toHaveTextContent('निवडक लोकांसाठी ठेवलेल्या नोंदीतून आलेली आठवण — त्या नोंदीच्या लोकांपुरतीच राहते.');
        expect(screen.queryByTestId('todo-marked-t-chosen')).toBeNull();
    });

    it('English twins', () => {
        h.language = 'en';
        drawList([task('t-marked', 'pipe', reminder({ makerAlwaysShown: true })), task('t-chosen', 'pipe 2', reminder({ fromChosenPeopleRecord: true }))]);
        expect(screen.getByTestId('todo-marked-t-marked')).toHaveTextContent("By the owner's setting, everyone on this plot sees this reminder.");
        expect(screen.getByTestId('todo-chosen-t-chosen')).toHaveTextContent("A reminder from a record kept for chosen people stays with that record's people.");
    });
});

describe('"काढा": one tap, with the way back', () => {
    it('a spoken and a left-over reminder both have it; a typed one does not', () => {
        drawList([spoken, leftover, planning]);
        expect(screen.getByTestId('todo-remove-t-spoken')).toBeInTheDocument();
        expect(screen.getByTestId('todo-remove-t-left')).toBeInTheDocument();
        expect(screen.queryByTestId('todo-remove-t-plan')).toBeNull();
    });

    it('hides the row at once, says "आठवण काढली · परत आणा", and sends the removal only after the way back has passed', () => {
        vi.useFakeTimers();
        const onRemove = drawList([spoken, planning]);
        fireEvent.click(screen.getByTestId('todo-remove-t-spoken'));
        expect(screen.queryByTestId('todo-row-t-spoken')).toBeNull();
        expect(screen.getByTestId('todo-removed-toast')).toHaveTextContent('आठवण काढली');
        expect(screen.getByTestId('todo-undo-remove')).toHaveTextContent('परत आणा');
        expect(onRemove).not.toHaveBeenCalled();

        act(() => { vi.advanceTimersByTime(REMOVE_UNDO_MS - 100); });
        expect(onRemove).not.toHaveBeenCalled();
        act(() => { vi.advanceTimersByTime(200); });
        expect(onRemove).toHaveBeenCalledTimes(1);
        expect(onRemove.mock.calls[0][0].id).toBe('t-spoken');
        expect(screen.queryByTestId('todo-removed-toast')).toBeNull();
    });

    it('"परत आणा" brings the row back and sends nothing, ever', () => {
        vi.useFakeTimers();
        const onRemove = drawList([spoken]);
        fireEvent.click(screen.getByTestId('todo-remove-t-spoken'));
        fireEvent.click(screen.getByTestId('todo-undo-remove'));
        expect(screen.getByTestId('todo-row-t-spoken')).toBeInTheDocument();
        expect(screen.queryByTestId('todo-removed-toast')).toBeNull();
        act(() => { vi.advanceTimersByTime(REMOVE_UNDO_MS * 3); });
        expect(onRemove).not.toHaveBeenCalled();
    });

    it('a second removal sends the first at once, and leaving the page never loses his tap', () => {
        vi.useFakeTimers();
        const onRemove = drawList([spoken, leftover]);
        fireEvent.click(screen.getByTestId('todo-remove-t-spoken'));
        fireEvent.click(screen.getByTestId('todo-remove-t-left'));
        expect(onRemove).toHaveBeenCalledTimes(1);
        expect(onRemove.mock.calls[0][0].id).toBe('t-spoken');
        cleanup(); // the page is left before the way back has passed
        expect(onRemove).toHaveBeenCalledTimes(2);
        expect(onRemove.mock.calls[1][0].id).toBe('t-left');
    });

    it('English twins of the toast', () => {
        h.language = 'en';
        vi.useFakeTimers();
        drawList([spoken]);
        fireEvent.click(screen.getByTestId('todo-remove-t-spoken'));
        expect(screen.getByTestId('todo-removed-toast')).toHaveTextContent('Reminder removed');
        expect(screen.getByTestId('todo-undo-remove')).toHaveTextContent('Undo');
    });
});
