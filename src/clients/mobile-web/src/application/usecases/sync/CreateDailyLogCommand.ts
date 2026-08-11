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

export interface LabourItemPayload {
     labourAssignmentId: string; // client-minted, stable across replay (A9)
     engagementType: string; // mapped server-side via LabourAssignmentFactory.MapLabourEngagement
     maleCount?: number;
     femaleCount?: number;
     workerCount?: number;
     wagePerPerson?: number;
     contractUnit?: string;
     contractQuantity?: number;
     totalCost?: number;
     linkedActivityId?: string;
     shift?: string;
     task?: string;
     notes?: string;
     // Present => the server records Explicit; absent => the server applies
     // its own default and records Assumed. Never invent a value here just
     // to fill the field — omitting it is the correct way to say "not stated".
     durationHours?: number;
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
     // Labour V1 Task 5 — structured manual labour entries. Transport only:
     // nothing server-side persists this yet (Task 6 adds the write path).
     labour?: LabourItemPayload[];
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
