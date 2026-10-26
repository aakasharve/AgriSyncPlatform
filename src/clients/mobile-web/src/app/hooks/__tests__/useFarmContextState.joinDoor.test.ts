// @vitest-environment jsdom
/**
 * spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — the join door replaces the old window.prompt.
 *   - every join control opens the ONE screen (prop path or the window event), no prompt;
 *   - the login screen's wish opens it by itself right after sign-in;
 *   - a seat on another farm re-reads the farm list but does not switch the open farm;
 *   - a typed-code request still waiting for the owner (PendingApproval) is NEVER a farm the
 *     person is in: not listed, not picked as the open farm, the 0-farm screen stays (F2);
 *   - once the server lists an Active farm, the 0-farm screen closes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act, cleanup } from '@testing-library/react';

const mockGetMyFarms = vi.fn();
const mockExitMembership = vi.fn();
vi.mock('../../../features/onboarding/qr/inviteApi', () => ({
    getMyFarms: () => mockGetMyFarms(),
    exitMembership: (farmId: string) => mockExitMembership(farmId),
}));
let authValue: { isAuthenticated: boolean; session: { userId: string; accessToken: string } | null };
vi.mock('../../providers/AuthProvider', () => ({ useAuth: () => authValue }));
const setCurrentFarmId = vi.fn();
vi.mock('../../../infrastructure/storage/SessionStore', () => ({
    SessionStore: { getCurrentFarmId: () => null, setCurrentFarmId: (id: string) => setCurrentFarmId(id) },
}));

import { useFarmContextState, requestJoinFarm } from '../useFarmContextState';
import { rememberJoinAfterSignIn } from '../../../features/onboarding/qr/farmCodeEntry';

const FARM_A = { farmId: 'f-a', name: 'A', role: 'PrimaryOwner', farmCode: 'AAAAAA', subscription: null };
const FARM_B = { farmId: 'f-b', name: 'B', role: 'Worker', farmCode: 'BBBBBB', subscription: null };
// What /farms/mine answers for a typed-code join request: the placeholder role, no code, no plan.
const FARM_B_PENDING = { farmId: 'f-b', name: 'B', role: 'Worker', farmCode: null, subscription: null, status: 'PendingApproval' };
const FARM_B_APPROVED = { ...FARM_B, status: 'Active' };

beforeEach(() => {
    window.sessionStorage.clear();
    authValue = { isAuthenticated: true, session: { userId: 'u1', accessToken: 'tok' } };
    mockGetMyFarms.mockReset().mockResolvedValue([FARM_A]);
    mockExitMembership.mockReset().mockResolvedValue({ membershipId: 'm-b', alreadyExited: false });
    setCurrentFarmId.mockReset();
});
afterEach(cleanup);

describe('the join door', () => {
    it('opens from a prop path and from the window event — never a window.prompt', async () => {
        const prompt = vi.spyOn(window, 'prompt').mockImplementation(() => null);
        const { result } = renderHook(() => useFarmContextState());
        await waitFor(() => expect(result.current.myFarms).toEqual([FARM_A]));
        expect(result.current.showJoinByCode).toBe(false);

        act(() => result.current.handleJoinViaQr());
        expect(result.current.showJoinByCode).toBe(true);
        act(() => result.current.closeJoinByCode());
        expect(result.current.showJoinByCode).toBe(false);

        act(() => requestJoinFarm());
        expect(result.current.showJoinByCode).toBe(true);
        expect(prompt).not.toHaveBeenCalled();
        prompt.mockRestore();
    });

    it('opens by itself right after sign-in when the login screen asked for it — once', async () => {
        rememberJoinAfterSignIn();
        const { result } = renderHook(() => useFarmContextState());
        await waitFor(() => expect(result.current.showJoinByCode).toBe(true));
        expect(window.sessionStorage.getItem('agrisync:join-after-sign-in')).toBeNull();
    });

    it('stays shut after sign-in when nobody asked', async () => {
        const { result } = renderHook(() => useFarmContextState());
        await waitFor(() => expect(result.current.myFarms).not.toBeNull());
        expect(result.current.showJoinByCode).toBe(false);
    });

    it('a seat on another farm re-reads the list but keeps the open farm', async () => {
        const { result } = renderHook(() => useFarmContextState());
        await waitFor(() => expect(result.current.currentFarmId).toBe('f-a'));

        mockGetMyFarms.mockResolvedValue([FARM_A, FARM_B_PENDING]);
        act(() => result.current.handleJoinComplete({ farmId: 'f-b', farmName: 'B', status: 'PendingApproval' }));
        await waitFor(() => expect(result.current.pendingFarms).toEqual([FARM_B_PENDING]));
        expect(result.current.myFarms).toEqual([FARM_A]);
        expect(result.current.currentFarmId).toBe('f-a');
    });

    it('a pending request is never the open farm: a 0-farm joiner stays on the 0-farm screen (F2)', async () => {
        mockGetMyFarms.mockResolvedValue([]);
        const { result } = renderHook(() => useFarmContextState());
        await waitFor(() => expect(result.current.showMinimalOnboarding).toBe(true));

        mockGetMyFarms.mockResolvedValue([FARM_B_PENDING]);
        act(() => result.current.handleJoinComplete({ farmId: 'f-b', farmName: 'B', status: 'PendingApproval' }));
        await waitFor(() => expect(result.current.pendingFarms).toEqual([FARM_B_PENDING]));

        // The owner has not let him in: nothing to open, nothing to switch to.
        expect(result.current.myFarms).toEqual([]);
        expect(result.current.currentFarmId).toBeNull();
        expect(setCurrentFarmId).not.toHaveBeenCalled();
        expect(result.current.showMinimalOnboarding).toBe(true);
    });

    it('the 0-farm screen closes once the server lists the farm as Active (the owner approved)', async () => {
        mockGetMyFarms.mockResolvedValue([FARM_B_PENDING]);
        const { result } = renderHook(() => useFarmContextState());
        await waitFor(() => expect(result.current.showMinimalOnboarding).toBe(true));

        mockGetMyFarms.mockResolvedValue([FARM_B_APPROVED]);
        act(() => result.current.handleJoinComplete({ farmId: 'f-b', farmName: 'B', status: 'Active' }));
        await waitFor(() => expect(result.current.showMinimalOnboarding).toBe(false));
        expect(result.current.currentFarmId).toBe('f-b');
        expect(result.current.pendingFarms).toEqual([]);
    });

    it('an older server (no status field) keeps the old meaning: every listed farm is one he is in', async () => {
        mockGetMyFarms.mockResolvedValue([FARM_B]);
        const { result } = renderHook(() => useFarmContextState());
        await waitFor(() => expect(result.current.myFarms).toEqual([FARM_B]));
        expect(result.current.currentFarmId).toBe('f-b');
    });

    // M1 — a request can always be withdrawn from the app (server self-exit), and the lists say so.
    it('withdrawing a waiting request calls self-exit for THAT farm and re-reads the lists', async () => {
        mockGetMyFarms.mockResolvedValue([FARM_A, FARM_B_PENDING]);
        const { result } = renderHook(() => useFarmContextState());
        await waitFor(() => expect(result.current.pendingFarms).toEqual([FARM_B_PENDING]));

        mockGetMyFarms.mockResolvedValue([FARM_A]);
        await act(() => result.current.handleWithdrawRequest('f-b'));

        expect(mockExitMembership).toHaveBeenCalledTimes(1);
        expect(mockExitMembership).toHaveBeenCalledWith('f-b');
        await waitFor(() => expect(result.current.pendingFarms).toEqual([]));
        expect(result.current.currentFarmId).toBe('f-a');
    });

    it('a refused withdraw rejects (so the screen can say so) and the request stays listed', async () => {
        mockGetMyFarms.mockResolvedValue([FARM_A, FARM_B_PENDING]);
        mockExitMembership.mockRejectedValue({ error: 'network', status: 0 });
        const { result } = renderHook(() => useFarmContextState());
        await waitFor(() => expect(result.current.pendingFarms).toEqual([FARM_B_PENDING]));

        await expect(result.current.handleWithdrawRequest('f-b')).rejects.toBeTruthy();
        expect(result.current.pendingFarms).toEqual([FARM_B_PENDING]);
    });

    it('signing out shuts the door', async () => {
        const { result, rerender } = renderHook(() => useFarmContextState());
        act(() => result.current.handleJoinViaQr());
        expect(result.current.showJoinByCode).toBe(true);
        authValue = { isAuthenticated: false, session: null };
        rerender();
        await waitFor(() => expect(result.current.showJoinByCode).toBe(false));
    });
});
