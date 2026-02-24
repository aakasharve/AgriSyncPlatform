import { mutationQueue } from '../../../infrastructure/sync/MutationQueue';
import { idGenerator } from '../../../core/domain/services/IdGenerator';

export interface AddLogTaskPayload {
     dailyLogId: string;
     taskId: string;
     activityType: string;
     notes?: string;
}

export class AddLogTaskCommand {
     static async enqueue(payload: AddLogTaskPayload): Promise<string> {
          const clientRequestId = idGenerator.generate();
          return mutationQueue.enqueue('add_log_task', payload, {
               clientRequestId,
               clientCommandId: clientRequestId
          });
     }
}
