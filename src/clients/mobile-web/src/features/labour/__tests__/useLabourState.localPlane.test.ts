// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Task 9 (B001, spec: 2026-08-28-labour-v2-release-1) — the hook finally
 * CONSUMES the local attendance plane:
 *
 *   - a successful fetch is composed with live queue intent
 *     (`overlayLocalAttendance`), so a just-confirmed mark renders in the
 *     register — weaker — instead of vanishing until the queue flushes;
 *   - a FAILED fetch with local facts serves the offline register
 *     (`buildOfflineRegister`) instead of the outage dead-end — `error`
 *     stays true, the banner stays honest;
 *   - a failed fetch with an empty plane keeps the dead-end exactly as
 *     before (EMPTY_LABOUR_DATA, error).
 *
 * The local-plane reads are mocked at the data module (the labourClient
 * idiom of the sibling test file); the real overlay/builder run.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';

const mockUseOptionalFarmContext = vi.fn();
vi.mock('../../../core/session/FarmContext', () => ({
    useOptionalFarmContext: () => mockUseOptionalFarmContext(),
}));

const mockFetchLabourData = vi.fn();
vi.mock('../data/labourClient', () => ({
    fetchLabourData: (farmId: string) => mockFetchLabourData(farmId),
}));

const mockGetLocalAttendanceMarks = vi.fn();
const mockGetLocalAttendanceNameHints = vi.fn();
vi.mock('../data/attendanceLocal', () => ({
    getLocalAttendanceMarks: (farmId: string) => mockGetLocalAttendanceMarks(farmId),
    getLocalAttendanceNameHints: (farmId: string, marks: unknown) => mockGetLocalAttendanceNameHints(farmId, marks),
}));

vi.mock('../../../app/providers/AuthProvider', () => ({
    useOptionalAuth: () => null,
}));

import { useLabourState } from '../useLabourState';
import { EMPTY_LABOUR_DATA } from '../labourMock';
import type { LabourData } from '../labour.types';

const GANESH = '33333333-3333-3333-3333-333333333333';

const serverData = (): LabourData => ({
    ...EMPTY_LABOUR_DATA,
    ledger: {
        weekLabel: '',
        days: ['2026-09-02'],
        rows: [{ personId: 'op:g', fieldOperatorId: GANESH, name: 'गणेश', initial: 'ग', tone: 'em', cells: [null] }],
        crewRows: [],
    },
});

afterEach(() => {
    cleanup();
    mockUseOptionalFarmContext.mockReset();
    mockFetchLabourData.mockReset();
    mockGetLocalAttendanceMarks.mockReset();
    mockGetLocalAttendanceNameHints.mockReset();
});

describe('useLabourState — the local plane reaches the screen (Task 9 / B001)', () => {
    it('composes live queue intent over a successful fetch', async () => {
        mockUseOptionalFarmContext.mockReturnValue({ currentFarmId: 'farm-1' });
        mockFetchLabourData.mockResolvedValue(serverData());
        mockGetLocalAttendanceMarks.mockResolvedValue([
            { fieldOperatorId: GANESH, workDate: '2026-09-02', dayMark: 'Full', source: 'queue' },
        ]);
        mockGetLocalAttendanceNameHints.mockResolvedValue(new Map());

        const { result } = renderHook(() => useLabourState());

        await waitFor(() => expect(result.current.loading).toBe(false));
        const cell = result.current.data.ledger.rows[0].cells[0];
        expect(cell).not.toBeNull();
        expect(cell!.day).toBe('full');
        expect(cell!.unsynced).toBe(true);
        expect(result.current.error).toBe(false);
    });

    it('a failed fetch with local facts serves the offline register — error stays true', async () => {
        mockUseOptionalFarmContext.mockReturnValue({ currentFarmId: 'farm-1' });
        mockFetchLabourData.mockRejectedValue(new Error('server down'));
        mockGetLocalAttendanceMarks.mockResolvedValue([
            { fieldOperatorId: GANESH, workDate: '2026-09-02', dayMark: 'Full', source: 'queue' },
        ]);
        mockGetLocalAttendanceNameHints.mockResolvedValue(new Map([[GANESH, 'गणेश']]));

        const { result } = renderHook(() => useLabourState());

        await waitFor(() => expect(result.current.error).toBe(true));
        expect(result.current.data.ledger.rows).toHaveLength(1);
        expect(result.current.data.ledger.rows[0].name).toBe('गणेश');
        expect(result.current.data.ledger.rows[0].cells[0]!.unsynced).toBe(true);
        expect(result.current.data.view).toBe('own'); // fail-closed — no owner claim card
    });

    it('a failed fetch with an EMPTY plane keeps the outage dead-end exactly as before', async () => {
        mockUseOptionalFarmContext.mockReturnValue({ currentFarmId: 'farm-1' });
        mockFetchLabourData.mockRejectedValue(new Error('server down'));
        mockGetLocalAttendanceMarks.mockResolvedValue([]);
        mockGetLocalAttendanceNameHints.mockResolvedValue(new Map());

        const { result } = renderHook(() => useLabourState());

        await waitFor(() => expect(result.current.error).toBe(true));
        expect(result.current.data).toBe(EMPTY_LABOUR_DATA);
    });

    it('a throwing local plane degrades to no overlay — never a crash, never an error flag', async () => {
        mockUseOptionalFarmContext.mockReturnValue({ currentFarmId: 'farm-1' });
        const real = serverData();
        mockFetchLabourData.mockResolvedValue(real);
        mockGetLocalAttendanceMarks.mockRejectedValue(new Error('no indexedDB here'));

        const { result } = renderHook(() => useLabourState());

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.data).toBe(real); // identity — the overlay was a no-op
        expect(result.current.error).toBe(false);
    });
});
