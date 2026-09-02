/**
 * Labour V2 R1 — the ONE local read of attendance marks, both halves labelled.
 *
 * `source: 'server'` rows came down /sync/pull — acknowledged, reconstructable
 * without this device. `source: 'queue'` rows are PENDING/FAILED mutationQueue
 * intent — real, durable, and NOT SAVED YET. P10 binds every consumer: a
 * queue-sourced fact must render with the existing unsynced treatment
 * (लक्षात ठेवलं ✓ family), never as server truth. Phase 4's register consumes
 * this; it must not read the two stores separately and lose the label.
 */
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
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

export async function getLocalAttendanceMarks(farmId: string): Promise<LocalAttendanceMark[]> {
    const db = getDatabase();
    const server = await db.attendanceMarks.where('farmId').equals(farmId).toArray();
    // `status !== 'APPLIED'` is the honest filter: FAILED intent is still
    // intent — a row the farmer spoke that has not been acknowledged is not
    // allowed to disappear from his own register just because a push failed.
    const queued = await db.mutationQueue
        .where('mutationType').equals(SyncMutationName.AttendanceMark)
        .filter(row => row.status !== 'APPLIED')
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
