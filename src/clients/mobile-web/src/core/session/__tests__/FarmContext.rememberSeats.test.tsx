// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 - lane CMP-D1 (founder D-81). Every successful /me/context answer
 * REPLACES the seats kept on the phone (appMeta), so an offline cold start can still tell the owner's seat from a
 * worker's; a failed answer keeps what was there. REAL Dexie (fake-indexeddb), the context fetch stubbed.
 */
import 'fake-indexeddb/auto';
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
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { storageNamespace } from '../../../infrastructure/storage/StorageNamespace';
import { writeActiveUserId } from '../../../infrastructure/storage/activeUserId';
import { readLastKnownSeats } from '../lastKnownSeats';

const wrapper = ({ children }: { children: React.ReactNode }) => <FarmContextProvider>{children}</FarmContextProvider>;
const seat = (farmId: string, role: string, authorities: unknown, status = 'Active') => ({ farmId, name: farmId, role, status, authorities });
const ctx = (farms: unknown[]) => ({ me: { userId: 'user-A' }, farms, share: {}, alerts: [], serverTimeUtc: '' });

beforeEach(async () => {
    window.localStorage.clear();
    writeActiveUserId('user-A');
    storageNamespace.setNamespace('user');
    await getDatabase().appMeta.clear();
});
afterEach(() => { cleanup(); mockFetchMeContext.mockReset(); });

describe('FarmContext keeps the last known seats', () => {
    it('an answer is remembered (role + authorities, Active seats only), and the next answer replaces it', async () => {
        mockFetchMeContext.mockResolvedValue(ctx([
            seat('farm-mine', 'PrimaryOwner', [{ name: 'SeeCompare', expiresAtUtc: null }]),
            seat('farm-asked', 'Worker', [], 'PendingApproval'),
        ]));
        const first = renderHook(() => useFarmContext(), { wrapper });
        await waitFor(() => expect(first.result.current.currentFarmId).toBe('farm-mine'));
        await waitFor(async () => expect((await readLastKnownSeats())?.seats.map(s => s.farmId)).toEqual(['farm-mine']));
        expect((await readLastKnownSeats())?.seats[0]).toMatchObject({ role: 'PrimaryOwner' });
        expect((await readLastKnownSeats())?.userId).toBe('user-A');
        first.unmount();

        mockFetchMeContext.mockResolvedValue(ctx([seat('farm-mine', 'Mukadam', [{ name: 'TakeAttendance', expiresAtUtc: null }])]));
        const second = renderHook(() => useFarmContext(), { wrapper });
        await waitFor(async () => expect((await readLastKnownSeats())?.seats[0]).toEqual({
            farmId: 'farm-mine', role: 'Mukadam', authorities: [{ name: 'TakeAttendance', expiresAtUtc: null }],
        }));
        second.unmount();
    });

    it('a failed answer leaves what was kept (offline start)', async () => {
        mockFetchMeContext.mockResolvedValueOnce(ctx([seat('farm-mine', 'PrimaryOwner', [])]));
        const first = renderHook(() => useFarmContext(), { wrapper });
        await waitFor(async () => expect((await readLastKnownSeats())?.seats).toHaveLength(1));
        first.unmount();

        mockFetchMeContext.mockRejectedValue(new Error('offline'));
        const second = renderHook(() => useFarmContext(), { wrapper });
        await waitFor(() => expect(second.result.current.loadFailed).toBe(true));
        expect((await readLastKnownSeats())?.seats[0]).toMatchObject({ farmId: 'farm-mine', role: 'PrimaryOwner' });
    });
});
