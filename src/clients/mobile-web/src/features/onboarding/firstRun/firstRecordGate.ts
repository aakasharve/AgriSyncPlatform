/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 — repair R1-g Part 1, task 1d (founder Q-A, 27 Nov: "Save after बरोबर").
 * The farm's FIRST record on this phone is saved only on his "बरोबर"; every later record saves at once (D-44, unchanged).
 *
 * It is the first only when BOTH hold, read from the phone itself:
 *   - the farm's once-only mark (`firstRecordOfferKey`, the same mark the setup-hub line uses, 1b) is not set;
 *   - the phone holds NO record of this farm. A record with no farm on it counts as this farm's, so a doubt always falls
 *     to today's auto-save, never to holding work back.
 * An installed phone whose farm already has records, but no mark (it never had this build), is therefore past its first (P11).
 * A read that fails is "not first" for the same reason. No farm open: never gated.
 */
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { FIRST_RECORD_SAVED, firstRecordOfferKey } from './firstRecord';

export async function isFirstRecordOnPhone(farmId: string | null | undefined): Promise<boolean> {
    if (!farmId) return false;
    try {
        const db = getDatabase();
        const mark = (await db.uiPrefs.get(firstRecordOfferKey(farmId)))?.value;
        if (mark !== undefined && mark !== '') return false;
        const anyOfThisFarm = await db.logs.filter(row => {
            const owner = row.log?.meta?.farmId;
            return !owner || owner === farmId;
        }).first();
        return anyOfThisFarm === undefined;
    } catch {
        return false;
    }
}

/**
 * "बरोबर" saved the farm's first record: set the mark, once. It never overwrites a later value (the setup-hub line showing
 * for that record, or answered). A failed write is harmless: the record now on the phone already ends the first.
 */
export async function markFirstRecordSaved(farmId: string | null | undefined): Promise<void> {
    if (!farmId) return;
    try {
        const db = getDatabase();
        const key = firstRecordOfferKey(farmId);
        await db.transaction('rw', db.uiPrefs, async () => {
            const now = (await db.uiPrefs.get(key))?.value;
            if (now === undefined || now === '') await db.uiPrefs.put({ key, value: FIRST_RECORD_SAVED });
        });
    } catch {
        // the stored record ends the farm's first on its own (`isFirstRecordOnPhone`)
    }
}
