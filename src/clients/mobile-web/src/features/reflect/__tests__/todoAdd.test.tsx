// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I14, T2)
 *
 * Adding a to-do is Marathi and happens in the list: "आठवण जोडा" opens a line + when + how urgent +
 * "जोडा" / "रद्द"; "बोलून सांगा" is drawn only when a real voice path is wired (the log flow, where a spoken
 * reminder becomes a to-do). The record is the SAME one the old English "Add New Task" sheet wrote, into
 * the same store — except a farm-wide to-do is filed under the whole farm, never a made-up 'unknown_plot'.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('../../../core/session/FarmContext', () => ({ useFarmContext: () => ({ currentFarmId: 'farm-1' }) }));
vi.mock('../../../services/harvestService', () => ({ getHarvestSessions: () => [], getOtherIncomeEntries: () => [] }));
vi.mock('../../attachments', () => ({ useAttachmentRetry: () => ({ retryUpload: vi.fn() }) }));
vi.mock('../overview/useLogAttachmentCount', () => ({ useLogAttachmentCount: () => 0 }));
const emitNextActionCreated = vi.hoisted(() => vi.fn());
vi.mock('../../../core/telemetry/eventEmitters', () => ({ emitClosureSummaryViewed: vi.fn(), emitNextActionCreated }));
vi.mock('../../logs/components/FarmWideTodayPanel', () => ({ default: () => null }));
vi.mock('../../finance/components/MoneyLensDrawer', () => ({ MoneyLensDrawer: () => null }));
vi.mock('../sections/LogDetailDrawer', () => ({ default: () => null }));

import { TodoSection } from '../overview/TodoSection';
import { buildTodoList, newTodoTask } from '../overview/todoModel';
import { CROPS, TODAY_KEY, task } from './reflectFixtures';

const ENGLISH = /Add New Task|What needs to be done|Priority|When is it due|Create Task|tomorrow|next week|no date|urgent|high|normal/i;

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 25, 10, 0, 0));
    emitNextActionCreated.mockClear();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('newTodoTask — the same record the task sheet made', () => {
    it('a manual, pending task with the due day from the four choices', () => {
        const base = { title: '  ठिबकची नळी तपासायची ', priority: 'urgent' as const };
        const t = newTodoTask({ ...base, when: 'tomorrow' }, '2026-10-31', 'id-1', new Date('2026-10-31T05:00:00Z'));
        expect(t).toMatchObject({ id: 'id-1', title: 'ठिबकची नळी तपासायची', status: 'pending', sourceType: 'manual', priority: 'urgent', dueDate: '2026-11-01', createdAt: '2026-10-31T05:00:00.000Z' });
        expect(newTodoTask({ ...base, when: 'today' }, '2026-10-31', 'x').dueDate).toBe('2026-10-31');
        expect(newTodoTask({ ...base, when: 'next_week' }, '2026-12-28', 'x').dueDate).toBe('2027-01-04');
        expect(newTodoTask({ ...base, when: 'no_date' }, '2026-10-31', 'x').dueDate).toBeUndefined();
    });

    it('no plot chosen → the whole farm (never "unknown_plot"); one plot chosen → that plot and crop', () => {
        const farm = newTodoTask({ title: 'खत आणायचं', when: 'today', priority: 'normal' }, TODAY_KEY, 'a');
        expect(farm.plotId).toBe('FARM_GLOBAL');
        expect(farm.cropId).toBe('FARM_GLOBAL');
        const one = newTodoTask({ title: 'छाटणी', when: 'today', priority: 'normal', place: { plotId: 'g1', cropId: 'grape' } }, TODAY_KEY, 'b');
        expect(one).toMatchObject({ plotId: 'g1', cropId: 'grape' });
    });
});

describe('TodoSection — add in place, in Marathi', () => {
    const list = buildTodoList({ tasks: [task('t1', 'फवारणी', { dueDate: TODAY_KEY })], storeIds: new Set(['t1']), crops: CROPS, scope: { viewCrops: [], viewPlots: {} }, wholeFarm: true, todayKey: TODAY_KEY });

    it('"आठवण जोडा" opens a line; "जोडा" hands over the words, when and how urgent; the form closes', () => {
        const onAddTodo = vi.fn();
        render(<TodoSection list={list} onToggle={vi.fn()} onAddTodo={onAddTodo} />);
        expect(screen.getByTestId('todo-add')).toHaveTextContent('आठवण जोडा');
        fireEvent.click(screen.getByTestId('todo-add'));
        const form = screen.getByTestId('todo-form');
        expect(screen.getByTestId('todo-save')).toBeDisabled();
        fireEvent.change(screen.getByTestId('todo-input'), { target: { value: 'उद्या ठिबकची नळी तपासायची' } });
        fireEvent.click(screen.getByTestId('todo-when-today'));
        fireEvent.click(screen.getByTestId('todo-priority-urgent'));
        expect(form.textContent).not.toMatch(ENGLISH);
        expect(within(form).getByText('कधी?')).toBeInTheDocument();
        expect(within(form).getByText('तातडीचं')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('todo-save'));
        expect(onAddTodo).toHaveBeenCalledWith({ title: 'उद्या ठिबकची नळी तपासायची', when: 'today', priority: 'urgent' });
        expect(screen.queryByTestId('todo-form')).toBeNull();
    });

    it('"रद्द" closes without adding; the defaults are उद्या and साधं, as the old sheet', () => {
        const onAddTodo = vi.fn();
        render(<TodoSection list={list} onToggle={vi.fn()} onAddTodo={onAddTodo} />);
        fireEvent.click(screen.getByTestId('todo-add'));
        expect(screen.getByTestId('todo-when-tomorrow')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('todo-priority-normal')).toHaveAttribute('aria-pressed', 'true');
        fireEvent.click(screen.getByTestId('todo-cancel'));
        expect(onAddTodo).not.toHaveBeenCalled();
        expect(screen.queryByTestId('todo-form')).toBeNull();
    });

    it('"बोलून सांगा" only when a real voice path is given, and it opens it', () => {
        const onTell = vi.fn();
        const { unmount } = render(<TodoSection list={list} onToggle={vi.fn()} onAddTodo={vi.fn()} />);
        expect(screen.queryByTestId('todo-tell')).toBeNull();
        unmount();
        render(<TodoSection list={list} onToggle={vi.fn()} onAddTodo={vi.fn()} onTell={onTell} />);
        fireEvent.click(screen.getByTestId('todo-tell'));
        expect(screen.getByTestId('todo-tell')).toHaveTextContent('बोलून सांगा');
        expect(onTell).toHaveBeenCalled();
    });
});
