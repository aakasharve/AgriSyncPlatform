// @vitest-environment jsdom
// spec: 2026-08-25-prod-cutover-waves
/**
 * ACCESS REVOCATION (founder 2026-10-12). A Worker whose farm membership was
 * removed gets a SUCCESSFUL /me that no longer lists the farm. The Labour
 * read-out and roster cached for that farm are then not his to keep or show:
 * they are purged, and the stale farm pointer goes with them. Other farms'
 * caches and other users' caches are untouched. REAL cache + pointer stores.
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
import { writeLabourReadout, readLabourReadout } from '../../../infrastructure/storage/LabourReadoutCache';
import { storageNamespace } from '../../../infrastructure/storage/StorageNamespace';
import { writeActiveUserId } from '../../../infrastructure/storage/activeUserId';
import { readCachedRoster, writeCachedRoster } from '../../../features/labour/data/fieldOperatorRosterCache';

const wrapper = ({ children }: { children: React.ReactNode }) => (
    <FarmContextProvider>{children}</FarmContextProvider>
);
const farm = (farmId: string) => ({ farmId, name: farmId, role: 'Worker' });
const ctx = (farms: unknown[]) => ({ me: { userId: 'user-A' }, farms, share: {}, alerts: [], serverTimeUtc: '' });
const op = { id: 'p1', displayName: 'Ramesh', isActive: true } as never;

beforeEach(() => {
    window.localStorage.clear();
    writeActiveUserId('user-A');
    storageNamespace.setNamespace('user');
});
afterEach(() => { cleanup(); mockFetchMeContext.mockReset(); });

describe('FarmContext - membership removed', () => {
    it('purges the removed farm\'s read-out + roster + pointer; keeps the other farm and other users', async () => {
        SessionStore.setCurrentFarmIdForUser('user-A', 'farm-gone');
        writeLabourReadout('user-A', 'farm-gone', 'alltime', { x: 1 });
        writeLabourReadout('user-A', 'farm-gone', 'week', { x: 1 });
        writeCachedRoster('farm-gone', [op]);
        writeLabourReadout('user-A', 'farm-kept', 'alltime', { x: 2 });
        writeCachedRoster('farm-kept', [op]);
        writeLabourReadout('user-B', 'farm-gone', 'alltime', { x: 3 });
        mockFetchMeContext.mockResolvedValue(ctx([farm('farm-kept')]));

        const { result } = renderHook(() => useFarmContext(), { wrapper });
        await waitFor(() => expect(result.current.currentFarmId).toBe('farm-kept'));

        expect(readLabourReadout('user-A', 'farm-gone', 'alltime')).toBeNull();
        expect(readLabourReadout('user-A', 'farm-gone', 'week')).toBeNull();
        expect(readCachedRoster('farm-gone')).toBeNull();
        expect(readLabourReadout('user-A', 'farm-kept', 'alltime')).not.toBeNull();
        expect(readCachedRoster('farm-kept')).not.toBeNull();
        expect(readLabourReadout('user-B', 'farm-gone', 'alltime')).not.toBeNull();
    });

    it('a worker left with NO farm: caches purged and the pointer is erased, not left dangling', async () => {
        SessionStore.setCurrentFarmIdForUser('user-A', 'farm-gone');
        writeLabourReadout('user-A', 'farm-gone', 'alltime', { x: 1 });
        writeCachedRoster('farm-gone', [op]);
        mockFetchMeContext.mockResolvedValue(ctx([]));

        const { result } = renderHook(() => useFarmContext(), { wrapper });
        await waitFor(() => expect(result.current.isLoading).toBe(false));
        await waitFor(() => expect(result.current.currentFarmId).toBeNull());

        expect(readLabourReadout('user-A', 'farm-gone', 'alltime')).toBeNull();
        expect(readCachedRoster('farm-gone')).toBeNull();
        expect(SessionStore.getCurrentFarmIdForUser('user-A')).toBeNull();
    });

    it('a FAILED /me (offline) purges nothing - unknown is not revoked', async () => {
        SessionStore.setCurrentFarmIdForUser('user-A', 'farm-a');
        writeLabourReadout('user-A', 'farm-a', 'alltime', { x: 1 });
        writeCachedRoster('farm-a', [op]);
        mockFetchMeContext.mockRejectedValue(new Error('Network Error'));

        const { result } = renderHook(() => useFarmContext(), { wrapper });
        await waitFor(() => expect(result.current.loadFailed).toBe(true));

        expect(readLabourReadout('user-A', 'farm-a', 'alltime')).not.toBeNull();
        expect(readCachedRoster('farm-a')).not.toBeNull();
    });
});
