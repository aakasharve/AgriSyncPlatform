// @vitest-environment jsdom
/**
 * FarmContext - the remembered farm id after an offline cold start.
 *
 * When /me fails offline the only farm id available is the pointer this user
 * had server-confirmed last time. It must (a) be used, (b) be read for THE
 * SIGNED-IN USER explicitly (the per-user storage namespace follows the session
 * a render later, so the ambient namespace can still be the previous farmer's),
 * (c) be dropped on logout and on a user change, and (d) never be invented.
 */
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act, cleanup } from '@testing-library/react';

const mockFetchMeContext = vi.fn();
vi.mock('../MeContextService', () => ({
    fetchMeContext: (opts?: { force?: boolean }) => mockFetchMeContext(opts),
    invalidateMeContext: vi.fn(),
}));

let auth: { isAuthenticated: boolean; session: { userId: string; accessToken: string } | null } =
    { isAuthenticated: true, session: { userId: 'user-A', accessToken: '' } };
vi.mock('../../../app/providers/AuthProvider', () => ({
    useAuth: () => auth,
}));

// Per-user pointers, plus an AMBIENT user that lags the session (as in the app).
const pointers: Record<string, string> = {};
let ambientUser = 'user-A';
vi.mock('../../../infrastructure/storage/SessionStore', () => ({
    SessionStore: {
        getCurrentFarmId: () => pointers[ambientUser] ?? null,
        setCurrentFarmId: (id: string) => { pointers[ambientUser] = id; },
        clearCurrentFarmId: () => { delete pointers[ambientUser]; },
        getCurrentFarmIdForUser: (u: string) => pointers[u] ?? null,
        setCurrentFarmIdForUser: (u: string, id: string) => { pointers[u] = id; },
    },
}));

import { FarmContextProvider, useFarmContext } from '../FarmContext';

const wrapper = ({ children }: { children: React.ReactNode }) => (
    <FarmContextProvider>{children}</FarmContextProvider>
);

afterEach(() => {
    cleanup();
    mockFetchMeContext.mockReset();
    for (const k of Object.keys(pointers)) delete pointers[k];
    ambientUser = 'user-A';
    auth = { isAuthenticated: true, session: { userId: 'user-A', accessToken: '' } };
});

describe('FarmContext - remembered farm after an offline cold start', () => {
    it('uses the farm id this user had confirmed, with loadFailed true and no farm object', async () => {
        pointers['user-A'] = 'farm-A';
        mockFetchMeContext.mockRejectedValue(new Error('offline'));
        const { result } = renderHook(() => useFarmContext(), { wrapper });
        await waitFor(() => expect(result.current.loadFailed).toBe(true));
        expect(result.current.currentFarmId).toBe('farm-A');
        expect(result.current.currentFarm).toBeNull();
    });

    it('invents nothing: no remembered id means no farm id', async () => {
        mockFetchMeContext.mockRejectedValue(new Error('offline'));
        const { result } = renderHook(() => useFarmContext(), { wrapper });
        await waitFor(() => expect(result.current.loadFailed).toBe(true));
        expect(result.current.currentFarmId).toBeNull();
    });

    it('a user change drops the previous user\'s farm id, even while the ambient namespace still points at them', async () => {
        pointers['user-A'] = 'farm-A';
        mockFetchMeContext.mockRejectedValue(new Error('offline'));
        const { result, rerender } = renderHook(() => useFarmContext(), { wrapper });
        await waitFor(() => expect(result.current.currentFarmId).toBe('farm-A'));

        // B signs in; ambientUser (activeUserId) has NOT caught up yet.
        auth = { isAuthenticated: true, session: { userId: 'user-B', accessToken: '' } };
        rerender();
        await waitFor(() => expect(result.current.currentFarmId).toBeNull());
        expect(pointers['user-A']).toBe('farm-A'); // A's own pointer untouched
        expect(pointers['user-B']).toBeUndefined();
    });

    it('a server-confirmed farm is written under THE SIGNED-IN USER, not the lagging ambient one', async () => {
        ambientUser = 'user-A';
        auth = { isAuthenticated: true, session: { userId: 'user-B', accessToken: 't' } };
        mockFetchMeContext.mockResolvedValue({
            me: { userId: 'user-B' }, farms: [{ farmId: 'farm-B', name: 'B' }],
            share: {}, alerts: [], serverTimeUtc: '',
        });
        const { result } = renderHook(() => useFarmContext(), { wrapper });
        await waitFor(() => expect(result.current.currentFarmId).toBe('farm-B'));
        expect(pointers['user-B']).toBe('farm-B');
        expect(pointers['user-A']).toBeUndefined();
    });

    it('logout drops the in-memory farm id', async () => {
        pointers['user-A'] = 'farm-A';
        mockFetchMeContext.mockRejectedValue(new Error('offline'));
        const { result, rerender } = renderHook(() => useFarmContext(), { wrapper });
        await waitFor(() => expect(result.current.currentFarmId).toBe('farm-A'));

        auth = { isAuthenticated: false, session: null };
        await act(async () => { rerender(); });
        await waitFor(() => expect(result.current.currentFarmId).toBeNull());
    });
});
