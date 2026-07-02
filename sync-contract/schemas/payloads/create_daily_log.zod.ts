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

export const CreateDailyLogPayload = z.object({
    dailyLogId: ZGuid,
    farmId: ZGuid,
    plotId: ZGuid,
    cropCycleId: ZGuid,
    operatorUserId: ZGuid.optional(),
    logDate: ZLogDate,
    location: LocationPayloadSchema.optional(),
    weatherStamp: WeatherStampPayloadSchema.optional(),
});

export type CreateDailyLogPayloadType = z.infer<typeof CreateDailyLogPayload>;
