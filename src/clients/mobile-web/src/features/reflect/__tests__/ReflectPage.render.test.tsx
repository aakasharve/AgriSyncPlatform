// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I6)
 *
 * The whole "पूर्ण शेतीचा आढावा" page on real-shaped records: the six sections in their FIXED order (nothing
 * movable), every section fed from the page's real props, and the page's actions wired to the real callbacks
 * (task tick → `onUpdateTask` with the whole task; in-hand card → the income page; the ledger link; a plot card
 * → that day's record or the "add it" view; the money pill → the money lens). Only infrastructure edges are
 * mocked (farm context, harvest storage, Dexie attachment counts, telemetry, the drawers).
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('../../../core/session/FarmContext', () => ({ useFarmContext: () => ({ currentFarmId: null }) }));
vi.mock('../../../services/harvestService', () => ({ getHarvestSessions: () => [], getOtherIncomeEntries: () => [] }));
vi.mock('../../attachments', () => ({ useAttachmentRetry: () => ({ retryUpload: vi.fn() }) }));
vi.mock('../overview/useLogAttachmentCount', () => ({ useLogAttachmentCount: () => 0 }));
vi.mock('../../../core/telemetry/eventEmitters', () => ({ emitClosureSummaryViewed: vi.fn() }));
vi.mock('../../logs/components/FarmWideTodayPanel', () => ({ default: () => null }));
vi.mock('../../finance/components/MoneyLensDrawer', () => ({
    MoneyLensDrawer: ({ isOpen, filters }: { isOpen: boolean; filters: object }) => (isOpen ? <div data-testid="money-lens">{JSON.stringify(filters)}</div> : null),
}));
vi.mock('../sections/LogDetailDrawer', () => ({
    default: ({ selectedLog, emptySelection }: { selectedLog: { id: string } | null; emptySelection: { plotName?: string } | null }) => (
        <div data-testid="log-drawer">{selectedLog ? `log:${selectedLog.id}` : `empty:${emptySelection?.plotName}`}</div>
    ),
}));

import ReflectPage from '../ReflectPage';
import { CROPS, TODAY_KEY, log, money, task } from './reflectFixtures';

const history = [
    log({
        id: 'g1-today', plotIds: ['g1'], cropActivities: [{ id: 'a', title: 'छाटणी' }], financialSummary: money(1500),
        observations: [{ id: 'o1', plotId: 'g1', dateKey: TODAY_KEY, timestamp: '2026-10-25T03:40:00.000Z', textRaw: 'कीड दिसली', noteType: 'issue', severity: 'normal', source: 'voice' }],
    }),
    log({ id: 'c1-old', date: '2026-10-21', cropId: 'cane', plotIds: ['c1'], irrigation: [{ id: 'i', method: 'drip', source: 'Well' }] }),
];

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 25, 10, 0, 0));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const renderPage = (over: Partial<React.ComponentProps<typeof ReflectPage>> = {}) => {
    const props = {
        history, crops: CROPS,
        tasks: [task('t1', 'फवारणी', { dueDate: TODAY_KEY })],
        onUpdateTask: vi.fn(), onAddTask: vi.fn(), navigate: vi.fn(),
        ...over,
    };
    render(<ReflectPage {...props} />);
    return props;
};

const sectionOrder = () => Array.from(document.querySelectorAll('section[data-testid^="reflect-section-"]')).map(s => s.getAttribute('data-testid'));

