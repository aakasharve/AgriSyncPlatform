// @vitest-environment jsdom
/**
 * PLR-D10 L3a — the हजेरी वही tile opens the वही WITH its history on a real farm (I23, D-16), and a
 * plain worker's own हजेरी is "coming soon" there and on the hub (D-35) — decided by the role the
 * server told this phone, never by the shape of the read-out alone.
 */
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { EMPTY_LABOUR_DATA } from '../../labourMock';
import type { LabourData } from '../../labour.types';

const mockUseLabourState = vi.fn();
vi.mock('../../useLabourState', () => ({ useLabourState: () => mockUseLabourState() }));

const mockFarm = vi.fn();
vi.mock('../../../../core/session/FarmContext', () => ({
    useOptionalFarmContext: () => ({ currentFarm: mockFarm(), currentFarmId: mockFarm()?.farmId ?? null, loadFailed: false }),
}));

const mockFetch = vi.fn();
vi.mock('../../data/labourClient', () => ({ fetchLabourData: (...a: unknown[]) => mockFetch(...a) }));
vi.mock('../../data/attendanceLocal', () => ({
    getLocalAttendanceMarks: async () => [],
    getLocalAttendanceNameHints: async () => new Map(),
}));
vi.mock('../../../../infrastructure/sync/BackgroundSyncWorker', () => ({ backgroundSyncWorker: { triggerNow: vi.fn() } }));

import LabourFeature from '../LabourFeature';

const readout = (view: LabourData['view']): LabourData => ({ ...EMPTY_LABOUR_DATA, view });

function mount(role: string, view: LabourData['view']) {
    mockFarm.mockReturnValue({ farmId: 'farm-1', name: 'शेत', role });
    mockUseLabourState.mockReturnValue({
        data: readout(view), loading: false, error: false, refresh: vi.fn(),
        timeWindow: 'alltime', setTimeWindow: vi.fn(), staleSinceIso: null,
    });
    mockFetch.mockResolvedValue({
        ...readout(view),
        dashboard: { ...EMPTY_LABOUR_DATA.dashboard, windowFrom: '2026-10-26', windowTo: '2026-10-29' },
        ledger: { weekLabel: '2026-10-26', days: ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29'], rows: [], crewRows: [] },
    });
    render(<LabourFeature onExit={() => undefined} />);
}

describe('LabourFeature — the हजेरी वही tile', () => {
    afterEach(() => { cleanup(); mockUseLabourState.mockReset(); mockFetch.mockReset(); mockFarm.mockReset(); });

    it('the owner gets the वही with ‹ › paging, opening on this week from the server', async () => {
        mount('PrimaryOwner', 'owner');
        fireEvent.click(screen.getByText('हजेरी वही'));
        await waitFor(() => expect(screen.getByTestId('vahi-paging')).toBeInTheDocument());
        expect(mockFetch).toHaveBeenCalledWith('farm-1', 'week', undefined);
        await waitFor(() => expect(screen.getByTestId('vahi-heading')).toHaveTextContent('२६–२९ ऑक्टो'));
    });

    it('a plain worker sees his own हजेरी as "coming soon" on the hub and in the वही — never an empty grid', () => {
        mount('Worker', 'own');
        expect(screen.getByTestId('own-attendance-coming-soon')).toBeInTheDocument();
        fireEvent.click(screen.getByText('हजेरी वही'));
        expect(screen.getByTestId('own-attendance-coming-soon')).toBeInTheDocument();
        expect(screen.queryByTestId('vahi-paging')).toBeNull();
        expect(screen.queryAllByTestId('ledger-cell')).toHaveLength(0);
        expect(mockFetch).not.toHaveBeenCalled();
    });

    it('a background refresh (the screen remounts) keeps him on the old week he is reading', async () => {
        mockFarm.mockReturnValue({ farmId: 'farm-1', name: 'शेत', role: 'PrimaryOwner' });
        const state = (loading: boolean) => ({
            data: readout('owner'), loading, error: false, refresh: vi.fn(),
            timeWindow: 'alltime', setTimeWindow: vi.fn(), staleSinceIso: null,
        });
        mockUseLabourState.mockReturnValue(state(false));
        mockFetch.mockImplementation((_f: string, _w: string, anchor?: string) => Promise.resolve({
            ...readout('owner'),
            dashboard: anchor
                ? { ...EMPTY_LABOUR_DATA.dashboard, windowFrom: '2026-10-19', windowTo: '2026-10-25' }
                : { ...EMPTY_LABOUR_DATA.dashboard, windowFrom: '2026-10-26', windowTo: '2026-10-29' },
            ledger: { weekLabel: '', days: [], rows: [], crewRows: [] },
        }));
        const { rerender } = render(<LabourFeature onExit={() => undefined} />);
        fireEvent.click(screen.getByText('हजेरी वही'));
        await waitFor(() => expect(screen.getByTestId('vahi-heading')).toHaveTextContent('२६–२९ ऑक्टो'));
        fireEvent.click(screen.getByTestId('vahi-prev'));
        await waitFor(() => expect(screen.getByTestId('vahi-heading')).toHaveTextContent('१९–२५ ऑक्टो'));

        mockUseLabourState.mockReturnValue(state(true));   // a sync settled: the read-out refetches
        rerender(<LabourFeature onExit={() => undefined} />);
        mockUseLabourState.mockReturnValue(state(false));
        rerender(<LabourFeature onExit={() => undefined} />);

        await waitFor(() => expect(screen.getByTestId('vahi-heading')).toHaveTextContent('१९–२५ ऑक्टो'));
    });

    it('an owner whose read-out is the offline own-shaped register is NOT told "coming soon"', () => {
        mount('PrimaryOwner', 'own');
        expect(screen.queryByTestId('own-attendance-coming-soon')).toBeNull();
    });
});
