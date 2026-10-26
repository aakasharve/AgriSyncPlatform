// @vitest-environment jsdom
/**
 * spec: plr-d7-m1-multiuser-2026-10-26 (step 1, F2) — /me/context lists every seat that has not
 * ended, so it can carry a typed-code join request still waiting for the owner
 * (status "PendingApproval"). The server grants that seat nothing, so the app-wide farm context
 * must never list it or make it the current farm. REAL pointer store (as the accessRevoked suite).
 */
import React from 'react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';

const mockFetchMeContext = vi.fn();
vi.mock('../MeContextService', () => ({
    fetchMeContext: (opts?: { force?: boolean }) => mockFetchMeContext(opts),
    invalidateMeContext: vi.fn(),
}));
vi.mock('../../../app/providers/AuthProvider', () => ({
    useAuth: () => ({ isAuthenticated: true, session: { userId: 'user-A', accessToken: 'tok' } }),
}));

import { FarmContextProvider, useFarmContext } from '../FarmContext';
import { SessionStore } from '../../../infrastructure/storage/SessionStore';
import { storageNamespace } from '../../../infrastructure/storage/StorageNamespace';
import { writeActiveUserId } from '../../../infrastructure/storage/activeUserId';

const wrapper = ({ children }: { children: React.ReactNode }) => (
    <FarmContextProvider>{children}</FarmContextProvider>
);
const seat = (farmId: string, status: string, role = 'Worker') => ({ farmId, name: farmId, role, status });
const ctx = (farms: unknown[]) => ({ me: { userId: 'user-A' }, farms, share: {}, alerts: [], serverTimeUtc: '' });

beforeEach(() => {
    window.localStorage.clear();
    writeActiveUserId('user-A');
    storageNamespace.setNamespace('user');
});
afterEach(() => { cleanup(); mockFetchMeContext.mockReset(); });

describe('FarmContext - a pending join request is not a farm', () => {
    it('a person whose only seat is a pending request gets NO current farm', async () => {
        mockFetchMeContext.mockResolvedValue(ctx([seat('farm-asked', 'PendingApproval')]));

        const { result } = renderHook(() => useFarmContext(), { wrapper });
        await waitFor(() => expect(result.current.isLoading).toBe(false));
        await waitFor(() => expect(mockFetchMeContext).toHaveBeenCalled());

        expect(result.current.currentFarmId).toBeNull();
        expect(result.current.farms).toEqual([]);
        expect(SessionStore.getCurrentFarmIdForUser('user-A')).toBeNull();
    });

    it('beside an Active farm, the request is neither listed nor picked', async () => {
        mockFetchMeContext.mockResolvedValue(ctx([
            seat('farm-asked', 'PendingApproval'),
            seat('farm-mine', 'Active', 'PrimaryOwner'),
        ]));

        const { result } = renderHook(() => useFarmContext(), { wrapper });
        await waitFor(() => expect(result.current.currentFarmId).toBe('farm-mine'));
        expect(result.current.farms.map(f => f.farmId)).toEqual(['farm-mine']);
    });
});