describe('ReflectPage (redesigned, real data)', () => {
    it('six sections in a FIXED order, nothing to move them with', () => {
        renderPage();
        expect(sectionOrder()).toEqual([
            'reflect-section-status', 'reflect-section-todo', 'reflect-section-day',
            'reflect-section-notes', 'reflect-section-calendar', 'reflect-section-cost',
        ]);
        // the old blocks carried "Move up" / "Move down" buttons; nothing on the page can re-order now
        expect(document.querySelector('[title="Move up"], [title="Move down"]')).toBeNull();
        expect(screen.queryByRole('button', { name: /move (up|down)/i })).toBeNull();
        // folding a section hides its body; the section stays where it is
        fireEvent.click(screen.getByTestId('reflect-section-notes-toggle'));
        expect(screen.queryByTestId('notes-list')).toBeNull();
        expect(sectionOrder()[3]).toBe('reflect-section-notes');
    });

    it('feeds every section from the real props', () => {
        renderPage();
        expect(screen.getAllByTestId(/^plot-card-/)).toHaveLength(3);
        expect(screen.getByTestId('plot-card-grape:g1')).toHaveAttribute('data-status', 'worked');
        expect(screen.getByTestId('notes-count')).toHaveTextContent('1');
        expect(within(screen.getByTestId('notes-list')).getByText('कीड दिसली')).toBeInTheDocument();
        expect(within(screen.getByTestId('todo-group-today')).getByText('फवारणी')).toBeInTheDocument();
        expect(screen.getByTestId('cal-chip-g1-today')).toBeInTheDocument();
        expect(screen.getByTestId('week-total')).toHaveTextContent('₹ 1,500');
        // no harvest or other income recorded in the stores: "—", not ₹ 0
        expect(screen.getByTestId('in-hand-amount')).toHaveTextContent('—');
    });

    it('picking a crop narrows every section', () => {
        renderPage();
        fireEvent.click(screen.getByTestId('farm-crop-cane'));
        expect(screen.getAllByTestId(/^plot-card-/).map(c => c.getAttribute('data-testid'))).toEqual(['plot-card-cane:c1']);
        expect(screen.getByTestId('notes-empty')).toBeInTheDocument();
        expect(screen.queryByTestId('cal-chip-g1-today')).toBeNull();
        expect(screen.getByTestId('cost-empty')).toBeInTheDocument();
    });

    it('a calendar day shows that day in the plot cards', () => {
        renderPage();
        // 25 Oct 2026 is a Sunday: the calendar's week (Sunday first) is 25–31; the 21st is one week back
        fireEvent.click(screen.getByTestId('cal-prev'));
        fireEvent.click(screen.getByTestId('cal-day-2026-10-21'));
        expect(screen.getByTestId('day-label')).toHaveTextContent('बुधवार, 21 ऑक्टो');
        expect(screen.getByTestId('plot-card-cane:c1')).toHaveAttribute('data-status', 'worked');
        expect(screen.getByTestId('plot-empty-grape:g1')).toHaveTextContent('या दिवशी नोंद नाही');
    });

    it('ticking a to-do hands the whole updated task to onUpdateTask (what the app\'s task store expects)', () => {
        const props = renderPage();
        fireEvent.click(screen.getByTestId('todo-tick-t1'));
        expect(props.onUpdateTask).toHaveBeenCalledWith(expect.objectContaining({ id: 't1', title: 'फवारणी', status: 'done', completedAt: expect.any(String) }));
        fireEvent.click(screen.getByTestId('todo-add'));
        expect(props.onAddTask).toHaveBeenCalled();
    });

    it('the in-hand card opens the income page; the ledger link opens the finance ledger', () => {
        const props = renderPage();
        fireEvent.click(screen.getByTestId('overview-money'));
        expect(props.navigate).toHaveBeenCalledWith('income');
        fireEvent.click(screen.getByTestId('open-finance'));
        expect(props.navigate).toHaveBeenCalledWith('finance-ledger');
    });

    it('a plot card opens its record, or the "nothing recorded" view; the money pill opens the money lens', () => {
        renderPage();
        fireEvent.click(screen.getByTestId('plot-card-grape:g1'));
        expect(screen.getByTestId('log-drawer')).toHaveTextContent('log:g1-today');
        fireEvent.click(screen.getByTestId('plot-card-grape:g2'));
        expect(screen.getByTestId('log-drawer')).toHaveTextContent('empty:थॉम्पसन');
        fireEvent.click(screen.getByTestId('plot-money-grape:g1'));
        expect(screen.getByTestId('money-lens')).toHaveTextContent('"cropId":"grape"');
        expect(screen.getByTestId('money-lens')).toHaveTextContent('"plotId":"g1"');
    });

    it('a farm with no crop yet: honest empty lines, no invented figures', () => {
        renderPage({ history: [], crops: [], tasks: [] });
        expect(screen.getByTestId('farm-status-empty')).toBeInTheDocument();
        expect(screen.getByTestId('plot-cards-empty')).toBeInTheDocument();
        expect(screen.getByTestId('todo-empty')).toBeInTheDocument();
        expect(screen.getByTestId('season-cost')).toHaveTextContent('—');
        expect(document.body.textContent).not.toContain('₹ 0');
    });
});
