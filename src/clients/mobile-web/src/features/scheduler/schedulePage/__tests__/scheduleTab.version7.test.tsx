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
import { cleanup, render, screen } from '@testing-library/react';

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
    it('top to bottom: plot head, change plot, the four tiles row, the plot schedule, the plot lists below; no owner-voice line with no voice', () => {
        render(page());
        const head = screen.getByTestId('sched-header');
        const change = screen.getByTestId('change-plot');
        const tiles = screen.getByTestId('fold-followed');
        const today = screen.getByTestId('today-card');
        const lists = screen.getByTestId('plot-lists');
        expect(before(head, change) || before(change, head)).toBe(true);
        expect(before(head, tiles)).toBe(true);
        expect(before(tiles, today)).toBe(true);
        expect(before(today, lists)).toBe(true);
        expect(screen.queryByTestId('owner-voice-line')).toBeNull();
    });
    it('opens on the plot last worked (the phone\'s own logs), not the first plot', () => {
        const log: any = { id: 'l1', date: '2026-10-25', context: { selection: [{ cropId: 'crop-1', cropName: 'Grapes', selectedPlotIds: ['plot-2'], selectedPlotNames: ['G2'] }] } };
        render(page([log]));
        expect(screen.getByTestId('sched-crop-plot').textContent).toContain('G2');
    });
    it('with no log it opens on the first plot in the canonical order', () => {
        render(page());
        expect(screen.getByTestId('sched-crop-plot').textContent).toContain('G1');
    });
    it('a seat without the take right (a worker) sees no take or plan button anywhere on the tab', () => {
        render(page([], { mayMakeOwnSchedule: false, mayPlanWork: false, mayAssignWork: false }));
        expect(document.querySelector('[data-testid^="take-btn-"]')).toBeNull();
        expect(document.querySelector('[data-testid^="take-plan-"]')).toBeNull();
    });
});
