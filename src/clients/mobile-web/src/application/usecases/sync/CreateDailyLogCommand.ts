import { mutationQueue } from '../../../infrastructure/sync/MutationQueue';

export interface LocationPayload {
     latitude: number;
     longitude: number;
     accuracyMeters: number;
     altitude?: number;
     capturedAtUtc: string;
     provider: string;
     permissionState: string;
}

export interface CreateDailyLogPayload {
     dailyLogId: string;
     farmId: string;
     plotId: string;
     cropCycleId: string;
     logDate: string;
     location?: LocationPayload;
}

export class CreateDailyLogCommand {
     static async enqueue(payload: CreateDailyLogPayload): Promise<string> {
          const clientRequestId = `create_daily_log:${payload.dailyLogId}`;
          return mutationQueue.enqueue('create_daily_log', payload, {
               clientRequestId,
               clientCommandId: clientRequestId
          });
     }
}
