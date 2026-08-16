import type { DayOutcome } from '../../../domain/types/log.types';
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
     /**
      * FOUNDER DECISION 8 (2026-08-16) — the farmer's own statement about the DAY.
      *
      * NOT a bucket: a scalar the server records verbatim on `ssf.daily_logs.day_outcome`.
      * Absent on every ordinary work day, and an absent value is never defaulted to
      * 'WORK_RECORDED' — "he did not say" and "he said it was a rest day" must stay
      * distinguishable (P4).
      *
      * It is deliberately NOT expressed as a `disturbance`: "there was no work today" is a
      * statement about the day, not a blockage, and routing it through `disturbance_events`
      * would set `HasDisturbance` for a plain rest day and report `blocked` instead of
      * `rest` — the wrong fact, not a shortcut.
      */
     dayOutcome?: DayOutcome;
     /**
      * OPTIONAL reason chip, offered AFTER the declaration is already saved. Doctrine P9 —
      * its absence never rejects the record. It rides the existing `disturbance` wire shape
      * (`LedgerDerivationService` already writes a `DisturbanceEvent` from it), so a chip
      * needs no new table.
      */
     disturbance?: { scope?: string; cause?: string; reason?: string };
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
