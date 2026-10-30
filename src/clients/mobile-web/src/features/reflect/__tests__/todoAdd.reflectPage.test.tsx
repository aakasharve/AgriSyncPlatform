// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I14, T2)
 *
 * On पूर्ण शेतीचा आढावा, a to-do typed in place ("आठवण जोडा") reaches the app's task store through
 * `onSaveTask` (the store the old sheet wrote), as the same manual record, filed under the whole farm or the
 * ONE plot the page is narrowed to, and emits the same `next_action.created` event the sheet emitted; the saved
 * line reads as an आठवण. Also: the page opens narrowed to one plot when लक्ष द्या's "तुकडा पहा" asks (H16).
 * Only infrastructure edges are mocked (farm context, storage, telemetry, drawers, the sync transport).
 */
import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { PlannedTask } from '../../../types';

vi.mock('../../../core/session/FarmContext', () => ({ useFarmContext: () => ({ currentFarmId: 'farm-1' }) }));
vi.mock('../../../services/harvestService', () => ({ getHarvestSessions: () => [], getOtherIncomeEntries: () => [] }));
vi.mock('../../attachments', () => ({ useAttachmentRetry: () => ({ retryUpload: vi.fn() }) }));
vi.mock('../overview/useLogAttachmentCount', () => ({ useLogAttachmentCount: () => 0 }));
const emitNextActionCreated = vi.hoisted(() => vi.fn());
vi.mock('../../../core/telemetry/eventEmitters', () => ({ emitClosureSummaryViewed: vi.fn(), emitNextActionCreated }));
vi.mock('../../logs/components/FarmWideTodayPanel', () => ({ default: () => null }));
vi.mock('../../finance/components/MoneyLensDrawer', () => ({ MoneyLensDrawer: () => null }));
// lane RF: the page reads the server's money ledger and plays recordings — neither is what these tests are about.
vi.mock('../overview/useMoneyLedger', () => ({ useMoneyLedger: () => ({ entries: [], gaps: [] }) }));
vi.mock('../day/useDayListen', () => ({ useDayListen: () => ({ kindOf: () => 'none', clipOf: () => undefined, playing: () => false, progress: 0, lengthOf: () => null, toggle: () => undefined, stop: () => undefined, farmOf: () => null }) }));
// The sync payload validator is the one link to `sync-contract` (TodayActivityFeed → ActivityFeedCard →
// useAttachmentRetry → … → MutationQueue → PayloadValidator), whose `zod` a worktree checkout cannot resolve.
// Nothing here validates a payload.
vi.mock('../../../infrastructure/sync/PayloadValidator', () => ({ validatePayload: () => ({ ok: true }) }));

import ReflectPage from '../ReflectPage';
import { CROPS } from './reflectFixtures';

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 25, 10, 0, 0));
    emitNextActionCreated.mockClear();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('ReflectPage — the in-place add reaches the task store', () => {
    it('saves a whole-farm to-do through onSaveTask and emits next_action.created, like the sheet did', () => {
        const onSaveTask = vi.fn();
        const onAddTask = vi.fn();
        render(<ReflectPage history={[]} crops={CROPS} tasks={[]} onUpdateTask={vi.fn()} onAddTask={onAddTask} onSaveTask={onSaveTask} onTellTodo={vi.fn()} />);
        fireEvent.click(screen.getByTestId('todo-add'));
        fireEvent.change(screen.getByTestId('todo-input'), { target: { value: 'खत आणायचं' } });
        fireEvent.click(screen.getByTestId('todo-save'));
        expect(onAddTask).not.toHaveBeenCalled();
        expect(onSaveTask).toHaveBeenCalledWith(expect.objectContaining({
            title: 'खत आणायचं', status: 'pending', sourceType: 'manual', priority: 'normal', plotId: 'FARM_GLOBAL', dueDate: '2026-10-26',
        }));
        const saved = onSaveTask.mock.calls[0][0];
        expect(emitNextActionCreated).toHaveBeenCalledWith({ farmId: 'farm-1', taskId: saved.id });
    });

    it('"बोलून सांगा" opens the voice path the page was given', () => {
        const onTellTodo = vi.fn();
        render(<ReflectPage history={[]} crops={CROPS} tasks={[]} onUpdateTask={vi.fn()} onSaveTask={vi.fn()} onTellTodo={onTellTodo} />);
        fireEvent.click(screen.getByTestId('todo-tell'));
        expect(onTellTodo).toHaveBeenCalled();
    });

    it('what "आठवण जोडा" saved shows in the list as an आठवण, never as a "काम" (I14-V2-02)', () => {
        const WithStore: React.FC = () => {
            const [tasks, setTasks] = useState<PlannedTask[]>([]);
            return <ReflectPage history={[]} crops={CROPS} tasks={tasks} onUpdateTask={vi.fn()} onSaveTask={t => setTasks(prev => [...prev, t])} />;
        };
        render(<WithStore />);
        fireEvent.click(screen.getByTestId('todo-add'));
        fireEvent.change(screen.getByTestId('todo-input'), { target: { value: 'ठिबकची नळी तपासायची' } });
        fireEvent.click(screen.getByTestId('todo-save'));
        // (the line also shows on the calendar's day; the to-do row is the one asked about)
        const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-testid^="todo-row-"]')).filter(r => r.textContent?.includes('ठिबकची नळी तपासायची'));
        expect(rows).toHaveLength(1);
        const row = rows[0];
        expect(row).toHaveTextContent('आठवण · हाताने जोडलं');
        expect(within(row).queryByText(/काम ·/)).toBeNull();
    });
});

describe('ReflectPage — opened on ONE plot (लक्ष द्या "तुकडा पहा", I14-V2F-03)', () => {
    const cards = () => Array.from(document.querySelectorAll('[data-testid^="plot-card-"]')).map(e => e.getAttribute('data-testid'));

    it('narrows the page to that plot and says the request was read', () => {
        const consumed = vi.fn();
        render(<ReflectPage history={[]} crops={CROPS} tasks={[]} focusPlotId="g2" onFocusPlotConsumed={consumed} />);
        expect(cards()).toEqual(['plot-card-grape:g2']);
        expect(screen.getByTestId('farm-plot-g2')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('farm-plot-g1')).toHaveAttribute('aria-pressed', 'false');
        expect(consumed).toHaveBeenCalledTimes(1);
    });

    it('a plot this phone does not hold leaves the whole farm (and is still read once)', () => {
        const consumed = vi.fn();
        render(<ReflectPage history={[]} crops={CROPS} tasks={[]} focusPlotId="not-here" onFocusPlotConsumed={consumed} />);
        expect(cards()).toEqual(['plot-card-grape:g1', 'plot-card-grape:g2', 'plot-card-cane:c1']);
        expect(consumed).toHaveBeenCalledTimes(1);
    });

    it('with no plot asked for, the page opens on the whole farm', () => {
        render(<ReflectPage history={[]} crops={CROPS} tasks={[]} />);
        expect(cards()).toHaveLength(3);
    });
});
