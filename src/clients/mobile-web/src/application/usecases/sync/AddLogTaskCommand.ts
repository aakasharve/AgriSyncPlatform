import { mutationQueue } from '../../../infrastructure/sync/MutationQueue';

export interface AddLogTaskPayload {
     dailyLogId: string;
     logTaskId: string;
     activityType: string;
     notes?: string;
     occurredAtUtc?: string;
}

export class AddLogTaskCommand {
     static async enqueue(payload: AddLogTaskPayload): Promise<string> {
          const clientRequestId = `add_log_task:${payload.dailyLogId}:${payload.logTaskId}`;
          return mutationQueue.enqueue('add_log_task', payload, {
               clientRequestId,
               clientCommandId: clientRequestId
          });
     }
}
