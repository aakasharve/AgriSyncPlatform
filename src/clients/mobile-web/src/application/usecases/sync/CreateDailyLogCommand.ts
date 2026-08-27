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

/**
 * LABOUR_PHASE2 A1 — what the farmer asserts about WHERE the work happened.
 *
 * The same three literals `create_daily_log.zod.ts:90` accepts,
 * `PushSyncBatchHandler.cs:603` allow-lists, `ck_daily_logs_scope` compares
 * against and `DailyLogDto` reads back. Renaming one is a schema change, not a
 * refactor.
 */
export type DailyLogScopePayload = 'Plot' | 'MultiPlot' | 'Farm';

/**
 * LABOUR_PHASE2 A1 (landmine L3) — this interface is a THIRD, HAND-WRITTEN copy
 * of the create_daily_log payload shape.
 *
 * The other two are `sync-contract/schemas/payloads/create_daily_log.zod.ts`
 * (canonical, validated at `MutationQueue.enqueue` via `PayloadValidator`) and
 * the C# record generated from it. Nothing compiles this file against either,
 * and CI's contract diff gate does not cover it — so the zod schema, the
 * generated C# and the server allow-list can all be correct while THIS file
 * silently sends last month's shape. The only reason nothing is broken today is
 * that the drift happens to fail loud in one direction: TypeScript rejects
 * `scope:` as an excess property on an object literal until the interface is
 * widened, which is what this change does.
 *
 * `__tests__/CreateDailyLogPayload.scope.test.ts` now compares this shape with
 * the zod-inferred one at the TYPE level — assignability both ways, plus the
 * key sets, which is the check that catches an OPTIONAL field added on one
 * side. So the next divergence fails TYPECHECK instead of a farmer's sync.
 *
 * WHY `plotId` AND `cropCycleId` BECOME OPTIONAL. A `MultiPlot` or `Farm` log
 * genuinely has neither, and inventing one to satisfy a required field is the
 * exact fabrication P4 forbids and founder decision O-1 closed. They stay
 * effectively required for `Plot`: `CreateDailyLogValidator` (HTTP) and
 * `CreateDailyLogHandler` (both paths) reject a plot-scoped log without them,
 * so the guard moves from this interface to the server rather than vanishing.
 *
 * THE INVARIANTS, which the domain and a database CHECK both enforce:
 *   'Plot'      => plotIds = [plotId], cropCycleId required
 *   'MultiPlot' => plotIds.length >= 2, no plotId, no cropCycleId
 *   'Farm'      => plotIds empty/omitted, no plotId, no cropCycleId
 *
 * `scope` omitted means `Plot` (`create_daily_log.zod.ts:84-89`) — that is what
 * every client shipped before P2.2 means, and the field stays optional so those
 * payloads keep validating.
 *
 * NOTE ON SCOPE OF THIS CHANGE: A1 makes the interface CAPABLE of carrying a
 * scope. It deliberately does not make anything PRODUCE one —
 * `logSyncMutationService.ts` is reserved for Phase 2b and is byte-identical to
 * `labour-v1-green`. An un-produced capability is the expected end state here.
 */
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
     scope?: DailyLogScopePayload;
     /**
      * The canonical spatial assertion as a SET, in the order the farmer's
      * selection was made: one entry for `Plot`, two or more for `MultiPlot`,
      * empty or omitted for `Farm`. Never a sentinel, never "the first plot".
      */
     plotIds?: string[];
     plotId?: string;
     cropCycleId?: string;
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
