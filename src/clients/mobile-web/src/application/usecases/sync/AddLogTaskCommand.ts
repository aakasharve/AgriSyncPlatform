import { mutationQueue } from '../../../infrastructure/sync/MutationQueue';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';

export interface AddLogTaskPayload {
     dailyLogId: string;
     logTaskId: string;
     activityType: string;
     notes?: string;
     occurredAtUtc?: string;
}

export class AddLogTaskCommand {
     static async enqueue(payload: AddLogTaskPayload): Promise<string> {
          const clientRequestId = `${SyncMutationName.AddLogTask}:${payload.dailyLogId}:${payload.logTaskId}`;
          return mutationQueue.enqueue(SyncMutationName.AddLogTask, payload, {
               clientRequestId,
               clientCommandId: clientRequestId
          });
     }
}
