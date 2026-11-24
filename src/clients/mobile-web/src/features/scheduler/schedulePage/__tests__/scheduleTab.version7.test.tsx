// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any -- test fixtures */
/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 10; approved spec "Schedule tab", decisions 4 and 5) - the whole tab as version 7: the plot head with
 * "change plot", the owner-voice slot (nothing while none is unheard), the four tiles, then the plot's schedule, then the plot lists BELOW. The tab opens on the plot
 * last worked. A seat that may not take (worker) sees no take.
 */
import React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../usePlotClips', () => ({ usePlotClips: () => new Map() }));
vi.mock('../../../finance/components/MoneyLensDrawer', () => ({ MoneyLensDrawer: () => null }));
vi.mock('../../../finance/financeSelectors', () => ({ financeSelectors: { getTotalCost: () => 0 } }));

import SchedulerPage from '../../../../pages/SchedulerPage';
import { setScheduleTemplatesFromReferenceData } from '../../../../infrastructure/reference/TemplateCatalog';
import { SERVER_TEMPLATE, SPRAY_TEMPLATE, crop, plot } from './scheduleFixtures';

beforeAll(() => setScheduleTemplatesFromReferenceData([SERVER_TEMPLATE, SPRAY_TEMPLATE]));
beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-26T06:00:00Z'));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

const before = (a: HTMLElement, b: HTMLElement) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
const page = (logs: any[] = [], props: Record<string, unknown> = {}) => (
    <SchedulerPage crops={[crop([plot({ id: 'plot-1', name: 'G1' }), plot({ id: 'plot-2', name: 'G2' })])]} logs={logs} tasks={[]} onUpdateCrops={vi.fn()} onBack={vi.fn()} {...props} />
);

describe('slice 10: the Schedule tab as version 7', () => {
    it('top to bottom: plot head with change plot, no owner-voice line, the four tiles, the profile, follow totals, the door cards, look reminders, the two tabs, the plot lists; the older parts after', () => {
        render(page());
        const ids = ['plot-head', 'schedule-tiles', 'schedule-profile', 'follow-totals-slot', 'look-memories', 'schedule-panes', 'plot-lists', 'fold-header'];
        const els = ids.map(id => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null);
        // the profile loads from the phone's copy; with no copy in this test it draws nothing, so it is checked in scheduleTab.profile.test
        ids.forEach((id, i) => { if (id !== 'schedule-profile') expect(els[i], id).not.toBeNull(); });
        const present = els.filter((e): e is HTMLElement => !!e);
        for (let i = 1; i < present.length; i += 1) expect(before(present[i - 1], present[i])).toBe(true);
        expect(screen.getByTestId('plot-head').contains(screen.getByTestId('change-plot'))).toBe(true);
        expect(screen.queryByTestId('owner-voice-line')).toBeNull();
        expect(screen.getByTestId('schedule-tiles-grid')).toHaveClass('grid-cols-2');
        expect(screen.getByTestId('schedule-tiles-grid').children.length).toBe(4);
    });
    it('opens on the plot last worked (the phone\'s own logs), not the first plot', () => {
        const log: any = { id: 'l1', date: '2026-10-25', context: { selection: [{ cropId: 'crop-1', cropName: 'Grapes', selectedPlotIds: ['plot-2'], selectedPlotNames: ['G2'] }] } };
        render(page([log]));
        expect(screen.getByTestId('plot-head-name').textContent).toContain('G2');
    });
    it('with no log it opens on the first plot in the canonical order', () => {
        render(page());
        expect(screen.getByTestId('plot-head-name').textContent).toContain('G1');
    });
    it('a seat without the take right (a worker) sees no take or plan button anywhere on the tab', () => {
        render(page([], { mayMakeOwnSchedule: false, mayPlanWork: false, mayAssignWork: false }));
        expect(document.querySelector('[data-testid^="take-btn-"]')).toBeNull();
        expect(document.querySelector('[data-testid^="take-plan-"]')).toBeNull();
    });
    it('"प्लॉट बदला" opens the ONE canonical crop-then-plot selector (CTX-1), not a scroll', () => {
        render(page());
        expect(screen.queryByTestId('place-picker')).toBeNull();
        fireEvent.click(screen.getByTestId('change-plot'));
        expect(screen.getByTestId('place-picker')).toBeInTheDocument();
    });
    it('the in-tab calendar: today is marked, each date has its small schedule day through the one helper (never day 0), and it names its rule', () => {
        render(page());
        const grid = screen.getByTestId('calendar-grid');
        const today = grid.querySelector('[data-today="yes"]') as HTMLElement;
        expect(today).not.toBeNull();
        expect(screen.getByTestId('calendar-rule')).toBeInTheDocument();
        const smalls = [...grid.querySelectorAll('[data-testid^="calendar-shown-"]')].map(e => e.textContent);
        expect(smalls.length).toBeGreaterThan(0);
        expect(smalls).not.toContain('०');
        expect(smalls).not.toContain('0');
        expect(screen.getByTestId('calendar-full-season')).toBeInTheDocument();
    });
    it('the follow-totals slot shows its rule and no number; the look-memories card shows its rule when nothing is due (never vanishes)', () => {
        render(page());
        const slot = screen.getByTestId('follow-totals-slot');
        expect(slot.textContent).not.toMatch(/[0-9०-९]/);
        expect(screen.getByTestId('look-memories')).toHaveAttribute('data-count', '0');
        expect(screen.getByTestId('look-memories-line').textContent).toMatch(/पाहणी/);
    });
    it('the plot lists are grouped chips by crop, only the seat own plots, and tapping a chip chooses the plot', () => {
        render(page());
        expect(screen.getByTestId('plot-chip-lists')).toBeInTheDocument();
        expect(screen.getByTestId('chip-plot-plot-1')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.queryByTestId('chip-plot-plot-9')).toBeNull();
        fireEvent.click(screen.getByTestId('chip-plot-plot-2'));
        expect(screen.getByTestId('plot-head-name').textContent).toContain('G2');
        expect(screen.getByTestId('chip-plot-plot-2')).toHaveAttribute('aria-pressed', 'true');
    });
});
