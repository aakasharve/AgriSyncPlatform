// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I16 — FR-6). After "माझं शेत सुरू करायचं" the
 * first run goes straight on to फोनच्या परवानग्या: the farm the server just created is listed at once
 * (only what the server returned, the creator as its owner), the 0-farm screen closes, the open farm is
 * the new one, and both farm lists are re-read so the server's own entry replaces it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act, cleanup } from '@testing-library/react';

const mockGetMyFarms = vi.fn();
vi.mock('../../../features/onboarding/qr/inviteApi', () => ({
    getMyFarms: () => mockGetMyFarms(),
    exitMembership: vi.fn(),
}));
vi.mock('../../providers/AuthProvider', () => ({
    useAuth: () => ({ isAuthenticated: true, session: { userId: 'u1', accessToken: 'tok' } }),
}));
const refresh = vi.fn(async () => undefined);
vi.mock('../../../core/session/FarmContext', () => ({ useOptionalFarmContext: () => ({ refresh }) }));
const setCurrentFarmId = vi.fn();
vi.mock('../../../infrastructure/storage/SessionStore', () => ({
    SessionStore: { getCurrentFarmId: () => null, setCurrentFarmId: (id: string) => setCurrentFarmId(id) },
}));

import { useFarmContextState, FARM_LIST_WAIT_MS } from '../useFarmContextState';

const CREATED = {
    farmId: 'f-new', farmName: 'आर्वे शेती', farmCode: 'ABC123', ownerAccountId: 'u1',
    subscription: null, wasAlreadyBootstrapped: false,
};

beforeEach(() => {
    mockGetMyFarms.mockReset();
    refresh.mockClear();
    setCurrentFarmId.mockReset();
});
afterEach(cleanup);

describe('creating the first farm', () => {
    it('lists the new farm at once as his own, closes the 0-farm screen, and re-reads both lists', async () => {
        // First answer: no farm. The re-read after creating never answers in this test, so what
        // the hook shows is what it put there itself.
        mockGetMyFarms.mockResolvedValueOnce([]).mockReturnValue(new Promise(() => undefined));
        const { result } = renderHook(() => useFarmContextState());
        await waitFor(() => expect(result.current.showMinimalOnboarding).toBe(true));
        expect(result.current.myFarms).toEqual([]);

        act(() => result.current.handleWizardComplete(CREATED));

        expect(result.current.showMinimalOnboarding).toBe(false);
        expect(result.current.currentFarmId).toBe('f-new');
        expect(result.current.myFarms).toEqual([
            { farmId: 'f-new', name: 'आर्वे शेती', role: 'PrimaryOwner', farmCode: 'ABC123', subscription: null, status: 'Active' },
        ]);
        expect(refresh).toHaveBeenCalledTimes(1);
        await waitFor(() => expect(mockGetMyFarms).toHaveBeenCalledTimes(2));
    });

    it('never lists the same farm twice (a farm that already existed is kept as the server sent it)', async () => {
        const server = { farmId: 'f-new', name: 'आर्वे शेती', role: 'PrimaryOwner', farmCode: 'ABC123', subscription: null };
        mockGetMyFarms.mockResolvedValueOnce([server]).mockReturnValue(new Promise(() => undefined));
        const { result } = renderHook(() => useFarmContextState());
        await waitFor(() => expect(result.current.myFarms).toEqual([server]));

        act(() => result.current.handleWizardComplete({ ...CREATED, wasAlreadyBootstrapped: true }));
        expect(result.current.myFarms).toEqual([server]);
    });

    it('a failed re-read does NOT erase the farm just created (the first run goes on to the permissions)', async () => {
        mockGetMyFarms.mockResolvedValueOnce([]).mockRejectedValue(new TypeError('Failed to fetch'));
        const { result } = renderHook(() => useFarmContextState());
        await waitFor(() => expect(result.current.showMinimalOnboarding).toBe(true));

        act(() => result.current.handleWizardComplete(CREATED));
        await waitFor(() => expect(mockGetMyFarms).toHaveBeenCalledTimes(2));
        // Let the rejected re-read settle, then look: the farm is still listed, the 0-farm screen still shut.
        await act(async () => { await Promise.resolve(); });
        expect(result.current.myFarms?.map(f => f.farmId)).toEqual(['f-new']);
        expect(result.current.showMinimalOnboarding).toBe(false);
    });

    it('a farm the server had ALREADY made is not claimed as his until the server lists it (he may have left it)', async () => {
        let answer: (v: unknown) => void = () => undefined;
        mockGetMyFarms.mockResolvedValueOnce([]).mockReturnValueOnce(new Promise(r => { answer = r; }));
        const { result } = renderHook(() => useFarmContextState());
        await waitFor(() => expect(result.current.showMinimalOnboarding).toBe(true));

        act(() => result.current.handleWizardComplete({ ...CREATED, wasAlreadyBootstrapped: true }));
        // Not "owner of f-new": not known yet (the first run waits) …
        expect(result.current.myFarms).toBeNull();
        // … until the server's own list answers — here, with the seat he really holds.
        await act(async () => { answer([{ farmId: 'f-new', name: 'आर्वे शेती', role: 'Worker', farmCode: null, subscription: null, status: 'Active' }]); });
        await waitFor(() => expect(result.current.myFarms?.[0]?.role).toBe('Worker'));
        expect(result.current.showMinimalOnboarding).toBe(false);
    });

    // Round-2 review EDGE-1: a farm made earlier + a re-read that fails used to leave him in the
    // empty app with no farm listed and no doors.
    it('a farm the server had ALREADY made + a FAILED re-read: the 0-farm doors come back (no empty app)', async () => {
        mockGetMyFarms.mockResolvedValueOnce([]).mockRejectedValue(new TypeError('Failed to fetch'));
        const { result } = renderHook(() => useFarmContextState());
        await waitFor(() => expect(result.current.showMinimalOnboarding).toBe(true));

        act(() => result.current.handleWizardComplete({ ...CREATED, wasAlreadyBootstrapped: true }));
        expect(result.current.showMinimalOnboarding).toBe(false);
        expect(result.current.myFarms).toBeNull();

        await waitFor(() => expect(result.current.showMinimalOnboarding).toBe(true));
        // Still no farm claimed as his.
        expect(result.current.myFarms).toEqual([]);
    });
});

