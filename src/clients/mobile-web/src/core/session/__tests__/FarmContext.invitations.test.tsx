// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 — lane MU-2 (MU design §5, §6: visible ≠ operational). /me/context
 * now carries the person's waiting personal invitations beside his farms. A waiting invitation — and the request a claim
 * makes — is never a farm in the switcher and never the current farm: only an Active seat is.
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
import { storageNamespace } from '../../../infrastructure/storage/StorageNamespace';
import { writeActiveUserId } from '../../../infrastructure/storage/activeUserId';

const wrapper = ({ children }: { children: React.ReactNode }) => <FarmContextProvider>{children}</FarmContextProvider>;
const invitation = {
    invitationId: 'inv-1', farmName: 'पाटील फार्म', invitedByName: 'रामराव', label: 'Family', name: null,
    plotScope: 'AllPlots', plotNames: [], authorities: [{ name: 'TakeAttendance', expiresAtUtc: null }],
    expiresAtUtc: '2026-11-13T06:00:00Z', namesAWorker: false,
};

beforeEach(() => {
    window.localStorage.clear();
    writeActiveUserId('user-A');
    storageNamespace.setNamespace('user');
});
afterEach(() => { cleanup(); mockFetchMeContext.mockReset(); });

describe('FarmContext — a waiting invitation is not a farm', () => {
    it('only invitations and a waiting claim: no farm in the switcher, no current farm', async () => {
        mockFetchMeContext.mockResolvedValue({
            me: { userId: 'user-A' }, share: {}, alerts: [], serverTimeUtc: '',
            farms: [{ farmId: 'farm-claimed', name: 'पाटील फार्म', role: 'SecondaryOwner', status: 'PendingApproval' }],
            invitations: [invitation],
        });

        const { result } = renderHook(() => useFarmContext(), { wrapper });
        await waitFor(() => expect(result.current.isLoading).toBe(false));
        await waitFor(() => expect(mockFetchMeContext).toHaveBeenCalled());

        expect(result.current.farms).toEqual([]);
        expect(result.current.currentFarmId).toBeNull();
    });

    it('beside an Active farm, only that farm is listed', async () => {
        mockFetchMeContext.mockResolvedValue({
            me: { userId: 'user-A' }, share: {}, alerts: [], serverTimeUtc: '',
            farms: [{ farmId: 'farm-mine', name: 'माझं शेत', role: 'PrimaryOwner', status: 'Active' }],
            invitations: [invitation],
        });

        const { result } = renderHook(() => useFarmContext(), { wrapper });
        await waitFor(() => expect(result.current.currentFarmId).toBe('farm-mine'));
        expect(result.current.farms.map(f => f.farmId)).toEqual(['farm-mine']);
    });
});
