import { mutationQueue } from '../../../infrastructure/sync/MutationQueue';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';

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

export class MarkAttendanceCommand {
    /**
     * clientRequestId is a derivable VALUE-KEYED natural key: the row's natural
     * key (farm:operator:date — also the DB unique index) plus the stated
     * facts. Same fact re-tapped = same key = device+server dedupe
     * (MutationQueue &[deviceId+clientRequestId]; PushSyncBatchHandler:457).
     * A CHANGED ruling is a new REQUEST about the same row → new key → the
     * server handler amends through the entity. Never a random guid — a
     * random id turns the second tap into a 23505 told to the farmer as
     * "a database constraint rejected this mutation".
     */
    static async enqueue(payload: AttendanceMarkPayload): Promise<string> {
        if (payload.dayMark == null && payload.nightMark == null
            && payload.hoursWorked == null && payload.extraHours == null) {
            throw new Error('attendance.mark must state something — an empty ruling is the absence of a mark.');
        }
        const clientRequestId = [
            SyncMutationName.AttendanceMark,
            payload.farmId, payload.fieldOperatorId, payload.workDate,
            payload.dayMark ?? '-', payload.nightMark ?? '-',
            payload.hoursWorked ?? '-', payload.extraHours ?? '-',
        ].join(':');
        return mutationQueue.enqueue(SyncMutationName.AttendanceMark, payload, {
            clientRequestId,
            clientCommandId: clientRequestId,
        });
    }
}