describe('waiting for the farm list is bounded', () => {
    afterEach(() => { vi.useRealTimers(); });

    it(`a list that hangs stops holding the screen after ${FARM_LIST_WAIT_MS} ms; a late answer still lands`, async () => {
        vi.useFakeTimers();
        let answer: (v: unknown) => void = () => undefined;
        mockGetMyFarms.mockReturnValueOnce(new Promise(r => { answer = r; }));
        const { result } = renderHook(() => useFarmContextState());
        await act(async () => { await Promise.resolve(); });
        expect(result.current.myFarms).toBeNull();

        await act(async () => { await vi.advanceTimersByTimeAsync(FARM_LIST_WAIT_MS - 1); });
        expect(result.current.myFarms).toBeNull();
        await act(async () => { await vi.advanceTimersByTimeAsync(1); });
        expect(result.current.myFarms).toEqual([]);

        await act(async () => { answer([{ farmId: 'f1', name: 'पवार मळा', role: 'PrimaryOwner', farmCode: 'X', subscription: null, status: 'Active' }]); });
        expect(result.current.myFarms?.map(f => f.farmId)).toEqual(['f1']);
    });

    it('EDGE-1: a farm made earlier + a re-read that HANGS: the doors come back after the wait; a late answer closes them', async () => {
        vi.useFakeTimers();
        let answer: (v: unknown) => void = () => undefined;
        mockGetMyFarms.mockResolvedValueOnce([]).mockReturnValueOnce(new Promise(r => { answer = r; }));
        const { result } = renderHook(() => useFarmContextState());
        await act(async () => { await Promise.resolve(); });
        expect(result.current.showMinimalOnboarding).toBe(true);

        act(() => result.current.handleWizardComplete({ ...CREATED, wasAlreadyBootstrapped: true }));
        expect(result.current.showMinimalOnboarding).toBe(false);
        await act(async () => { await vi.advanceTimersByTimeAsync(FARM_LIST_WAIT_MS - 1); });
        expect(result.current.showMinimalOnboarding).toBe(false);
        await act(async () => { await vi.advanceTimersByTimeAsync(1); });
        expect(result.current.showMinimalOnboarding).toBe(true);
        expect(result.current.myFarms).toEqual([]);

        // The server finally lists the seat he holds: the doors close, the first run goes on.
        await act(async () => { answer([{ farmId: 'f-new', name: 'आर्वे शेती', role: 'PrimaryOwner', farmCode: 'ABC123', subscription: null, status: 'Active' }]); });
        expect(result.current.showMinimalOnboarding).toBe(false);
        expect(result.current.myFarms?.map(f => f.farmId)).toEqual(['f-new']);
    });

    it('a FIRST read that hangs never opens the doors by itself (an installed user offline is not sent to them)', async () => {
        vi.useFakeTimers();
        mockGetMyFarms.mockReturnValueOnce(new Promise(() => undefined));
        const { result } = renderHook(() => useFarmContextState());
        await act(async () => { await vi.advanceTimersByTimeAsync(FARM_LIST_WAIT_MS * 2); });
        expect(result.current.myFarms).toEqual([]);
        expect(result.current.showMinimalOnboarding).toBe(false);
    });

    it('a list that answers in time is never replaced by the timer', async () => {
        vi.useFakeTimers();
        const farm = { farmId: 'f1', name: 'पवार मळा', role: 'PrimaryOwner', farmCode: 'X', subscription: null, status: 'Active' };
        mockGetMyFarms.mockResolvedValueOnce([farm]);
        const { result } = renderHook(() => useFarmContextState());
        await act(async () => { await Promise.resolve(); });
        expect(result.current.myFarms).toEqual([farm]);
        await act(async () => { await vi.advanceTimersByTimeAsync(FARM_LIST_WAIT_MS * 2); });
        expect(result.current.myFarms).toEqual([farm]);
    });
});
