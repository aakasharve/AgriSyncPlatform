// @vitest-environment jsdom
/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane JOIN, V1-A) — what he chose BEFORE the SMS code is taken
 * ONCE right after sign-in:
 *   - a held QR / code opens the join door carrying it (the door sends it), and closing the door forgets it;
 *   - "नाही, मी स्वतः सुरू करतोय" makes the 0-farm screen open on his own farm;
 *   - nothing held: the door stays shut, as before.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

const mockGetMyFarms = vi.fn();
vi.mock('../../../features/onboarding/qr/inviteApi', () => ({
    getMyFarms: () => mockGetMyFarms(),
    exitMembership: vi.fn(),
}));
let authValue: { isAuthenticated: boolean; session: { userId: string; accessToken: string } | null };
vi.mock('../../providers/AuthProvider', () => ({ useAuth: () => authValue }));
vi.mock('../../../infrastructure/storage/SessionStore', () => ({
    SessionStore: { getCurrentFarmId: () => null, setCurrentFarmId: vi.fn() },
}));

import { useFarmContextState } from '../useFarmContextState';
import { holdJoin, holdOwnFarmStart, peekHeldJoin } from '../../../features/onboarding/joinStart/heldJoin';

beforeEach(() => {
    window.sessionStorage.clear();
    authValue = { isAuthenticated: true, session: { userId: 'u1', accessToken: 'tok' } };
    mockGetMyFarms.mockReset().mockResolvedValue([]);
});
afterEach(cleanup);

describe('after sign-in', () => {
    it('a held farm code opens the join door carrying it, once; closing the door forgets it', async () => {
        holdJoin({ kind: 'farmCode', code: 'K7M2QX' });
        const { result } = renderHook(() => useFarmContextState());
        await waitFor(() => expect(result.current.showJoinByCode).toBe(true));
        expect(result.current.heldJoin).toEqual({ kind: 'farmCode', code: 'K7M2QX' });
        expect(peekHeldJoin()).toBeNull(); // taken from the phone: it cannot be sent twice
        act(() => result.current.closeJoinByCode());
        expect(result.current.showJoinByCode).toBe(false);
        expect(result.current.heldJoin).toBeNull();
    });

    it('"नाही, मी स्वतः सुरू करतोय": his own farm first', async () => {
        holdOwnFarmStart();
        const { result } = renderHook(() => useFarmContextState());
        await waitFor(() => expect(result.current.ownFarmFirst).toBe(true));
        expect(result.current.showJoinByCode).toBe(false);
        await waitFor(() => expect(result.current.showMinimalOnboarding).toBe(true));
    });

    it('nothing held: the door stays shut and the 0-farm screen opens on its doors', async () => {
        const { result } = renderHook(() => useFarmContextState());
        await waitFor(() => expect(result.current.showMinimalOnboarding).toBe(true));
        expect(result.current.showJoinByCode).toBe(false);
        expect(result.current.heldJoin).toBeNull();
        expect(result.current.ownFarmFirst).toBe(false);
    });

    it('signed out: nothing is taken (it waits for the sign-in)', async () => {
        authValue = { isAuthenticated: false, session: null };
        holdJoin({ kind: 'invitation', code: '48217730' });
        const { result } = renderHook(() => useFarmContextState());
        await new Promise((r) => setTimeout(r, 20));
        expect(result.current.heldJoin).toBeNull();
        expect(peekHeldJoin()).toEqual({ kind: 'invitation', code: '48217730' });
    });
});
