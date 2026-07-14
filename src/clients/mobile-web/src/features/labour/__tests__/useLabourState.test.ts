// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * useLabourState tests — MONEY-SAFETY lock, spec:
 * 2026-07-13-labour-attendance-approval-design.
 *
 * The bug this locks: a REAL farm (farmId present) must NEVER render
 * `LABOUR_MOCK` (रोकडे/रमेश/सुनीता + their mock ₹ balances) — not on first
 * paint, not on a fetch error. Only the no-farm-context path (preview /
 * no provider) may show the mock.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor, act, cleanup } from '@testing-library/react';

const mockUseOptionalFarmContext = vi.fn();
vi.mock('../../../core/session/FarmContext', () => ({
    useOptionalFarmContext: () => mockUseOptionalFarmContext(),
}));

const mockFetchLabourData = vi.fn();
vi.mock('../data/labourClient', () => ({
    fetchLabourData: (farmId: string) => mockFetchLabourData(farmId),
}));

import { useLabourState } from '../useLabourState';
import { LABOUR_MOCK, EMPTY_LABOUR_DATA } from '../labourMock';

afterEach(() => {
    cleanup();
    mockUseOptionalFarmContext.mockReset();
    mockFetchLabourData.mockReset();
});

describe('useLabourState — money safety', () => {
    it('no farm context (preview) → LABOUR_MOCK, no error', () => {
        mockUseOptionalFarmContext.mockReturnValue(null);

        const { result } = renderHook(() => useLabourState());

        // Preview is defined strictly as the null-provider case (no FarmContext at all).
        expect(mockUseOptionalFarmContext()).toBe(null);
        expect(result.current.data).toBe(LABOUR_MOCK);
        expect(result.current.error).toBe(false);
        expect(mockFetchLabourData).not.toHaveBeenCalled();
    });

    it('provider present but farm still loading (currentFarmId null, isLoading true) → EMPTY_LABOUR_DATA, never mock', () => {
        mockUseOptionalFarmContext.mockReturnValue({ currentFarmId: null, isLoading: true });

        const { result } = renderHook(() => useLabourState());

        expect(result.current.data).toBe(EMPTY_LABOUR_DATA);
        expect(result.current.data).not.toBe(LABOUR_MOCK);
        expect(Object.keys(result.current.data.people)).toHaveLength(0);
        expect(result.current.data.dashboard.money).toEqual({ recorded: 0, paid: 0, advance: 0, owed: 0 });
        expect(result.current.error).toBe(false);
        expect(result.current.loading).toBe(true);
        expect(mockFetchLabourData).not.toHaveBeenCalled();
    });

    it('real farm + successful fetch → real data, no mock, no error', async () => {
        mockUseOptionalFarmContext.mockReturnValue({ currentFarmId: 'farm-1' });
        const real = { ...EMPTY_LABOUR_DATA, topLevelIds: ['w1'], people: { w1: {} } };
        mockFetchLabourData.mockResolvedValueOnce(real);

        const { result } = renderHook(() => useLabourState());

        // Immediately (before the fetch resolves) — never the mock for a real farm.
        expect(result.current.data).toBe(EMPTY_LABOUR_DATA);
        expect(result.current.data).not.toBe(LABOUR_MOCK);

        await waitFor(() => expect(result.current.data).toBe(real));
        expect(result.current.error).toBe(false);
    });

    it('real farm + fetch error → EMPTY_LABOUR_DATA (no mock people/money) + error true', async () => {
        mockUseOptionalFarmContext.mockReturnValue({ currentFarmId: 'farm-2' });
        mockFetchLabourData.mockRejectedValueOnce(new Error('fetchLabourData failed: 500'));

        const { result } = renderHook(() => useLabourState());

        await waitFor(() => expect(result.current.error).toBe(true));

        // The money-safety assertion: NEVER the mock's fake workers/money.
        expect(result.current.data).toBe(EMPTY_LABOUR_DATA);
        expect(result.current.data).not.toBe(LABOUR_MOCK);
        expect(Object.keys(result.current.data.people)).toHaveLength(0);
        expect(result.current.data.dashboard.money).toEqual({ recorded: 0, paid: 0, advance: 0, owed: 0 });
        expect(result.current.loading).toBe(false);
    });

    it('refresh() re-runs the fetch for the current farm and can recover from error', async () => {
        mockUseOptionalFarmContext.mockReturnValue({ currentFarmId: 'farm-3' });
        mockFetchLabourData.mockRejectedValueOnce(new Error('boom'));

        const { result } = renderHook(() => useLabourState());
        await waitFor(() => expect(result.current.error).toBe(true));

        const real = { ...EMPTY_LABOUR_DATA, topLevelIds: ['w9'], people: { w9: {} } };
        mockFetchLabourData.mockResolvedValueOnce(real);

        act(() => { result.current.refresh(); });

        // `error` flips to false optimistically the moment the retry starts
        // (before the fetch settles) — assert on the settled DATA instead.
        await waitFor(() => expect(result.current.data).toBe(real));
        expect(result.current.error).toBe(false);
        expect(mockFetchLabourData).toHaveBeenCalledTimes(2);
    });
});
