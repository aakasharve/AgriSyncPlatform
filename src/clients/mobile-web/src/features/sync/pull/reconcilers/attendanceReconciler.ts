/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Labour V2 R1 Task 3.5c — reconciles server-acknowledged attendance marks
 * into `db.attendanceMarks` (the pull carriage of P10: once landed here, the
 * fact is reconstructable without the device that spoke it).
 *
 * A pull with the field absent (older server) is a NO-OP — the wire field is
 * additive and optional. Rows are keyed by the mark's server id; `put` makes
 * re-pulls idempotent.
 *
 * Must run inside the orchestrator's `db.transaction('rw', ...)` block
 * (financeReconciler idiom).
 */

import type { SyncPullResponse } from '../../../../infrastructure/api/AgriSyncClient';
import type { AgriLogDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { normalizeMojibakeDeep } from '../../../../shared/utils/textEncoding';

export async function reconcileAttendance(
    db: AgriLogDatabase,
    payload: SyncPullResponse,
    receivedAtUtc: string,
): Promise<void> {
    const marks = (payload.attendanceMarks ?? []).map(m => normalizeMojibakeDeep(m).value);
    for (const mark of marks) {
        await db.attendanceMarks.put({
            id: mark.id,
            farmId: mark.farmId,
            fieldOperatorId: mark.fieldOperatorId,
            workDate: mark.workDate,
            payload: mark,
            updatedAt: receivedAtUtc,
        });
    }
}
