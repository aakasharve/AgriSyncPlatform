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
 *
 * TASK 17 (spec: 2026-08-28-labour-v2-release-1) — R14 SUPERSEDED. R14 reset
 * the window to `DEFAULT_LABOUR_WINDOW` on every mount so a farmer's choice
 * never survived leaving आढावा. The founder reversed that: his choice is now
 * REMEMBERED. The describe block at the bottom of this file locks the
 * persistence half of that reversal, against the REAL `SessionStore` (not
 * mocked here — it is the thing under test), matching `getCurrentFarmId`'s
 * own pattern: absent -> default, corrupt/unrecognised -> default, and never
 * a raw stored string reaching the server unvalidated.
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
import { SessionStore } from '../../../infrastructure/storage/SessionStore';

afterEach(() => {
    cleanup();
    mockUseOptionalFarmContext.mockReset();
    mockFetchLabourData.mockReset();
    mockUseOptionalAuth.mockReset();
    mockUseOptionalAuth.mockReturnValue(null);
    // TASK 17 — the persistence describe block below writes through the
    // REAL SessionStore (jsdom's real localStorage). Without this, a value
    // written by one test would leak into the next test's "fresh" hook
    // mount within this same file — including the pre-existing tests above,
    // whose `it.each` walks every non-default window and would otherwise
    // leave 'month' sitting in storage for whatever runs next.
    window.localStorage.clear();
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

/**
 * TASK 17 (spec: 2026-08-28-labour-v2-release-1) — R14 superseded: the
 * founder's choice on आढावा is now REMEMBERED across visits, because leaving
 * आढावा unmounts `LabourFeature` (and this hook with it) — `SessionStore` is
 * the only thing still standing on the next mount. Offline-first, cheap-
 * handset constraints apply exactly as they do to `getCurrentFarmId`:
 * absent -> the founder-chosen default; corrupt/unrecognised -> the same
 * default, never forwarded to the server; a throwing storage access ->
 * degrades to the default rather than crashing the screen (proven for
 * `SessionStore` itself, not re-proven here).
 */
describe('useLabourState — the window is remembered across visits (Task 17, R14 superseded)', () => {
    it('a window picked in one visit is still selected the next time the hook mounts (leaving and returning to आढावा)', async () => {
        mockUseOptionalFarmContext.mockReturnValue({ currentFarmId: 'farm-1' });
        mockFetchLabourData.mockResolvedValue(EMPTY_LABOUR_DATA);

        const first = renderHook(() => useLabourState());
        await waitFor(() => expect(mockFetchLabourData).toHaveBeenCalledTimes(1));
        act(() => first.result.current.setTimeWindow('week'));
        await waitFor(() => expect(mockFetchLabourData).toHaveBeenCalledTimes(2));

        // Leaving आढावा unmounts LabourFeature, and this hook with it — a
        // fresh farm-navigation, not a re-render, is what a real visit ends
        // with. `first.unmount()` is the closest this test level gets to that.
        first.unmount();
        mockFetchLabourData.mockClear();

        // Returning re-mounts the hook from nothing — no props, no context,
        // carries the choice forward. Only SessionStore can have remembered it.
        const second = renderHook(() => useLabourState());

        expect(second.result.current.timeWindow).toBe('week');
        await waitFor(() => expect(mockFetchLabourData).toHaveBeenCalledWith('farm-1', 'week'));
    });

    it('a fresh install (nothing ever stored) still opens on आजपर्यंत — absence is never treated as a chosen window', () => {
        mockUseOptionalFarmContext.mockReturnValue({ currentFarmId: 'farm-1' });
        mockFetchLabourData.mockResolvedValue(EMPTY_LABOUR_DATA);
        expect(SessionStore.getLabourWindow()).toBeNull(); // sanity: truly nothing stored

        const { result } = renderHook(() => useLabourState());

        expect(result.current.timeWindow).toBe(DEFAULT_LABOUR_WINDOW);
    });

    it('a corrupt/unrecognised stored value falls back to आजपर्यंत — never reaches the server unvalidated', async () => {
        mockUseOptionalFarmContext.mockReturnValue({ currentFarmId: 'farm-1' });
        mockFetchLabourData.mockResolvedValue(EMPTY_LABOUR_DATA);
        // Simulates an old build's stale value, or a hand-edited store — a
        // string that was never one of the four windows this build knows.
        SessionStore.setLabourWindow('this-week-actually');

        const { result } = renderHook(() => useLabourState());

        expect(result.current.timeWindow).toBe(DEFAULT_LABOUR_WINDOW);
        await waitFor(() => expect(mockFetchLabourData).toHaveBeenCalledTimes(1));
        expect(mockFetchLabourData).toHaveBeenCalledWith('farm-1', 'alltime');
        expect(mockFetchLabourData).not.toHaveBeenCalledWith('farm-1', 'this-week-actually');
    });

    it('selecting a window persists it through SessionStore, not just in component state', async () => {
        mockUseOptionalFarmContext.mockReturnValue({ currentFarmId: 'farm-1' });
        mockFetchLabourData.mockResolvedValue(EMPTY_LABOUR_DATA);

        const { result } = renderHook(() => useLabourState());
        await waitFor(() => expect(mockFetchLabourData).toHaveBeenCalledTimes(1));

        act(() => result.current.setTimeWindow('month'));
        await waitFor(() => expect(mockFetchLabourData).toHaveBeenCalledTimes(2));

        expect(SessionStore.getLabourWindow()).toBe('month');
    });
});
