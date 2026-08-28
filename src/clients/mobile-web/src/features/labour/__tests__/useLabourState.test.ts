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
 *
 * Task 6c (spec: 2026-08-28-labour-v2-release-1, P4) — the `dashboard.money`
 * assertions below were updated from `{ recorded: 0, ..., owed: 0 }` to
 * `{ recorded: null, ..., owed: null }`. That `0` was pinning the exact
 * defect Task 6c fixes: `EMPTY_LABOUR_DATA` hardcoded a fabricated ₹0
 * instead of the unknown `null` Task 1 already made these fields capable of
 * expressing. The assertions still prove the same thing (no mock money
 * leaks into this state) — only the honest shape of "no money" changed.
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

// BUG 1 (2026-08-10): the hook now also asks whether auth has settled before
// firing. `useOptionalAuth` is the non-throwing accessor (mirrors
// `useOptionalFarmContext`); returning `null` means "no AuthProvider in the
// tree at all", which is how every pre-existing test in this file renders —
// there is nothing pending to wait for, so the gate opens.
const mockUseOptionalAuth = vi.fn(() => null as unknown);
vi.mock('../../../app/providers/AuthProvider', () => ({
    useOptionalAuth: () => mockUseOptionalAuth(),
}));

import { useLabourState } from '../useLabourState';
import { LABOUR_MOCK, EMPTY_LABOUR_DATA } from '../labourMock';

afterEach(() => {
    cleanup();
    mockUseOptionalFarmContext.mockReset();
    mockFetchLabourData.mockReset();
    mockUseOptionalAuth.mockReset();
    mockUseOptionalAuth.mockReturnValue(null);
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
        expect(result.current.data.dashboard.money).toEqual({ recorded: null, paid: 0, advance: 0, owed: null });
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
        expect(result.current.data.dashboard.money).toEqual({ recorded: null, paid: 0, advance: 0, owed: null });
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

// ---------------------------------------------------------------------------
// BUG 1 (2026-08-10) — auth gate.
//
// `currentFarmId` is restored from localStorage, so a farm id exists on the
// very first render — before AuthProvider's boot refresh has put an access
// token back in memory. Fetching then produced a guaranteed 401, a latched
// `error = true`, and a farmer stuck on "माहिती आणता आली नाही" until he tapped
// retry. These tests lock the wait-for-auth behaviour AND that the wait is
// honest (empty state, never mock money, never a false error).
// ---------------------------------------------------------------------------

describe('useLabourState — auth gate (BUG 1)', () => {
    it('does NOT fetch while auth is still checking, even though a farm id already exists', () => {
        mockUseOptionalFarmContext.mockReturnValue({ currentFarmId: 'farm-boot', isLoading: false });
        mockUseOptionalAuth.mockReturnValue({ authStatus: 'checking', session: null });

        const { result } = renderHook(() => useLabourState());

        expect(mockFetchLabourData).not.toHaveBeenCalled();
        // Honest: a spinner, not an error banner and not mock money.
        expect(result.current.loading).toBe(true);
        expect(result.current.error).toBe(false);
        expect(result.current.data).toBe(EMPTY_LABOUR_DATA);
        expect(result.current.data).not.toBe(LABOUR_MOCK);
    });

    it('does NOT fetch when authenticated but the access token is not in memory yet', () => {
        mockUseOptionalFarmContext.mockReturnValue({ currentFarmId: 'farm-boot', isLoading: false });
        mockUseOptionalAuth.mockReturnValue({ authStatus: 'authenticated', session: null });

        const { result } = renderHook(() => useLabourState());

        expect(mockFetchLabourData).not.toHaveBeenCalled();
        expect(result.current.error).toBe(false);
        expect(result.current.data).toBe(EMPTY_LABOUR_DATA);
    });

    it('fires exactly once, WITHOUT a manual retry, as soon as the access token lands', async () => {
        mockUseOptionalFarmContext.mockReturnValue({ currentFarmId: 'farm-boot', isLoading: false });
        mockUseOptionalAuth.mockReturnValue({ authStatus: 'checking', session: null });

        const { result, rerender } = renderHook(() => useLabourState());
        expect(mockFetchLabourData).not.toHaveBeenCalled();

        const real = { ...EMPTY_LABOUR_DATA, topLevelIds: ['w1'], people: { w1: {} } };
        mockFetchLabourData.mockResolvedValueOnce(real);

        // Boot refresh completes: token is in memory, status flips.
        mockUseOptionalAuth.mockReturnValue({
            authStatus: 'authenticated',
            session: { accessToken: 'tok-1', userId: 'u1', expiresAtUtc: '2099-01-01T00:00:00Z' },
        });
        rerender();

        await waitFor(() => expect(result.current.data).toBe(real));
        expect(mockFetchLabourData).toHaveBeenCalledTimes(1);
        expect(mockFetchLabourData).toHaveBeenCalledWith('farm-boot');
        // The whole point: no error banner was ever shown, so nobody had to tap retry.
        expect(result.current.error).toBe(false);
    });

    it('anonymous session shows the honest empty state — not a spinner, not an error, never the mock', () => {
        mockUseOptionalFarmContext.mockReturnValue({ currentFarmId: 'farm-boot', isLoading: false });
        mockUseOptionalAuth.mockReturnValue({ authStatus: 'anonymous', session: null });

        const { result } = renderHook(() => useLabourState());

        expect(mockFetchLabourData).not.toHaveBeenCalled();
        expect(result.current.loading).toBe(false);
        expect(result.current.error).toBe(false);
        expect(result.current.data).toBe(EMPTY_LABOUR_DATA);
        expect(result.current.data).not.toBe(LABOUR_MOCK);
    });

    it('MONEY-SAFETY still holds under the gate: a real farm whose fetch fails shows EMPTY, never LABOUR_MOCK', async () => {
        mockUseOptionalFarmContext.mockReturnValue({ currentFarmId: 'farm-boot', isLoading: false });
        mockUseOptionalAuth.mockReturnValue({
            authStatus: 'authenticated',
            session: { accessToken: 'tok-1', userId: 'u1', expiresAtUtc: '2099-01-01T00:00:00Z' },
        });
        mockFetchLabourData.mockRejectedValueOnce(new Error('Request failed with status code 500'));

        const { result } = renderHook(() => useLabourState());

        await waitFor(() => expect(result.current.error).toBe(true));
        expect(result.current.data).toBe(EMPTY_LABOUR_DATA);
        expect(result.current.data).not.toBe(LABOUR_MOCK);
        expect(Object.keys(result.current.data.people)).toHaveLength(0);
        expect(result.current.data.dashboard.money).toEqual({ recorded: null, paid: 0, advance: 0, owed: null });
    });

    it('preview (no FarmContext provider) still shows LABOUR_MOCK regardless of auth', () => {
        mockUseOptionalFarmContext.mockReturnValue(null);
        mockUseOptionalAuth.mockReturnValue(null);

        const { result } = renderHook(() => useLabourState());

        expect(result.current.data).toBe(LABOUR_MOCK);
        expect(mockFetchLabourData).not.toHaveBeenCalled();
    });
});
