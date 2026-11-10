/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 - lane CMP-D1 (founder D-81, doctrine P5, P9, P10).
 *
 * The LAST KNOWN SEAT of this person on each farm (his label and the authorities the server last listed for him), kept in
 * `appMeta` - an existing key-value table, so no Dexie version bump - and refreshed by every successful `/me/context`
 * answer (`FarmContext`). `/me/context` itself is held in memory only (2-minute cache, `MeContextService.ts`), so without
 * this an offline cold start would not know who the person is. What reads it: the तुलना tab (`hiddenViews.ts`), which
 * fails CLOSED - a seat the phone does not know shows nothing, and the first ever start (nothing stored) shows nothing.
 *
 * WHOSE IT IS (fix round 1, review N001). The value is tagged with the id of the user who was signed in when it was written
 * (`userId`), and a reader ignores a value whose id is not the current session's, or when the session's user id is not known.
 * Isolation does NOT come from a wipe at sign-in: each farmer has his own database (`activateDatabaseForUser`), the active
 * one moves to the unidentified database on sign-out, and `FarmContext` sits outside the provider that activates a database,
 * so a write can land in whichever database is active at that moment. The tag makes that harmless - a seat written for the
 * owner is never read as the seat of a worker who signs in on the same phone and the same farm id. Nothing is written when
 * no user id is known. The hook also re-binds when the active database changes (as `useUiPref` does), so it never keeps
 * answering from the database it started on.
 *
 * This is presentation only. The phone remembers the server's last word so it can HIDE a door; it never decides access, and
 * a stale value can only be wrong in two directions: it can show the tab to a person whose authority was just taken away
 * while he is offline (the compare READ - lane CMP-D2 - still refuses him on the server), or hide it from a person who was
 * just given it (it appears with the next answer).
 *
 * A write that fails is swallowed on purpose and lands in `console.warn`: the only cost is that the NEXT offline start hides
 * the tab (fail closed) until an online answer arrives - never a wrong "shown".
 */
import { liveQuery } from 'dexie';
import { useEffect, useMemo, useState } from 'react';
import { getDatabase } from '../../infrastructure/storage/DexieDatabase';
import type { AgriLogDatabase } from '../../infrastructure/storage/DexieDatabase';
import { onActiveDatabaseChanged } from '../../infrastructure/storage/activeDatabaseName';
import { useOptionalAuth } from '../../app/providers/AuthProvider';
import type { MeAuthority, MeFarm } from './MeContextService';
import { isActiveSeat } from './seatStatus';

/** appMeta key of the stored seats: `{ userId, savedAtUtc, seats }`. Absent = never learned (first start) or cleared. */
export const LAST_KNOWN_SEATS_META_KEY = 'shramsafal_last_known_seats_v1';

/** One farm's seat as the server last described it. */
export interface KnownSeat {
    farmId: string;
    role: string;
    authorities: MeAuthority[];
}

export interface StoredSeats {
    /** The user who was signed in when this was written; '' for a value that carries none (never used). */
    userId: string;
    savedAtUtc: string;
    seats: KnownSeat[];
}

/** What the tab rule reads: the label (only to recognise the primary account holder) and the authorities held. */
export interface TabSeat {
    role?: string | null;
    authorities?: ReadonlyArray<{ name: string; expiresAtUtc?: string | null }> | null;
}

type SeatSource = Pick<MeFarm, 'farmId' | 'role' | 'status' | 'authorities'>;

/**
 * Replaces the stored seats with this answer's Active seats (a farm that left the answer, or an authority taken back, is
 * gone), tagged with `userId`. With no user id nothing is written.
 */
export async function rememberSeats(farms: readonly SeatSource[], userId: string | null | undefined, db?: AgriLogDatabase): Promise<void> {
    if (!userId) return;
    const seats: KnownSeat[] = farms
        .filter(isActiveSeat)
        .filter(f => typeof f.farmId === 'string' && f.farmId.length > 0 && typeof f.role === 'string')
        .map(f => ({
            farmId: f.farmId,
            role: f.role,
            authorities: Array.isArray(f.authorities)
                ? f.authorities
                    .filter(a => typeof a?.name === 'string')
                    .map(a => ({ name: a.name, expiresAtUtc: a.expiresAtUtc ?? null }))
                : [],
        }));
    const value: StoredSeats = { userId, savedAtUtc: new Date().toISOString(), seats };
    try {
        await (db ?? getDatabase()).appMeta.put({ key: LAST_KNOWN_SEATS_META_KEY, value, updatedAt: value.savedAtUtc });
    } catch (error) {
        console.warn('[lastKnownSeats] could not keep the seats; the next offline start will hide the तुलना tab until an online answer arrives', error);
    }
}

