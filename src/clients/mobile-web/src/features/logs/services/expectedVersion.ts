/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF-S fix pass 1, B005) — when a record's create goes out with
 * separate task lines (`add_log_task`), the server moves the record's version on once for each line. This phone then
 * expects 1 + their number, so a move or an edit made before the next pull names the server's own version and is never
 * refused as "someone changed it" when nobody did. Written onto the phone's copy of the log (the one every
 * version-reading path reads: `getDatabase().logs`) and onto the caller's object. A failure is kept in the log and
 * changes nothing else: the next pull states the server's own version, and that wins.
 */
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import type { DailyLog } from '../../../types';

export async function expectVersionOnPhone(log: DailyLog, version: number): Promise<void> {
    log.contentVersion = version;
    try {
        const db = getDatabase();
        const row = await db.logs.get(log.id);
        if (row) await db.logs.put({ ...row, log: { ...row.log, contentVersion: version } });
    } catch (error) {
        console.error(`enqueueLogsForSync: the expected version of ${log.id} could not be written on this phone`, error);
    }
}
