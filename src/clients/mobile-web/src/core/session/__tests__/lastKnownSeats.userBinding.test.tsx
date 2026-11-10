// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 - lane CMP-D1 fix round 1 (review N001, N004, N005).
 *
 * The seats kept on the phone belong to ONE signed-in user: the value carries that user's id, a value whose id is not the
 * current session's is ignored (fail closed), and nothing is kept at all when no user id is known. The hook re-binds when
 * the active per-farmer database changes (login / logout). A write that fails changes nothing and the tab stays hidden. An
 * authority that has ended is not held on the live seat either.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ userId: 'user-A' as string | null }));
vi.mock('../../../app/providers/AuthProvider', () => ({
    useOptionalAuth: () => (h.userId ? { session: { userId: h.userId } } : { session: null }),
    useAuth: () => ({ session: h.userId ? { userId: h.userId } : null }),
}));

import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { getActiveDatabaseName, setActiveDatabaseName } from '../../../infrastructure/storage/activeDatabaseName';
import { hiddenMainViewsFor } from '../../navigation/hiddenViews';
import {
    LAST_KNOWN_SEATS_META_KEY, readLastKnownSeats, rememberSeats, seatForTabs, useLastKnownSeats, useSeatForTabs,
} from '../lastKnownSeats';

const FARM = 'aaaaaaaa-0000-4000-8000-00000000000a';
const NOW = new Date('2026-11-10T06:00:00.000Z');
const HIDDEN = ['compare'];
const ownerSeat = { farmId: FARM, role: 'PrimaryOwner', status: 'Active', authorities: [] as { name: string; expiresAtUtc: string | null }[] };

const originalDatabase = getActiveDatabaseName();
beforeEach(async () => { h.userId = 'user-A'; await getDatabase().appMeta.clear(); });
afterEach(() => { cleanup(); setActiveDatabaseName(originalDatabase); vi.restoreAllMocks(); });

describe('N001 - the stored seats belong to the user who was signed in', () => {
    it('the value carries the user id; nothing is stored when no user id is known', async () => {
        await rememberSeats([ownerSeat], 'user-A');
        expect((await readLastKnownSeats())?.userId).toBe('user-A');

        await getDatabase().appMeta.clear();
        await rememberSeats([ownerSeat], null);
        await rememberSeats([ownerSeat], '');
        await rememberSeats([ownerSeat], undefined);
        expect(await getDatabase().appMeta.get(LAST_KNOWN_SEATS_META_KEY)).toBeUndefined();
    });

    it('the owner\'s seats stored for user A are NOT used for user B on the same farm id; they ARE for user A', async () => {
        await rememberSeats([ownerSeat], 'user-A');
        const stored = await readLastKnownSeats();
        const forB = seatForTabs({ currentFarmId: FARM, currentFarm: null, stored, userId: 'user-B', now: NOW });
        expect(forB).toBeNull();
        expect(hiddenMainViewsFor(forB)).toEqual(HIDDEN);
        // the owner's own cold start still works
        const forA = seatForTabs({ currentFarmId: FARM, currentFarm: null, stored, userId: 'user-A', now: NOW });
        expect(hiddenMainViewsFor(forA)).toEqual([]);
        // a session whose user is not known cannot vouch for a stored value
        expect(hiddenMainViewsFor(seatForTabs({ currentFarmId: FARM, currentFarm: null, stored, userId: null, now: NOW }))).toEqual(HIDDEN);
    });

    it('a value stored by an older build (no user id) is never used', async () => {
        await getDatabase().appMeta.put({
            key: LAST_KNOWN_SEATS_META_KEY, updatedAt: '', value: { savedAtUtc: '', seats: [{ farmId: FARM, role: 'PrimaryOwner', authorities: [] }] },
        });
        const stored = await readLastKnownSeats();
        expect(hiddenMainViewsFor(seatForTabs({ currentFarmId: FARM, currentFarm: null, stored, userId: 'user-A', now: NOW }))).toEqual(HIDDEN);
    });

    it('the hook hands the shell the owner\'s stored seat for the same user, and nothing for another user', async () => {
        await rememberSeats([ownerSeat], 'user-A');
        h.userId = 'user-A';
        const same = renderHook(() => useSeatForTabs(FARM, null));
        await waitFor(() => expect(hiddenMainViewsFor(same.result.current)).toEqual([]));
        same.unmount();

        h.userId = 'user-B';
        const other = renderHook(() => useSeatForTabs(FARM, null));
        await new Promise(r => setTimeout(r, 50));
        expect(hiddenMainViewsFor(other.result.current)).toEqual(HIDDEN);
    });

    it('the hook re-binds when the active database changes: it reads the NEW database, then the old one again', async () => {
        await rememberSeats([ownerSeat], 'user-A');
        const hook = renderHook(() => useLastKnownSeats());
        await waitFor(() => expect(hook.result.current?.userId).toBe('user-A'));

        // another farmer signs in: the active database is another one, with nothing kept in it
        act(() => { setActiveDatabaseName(`${originalDatabase}_cmpd1_other`); });
        await waitFor(() => expect(hook.result.current).toBeNull());
        await rememberSeats([{ ...ownerSeat, role: 'Mukadam' }], 'user-B');
        await waitFor(() => expect(hook.result.current?.userId).toBe('user-B'));
        expect(hook.result.current?.seats[0].role).toBe('Mukadam');

        act(() => { setActiveDatabaseName(originalDatabase); });
        await waitFor(() => expect(hook.result.current?.userId).toBe('user-A'));
    });
});

describe('N004 - a write that fails changes nothing and the tab stays hidden', () => {
    it('appMeta.put rejects: rememberSeats does not throw, nothing is stored, the seat is unknown, the tab is hidden', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        vi.spyOn(getDatabase().appMeta, 'put').mockRejectedValue(new Error('quota'));

        await expect(rememberSeats([ownerSeat], 'user-A')).resolves.toBeUndefined();
        expect(warn).toHaveBeenCalled();
        vi.restoreAllMocks();
        expect(await readLastKnownSeats()).toBeNull();
        expect(hiddenMainViewsFor(seatForTabs({ currentFarmId: FARM, currentFarm: null, stored: await readLastKnownSeats(), userId: 'user-A', now: NOW })))
            .toEqual(HIDDEN);
    });
});

describe('N005 - an ended authority is not held on the live seat either', () => {
    const live = (end: string | null) => ({
        role: 'Mukadam', authorities: [{ name: 'SeeCompare', expiresAtUtc: end }],
    });

    it('a live SeeCompare past its end hides the tab; one still running (or permanent) shows it', () => {
        expect(hiddenMainViewsFor(live('2026-11-10T05:00:00.000Z'), NOW)).toEqual(HIDDEN);
        expect(hiddenMainViewsFor(live('2026-11-10T07:00:00.000Z'), NOW)).toEqual([]);
        expect(hiddenMainViewsFor(live(null), NOW)).toEqual([]);
        expect(hiddenMainViewsFor(live('not a date'), NOW)).toEqual(HIDDEN);
    });

    it('the primary owner has no end', () => {
        expect(hiddenMainViewsFor({ role: 'PrimaryOwner', authorities: [] }, NOW)).toEqual([]);
    });
});
