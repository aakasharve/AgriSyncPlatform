import { mutationQueue } from '../../../infrastructure/sync/MutationQueue';
import { idGenerator } from '../../../core/domain/services/IdGenerator';

export interface VerifyLogPayload {
     dailyLogId: string;
     verificationStatus: 'verified' | 'disputed' | 'correction_pending';
     reason?: string;
}

export class VerifyLogCommand {
     static async enqueue(payload: VerifyLogPayload): Promise<string> {
          const clientRequestId = idGenerator.generate();
          return mutationQueue.enqueue('verify_log', payload, {
               clientRequestId,
               clientCommandId: clientRequestId
          });
     }
}
