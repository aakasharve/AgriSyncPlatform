import { mutationQueue } from '../../../infrastructure/sync/MutationQueue';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';

export interface AttendanceMarkPayload {
    attendanceMarkId: string;
    farmId: string;
    fieldOperatorId: string;
    /** YYYY-MM-DD — the farmer's day, not a timestamp. */
    workDate: string;
    /** Omitted = this door says NOTHING about that half (B002): a first mark
     *  stores the silence as Unmarked ("nobody said"); an amend PRESERVES the
     *  stored half — a stated fact is never erased by an unspoken one. */
    dayMark?: 'Full' | 'Half' | 'Absent';
    nightMark?: 'Worked' | 'NotWorked';
    hoursWorked?: number;
    extraHours?: number;
    resolvedLabourAssignmentId?: string;
}

const factsOf = (p: AttendanceMarkPayload): string => [
    p.dayMark ?? '-', p.nightMark ?? '-', p.hoursWorked ?? '-', p.extraHours ?? '-',
].join(':');

export class MarkAttendanceCommand {
    /**
     * clientRequestId is a derivable VALUE-KEYED natural key: the row's natural
     * key (farm:operator:date — also the DB unique index) plus the stated
     * facts. Same fact re-tapped = same key = device+server dedupe
     * (MutationQueue &[deviceId+clientRequestId]; PushSyncBatchHandler:457).
     * A CHANGED ruling is a new REQUEST about the same row → new key → the
     * server handler amends through the entity (a REVERT A -> B -> A is also a
     * new request: the key carries a `:revN` suffix once the person-day already
     * holds statements, so the farmer's last word is never swallowed by the
     * first row). Never a random guid — a
     * random id turns the second tap into a 23505 told to the farmer as
     * "a database constraint rejected this mutation".
     */
    static async enqueue(payload: AttendanceMarkPayload): Promise<string> {
        if (payload.dayMark == null && payload.nightMark == null
            && payload.hoursWorked == null && payload.extraHours == null) {
            throw new Error('attendance.mark must state something — an empty ruling is the absence of a mark.');
        }
        const factsKey = factsOf(payload);
        const baseKey = [
            SyncMutationName.AttendanceMark,
            payload.farmId, payload.fieldOperatorId, payload.workDate,
            factsKey,
        ].join(':');

        // The facts-only key is unique per (person-day, facts) FOREVER, so a
        // revert (A -> B -> A) would collide with the first A row and the
        // farmer's last word would be silently swallowed. Look at what this
        // person-day already holds on this device:
        //   - nothing                  -> the plain facts key (first request);
        //   - latest statement == new  -> the same request again (double tap,
        //                                 retry): hand back THAT row's key;
        //   - otherwise                -> a new request, keyed by how many
        //                                 statements preceded it.
        // A row the farmer explicitly discarded (REJECTED_DROPPED) is not a
        // statement he stands behind, so it does not count as "latest".
        const history = (await getDatabase().mutationQueue
            .where('mutationType').equals(SyncMutationName.AttendanceMark)
            .filter((row) => {
                const p = row.payload as AttendanceMarkPayload;
                return p.farmId === payload.farmId
                    && p.fieldOperatorId === payload.fieldOperatorId
                    && p.workDate === payload.workDate;
            })
            .toArray())
            .sort((l, r) => (l.id ?? 0) - (r.id ?? 0));
        const standing = history.filter((row) => row.status !== 'REJECTED_DROPPED');
        const latest = standing[standing.length - 1];
        if (latest && factsOf(latest.payload as AttendanceMarkPayload) === factsKey) {
            return latest.clientRequestId;
        }
        const clientRequestId = history.length === 0 ? baseKey : `${baseKey}:rev${history.length}`;
        return mutationQueue.enqueue(SyncMutationName.AttendanceMark, payload, {
            clientRequestId,
            clientCommandId: clientRequestId,
        });
    }
}
