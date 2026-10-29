// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I6)
 *
 * The whole "पूर्ण शेतीचा आढावा" page on real-shaped records: the six sections in their first-use order, folded
 * and ordered as the founder's D-4 asks (remembered on this phone — `useUiPref` is an in-memory store here, so a
 * remount is a reopen), every section fed from the page's real props, and the page's actions wired to the real callbacks
 * (task tick → `onUpdateTask` with the whole task; in-hand card → the income page; the ledger link; a plot card
 * → that day's record or the "add it" view; the money pill → the money lens). Only infrastructure edges are
 * mocked (farm context, harvest storage, Dexie attachment counts, telemetry, the drawers).
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('../../../core/session/FarmContext', () => ({ useFarmContext: () => ({ currentFarmId: null }) }));
// spec: plr-d10 (I22, D-4) — the remembered folds / order, in memory: survives a remount (a reopen), cleared per test.
const prefs = vi.hoisted(() => new Map<string, unknown>());
vi.mock('../../../shared/hooks/useUiPref', async () => {
    const { useState } = await import('react');
    return {
        useUiPref: <T,>(key: string, fallback: T) => {
            const [value, setValue] = useState<T>(prefs.has(key) ? prefs.get(key) as T : fallback);
            const update = (next: T) => { prefs.set(key, next); setValue(next); };
            return [value, update, true] as const;
        },
    };
});
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
    prefs.clear();
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

/** Open every folded section (the content tests below read all six). */
const openAll = () => {
    for (const id of ['status', 'todo', 'day', 'notes', 'calendar', 'cost']) {
        const toggle = screen.getByTestId(`reflect-section-${id}-toggle`);
        if (toggle.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle);
    }
};

const sectionOrder = () => Array.from(document.querySelectorAll('section[data-testid^="reflect-section-"]')).map(s => s.getAttribute('data-testid'));

describe('ReflectPage (redesigned, real data)', () => {
    it('six sections in their first-use order; no move buttons until "क्रम बदला" is on', () => {
        renderPage();
        expect(sectionOrder()).toEqual([
            'reflect-section-status', 'reflect-section-todo', 'reflect-section-day',
            'reflect-section-notes', 'reflect-section-calendar', 'reflect-section-cost',
        ]);
        expect(document.querySelector('[data-testid$="-reorder"]')).toBeNull();
        expect(screen.queryByRole('button', { name: /move (up|down)/i })).toBeNull();
        // folding a section hides its body; the section stays where it is
        fireEvent.click(screen.getByTestId('reflect-section-day-toggle'));
        expect(screen.queryAllByTestId(/^plot-card-/)).toHaveLength(0);
        expect(sectionOrder()[2]).toBe('reflect-section-day');
    });

    it('D-4 first use: शेताची स्थिती, करायची कामे, प्लॉटनिहाय काम open; notes, calendar, money folded — their headers keep the count', () => {
        renderPage();
        const expanded = (id: string) => screen.getByTestId(`reflect-section-${id}-toggle`).getAttribute('aria-expanded');
        expect(['status', 'todo', 'day', 'notes', 'calendar', 'cost'].map(expanded)).toEqual(['true', 'true', 'true', 'false', 'false', 'false']);
        expect(screen.queryByTestId('notes-list')).toBeNull();
        expect(screen.getByTestId('notes-count')).toHaveTextContent('1'); // the folded section still says how many
        expect(screen.getByTestId('todo-count')).toBeInTheDocument();
    });

    it('D-4 reopening: his folds and his order are remembered', () => {
        renderPage();
        fireEvent.click(screen.getByTestId('reflect-section-notes-toggle')); // open notes
        fireEvent.click(screen.getByTestId('reflect-section-todo-toggle')); // fold to-dos
        fireEvent.click(screen.getByTestId('reflect-reorder-toggle'));
        expect(screen.queryByTestId('reflect-section-status-reorder')).toBeNull(); // शेताची स्थिती never moves
        expect(screen.getByTestId('reflect-section-todo-up')).toBeDisabled(); // already first of the movable ones
        fireEvent.click(screen.getByTestId('reflect-section-cost-up'));
        expect(sectionOrder().slice(-2)).toEqual(['reflect-section-cost', 'reflect-section-calendar']);
        cleanup();

        renderPage(); // the page opened again
        expect(screen.getByTestId('notes-list')).toBeInTheDocument();
        expect(screen.getByTestId('reflect-section-todo-toggle')).toHaveAttribute('aria-expanded', 'false');
        expect(sectionOrder()).toEqual([
            'reflect-section-status', 'reflect-section-todo', 'reflect-section-day',
            'reflect-section-notes', 'reflect-section-cost', 'reflect-section-calendar',
        ]);
    });

    it('D-4 upgrade from LIVE (P11): his LIVE fold and order choices are kept until he makes new ones', () => {
        prefs.set('collapsible-daily-logs', false);
        prefs.set('collapsible-notes', true);
        prefs.set('reflect-block-order', ['farm-status', 'notes', 'daily-logs']);
        renderPage();
        expect(screen.getByTestId('reflect-section-day-toggle')).toHaveAttribute('aria-expanded', 'false');
        expect(screen.getByTestId('reflect-section-notes-toggle')).toHaveAttribute('aria-expanded', 'true');
        expect(sectionOrder().slice(0, 4)).toEqual(['reflect-section-status', 'reflect-section-todo', 'reflect-section-notes', 'reflect-section-day']);
    });

    it('D-4 TEST build: the owner-layout label and the three versions; V1 opens all, V3 opens calendar and money one at a time', () => {
        renderPage();
        expect(screen.getByTestId('reflect-owner-preview-label')).toHaveTextContent('मालकाचा आढावा — नमुना');
        fireEvent.click(screen.getByTestId('reflect-layout-v1'));
        expect(screen.getByTestId('notes-list')).toBeInTheDocument();
        expect(screen.queryByTestId('reflect-reorder-toggle')).toBeNull(); // V1 keeps no order
        fireEvent.click(screen.getByTestId('reflect-layout-v3'));
        const expanded = (id: string) => screen.getByTestId(`reflect-section-${id}-toggle`).getAttribute('aria-expanded');
        expect([expanded('notes'), expanded('calendar'), expanded('cost')]).toEqual(['true', 'false', 'false']);
        fireEvent.click(screen.getByTestId('reflect-section-calendar-toggle'));
        fireEvent.click(screen.getByTestId('reflect-section-cost-toggle'));
        expect([expanded('calendar'), expanded('cost')]).toEqual(['false', 'true']);
        // "पहिली भेट": this version forgets its folds
        fireEvent.click(screen.getByTestId('reflect-layout-first-visit'));
        expect([expanded('calendar'), expanded('cost')]).toEqual(['false', 'false']);
    });

    it('feeds every section from the real props', () => {
        renderPage();
        openAll();
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
        openAll();
        fireEvent.click(screen.getByTestId('farm-crop-cane'));
        expect(screen.getAllByTestId(/^plot-card-/).map(c => c.getAttribute('data-testid'))).toEqual(['plot-card-cane:c1']);
        expect(screen.getByTestId('notes-empty')).toBeInTheDocument();
        expect(screen.queryByTestId('cal-chip-g1-today')).toBeNull();
        expect(screen.getByTestId('cost-empty')).toBeInTheDocument();
    });

    it('a calendar day shows that day in the plot cards', () => {
        renderPage();
        openAll();
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
        openAll();
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
        openAll();
        expect(screen.getByTestId('farm-status-empty')).toBeInTheDocument();
        expect(screen.getByTestId('plot-cards-empty')).toBeInTheDocument();
        expect(screen.getByTestId('todo-empty')).toBeInTheDocument();
        expect(screen.getByTestId('season-cost')).toHaveTextContent('—');
        expect(document.body.textContent).not.toContain('₹ 0');
    });
});
