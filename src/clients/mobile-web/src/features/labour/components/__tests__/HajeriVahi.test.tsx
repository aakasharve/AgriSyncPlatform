// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I23, founder D-16) — the हजेरी वही turns
 * back a week or a month: ‹ › paging with the exact dates in the heading, an obvious "आज" return,
 * no next page once today is reached (no future), read-only browsing (a tap opens a day's detail,
 * nothing is ever marked), and the server owns every boundary (the phone only steps one day past
 * the range it was last given).
 *
 * The founder's preview list: the current week, a previous week, a previous month, cell detail,
 * back to today — and "demonstrate that browsing cannot accidentally mark attendance".
 */
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { LabourData, LedgerRow } from '../../labour.types';
import { EMPTY_LABOUR_DATA } from '../../labourMock';

const mockFetch = vi.fn();
vi.mock('../../data/labourClient', () => ({
    fetchLabourData: (...args: unknown[]) => mockFetch(...args),
}));
vi.mock('../../data/attendanceLocal', () => ({
    getLocalAttendanceMarks: async () => [],
    getLocalAttendanceNameHints: async () => new Map(),
}));
const mockEnqueue = vi.fn();
vi.mock('../../../../application/usecases/sync/MarkAttendanceCommand', () => ({
    MarkAttendanceCommand: { enqueue: (p: unknown) => mockEnqueue(p) },
}));

import HajeriVahi from '../HajeriVahi';

const TODAY = '2026-10-29'; // Thursday

const daysBetween = (from: string, to: string): string[] => {
    const out: string[] = [];
    for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d = new Date(d.getTime() + 86_400_000)) {
        out.push(d.toISOString().slice(0, 10));
    }
    return out;
};

function page(windowFrom: string, windowTo: string): LabourData {
    const days = daysBetween(windowFrom, windowTo);
    const ganesh: LedgerRow = {
        personId: 'op:ganesh', fieldOperatorId: 'ganesh', name: 'गणेश', initial: 'ग', tone: 'em',
        cells: days.map((_, i) => (i === 1
            ? { day: 'full', night: null, hours: null, extraHours: null, ukte: false, work: null }
            : null)),
    } as unknown as LedgerRow;
    return {
        ...EMPTY_LABOUR_DATA,
        view: 'owner',
        dashboard: { ...EMPTY_LABOUR_DATA.dashboard, weekLabel: windowFrom, windowFrom, windowTo },
        ledger: { weekLabel: windowFrom, days, rows: [ganesh], crewRows: [] },
    };
}

/** What the SERVER answers — the phone never computes these boundaries. */
function server(_farmId: string, window: string, anchor?: string): Promise<LabourData> {
    if (window === 'week' && anchor === undefined) return Promise.resolve(page('2026-10-26', '2026-10-29'));
    if (window === 'week' && anchor === '2026-10-25') return Promise.resolve(page('2026-10-19', '2026-10-25'));
    if (window === 'week' && anchor === '2026-10-26') return Promise.resolve(page('2026-10-26', '2026-10-29'));
    if (window === 'month' && anchor === undefined) return Promise.resolve(page('2026-10-01', '2026-10-29'));
    if (window === 'month' && anchor === '2026-09-30') return Promise.resolve(page('2026-09-01', '2026-09-30'));
    return Promise.reject(new Error(`unexpected ${window} ${anchor}`));
}

function draw(onOpenCell = vi.fn()) {
    render(<HajeriVahi data={EMPTY_LABOUR_DATA} mainWindow="alltime" farmId="farm-1" todayKey={TODAY}
        onOpenCell={onOpenCell} onToast={() => undefined} />);
    return onOpenCell;
}

const heading = () => screen.getByTestId('vahi-heading');

