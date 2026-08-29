// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * useLabourState — the adjustable time window's STATE half (Task 11, spec:
 * 2026-08-28-labour-v2-release-1).
 *
 * The window lives in the hook, not in a screen, because it is a property of
 * the QUESTION asked of the server, and the hook owns the asking. These tests
 * lock: the opening window, that changing it re-asks the server with the new
 * value, and that a change goes through the SAME honest loading path every
 * other fetch does (spinner, never stale numbers under a new heading).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor, act, cleanup } from '@testing-library/react';

const mockUseOptionalFarmContext = vi.fn();
vi.mock('../../../core/session/FarmContext', () => ({
    useOptionalFarmContext: () => mockUseOptionalFarmContext(),
}));

// NB: unlike `useLabourState.test.ts`'s mock, this one forwards BOTH
// arguments — the window is the second, and it is the whole subject here.
const mockFetchLabourData = vi.fn();
vi.mock('../data/labourClient', () => ({
    fetchLabourData: (...args: unknown[]) => mockFetchLabourData(...args),
}));

const mockUseOptionalAuth = vi.fn(() => null as unknown);
vi.mock('../../../app/providers/AuthProvider', () => ({
    useOptionalAuth: () => mockUseOptionalAuth(),
}));

import { useLabourState } from '../useLabourState';
import { EMPTY_LABOUR_DATA } from '../labourMock';
import { LABOUR_WINDOW_ORDER, DEFAULT_LABOUR_WINDOW } from '../labourWindow';

afterEach(() => {
    cleanup();
    mockUseOptionalFarmContext.mockReset();
    mockFetchLabourData.mockReset();
    mockUseOptionalAuth.mockReset();
    mockUseOptionalAuth.mockReturnValue(null);
});

describe('useLabourState — adjustable time window', () => {
    it('opens on आजपर्यंत (all time) — the founder-chosen default', async () => {
        mockUseOptionalFarmContext.mockReturnValue({ currentFarmId: 'farm-1' });
        mockFetchLabourData.mockResolvedValue(EMPTY_LABOUR_DATA);

        const { result } = renderHook(() => useLabourState());

        expect(result.current.timeWindow).toBe(DEFAULT_LABOUR_WINDOW);
        expect(result.current.timeWindow).toBe('alltime');
        await waitFor(() => expect(mockFetchLabourData).toHaveBeenCalledTimes(1));
        expect(mockFetchLabourData).toHaveBeenCalledWith('farm-1', 'alltime');
    });

    it.each(LABOUR_WINDOW_ORDER.filter((w) => w !== 'alltime'))(
        'selecting %s re-fetches the same farm with that window',
        async (window) => {
            mockUseOptionalFarmContext.mockReturnValue({ currentFarmId: 'farm-1' });
            mockFetchLabourData.mockResolvedValue(EMPTY_LABOUR_DATA);

            const { result } = renderHook(() => useLabourState());
            await waitFor(() => expect(mockFetchLabourData).toHaveBeenCalledTimes(1));

            act(() => result.current.setTimeWindow(window));

            await waitFor(() => expect(mockFetchLabourData).toHaveBeenCalledTimes(2));
            expect(mockFetchLabourData).toHaveBeenLastCalledWith('farm-1', window);
            expect(result.current.timeWindow).toBe(window);
        },
    );

    it('walks every window in turn, asking the server once for each', async () => {
        mockUseOptionalFarmContext.mockReturnValue({ currentFarmId: 'farm-1' });
        mockFetchLabourData.mockResolvedValue(EMPTY_LABOUR_DATA);

        const { result } = renderHook(() => useLabourState());
        await waitFor(() => expect(mockFetchLabourData).toHaveBeenCalledTimes(1));

        for (const window of ['today', 'week', 'month', 'alltime'] as const) {
            act(() => result.current.setTimeWindow(window));
            await waitFor(() => expect(mockFetchLabourData).toHaveBeenLastCalledWith('farm-1', window));
        }

        expect(mockFetchLabourData.mock.calls.map((c) => c[1]))
            .toEqual(['alltime', 'today', 'week', 'month', 'alltime']);
    });

    it('re-selecting the SAME window does not re-ask the server', async () => {
        mockUseOptionalFarmContext.mockReturnValue({ currentFarmId: 'farm-1' });
        mockFetchLabourData.mockResolvedValue(EMPTY_LABOUR_DATA);

        const { result } = renderHook(() => useLabourState());
        await waitFor(() => expect(mockFetchLabourData).toHaveBeenCalledTimes(1));

        act(() => result.current.setTimeWindow('alltime'));
        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(mockFetchLabourData).toHaveBeenCalledTimes(1);
    });

    it('a window change goes through the honest loading path — never the numbers of the previous window under the new heading', async () => {
        mockUseOptionalFarmContext.mockReturnValue({ currentFarmId: 'farm-1' });
        const firstAnswer = { ...EMPTY_LABOUR_DATA, topLevelIds: ['w1'] };
        mockFetchLabourData.mockResolvedValueOnce(firstAnswer);

        const { result } = renderHook(() => useLabourState());
        await waitFor(() => expect(result.current.data).toBe(firstAnswer));

        // Never resolves: the state DURING a window change is what matters.
        mockFetchLabourData.mockReturnValueOnce(new Promise(() => {}));
        act(() => result.current.setTimeWindow('week'));

        // `useLabourState.ts` resets to EMPTY_LABOUR_DATA before every fetch
        // and `LabourFeature` renders the spinner for `loading` — so the
        // farmer sees "आणत आहोत", not last window's answer relabelled.
        expect(result.current.loading).toBe(true);
        expect(result.current.data).toBe(EMPTY_LABOUR_DATA);
        expect(result.current.data).not.toBe(firstAnswer);
    });

    it('a failed fetch under a narrowed window is still an honest error, not an empty period', async () => {
        mockUseOptionalFarmContext.mockReturnValue({ currentFarmId: 'farm-1' });
        mockFetchLabourData.mockResolvedValueOnce(EMPTY_LABOUR_DATA);

        const { result } = renderHook(() => useLabourState());
        await waitFor(() => expect(mockFetchLabourData).toHaveBeenCalledTimes(1));

        mockFetchLabourData.mockRejectedValueOnce(new Error('boom'));
        act(() => result.current.setTimeWindow('today'));

        await waitFor(() => expect(result.current.error).toBe(true));
        expect(result.current.data).toBe(EMPTY_LABOUR_DATA);
    });

    it('refresh() re-asks for the window currently selected, not the default', async () => {
        mockUseOptionalFarmContext.mockReturnValue({ currentFarmId: 'farm-1' });
        mockFetchLabourData.mockResolvedValue(EMPTY_LABOUR_DATA);

        const { result } = renderHook(() => useLabourState());
        await waitFor(() => expect(mockFetchLabourData).toHaveBeenCalledTimes(1));

        act(() => result.current.setTimeWindow('month'));
        await waitFor(() => expect(mockFetchLabourData).toHaveBeenCalledTimes(2));

        act(() => result.current.refresh());
        await waitFor(() => expect(mockFetchLabourData).toHaveBeenCalledTimes(3));
        expect(mockFetchLabourData).toHaveBeenLastCalledWith('farm-1', 'month');
    });

    it('preview (no farm provider) exposes the default window and asks nothing', () => {
        mockUseOptionalFarmContext.mockReturnValue(null);

        const { result } = renderHook(() => useLabourState());

        expect(result.current.timeWindow).toBe('alltime');
        expect(mockFetchLabourData).not.toHaveBeenCalled();
    });
});
