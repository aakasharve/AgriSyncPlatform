// @vitest-environment jsdom
// spec: 2026-08-25-prod-cutover-waves
// Offline cold start opens on a token-less presence session. When the online
// refresh upgrades it to a REAL token, isAuthenticated/userId do not change,
// so farm data fetched (and failed) while offline must be refetched.
import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';

const mockFetchMeContext = vi.fn();
vi.mock('../MeContextService', () => ({
    fetchMeContext: (o?: { force?: boolean }) => mockFetchMeContext(o),
    invalidateMeContext: vi.fn(),
}));
const mockGetMyFarms = vi.fn();
vi.mock('../../../features/onboarding/qr/inviteApi', () => ({
    getMyFarms: () => mockGetMyFarms(),
}));
let authValue: { isAuthenticated: boolean; session: { userId: string; accessToken: string } | null };
vi.mock('../../../app/providers/AuthProvider', () => ({ useAuth: () => authValue }));
vi.mock('../../../infrastructure/storage/SessionStore', () => ({
    SessionStore: {
        getCurrentFarmId: () => null, setCurrentFarmId: vi.fn(), clearCurrentFarmId: vi.fn(),
        getCurrentFarmIdForUser: () => null, setCurrentFarmIdForUser: vi.fn(),
    },
}));

import { FarmContextProvider, useFarmContext } from '../FarmContext';
import { useFarmContextState } from '../../../app/hooks/useFarmContextState';

const presence = () => ({ isAuthenticated: true, session: { userId: 'u1', accessToken: '' } });
const real = () => ({ isAuthenticated: true, session: { userId: 'u1', accessToken: 'tok-real' } });

afterEach(() => { cleanup(); mockFetchMeContext.mockReset(); mockGetMyFarms.mockReset(); });

describe('presence -> real token refetches farm data', () => {
    it('FarmContextProvider: offline loadFailed clears after the real token arrives', async () => {
        authValue = presence();
        mockFetchMeContext.mockRejectedValueOnce(new Error('offline'));
        const wrapper = ({ children }: { children: React.ReactNode }) => <FarmContextProvider>{children}</FarmContextProvider>;
        const { result, rerender } = renderHook(() => useFarmContext(), { wrapper });
        await waitFor(() => expect(result.current.loadFailed).toBe(true));
        expect(mockFetchMeContext).toHaveBeenCalledTimes(1);

        mockFetchMeContext.mockResolvedValueOnce({
            me: { userId: 'u1' }, farms: [{ farmId: 'f1', name: 'F' }], share: {}, alerts: [], serverTimeUtc: 'x',
        });
        authValue = real();
        rerender();
        await waitFor(() => expect(result.current.loadFailed).toBe(false));
        expect(mockFetchMeContext).toHaveBeenCalledTimes(2);
        expect(result.current.farms.map(f => f.farmId)).toEqual(['f1']);
    });

    it('useFarmContextState: empty offline myFarms is refetched after the real token arrives', async () => {
        authValue = presence();
        mockGetMyFarms.mockRejectedValueOnce(new Error('offline'));
        const { result, rerender } = renderHook(() => useFarmContextState());
        await waitFor(() => expect(result.current.myFarms).toEqual([]));
        expect(mockGetMyFarms).toHaveBeenCalledTimes(1);

        mockGetMyFarms.mockResolvedValueOnce([{ farmId: 'f1', name: 'F' }]);
        authValue = real();
        rerender();
        await waitFor(() => expect(result.current.myFarms?.length).toBe(1));
        expect(mockGetMyFarms).toHaveBeenCalledTimes(2);
    });

    it('a session that already has a real token does not refetch extra', async () => {
        authValue = real();
        mockFetchMeContext.mockResolvedValue({ me: {}, farms: [], share: {}, alerts: [], serverTimeUtc: 'x' });
        const wrapper = ({ children }: { children: React.ReactNode }) => <FarmContextProvider>{children}</FarmContextProvider>;
        const { rerender } = renderHook(() => useFarmContext(), { wrapper });
        await waitFor(() => expect(mockFetchMeContext).toHaveBeenCalledTimes(1));
        rerender();
        expect(mockFetchMeContext).toHaveBeenCalledTimes(1);
    });
});
