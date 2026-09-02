/**
 * Labour V2 R1 — the ONE local read of attendance marks, both halves labelled.
 *
 * `source: 'server'` rows came down /sync/pull — acknowledged, reconstructable
 * without this device. `source: 'queue'` rows are LIVE mutationQueue intent —
 * PENDING/SENDING/FAILED/REJECTED_USER_REVIEW (see LIVE_INTENT_STATUSES for
 * why each is in and, more importantly, why the other two are OUT) — real,
 * durable, and NOT SAVED YET. P10 binds every consumer: a queue-sourced fact
 * must render with the existing unsynced treatment (लक्षात ठेवलं ✓ family),
 * never as server truth. Phase 4's register consumes this; it must not read
 * the two stores separately and lose the label.
 */
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import type { MutationQueueStatus } from '../../../infrastructure/storage/DexieDatabase';
import type { AttendanceMarkPayload } from '../../../application/usecases/sync/MarkAttendanceCommand';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';

export interface LocalAttendanceMark {
    fieldOperatorId: string;
    workDate: string;
    dayMark?: string;
    nightMark?: string;
    hoursWorked?: number;
    extraHours?: number;
    source: 'server' | 'queue';
}

/**
 * The queue statuses that ARE live local intent — filtered TO, never filtered
 * away-from, so a status added to the vocabulary later defaults to hidden
 * until someone decides here what it means (B001, 3.5 review).
 *
 * - PENDING / SENDING — captured, not yet acknowledged. The heart of P10.
 * - FAILED — retry-capped or backed-off, but still the farmer's statement;
 *   parking a fact must not erase it from his own register.
 * - REJECTED_USER_REVIEW — permanently refused THESE BYTES (for
 *   attendance.mark that is the AttendanceContradiction question) and sitting
 *   in the conflict UI awaiting HIS answer. Deliberately shown: the mark is
 *   still his stated, unresolved intent, and a register that blanked it the
 *   moment sync ran would make his statement silently vanish while the
 *   question is still open. It renders as 'queue' — the honest weaker state.
 *
 * NOT live, by decision:
 * - APPLIED — acknowledged; the server row from /sync/pull owns the fact now.
 * - REJECTED_DROPPED — the farmer EXPLICITLY discarded it in the conflict UI
 *   (MutationQueue.markRejectedDropped: soft-delete, kept only for audit).
 *   Surfacing it would resurrect a mark he chose to throw away, forever —
 *   it never retries, never flips to 'server', never leaves. Pinned in
 *   attendanceLocal.test.ts.
 */
const LIVE_INTENT_STATUSES: ReadonlySet<MutationQueueStatus> = new Set<MutationQueueStatus>([
    'PENDING',
    'SENDING',
    'FAILED',
    'REJECTED_USER_REVIEW',
]);

export async function getLocalAttendanceMarks(farmId: string): Promise<LocalAttendanceMark[]> {
    const db = getDatabase();
    const server = await db.attendanceMarks.where('farmId').equals(farmId).toArray();
    const queued = await db.mutationQueue
        .where('mutationType').equals(SyncMutationName.AttendanceMark)
        .filter(row => LIVE_INTENT_STATUSES.has(row.status))
        .toArray();
    const out: LocalAttendanceMark[] = server.map(r => ({
        fieldOperatorId: r.fieldOperatorId,
        workDate: r.workDate,
        dayMark: r.payload.dayMark ?? undefined,
        nightMark: r.payload.nightMark ?? undefined,
        hoursWorked: r.payload.hoursWorked ?? undefined,
        extraHours: r.payload.extraHours ?? undefined,
        source: 'server',
    }));
    for (const row of queued) {
        const p = row.payload as AttendanceMarkPayload;
        if (p.farmId !== farmId) continue;
        out.push({
            fieldOperatorId: p.fieldOperatorId, workDate: p.workDate,
            dayMark: p.dayMark, nightMark: p.nightMark,
            hoursWorked: p.hoursWorked, extraHours: p.extraHours,
            source: 'queue',
        });
    }
    return out;
}
