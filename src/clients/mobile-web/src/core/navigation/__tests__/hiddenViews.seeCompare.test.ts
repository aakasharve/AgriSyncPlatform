/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 - lane CMP-D1 (founder D-81, doctrine P5, P9, P10).
 *
 * "तुलना पाहणे" is an authority like the others: the तुलना TAB is shown only to the primary owner or to a seat that holds
 * SeeCompare, decided from the authorities the server sent (never from the label), and it FAILS CLOSED: an unknown or
 * not-yet-loaded seat shows nothing. The last known seat is kept on the phone (appMeta, no Dexie bump) so an offline cold
 * start still shows it to the owner and still never shows it to a worker. Hiding the tab is NOT the security boundary - the
 * compare read (lane CMP-D2) is; these tests only pin who is SHOWN the tab.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDatabase, DATABASE_VERSION } from '../../../infrastructure/storage/DexieDatabase';
import { hiddenMainViewsFor } from '../hiddenViews';
import {
    LAST_KNOWN_SEATS_META_KEY, readLastKnownSeats, rememberSeats, seatForTabs,
} from '../../session/lastKnownSeats';

const FARM_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const FARM_B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const USER = 'user-A';
const NOW = new Date('2026-11-10T06:00:00.000Z');
const SEE_COMPARE = { name: 'SeeCompare', expiresAtUtc: null };
const OTHER = [{ name: 'TakeAttendance', expiresAtUtc: null }, { name: 'SeeAllTasks', expiresAtUtc: null }];

const HIDDEN = ['compare'];

describe('the rule: who is shown the तुलना tab', () => {
    it('the primary owner always sees it, whatever the authorities list says', () => {
        expect(hiddenMainViewsFor({ role: 'PrimaryOwner', authorities: [] })).toEqual([]);
        expect(hiddenMainViewsFor({ role: 'PrimaryOwner', authorities: undefined })).toEqual([]);
        expect(hiddenMainViewsFor({ role: 'PrimaryOwner' })).toEqual([]);
    });

    it('a मुकादम, a co-owner or family WITHOUT SeeCompare does not see it (the label gives nothing)', () => {
        for (const role of ['Mukadam', 'SecondaryOwner', 'Family']) {
            expect(hiddenMainViewsFor({ role, authorities: OTHER })).toEqual(HIDDEN);
            expect(hiddenMainViewsFor({ role, authorities: [] })).toEqual(HIDDEN);
        }
    });

    it('a holder of SeeCompare sees it, on any non-worker label', () => {
        for (const role of ['Mukadam', 'SecondaryOwner', 'Family']) {
            expect(hiddenMainViewsFor({ role, authorities: [...OTHER, SEE_COMPARE] })).toEqual([]);
        }
    });

    it('a worker never sees it, even if a list somehow carried SeeCompare', () => {
        expect(hiddenMainViewsFor({ role: 'Worker', authorities: OTHER })).toEqual(HIDDEN);
        expect(hiddenMainViewsFor({ role: 'Worker', authorities: [SEE_COMPARE] })).toEqual(HIDDEN);
    });

    it('an unknown or not-yet-loaded seat hides it (fail closed)', () => {
        expect(hiddenMainViewsFor(null)).toEqual(HIDDEN);
        expect(hiddenMainViewsFor(undefined)).toEqual(HIDDEN);
        expect(hiddenMainViewsFor({})).toEqual(HIDDEN);
        expect(hiddenMainViewsFor({ role: null, authorities: null })).toEqual(HIDDEN);
    });

    it('a server that sent no authorities for a non-owner seat hides it (an older server: nothing on a guess)', () => {
        expect(hiddenMainViewsFor({ role: 'Mukadam' })).toEqual(HIDDEN);
        expect(hiddenMainViewsFor({ role: 'Mukadam', authorities: null })).toEqual(HIDDEN);
    });
});

