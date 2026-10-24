// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FarmContext — `loadFailed` (Task 6e, spec:
 * 2026-08-28-labour-v2-release-1, P5, Ruling R8).
 *
 * `FarmContext` is consumed across the whole app, so this task's change to
 * it had to be PURELY ADDITIVE: one new boolean, and not one byte of moved
 * behaviour for `isLoading`, `currentFarmId`, `farms`, `currentFarm`,
 * `switchFarm`, or the deliberate silent swallow in the `catch`. Other
 * screens legitimately keep stale data through a failed refresh; this task
 * surfaces information, it does not change that policy.
 *
 * These tests exist to hold that line, and the last one is the important
 * one: it proves the swallow still swallows.
 *
 * (This file is new — there was no FarmContext/session suite before Task
 * 6e. It covers only the flag and the behaviour the flag must not disturb.)
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act, cleanup } from '@testing-library/react';

const mockFetchMeContext = vi.fn();
vi.mock('../MeContextService', () => ({
    fetchMeContext: (opts?: { force?: boolean }) => mockFetchMeContext(opts),
    invalidateMeContext: vi.fn(),
}));

vi.mock('../../../app/providers/AuthProvider', () => ({
    useAuth: () => ({ isAuthenticated: true }),
}));

let storedFarmId: string | null = null;
vi.mock('../../../infrastructure/storage/SessionStore', () => ({
    SessionStore: {
        getCurrentFarmId: () => storedFarmId,
        setCurrentFarmId: (id: string) => { storedFarmId = id; },
        clearCurrentFarmId: () => { storedFarmId = null; },
    },
}));

import { FarmContextProvider, useFarmContext } from '../FarmContext';
import type { MeContext } from '../MeContextService';

const farm = (farmId: string, name: string) => ({
    farmId, name, farmCode: null, ownerAccountId: 'owner-1', role: 'Owner',
    status: 'Active', joinedVia: 'created', plan: 'Free',
    planValidUntilUtc: null,
    capabilities: { canInvite: true, canVerify: true, canAddCost: true, canSeeBilling: true },
});

const meContextWith = (farms: ReturnType<typeof farm>[]) => ({
    me: {
        userId: 'u1', displayName: 'पुरवेश', phoneMasked: '88****8888',
        phoneVerifiedAtUtc: null, preferredLanguage: 'mr', authMode: 'otp',
    },
    farms,
    share: { referralCode: null, referralsTotal: 0, referralsQualified: 0, benefitsEarned: 0 },
    alerts: [],
    serverTimeUtc: '2026-08-28T00:00:00Z',
}) as unknown as MeContext;

const wrapper = ({ children }: { children: React.ReactNode }) => (
    <FarmContextProvider>{children}</FarmContextProvider>
);

beforeEach(() => { storedFarmId = null; });
afterEach(() => {
    cleanup();
    mockFetchMeContext.mockReset();
});

describe('FarmContext — loadFailed (Task 6e)', () => {
    it('a SUCCESSFUL /me leaves loadFailed false, and resolves farms/currentFarmId exactly as before', async () => {
        mockFetchMeContext.mockResolvedValue(meContextWith([farm('f1', 'वरचं शेत')]));

        const { result } = renderHook(() => useFarmContext(), { wrapper });

        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(result.current.loadFailed).toBe(false);
        expect(result.current.farms.map(f => f.farmId)).toEqual(['f1']);
        expect(result.current.currentFarmId).toBe('f1');
        expect(result.current.currentFarm?.farmId).toBe('f1');
    });

    it('a FAILED /me sets loadFailed true and still clears isLoading — the state the labour screen used to read as "no farm"', async () => {
        mockFetchMeContext.mockRejectedValue(new Error('Network Error'));

        const { result } = renderHook(() => useFarmContext(), { wrapper });

        await waitFor(() => expect(result.current.loadFailed).toBe(true));
        // Unchanged: the failure is still swallowed, so these settle exactly
        // as they did before Task 6e. That combination — no farm id, not
        // loading, no error anywhere — is precisely why the flag was needed.
        expect(result.current.isLoading).toBe(false);
        expect(result.current.currentFarmId).toBeNull();
        expect(result.current.farms).toEqual([]);
        expect(result.current.meContext).toBeNull();
    });

    it('a successful refresh AFTER a failure clears loadFailed — the flag reports the last attempt, not a latch', async () => {
        mockFetchMeContext.mockRejectedValueOnce(new Error('Network Error'));

        const { result } = renderHook(() => useFarmContext(), { wrapper });
        await waitFor(() => expect(result.current.loadFailed).toBe(true));

        mockFetchMeContext.mockResolvedValueOnce(meContextWith([farm('f9', 'खालचं शेत')]));
        await act(async () => { await result.current.refresh(); });

        expect(result.current.loadFailed).toBe(false);
        expect(result.current.currentFarmId).toBe('f9');
    });

    // THE BLAST-RADIUS TEST. The swallow is deliberate: a screen that is
    // content with the farm list it already has must not be blanked by a
    // failed refresh. Task 6e added a flag beside that policy, never in
    // place of it.
    it('a failed REFRESH still keeps the stale farm list and current farm — the swallow is untouched', async () => {
        mockFetchMeContext.mockResolvedValueOnce(meContextWith([farm('f1', 'वरचं शेत')]));

        const { result } = renderHook(() => useFarmContext(), { wrapper });
        await waitFor(() => expect(result.current.currentFarmId).toBe('f1'));

        mockFetchMeContext.mockRejectedValueOnce(new Error('Network Error'));
        await act(async () => { await result.current.refresh(); });

        expect(result.current.loadFailed).toBe(true);
        // Stale data kept, exactly as before this task.
        expect(result.current.farms.map(f => f.farmId)).toEqual(['f1']);
        expect(result.current.currentFarmId).toBe('f1');
        expect(result.current.currentFarm?.name).toBe('वरचं शेत');
        expect(result.current.isLoading).toBe(false);
    });
});
