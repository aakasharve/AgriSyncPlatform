// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I12, H10 / H-13; I12-V1-M2, I12-V1-m4) — the
 * work home's "आजची हजेरी" door as AppRouter computes it: owner yes, worker no, unknown role no, and a
 * मुकादम by the SERVER's grant — asked when the tab opens online, so a fresh phone shows it on first use.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { LabourData } from '../labour.types';

const h = vi.hoisted(() => ({ fetchLabourData: vi.fn() }));
vi.mock('../data/labourClient', () => ({ fetchLabourData: h.fetchLabourData }));

import { useHomeAttendanceDoor, HOME_GRANT_WINDOW, type HomeAttendanceDoorInput } from '../useHomeAttendanceDoor';
import { saveLabourReadout } from '../data/labourReadout';
import { readCachedLabourGrant } from '../homeAttendanceDoor';

const readout = (canManageLabour?: boolean): LabourData => ({
    topLevelIds: [],
    people: {},
    dashboard: { weekLabel: '', insight: '', manDays: 0, manDaysTrend: 0, wages: null, advances: null, owed: null, logs: 0, pending: 0, plots: [], money: null },
    ledger: { weekLabel: '', days: [], rows: [], crewRows: [] },
    view: 'crew',
    ...(canManageLabour === undefined ? {} : { canManageLabour }),
    home: { rojandariStated: null, ukteAgreed: null, onFarmToday: 0, rojandariToday: null, ukteToday: null },
    review: [],
    attendance: { plot: '', headcount: null, rows: [], todaysLabourAssignmentId: '' },
} as unknown as LabourData);

const MUKADAM: HomeAttendanceDoorInput = { role: 'Mukadam', userId: 'u1', farmId: 'f1', active: true };
const door = (input: HomeAttendanceDoorInput) => renderHook((p: HomeAttendanceDoorInput) => useHomeAttendanceDoor(p), { initialProps: input });

beforeEach(() => { h.fetchLabourData.mockReset(); });
afterEach(() => {
    localStorage.clear();
    Object.defineProperty(globalThis.navigator, 'onLine', { configurable: true, value: true });
});

describe('useHomeAttendanceDoor', () => {
    it('owner tier: the door, without asking the server', () => {
        expect(door({ ...MUKADAM, role: 'PrimaryOwner' }).result.current).toBe(true);
        expect(door({ ...MUKADAM, role: 'SecondaryOwner' }).result.current).toBe(true);
        expect(h.fetchLabourData).not.toHaveBeenCalled();
    });

    it('a worker never gets it — not even with a cached "yes" — and nothing is asked', () => {
        saveLabourReadout('u1', 'f1', 'alltime', readout(true));
        expect(door({ ...MUKADAM, role: 'Worker' }).result.current).toBe(false);
        expect(h.fetchLabourData).not.toHaveBeenCalled();
    });

    it('a role the server has not told this phone yet: hidden, nothing asked', () => {
        expect(door({ ...MUKADAM, role: null }).result.current).toBe(false);
        expect(h.fetchLabourData).not.toHaveBeenCalled();
    });

    it('मुकादम on a FRESH phone (nothing cached): hidden while unknown, then shown on the server\'s grant — and cached like the हजेरी screen does', async () => {
        let answer!: (d: LabourData) => void;
        h.fetchLabourData.mockReturnValue(new Promise<LabourData>((res) => { answer = res; }));
        const { result } = door(MUKADAM);
        expect(result.current).toBe(false);
        expect(h.fetchLabourData).toHaveBeenCalledWith('f1', HOME_GRANT_WINDOW);
        answer(readout(true));
        await waitFor(() => expect(result.current).toBe(true));
        expect(readCachedLabourGrant('u1', 'f1')).toBe(true);
    });

    it('मुकादम whom the owner has NOT granted: stays hidden after the server answers', async () => {
        h.fetchLabourData.mockResolvedValue(readout(false));
        const { result } = door(MUKADAM);
        await waitFor(() => expect(readCachedLabourGrant('u1', 'f1')).toBe(false));
        expect(result.current).toBe(false);
    });

    it('a revoked grant wins over an older cached "yes"', async () => {
        saveLabourReadout('u1', 'f1', 'week', readout(true));
        h.fetchLabourData.mockResolvedValue(readout(false));
        const { result } = door(MUKADAM);
        expect(result.current).toBe(true); // the cached answer, while the server is asked
        await waitFor(() => expect(result.current).toBe(false));
    });

    it('server unreachable: unknown is not "no" — the cached answer stands', async () => {
        saveLabourReadout('u1', 'f1', 'alltime', readout(true));
        h.fetchLabourData.mockRejectedValue(new Error('Network Error'));
        const { result } = door(MUKADAM);
        await waitFor(() => expect(h.fetchLabourData).toHaveBeenCalled());
        await new Promise((r) => setTimeout(r, 0));
        expect(result.current).toBe(true);
    });

    it('403 (no longer a member of the farm): the cached copies are erased and the door hides', async () => {
        saveLabourReadout('u1', 'f1', 'alltime', readout(true));
        h.fetchLabourData.mockRejectedValue({ response: { status: 403 } });
        const { result } = door(MUKADAM);
        await waitFor(() => expect(result.current).toBe(false));
        expect(readCachedLabourGrant('u1', 'f1')).toBeUndefined();
    });

    it('offline: nothing is asked; the cached answer is used', () => {
        Object.defineProperty(globalThis.navigator, 'onLine', { configurable: true, value: false });
        saveLabourReadout('u1', 'f1', 'alltime', readout(true));
        expect(door(MUKADAM).result.current).toBe(true);
        expect(h.fetchLabourData).not.toHaveBeenCalled();
    });

    it('not on the आजची कामे tab: nothing is asked and no door', () => {
        expect(door({ ...MUKADAM, active: false }).result.current).toBe(false);
        expect(h.fetchLabourData).not.toHaveBeenCalled();
    });

    it('asks once while the tab stays open, and joins that one ask when the tab is re-opened soon after', async () => {
        h.fetchLabourData.mockResolvedValue(readout(true));
        const { result, rerender } = door(MUKADAM);
        await waitFor(() => expect(result.current).toBe(true));
        rerender({ ...MUKADAM, active: false });
        expect(result.current).toBe(false);
        rerender(MUKADAM);
        await waitFor(() => expect(result.current).toBe(true));
        expect(h.fetchLabourData).toHaveBeenCalledTimes(1);
    });
});
