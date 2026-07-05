import { mutationQueue } from '../../../infrastructure/sync/MutationQueue';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';

export interface LocationPayload {
     latitude: number;
     longitude: number;
     accuracyMeters: number;
     altitude?: number;
     capturedAtUtc: string;
     provider: string;
     permissionState: string;
}

export interface WeatherStampPayload {
     plotId?: string;
     timestampLocal: string;
     timestampProvider: string;
     provider: string;
     tempC: number;
     humidity: number;
     windKph: number;
     precipMm: number;
     cloudCoverPct: number;
     conditionText: string;
     iconCode: string;
     rainProbNext6h: number;
     windGustKph?: number;
     soilMoistureVolumetric0To10?: number;
     uvIndex?: number;
     alerts?: string[];
}

export interface CreateDailyLogPayload {
     dailyLogId: string;
     farmId: string;
     plotId: string;
     cropCycleId: string;
     logDate: string;
     location?: LocationPayload;
     weatherStamp?: WeatherStampPayload;
     // AI Intelligence Plan WP-2a — the original parse job id (AiJob.Id) carried
     // back on confirm so the server can derive the typed ledger rows keyed to
     // that job. Omitted for manual logs and offline logs with no source parse.
     sourceAiJobId?: string;
}

export class CreateDailyLogCommand {
     static async enqueue(payload: CreateDailyLogPayload): Promise<string> {
          const clientRequestId = `${SyncMutationName.CreateDailyLog}:${payload.dailyLogId}`;
          return mutationQueue.enqueue(SyncMutationName.CreateDailyLog, payload, {
               clientRequestId,
               clientCommandId: clientRequestId
          });
     }
}
