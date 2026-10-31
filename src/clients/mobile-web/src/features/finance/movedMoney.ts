/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF-S fix pass 2, N1 + N3) — the money a MOVE of a saved record
 * took with it, written on this phone the moment the server says the move is done.
 *
 * The server's answer to `move_daily_log` lists EXACTLY the money entries it moved, each as the pull would carry it
 * (`MoveDailyLogResultDto.moneyMoved`). Those rows — and only those — are written into the phone's copy of the server's
 * ledger (`costEntries`) and merged into the money book by id, the same event a pull raises. So:
 *
 *   - money the server did not move is never moved here (an old-key entry, a line the server could not find: the move
 *     was refused instead, or the entry is not the record's) — the phone and the server cannot disagree (N1);
 *   - money saved a moment ago, still only in the money book and not yet pulled, takes its new place at once (N3);
 *   - the next pull brings the same rows again (the server moved their clock forward), so a failure here heals itself.
 */
import { getDatabase } from '../../infrastructure/storage/DexieDatabase';

/** One money entry as the server sends it (the fields this module relies on; the rest is kept as sent). */
interface MovedCostEntry { id: string; farmId: string; [field: string]: unknown }

/** The money entries a move's answer names, or none when the answer names none (or is not a move's answer). */
export function movedMoneyOf(data: unknown): MovedCostEntry[] {
    if (typeof data !== 'object' || data === null) return [];
    const moved = (data as { moneyMoved?: unknown }).moneyMoved;
    if (!Array.isArray(moved)) return [];
    return moved.filter((row): row is MovedCostEntry =>
        typeof row === 'object' && row !== null
        && typeof (row as { id?: unknown }).id === 'string' && typeof (row as { farmId?: unknown }).farmId === 'string');
}

/** Write the money a move took into this phone's ledger copy and money book. Returns how many entries were written. */
export async function takeMovedMoney(data: unknown): Promise<number> {
    const moved = movedMoneyOf(data);
    if (moved.length === 0) return 0;
    const at = new Date().toISOString();
    await getDatabase().costEntries.bulkPut(moved.map(entry => ({ id: entry.id, farmId: entry.farmId, payload: entry, updatedAt: at })));
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('agrisync:finance-sync-payload', { detail: { costEntries: moved } }));
    }
    return moved.length;
}
