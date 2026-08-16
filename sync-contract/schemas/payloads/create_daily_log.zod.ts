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

// spec: dfes-farmer-facing-deploy-readiness-2026-08-14 (task-0b) — the MANUAL
// draft. Until now a manual save sent only the log's identity, so the server had
// nothing to normalise: no typed children were ever written for it, the scorer
// saw an empty day, and every manual-entry day was reported to the farmer as
// 0/10. These are the eight buckets the confirm screen (ManualEntry.tsx) already
// builds its `userDraft` from, and they are deliberately the SAME eight names as
// `CreateDailyLogHandler.EvidenceArrayKeys` — one vocabulary, not a second list.
//
// Each row is `z.unknown()` on purpose. The buckets are heterogeneous and still
// evolving on the client, and a strict per-row schema here would reject a farmer's
// whole day over one unrecognised field. Row-level meaning is applied SERVER-side
// by ManualDraftNormalizer, which copies only fields it recognises and never
// invents one. The array-of-objects shape IS enforced (a scalar in a bucket is a
// contract error, not data), and PushSyncBatchHandler independently rejects
// unknown bucket keys and over-sized drafts at the sync boundary.
const ZDraftBucket = z.array(z.unknown());

// spec: dfes-companion-2026-07-11 (wave-3.10), founder decision 8 (2026-08-16) — the
// farmer's own statement about the DAY, and the optional chip explaining it. These are
// the only two NON-bucket keys the draft carries: scalars, not arrays of rows. The eight
// bucket names above are untouched.
//
// The vocabulary is the SAME one the AI contract already uses (`DayOutcomeSchema`,
// AgriLogResponseSchema.ts) — one vocabulary for what a day turned out to be, never a
// second list that can drift out of step with the first.
const ManualDraftSchema = z.object({
    labour: ZDraftBucket.optional(),
    inputs: ZDraftBucket.optional(),
    irrigation: ZDraftBucket.optional(),
    observations: ZDraftBucket.optional(),
    plannedTasks: ZDraftBucket.optional(),
    cropActivities: ZDraftBucket.optional(),
    machinery: ZDraftBucket.optional(),
    activityExpenses: ZDraftBucket.optional(),
    dayOutcome: z.enum(['WORK_RECORDED', 'DISTURBANCE_RECORDED', 'NO_WORK_PLANNED', 'IRRELEVANT_INPUT']).optional(),
    // OPTIONAL by doctrine P9: a declaration with no chip must still be accepted. Every
    // field inside is optional too — a chip whose reason is missing simply writes no
    // DisturbanceEvent server-side rather than failing the farmer's whole day.
    disturbance: z.object({
        scope: z.string().optional(),
        cause: z.string().optional(),
        reason: z.string().optional(),
    }).optional(),
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
    // The farmer's typed day. Present on a MANUAL save; omitted on a voice
    // confirm (whose facts already ride sourceAiJobId's AiJob) and omitted by
    // every older client — an absent draft must behave exactly as before.
    manualDraft: ManualDraftSchema.optional(),
});

export type CreateDailyLogPayloadType = z.infer<typeof CreateDailyLogPayload>;