/** The stored seats, or `null` when none are stored or the value is not a list of seats (never read as a seat). */
export async function readLastKnownSeats(db: AgriLogDatabase = getDatabase()): Promise<StoredSeats | null> {
    const row = await db.appMeta.get(LAST_KNOWN_SEATS_META_KEY);
    const value = row?.value as Partial<StoredSeats> | undefined;
    if (!value || !Array.isArray(value.seats)) return null;
    const seats = value.seats.filter(
        (s): s is KnownSeat => !!s && typeof s.farmId === 'string' && typeof s.role === 'string',
    ).map(s => ({ ...s, authorities: Array.isArray(s.authorities) ? s.authorities : [] }));
    return {
        userId: typeof value.userId === 'string' ? value.userId : '',
        savedAtUtc: typeof value.savedAtUtc === 'string' ? value.savedAtUtc : '',
        seats,
    };
}

/** The stored seats of the ACTIVE database, kept live and re-bound when the active database changes (`null` until read). */
export function useLastKnownSeats(): StoredSeats | null {
    const [stored, setStored] = useState<StoredSeats | null>(null);
    // Bumped when the active per-farmer database changes (login / logout): the old subscription watches the old database.
    const [dbEpoch, setDbEpoch] = useState(0);
    useEffect(() => onActiveDatabaseChanged(() => {
        // Back to "don't know" in the same breath, so the answer of the previous database is never used for the new one.
        setStored(null);
        setDbEpoch(n => n + 1);
    }), []);
    useEffect(() => {
        let alive = true;
        const subscription = liveQuery(() => readLastKnownSeats(getDatabase())).subscribe({
            next: value => { if (alive) setStored(value); },
            error: () => { if (alive) setStored(null); },
        });
        return () => { alive = false; subscription.unsubscribe(); };
    }, [dbEpoch]);
    return stored;
}

/**
 * The seat the तुलना tab is decided from: the live `/me/context` seat of the open farm when there is one; otherwise the
 * last known seat of THAT farm (never another farm's, never another user's), with the authorities that have ended since
 * dropped; otherwise `null` (unknown - the tab stays hidden).
 */
export function seatForTabs(input: {
    currentFarmId: string | null | undefined;
    currentFarm: TabSeat | null | undefined;
    stored: StoredSeats | null | undefined;
    /** The signed-in user's id; a stored value written for anyone else (or when this is unknown) is not used. */
    userId: string | null | undefined;
    now?: Date;
}): TabSeat | null {
    if (input.currentFarm) return input.currentFarm;
    if (!input.currentFarmId || !input.stored || !input.userId || input.stored.userId !== input.userId) return null;
    const known = input.stored.seats.find(s => s.farmId === input.currentFarmId);
    if (!known) return null;
    const nowMs = (input.now ?? new Date()).getTime();
    return {
        role: known.role,
        authorities: known.authorities.filter(a => {
            if (!a.expiresAtUtc) return true;
            const end = Date.parse(a.expiresAtUtc);
            return !Number.isNaN(end) && end > nowMs;
        }),
    };
}

/** The hook the two readers of the tab list share (`AppRouter`, `AppContent`): live seat, else the last known one of this user. */
export function useSeatForTabs(
    currentFarmId: string | null | undefined,
    currentFarm: (TabSeat & { farmId?: string }) | null | undefined,
): TabSeat | null {
    const stored = useLastKnownSeats();
    const userId = useOptionalAuth()?.session?.userId ?? null;
    return useMemo(
        () => seatForTabs({ currentFarmId, currentFarm, stored, userId }),
        [currentFarmId, currentFarm, stored, userId],
    );
}
