// Sub-plan 02 Task 8: canonical payload schema for the create_daily_log
// mutation. The shape mirrors the backend handler's allowlist
// (`PushSyncBatchHandler.HandleCreateDailyLogAsync` →
// `CreateDailyLogMutationPayload`) and the client's
// `CreateDailyLogCommand.enqueue` interface, so any divergence here is a
// real contract drift and not a "schema we plan to harden later".
//
// History: an earlier draft of this file used a forward-looking shape
// (`logId`, `plotIds[]`, `inputMode`, `clientRequestId` inside the
// payload) that no producer or consumer actually emitted. That caused
// `MutationQueue.enqueue` to throw at the offline boundary the moment a
// real plot context produced a queueable mutation, breaking the e2e
// suite (specs 02 & 03). The schema now reflects the wire format that
// is actually in production.
import { z } from 'zod';
import { ZGuid } from './_shared.zod';

const ZLogDate = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

const LocationPayloadSchema = z.object({
    latitude: z.number(),
    longitude: z.number(),
    accuracyMeters: z.number(),
    altitude: z.number().optional(),
    capturedAtUtc: z.string().datetime({ offset: true }),
    provider: z.string(),
    permissionState: z.string(),
});

// Mirrors the client `WeatherStamp` (weather.types.ts) MINUS `id`
// (server-generated) and MINUS daily_log_id (comes from the parent
// CreateDailyLogPayload). `provider` is kept as a plain string for the
// generator; the backend maps it to the WeatherProvider enum.
const WeatherStampPayloadSchema = z.object({
    plotId: ZGuid.optional(),
    timestampLocal: z.string(),
    timestampProvider: z.string(),
    provider: z.string(),
    tempC: z.number(),
    humidity: z.number(),
    windKph: z.number(),
    precipMm: z.number(),
    cloudCoverPct: z.number(),
    conditionText: z.string(),
    iconCode: z.string(),
    rainProbNext6h: z.number(),
    windGustKph: z.number().optional(),
    soilMoistureVolumetric0To10: z.number().optional(),
    uvIndex: z.number().optional(),
    alerts: z.array(z.string()).optional(),
});

// Labour V1 Task 5 — manual labour transport. Mirrors the fields
// `LabourAssignmentFactory.FromParsed` (Task 3) and `LabourTime` (Task 4)
// need on the WRITE path. `labourAssignmentId` is client-minted so it stays
// stable across replay (A9). `durationHours` is intentionally optional —
// present means the farmer stated it (server records `Explicit`); absent
// means the server applies its own default and records `Assumed`. The
// client must never invent a value here just to fill the field.
const LabourItemSchema = z.object({
    labourAssignmentId: ZGuid,
    engagementType: z.string(),
    maleCount: z.number().int().optional(),
    femaleCount: z.number().int().optional(),
    workerCount: z.number().int().optional(),
    wagePerPerson: z.number().optional(),
    contractUnit: z.string().optional(),
    contractQuantity: z.number().optional(),
    totalCost: z.number().optional(),
    linkedActivityId: ZGuid.optional(),
    shift: z.string().optional(),
    task: z.string().optional(),
    notes: z.string().optional(),
    durationHours: z.number().optional(),
});

export const CreateDailyLogPayload = z.object({
    dailyLogId: ZGuid,
    farmId: ZGuid,
    plotId: ZGuid,
    cropCycleId: ZGuid,
    operatorUserId: ZGuid.optional(),
    logDate: ZLogDate,
    location: LocationPayloadSchema.optional(),
    weatherStamp: WeatherStampPayloadSchema.optional(),
    // AI Intelligence Plan WP-2a — when the farmer confirms a voice draft the
    // client threads the original parse job id (AiJob.Id) so the server can
    // derive the typed ledger rows (LedgerDerivationService) keyed to that job.
    // Optional: manual logs and offline logs without a source job omit it.
    // ZGuid (not z.string().uuid()) so the C# generator emits a `Guid?` that
    // maps 1:1 onto CreateDailyLogCommand.SourceAiJobId (Guid?).
    sourceAiJobId: ZGuid.optional(),
    // Labour V1 Task 5 — structured manual labour entries. Task 5 is
    // transport only: PushSyncBatchHandler widens its allow-list to accept
    // this key and maps it onto CreateDailyLogCommand.Labour, but nothing
    // persists it yet (Task 6).
    labour: z.array(LabourItemSchema).optional(),
});

export type CreateDailyLogPayloadType = z.infer<typeof CreateDailyLogPayload>;
