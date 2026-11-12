/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane CMP-D2 Task 3; P4, P10; the CMP-D1 `lastKnownSeats` precedent)
 *
 * The last तुलना answer for each farm, kept in `appMeta` (no Dexie version bump) so the screen can still show something true with no net:
 * that answer with the time the SERVER gave it. One row per farm, tagged with the id of the user who was signed in when it was written;
 * a reader ignores a row whose user is not the current one, and when the current user is not known (another farmer on the same phone
 * and the same farm id must never read this one's numbers - his seat may not hold "तुलना पाहणे"). A refusal removes it.
 */
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { parseFarmCompare, type FarmCompareDto } from './compareDtos';

export const compareMetaKey = (farmId: string): string => `shramsafal_farm_compare_v1:${farmId}`;

export interface StoredCompare {
    userId: string;
    receivedAtUtc: string;
    compare: FarmCompareDto;
}

/** The kept answer of THIS farm for THIS user, or null (none kept, another user's, unreadable, or no user known). */
export async function readCachedCompare(farmId: string, userId: string | null): Promise<StoredCompare | null> {
    if (!userId) return null;
    try {
        const row = await getDatabase().appMeta.get(compareMetaKey(farmId));
        const value = row?.value as { userId?: unknown; receivedAtUtc?: unknown; compare?: unknown } | undefined;
        if (!value || value.userId !== userId || typeof value.receivedAtUtc !== 'string') return null;
        const compare = parseFarmCompare(value.compare);
        return compare ? { userId, receivedAtUtc: value.receivedAtUtc, compare } : null;
    } catch {
        return null;
    }
}

/** Keeps an answer for this farm and user; nothing is written when no user is known. A blocked store only costs the next offline start. */
export async function saveCompare(farmId: string, userId: string | null, compare: FarmCompareDto): Promise<void> {
    if (!userId) return;
    try {
        const receivedAtUtc = new Date().toISOString();
        await getDatabase().appMeta.put({
            key: compareMetaKey(farmId),
            value: { userId, receivedAtUtc, compare },
            updatedAt: receivedAtUtc,
        });
    } catch {
        /* a blocked store only means nothing is kept for the next time without a net */
    }
}

export async function dropCompare(farmId: string): Promise<void> {
    try {
        await getDatabase().appMeta.delete(compareMetaKey(farmId));
    } catch {
        /* nothing kept to remove */
    }
}
