// @vitest-environment jsdom
/**
 * Repair FIX-1 round 1, Bug 1 (CTO ruling, 27 Nov): the phone kept TWO records of "which farm is open" — the header's
 * (`useFarmContextState`, from /farms/mine) and the app-wide one (`FarmContext`, from /me/context, read by the Setup Hub).
 * A header switch moved only the first; a hub-row switch only the second. FarmContext is now the ONE source:
 *   1. a header switch moves FarmContext, and the hub's farm (name, code, role) follows;
 *   2. a FarmContext switch (the hub row) moves the header's farm and the name it shows;
 *   3. after a switch, a fresh mount (the reload) opens the switched farm in both — the pointer is written for the
 *      SIGNED-IN farmer, even in the tick before the handset's ambient farmer is switched to him;
 *   4. a first run where the two lists come back in different orders settles both on the same farm.
 * REAL FarmContextProvider, REAL pointer store; only the two server reads and the session are stubbed.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ myFarms: [] as unknown[], me: null as unknown }));
vi.mock('../../../core/session/MeContextService', () => ({
    fetchMeContext: vi.fn(async () => h.me),
    invalidateMeContext: vi.fn(),
}));
vi.mock('../../providers/AuthProvider', () => ({
    useAuth: () => ({ isAuthenticated: true, session: { userId: 'user-A', accessToken: 'tok' } }),
}));
vi.mock('../../../features/onboarding/qr/inviteApi', () => ({
    getMyFarms: vi.fn(async () => h.myFarms),
    getFarmDetails: vi.fn(async () => null),
    exitMembership: vi.fn(),
}));

import { useFarmContextState } from '../useFarmContextState';
import { FarmContextProvider, useFarmContext } from '../../../core/session/FarmContext';
import { useFarmAdminState } from '../../../features/profile/hooks/useFarmAdminState';
import { SessionStore } from '../../../infrastructure/storage/SessionStore';
import { storageNamespace } from '../../../infrastructure/storage/StorageNamespace';
import { writeActiveUserId } from '../../../infrastructure/storage/activeUserId';

const A = { farmId: 'farm-A', name: 'Farm A', role: 'PrimaryOwner', farmCode: 'CODEA', subscription: null, status: 'Active' };
const B = { farmId: 'farm-B', name: 'Farm B', role: 'Mukadam', farmCode: 'CODEB', subscription: null, status: 'Active' };
const seat = (f: typeof A) => ({ farmId: f.farmId, name: f.name, role: f.role, status: 'Active' });
const meWith = (...farms: (typeof A)[]) => ({ me: { userId: 'user-A' }, farms: farms.map(seat), share: {}, alerts: [], serverTimeUtc: '' });

/** The header (AppContent's hook), the app-wide farm, and the Setup Hub's farm exactly as ProfilePage reads it. */
function useApp() {
    const header = useFarmContextState();
    const ctx = useFarmContext();
    const hub = useFarmAdminState(ctx.currentFarm?.farmId ?? ctx.currentFarmId ?? null);
    return { header, ctx, hub };
}
type App = ReturnType<typeof useApp>;
const headerName = (app: App) => app.header.myFarms?.find(f => f.farmId === app.header.currentFarmId)?.name;
const hubCode = (app: App) => app.hub.myMemberships.find(m => m.farmId === app.hub.myFarm?.farmId)?.farmCode;
const wrapper = ({ children }: { children: React.ReactNode }) => <FarmContextProvider>{children}</FarmContextProvider>;

async function mountSettledOn(farmId: string) {
    const view = renderHook(useApp, { wrapper });
    await waitFor(() => {
        expect(view.result.current.ctx.currentFarmId).toBe(farmId);
        expect(view.result.current.hub.myFarm?.farmId).toBe(farmId);
        expect(view.result.current.header.myFarms).not.toBeNull();
    });
    return view;
}

beforeEach(() => {
    window.localStorage.clear();
    writeActiveUserId('user-A');
    storageNamespace.setNamespace('user');
    h.myFarms = [A, B];
    h.me = meWith(A, B);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('one open farm — the header and the Setup Hub always agree', () => {
    it('1. a switch in the header moves the app-wide farm, and the hub follows (name, code, role)', async () => {
        const { result } = await mountSettledOn('farm-A');
        expect(result.current.header.currentFarmId).toBe('farm-A');

        act(() => result.current.header.handleSwitchFarm('farm-B'));

        await waitFor(() => expect(result.current.ctx.currentFarmId).toBe('farm-B'));
        expect(result.current.hub.myFarm).toMatchObject({ farmId: 'farm-B', name: 'Farm B', role: 'Mukadam' });
        expect(hubCode(result.current)).toBe('CODEB');
        expect(result.current.header.currentFarmId).toBe('farm-B');
        expect(headerName(result.current)).toBe('Farm B');
    });

    it('2. a switch in the hub row (FarmContext) moves the header and the name it shows', async () => {
        const { result } = await mountSettledOn('farm-A');

        act(() => result.current.ctx.switchFarm('farm-B'));

        await waitFor(() => expect(result.current.header.currentFarmId).toBe('farm-B'));
        expect(headerName(result.current)).toBe('Farm B');
        expect(result.current.hub.myFarm?.name).toBe('Farm B');
    });

    it('3. after a switch, the app opened again opens the switched farm in both', async () => {
        const first = await mountSettledOn('farm-A');
        act(() => first.result.current.header.handleSwitchFarm('farm-B'));
        await waitFor(() => expect(first.result.current.ctx.currentFarmId).toBe('farm-B'));
        first.unmount();

        const { result } = await mountSettledOn('farm-B');
        expect(result.current.header.currentFarmId).toBe('farm-B');
        expect(headerName(result.current)).toBe('Farm B');
    });

    it('3b. the switch is kept for the SIGNED-IN farmer, even before the handset\'s ambient farmer is switched to him', async () => {
        const { result } = await mountSettledOn('farm-A');
        // The sign-in tick: the session is user-A, the handset still serves the previous farmer.
        writeActiveUserId('previous-farmer');

        act(() => result.current.ctx.switchFarm('farm-B'));

        expect(SessionStore.getCurrentFarmIdForUser('user-A')).toBe('farm-B');
    });

    it('4. first run: the two lists in different orders still settle both on the same farm, and that farm is kept', async () => {
        h.myFarms = [B, A];       // /farms/mine
        h.me = meWith(A, B);      // /me/context
        const { result } = renderHook(useApp, { wrapper });

        await waitFor(() => {
            expect(result.current.ctx.currentFarmId).not.toBeNull();
            expect(result.current.header.myFarms).not.toBeNull();
        });
        await waitFor(() => expect(result.current.header.currentFarmId).toBe(result.current.ctx.currentFarmId));
        const open = result.current.ctx.currentFarmId;
        expect(open).toBe('farm-A');
        expect(result.current.hub.myFarm?.farmId).toBe(open);
        expect(SessionStore.getCurrentFarmIdForUser('user-A')).toBe(open);
    });
});
