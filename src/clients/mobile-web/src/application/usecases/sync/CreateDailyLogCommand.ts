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

/**
 * spec: dfes-farmer-facing-deploy-readiness-2026-08-14 (task-0b) — the farmer's typed
 * day, as entered on the manual-entry screen. Sent ONLY on a manual save; a voice
 * confirm's facts already ride `sourceAiJobId`.
 *
 * Rows are `unknown` on purpose: these buckets are heterogeneous and evolve on the
 * client, and the server (ManualDraftNormalizer) copies only fields it recognises and
 * invents none. Bucket NAMES are the contract, and they are the same eight the canonical
 * zod schema and CreateDailyLogHandler.EvidenceArrayKeys use.
 */
export interface ManualDraftPayload {
     labour?: unknown[];
     inputs?: unknown[];
     irrigation?: unknown[];
     observations?: unknown[];
     plannedTasks?: unknown[];
     cropActivities?: unknown[];
     machinery?: unknown[];
     activityExpenses?: unknown[];
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
     // task-0b — present on a MANUAL save so the server has something to persist.
     // Omitted on voice confirms; omitting it entirely is the pre-task-0b behaviour.
     manualDraft?: ManualDraftPayload;
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