describe('the seat the first render reads: the live answer, else the last known one for THIS farm', () => {
    const owner = { farmId: FARM_A, role: 'PrimaryOwner', authorities: [] as { name: string; expiresAtUtc: string | null }[] };
    const stored = {
        userId: USER,
        savedAtUtc: '2026-11-09T06:00:00.000Z',
        seats: [
            { farmId: FARM_A, role: 'PrimaryOwner', authorities: [] },
            { farmId: FARM_B, role: 'Mukadam', authorities: [SEE_COMPARE] },
        ],
    };

    it('the live /me/context seat wins over anything stored', () => {
        const live = { farmId: FARM_A, role: 'Mukadam', authorities: OTHER };
        expect(seatForTabs({ currentFarmId: FARM_A, currentFarm: live, stored, userId: USER, now: NOW })).toMatchObject({ role: 'Mukadam' });
        expect(hiddenMainViewsFor(seatForTabs({ currentFarmId: FARM_A, currentFarm: live, stored, userId: USER, now: NOW }))).toEqual(HIDDEN);
    });

    it('offline cold start (no live answer): the stored seat of the open farm is used, so the owner keeps the tab', () => {
        const seat = seatForTabs({ currentFarmId: FARM_A, currentFarm: null, stored, userId: USER, now: NOW });
        expect(hiddenMainViewsFor(seat)).toEqual([]);
    });

    it('offline cold start with NOTHING stored (first ever start): hidden', () => {
        expect(hiddenMainViewsFor(seatForTabs({ currentFarmId: FARM_A, currentFarm: null, stored: null, userId: USER, now: NOW }))).toEqual(HIDDEN);
        expect(hiddenMainViewsFor(seatForTabs({ currentFarmId: null, currentFarm: null, stored, userId: USER, now: NOW }))).toEqual(HIDDEN);
    });

    it('a stored value for ANOTHER farm is not used', () => {
        const onlyB = { userId: USER, savedAtUtc: stored.savedAtUtc, seats: [stored.seats[1]] };
        expect(hiddenMainViewsFor(seatForTabs({ currentFarmId: FARM_A, currentFarm: null, stored: onlyB, userId: USER, now: NOW }))).toEqual(HIDDEN);
        // and the owner of A is not shown the tab on B because A's seat was stored
        const onlyA = { userId: USER, savedAtUtc: stored.savedAtUtc, seats: [stored.seats[0]] };
        expect(hiddenMainViewsFor(seatForTabs({ currentFarmId: FARM_B, currentFarm: null, stored: onlyA, userId: USER, now: NOW }))).toEqual(HIDDEN);
    });

    it('a stored SeeCompare that has ended is not held (the end is read on the phone too)', () => {
        const ended = { userId: USER, savedAtUtc: stored.savedAtUtc, seats: [{ farmId: FARM_B, role: 'Mukadam', authorities: [{ name: 'SeeCompare', expiresAtUtc: '2026-11-10T05:00:00.000Z' }] }] };
        const running = { userId: USER, savedAtUtc: stored.savedAtUtc, seats: [{ farmId: FARM_B, role: 'Mukadam', authorities: [{ name: 'SeeCompare', expiresAtUtc: '2026-11-10T07:00:00.000Z' }] }] };
        expect(hiddenMainViewsFor(seatForTabs({ currentFarmId: FARM_B, currentFarm: null, stored: ended, userId: USER, now: NOW }), NOW)).toEqual(HIDDEN);
        expect(hiddenMainViewsFor(seatForTabs({ currentFarmId: FARM_B, currentFarm: null, stored: running, userId: USER, now: NOW }), NOW)).toEqual([]);
    });

    it('the live owner seat is shown the tab (control)', () => {
        expect(hiddenMainViewsFor(seatForTabs({ currentFarmId: FARM_A, currentFarm: owner, stored: null, userId: USER, now: NOW }))).toEqual([]);
    });
});

describe('the last known seats on the phone (appMeta, no Dexie version bump)', () => {
    beforeEach(async () => { await getDatabase().appMeta.clear(); });

    const farm = (farmId: string, role: string, authorities: { name: string; expiresAtUtc: string | null }[] | null) =>
        ({ farmId, role, status: 'Active', authorities });

    it('keeps role and authorities per Active farm, and nothing else', async () => {
        await rememberSeats([
            farm(FARM_A, 'PrimaryOwner', [SEE_COMPARE]),
            farm(FARM_B, 'Mukadam', OTHER),
            { farmId: 'pending-farm', role: 'Worker', status: 'PendingApproval', authorities: [] },
        ], USER);
        const row = await getDatabase().appMeta.get(LAST_KNOWN_SEATS_META_KEY);
        expect(row).toBeTruthy();
        const read = await readLastKnownSeats();
        expect(read?.seats.map(s => s.farmId).sort()).toEqual([FARM_A, FARM_B].sort());
        expect(read?.seats.find(s => s.farmId === FARM_B)).toEqual({ farmId: FARM_B, role: 'Mukadam', authorities: OTHER });
        expect(Object.keys(row!.value as object).sort()).toEqual(['savedAtUtc', 'seats', 'userId']);
        expect(Object.keys((row!.value as { seats: object[] }).seats[0]).sort()).toEqual(['authorities', 'farmId', 'role']);
    });

    it('the next context REPLACES the stored one: an authority removed is gone, a farm that left is gone', async () => {
        await rememberSeats([farm(FARM_B, 'Mukadam', [SEE_COMPARE])], USER);
        let read = await readLastKnownSeats();
        expect(hiddenMainViewsFor(seatForTabs({ currentFarmId: FARM_B, currentFarm: null, stored: read, userId: USER, now: NOW }))).toEqual([]);

        await rememberSeats([farm(FARM_B, 'Mukadam', OTHER)], USER);
        read = await readLastKnownSeats();
        expect(hiddenMainViewsFor(seatForTabs({ currentFarmId: FARM_B, currentFarm: null, stored: read, userId: USER, now: NOW }))).toEqual(HIDDEN);

        await rememberSeats([farm(FARM_A, 'PrimaryOwner', [])], USER);
        read = await readLastKnownSeats();
        expect(read?.seats.map(s => s.farmId)).toEqual([FARM_A]);
    });

    it('nothing stored reads as null; a damaged value reads as null (never as a seat)', async () => {
        expect(await readLastKnownSeats()).toBeNull();
        await getDatabase().appMeta.put({ key: LAST_KNOWN_SEATS_META_KEY, value: { seats: 'not a list' } } as never);
        expect(await readLastKnownSeats()).toBeNull();
        await getDatabase().appMeta.put({ key: LAST_KNOWN_SEATS_META_KEY, value: { seats: [{ farmId: FARM_A }] } } as never);
        const read = await readLastKnownSeats();
        expect(hiddenMainViewsFor(seatForTabs({ currentFarmId: FARM_A, currentFarm: null, stored: read, userId: USER, now: NOW }))).toEqual(HIDDEN);
    });

    it('is a value in an existing table: the Dexie version is unchanged', () => {
        expect(DATABASE_VERSION).toBe(28); // this lane keeps its value in the existing appMeta table: the version is the one it started from
    });
});