describe('HajeriVahi — turning back a week or a month (I23, D-16)', () => {
    beforeEach(() => { mockFetch.mockImplementation(server); });
    afterEach(() => { cleanup(); mockFetch.mockReset(); mockEnqueue.mockReset(); });

    it('opens on THIS week: its exact dates, ending today; no next page, no आज (already there)', async () => {
        draw();
        await waitFor(() => expect(heading()).toHaveTextContent('२६–२९ ऑक्टो · आजपर्यंत'));
        expect(mockFetch).toHaveBeenCalledWith('farm-1', 'week', undefined);
        expect(screen.getByTestId('vahi-next')).toBeDisabled();
        expect(screen.queryByTestId('vahi-today')).toBeNull();
        expect(screen.getAllByTestId('ledger-day-head')).toHaveLength(4);
    });

    it('‹ turns back to the whole previous week (Mon–Sun), asked for by the day before this range', async () => {
        draw();
        await waitFor(() => expect(heading()).toHaveTextContent('२६–२९ ऑक्टो'));
        fireEvent.click(screen.getByTestId('vahi-prev'));
        await waitFor(() => expect(heading()).toHaveTextContent('१९–२५ ऑक्टो'));
        expect(heading()).not.toHaveTextContent('आजपर्यंत');
        expect(mockFetch).toHaveBeenLastCalledWith('farm-1', 'week', '2026-10-25');
        expect(screen.getAllByTestId('ledger-day-head')).toHaveLength(7);
        expect(screen.getByTestId('vahi-next')).not.toBeDisabled();
        expect(screen.getByTestId('vahi-today')).toHaveTextContent('आज');
    });

    it('› from last week comes back to this week, and आज returns to today from anywhere', async () => {
        draw();
        await waitFor(() => expect(heading()).toHaveTextContent('२६–२९ ऑक्टो'));
        fireEvent.click(screen.getByTestId('vahi-prev'));
        await waitFor(() => expect(heading()).toHaveTextContent('१९–२५ ऑक्टो'));
        fireEvent.click(screen.getByTestId('vahi-next'));
        await waitFor(() => expect(heading()).toHaveTextContent('२६–२९ ऑक्टो · आजपर्यंत'));
        expect(mockFetch).toHaveBeenLastCalledWith('farm-1', 'week', '2026-10-26');

        fireEvent.click(screen.getByTestId('vahi-prev'));
        await waitFor(() => expect(heading()).toHaveTextContent('१९–२५ ऑक्टो'));
        fireEvent.click(screen.getByTestId('vahi-today'));
        await waitFor(() => expect(heading()).toHaveTextContent('२६–२९ ऑक्टो · आजपर्यंत'));
    });

    it('महिना pages by calendar month: this month to today, then the whole previous month', async () => {
        draw();
        await waitFor(() => expect(heading()).toHaveTextContent('२६–२९ ऑक्टो'));
        fireEvent.click(screen.getByTestId('vahi-unit-month'));
        await waitFor(() => expect(heading()).toHaveTextContent('१–२९ ऑक्टो · आजपर्यंत'));
        expect(mockFetch).toHaveBeenLastCalledWith('farm-1', 'month', undefined);
        fireEvent.click(screen.getByTestId('vahi-prev'));
        await waitFor(() => expect(heading()).toHaveTextContent('१–३० सप्टें'));
        expect(mockFetch).toHaveBeenLastCalledWith('farm-1', 'month', '2026-09-30');
        expect(screen.getAllByTestId('ledger-day-head')).toHaveLength(30);
    });

    it('a tapped cell on a past week opens THAT day\'s detail — browsing never marks anything', async () => {
        const onOpenCell = draw();
        await waitFor(() => expect(heading()).toHaveTextContent('२६–२९ ऑक्टो'));
        fireEvent.click(screen.getByTestId('vahi-prev'));
        await waitFor(() => expect(heading()).toHaveTextContent('१९–२५ ऑक्टो'));

        const cells = screen.getAllByTestId('ledger-cell');
        for (const cell of cells) fireEvent.click(cell);
        expect(onOpenCell).toHaveBeenCalledTimes(1); // only the one cell that holds a fact
        expect(onOpenCell.mock.calls[0][1]).toBe(1);
        expect(onOpenCell.mock.calls[0][2]).toBe('2026-10-20');

        // Read-only by construction: no mark was queued by any tap, and the page offers no save.
        expect(mockEnqueue).not.toHaveBeenCalled();
        expect(screen.queryByText('बरोबर')).toBeNull();
        expect(screen.queryByText('जतन करा')).toBeNull();
    });

    it('a past week that cannot be fetched says so and keeps the way back; nothing invented', async () => {
        mockFetch.mockImplementation((f: string, w: string, a?: string) =>
            (a === '2026-10-25' ? Promise.reject(new Error('offline')) : server(f, w, a)));
        draw();
        await waitFor(() => expect(heading()).toHaveTextContent('२६–२९ ऑक्टो'));
        fireEvent.click(screen.getByTestId('vahi-prev'));
        await waitFor(() => expect(screen.getByText('माहिती आणता आली नाही')).toBeInTheDocument());
        expect(screen.queryAllByTestId('ledger-cell')).toHaveLength(0);
        fireEvent.click(screen.getByTestId('vahi-today'));
        await waitFor(() => expect(heading()).toHaveTextContent('२६–२९ ऑक्टो · आजपर्यंत'));
    });
});
