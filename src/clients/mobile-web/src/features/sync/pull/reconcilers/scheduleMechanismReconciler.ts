/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 1, "The switch"; P11)
 *
 * The pull carries `capabilities.scheduleMechanism.farmIds`: the farms of this pull the schedule mechanism is switched on for. FULL on every pull (the owner
 * flips a switch and no row changes), so it is stored whole in `appMeta`, replacing the last answer (`core/session/scheduleMechanism.ts` reads it).
 *
 * Unlike the other pull keys, an ABSENT key is an ANSWER, not "leave it": the server omits `capabilities` when the switch is off for every farm of the pull
 * (so a switched-off pull is byte for byte what it was), and an older server never sends it. Both are OFF and clear what was stored, so a switch turned off,
 * or a server rolled back, never leaves a phone showing screens the server would refuse. A value that cannot be read is off too. Never throws into the pull.
 */
import type { SyncPullResponse } from '../../../../infrastructure/api/AgriSyncClient';
import type { AgriLogDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import {
    SCHEDULE_MECHANISM_META_ROW,
    parseScheduleMechanismFarmIds,
    writeScheduleMechanismFarmIds,
} from '../../../../core/session/scheduleMechanism';

/**
 * Returns true when the answer was stored this pull. An "off" answer replaces an answer that was stored (that is how a switch turned off is learned), but on a
 * phone that holds none it writes NOTHING: a pull from a server where the mechanism was never on leaves `appMeta` exactly as it was before this slice.
 */
export async function reconcileScheduleMechanism(db: AgriLogDatabase, payload: SyncPullResponse, receivedAtUtc: string): Promise<boolean> {
    const capabilities = (payload as SyncPullResponse & { capabilities?: unknown }).capabilities;
    try {
        const farmIds = parseScheduleMechanismFarmIds(capabilities);
        if (farmIds.length === 0 && !(await db.appMeta.get(SCHEDULE_MECHANISM_META_ROW))) return false;
        await writeScheduleMechanismFarmIds(db, farmIds, receivedAtUtc);
        return true;
    } catch (error) {
        console.warn(JSON.stringify({
            component: 'scheduleMechanismReconciler',
            action: 'schedule_mechanism_not_kept_this_pull',
            reason: error instanceof Error ? error.message : String(error),
        }));
        return false;
    }
}
