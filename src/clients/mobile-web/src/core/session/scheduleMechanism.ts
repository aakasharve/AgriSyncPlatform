/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 1, "The switch"; doctrine P5, P11).
 *
 * Is the schedule mechanism switched ON for THIS farm? The SERVER decides (the `schedule_mechanism` switch, one row, farm by farm) and tells the phone on
 * every pull: `capabilities.scheduleMechanism.farmIds`, the farms of that pull it is on for. The pull stores the answer whole in `appMeta` (no Dexie
 * version bump: the `planningStateStore.ts` precedent) and this module is the one reader of it.
 *
 * FAILS CLOSED, in every direction: OFF, unknown and "another farm is on" all read as off, and OFF is exactly today's screens - nothing here draws a
 * screen, and nothing in slice 1 reads it yet. Unknown means: never pulled, an older server (it never sends the key), the server omitted the key
 * (it does that when the switch is off for every farm of the pull, so the bytes of a switched-off pull are unchanged), a stored value this build cannot
 * read, a blocked store, or no open farm to ask about. The phone never works the switch out itself and never turns it on from a hunch: it remembers the
 * server's last word, and where it has none it shows what it showed before. The server asks again on every write of the mechanism (a new mutation for a
 * farm the switch is off for is refused), so this is presentation, never the security boundary.
 */
import { liveQuery } from 'dexie';
import { useEffect, useState } from 'react';
import { getDatabase } from '../../infrastructure/storage/DexieDatabase';
import type { AgriLogDatabase } from '../../infrastructure/storage/DexieDatabase';
import { onActiveDatabaseChanged } from '../../infrastructure/storage/activeDatabaseName';

/** appMeta key of the stored answer: `{ receivedAtUtc, farmIds }`. Absent = never pulled (unknown = off). */
export const SCHEDULE_MECHANISM_META_ROW = 'shramsafal_schedule_mechanism_v1';

interface StoredScheduleMechanism {
    receivedAtUtc: string;
    farmIds: string[];
}

const normalise = (id: string): string => id.trim().toLowerCase();

/**
 * The farm ids in a pull's `capabilities` value, as the server sent them. Anything that is not
 * `{ scheduleMechanism: { farmIds: [strings] } }` is "no farm is on": an entry that is not a non-empty string is dropped, the rest are kept, and
 * it never throws. Unknown siblings (a later slice adds keys beside `scheduleMechanism`) are ignored.
 */
export function parseScheduleMechanismFarmIds(capabilities: unknown): string[] {
    if (!capabilities || typeof capabilities !== 'object') return [];
    const scheduleMechanism = (capabilities as { scheduleMechanism?: unknown }).scheduleMechanism;
    if (!scheduleMechanism || typeof scheduleMechanism !== 'object') return [];
    const farmIds = (scheduleMechanism as { farmIds?: unknown }).farmIds;
    if (!Array.isArray(farmIds)) return [];
    const kept: string[] = [];
    for (const id of farmIds) {
        if (typeof id !== 'string' || id.trim().length === 0) continue;
        if (!kept.some(k => normalise(k) === normalise(id))) kept.push(id.trim());
    }
    return kept;
}

/** The whole rule, pure: is the mechanism on for `farmId`, given the farms the server said it is on for? `null` / `undefined` = unknown = off. */
export function isScheduleMechanismOn(
    onFarmIds: Iterable<string> | null | undefined,
    farmId: string | null | undefined,
): boolean {
    if (!onFarmIds || typeof farmId !== 'string' || farmId.trim().length === 0) return false;
    const wanted = normalise(farmId);
    for (const id of onFarmIds) {
        if (typeof id === 'string' && normalise(id) === wanted) return true;
    }
    return false;
}

/** The farms the server last said the mechanism is on for; `[]` (off) when nothing is stored, the value cannot be read, or the store is blocked. */
export async function readScheduleMechanismFarmIds(db: AgriLogDatabase = getDatabase()): Promise<string[]> {
    try {
        const row = await db.appMeta.get(SCHEDULE_MECHANISM_META_ROW);
        const value = row?.value as Partial<StoredScheduleMechanism> | null | undefined;
        if (!value || !Array.isArray(value.farmIds)) return [];
        return value.farmIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
    } catch {
        return []; // a blocked store reads as "unknown: off"
    }
}

/** Replaces the stored answer whole (a farm it no longer lists is off). Called by the pull's reconciler, inside its transaction. */
export async function writeScheduleMechanismFarmIds(
    db: AgriLogDatabase,
    farmIds: readonly string[],
    receivedAtUtc: string,
): Promise<void> {
    const value: StoredScheduleMechanism = { receivedAtUtc, farmIds: [...farmIds] };
    await db.appMeta.put({ key: SCHEDULE_MECHANISM_META_ROW, value, updatedAt: receivedAtUtc });
}

/**
 * Is the mechanism on for this farm, kept live: `false` until the stored answer is read (today's screens), `true` only while the server's last word names
 * the farm. Re-binds when the active per-farmer database changes (login / logout), like `useLastKnownSeats`, so one farmer's answer is never read for another.
 */
export function useScheduleMechanism(farmId: string | null | undefined): boolean {
    const [onFarmIds, setOnFarmIds] = useState<string[] | null>(null);
    // Bumped when the active per-farmer database changes: the old subscription watches the old database.
    const [dbEpoch, setDbEpoch] = useState(0);
    useEffect(() => onActiveDatabaseChanged(() => {
        setOnFarmIds(null); // back to "don't know" in the same breath
        setDbEpoch(n => n + 1);
    }), []);
    useEffect(() => {
        let alive = true;
        const subscription = liveQuery(() => readScheduleMechanismFarmIds(getDatabase())).subscribe({
            next: value => { if (alive) setOnFarmIds(value); },
            error: () => { if (alive) setOnFarmIds(null); },
        });
        return () => { alive = false; subscription.unsubscribe(); };
    }, [dbEpoch]);
    return isScheduleMechanismOn(onFarmIds, farmId);
}
