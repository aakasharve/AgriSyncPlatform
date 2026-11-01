import { v4 as uuidv4 } from 'uuid';
import type { RecordAudienceName, RecordKindName } from '../../../infrastructure/api/recordAudienceDtos';
import { mutationQueue } from '../../../infrastructure/sync/MutationQueue';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';

/**
 * spec: plr-d10 lane PRV (founder D-26) — the farm's primary account holder chooses who sees ONE record
 * (`set_record_audience.zod.ts`), queued so it works with no internet (P10); the server decides when it arrives
 * (only the holder of the record's farm; every chosen person an Active member of that farm, E4).
 */
export interface SetRecordAudiencePayload {
    recordKind: RecordKindName;
    recordId: string;
    audience: RecordAudienceName;
    /** The people he chose: at least one for `Selected`, none otherwise. */
    selectedUserIds: string[];
    changedAtUtc: string;
}

/** 'Selected' names at least one person, the other two nobody; each person once. */
export function namesPeopleRightly(p: Pick<SetRecordAudiencePayload, 'audience' | 'selectedUserIds'>): boolean {
    return (p.audience === 'Selected') === (p.selectedUserIds.length > 0)
        && new Set(p.selectedUserIds).size === p.selectedUserIds.length;
}

export class SetRecordAudienceCommand {
    /** Every choice is its own request (choosing again later is a new choice); the server ignores a repeat of the same one. */
    static async enqueue(payload: SetRecordAudiencePayload): Promise<string> {
        if (!namesPeopleRightly(payload)) {
            throw new Error('set_record_audience: Selected names at least one person, the others nobody.');
        }

        const clientRequestId = `${SyncMutationName.SetRecordAudience}:${payload.recordId}:${uuidv4()}`;
        return mutationQueue.enqueue(SyncMutationName.SetRecordAudience, payload, {
            clientRequestId,
            clientCommandId: clientRequestId,
        });
    }
}
