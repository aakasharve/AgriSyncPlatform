import { AddLogTaskCommand } from '../../../application/usecases/sync/AddLogTaskCommand';
import { CreateDailyLogCommand, type ManualDraftPayload } from '../../../application/usecases/sync/CreateDailyLogCommand';
import { idGenerator } from '../../../core/domain/services/IdGenerator';
import { type CropCycleDto, type PlotDto } from '../../../infrastructure/api/AgriSyncClient';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { backgroundSyncWorker } from '../../../infrastructure/sync/BackgroundSyncWorker';
import { type DailyLog } from '../../../types';

// The backend's AddLogTaskMutationPayload deserializes logTaskId as a
// nullable Guid. Local domain code, however, freely uses non-UUID strings
// like 'act_global_daily', `irr_${Date.now()}`, or scoped composites like
// 'act_global_daily::<plotUuid>' for in-memory state keying. If those land
// on the wire as-is, /sync/push returns 500 and the cycle never produces
// REJECTED → the conflict-badge / retry UI starves. So at the sync
// boundary we replace any non-UUID logTaskId with a freshly generated v4
// UUID. The payload is then memoised inside the mutation queue, so retries
// reuse the same UUID and stay idempotent.
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function ensureUuid(localId: string | undefined): string {
    if (localId && UUID_REGEX.test(localId)) {
        return localId;
    }
    return idGenerator.generate();
}

interface ResolvedLogSyncTarget {
    farmId: string;
    plotId: string;
    cropCycleId: string;
}

interface LogTaskMutationPayload {
    logTaskId: string;
    activityType: string;
    notes?: string;
    occurredAtUtc?: string;
}

function normalizeName(value?: string): string {
    return (value || '').trim().toLowerCase();
}

function buildTaskNotes(parts: Array<string | undefined>): string | undefined {
    const filtered = parts
        .map(part => part?.trim())
        .filter((part): part is string => Boolean(part && part.length > 0));

    if (filtered.length === 0) {
        return undefined;
    }

    return filtered.join(' • ');
}

function buildTaskPayloads(log: DailyLog): LogTaskMutationPayload[] {
    const occurredAtUtc = log.meta?.createdAtISO;
    const payloads: LogTaskMutationPayload[] = [];

    log.cropActivities.forEach(activity => {
        payloads.push({
            logTaskId: ensureUuid(activity.id),
            activityType: activity.workTypes?.[0] || activity.title,
            notes: activity.notes,
            occurredAtUtc,
        });
    });

    log.irrigation.forEach(event => {
        payloads.push({
            logTaskId: ensureUuid(event.id),
            activityType: 'Irrigation',
            notes: buildTaskNotes([
                event.method ? `Method: ${event.method}` : undefined,
                event.source ? `Source: ${event.source}` : undefined,
                event.durationHours ? `Duration: ${event.durationHours} hrs` : undefined,
                event.notes,
            ]),
            occurredAtUtc,
        });
    });

    log.labour.forEach(event => {
        payloads.push({
            logTaskId: ensureUuid(event.id),
            activityType: event.activity || 'Labour',
            notes: buildTaskNotes([
                event.count ? `Workers: ${event.count}` : undefined,
                event.totalCost ? `Cost: ₹${event.totalCost}` : undefined,
                event.notes,
            ]),
            occurredAtUtc,
        });
    });

    log.inputs.forEach(event => {
        const productName = event.productName || event.mix?.[0]?.productName || 'Input';
        const activityType = event.type === 'fertilizer' || event.reason === 'Growth' || event.reason === 'Deficiency'
            ? `Fertilizer ${productName}`
            : `Spray ${productName}`;

        payloads.push({
            logTaskId: ensureUuid(event.id),
            activityType,
            notes: buildTaskNotes([
                event.quantity ? `Qty: ${event.quantity} ${event.unit || ''}` : undefined,
                event.cost ? `Cost: ₹${event.cost}` : undefined,
                event.notes,
            ]),
            occurredAtUtc,
        });
    });

    log.machinery.forEach(event => {
        payloads.push({
            logTaskId: ensureUuid(event.id),
            activityType: `Machinery ${event.type}`,
            notes: buildTaskNotes([
                event.hoursUsed ? `Hours: ${event.hoursUsed}` : undefined,
                event.rentalCost ? `Rent: ₹${event.rentalCost}` : undefined,
                event.fuelCost ? `Fuel: ₹${event.fuelCost}` : undefined,
                event.notes,
            ]),
            occurredAtUtc,
        });
    });

    log.observations?.forEach(event => {
        payloads.push({
            logTaskId: ensureUuid(event.id),
            activityType: event.noteType === 'reminder' ? 'Reminder' : 'Observation',
            notes: event.textCleaned || event.textRaw,
            occurredAtUtc,
        });
    });

    return payloads;
}

/**
 * spec: dfes-farmer-facing-deploy-readiness-2026-08-14 (task-0b) — carry the farmer's
 * typed day to the server on a MANUAL save.
 *
 * The defect this closes: a manual log's payload was identity-only, so the server had
 * nothing to persist. No typed children were ever written for it, the day scored 0/10,
 * and a farmer who had typed out everything he did was told he had recorded nothing.
 *
 * THE GATE IS POSITIVE, AND IT FAILS SAFE. A draft ships only when the log ASSERTS it is
 * manual (`provenance.source === 'manual'`). Anything else — `'ai'`, `'pre_spine'`, or no
 * provenance at all — ships nothing.
 *
 * Why not "no sourceAiJobId": that was wrong and would have written a lie. The client's
 * real discriminator is `LogProvenance.source` (`domain/ai/LogProvenance.ts:18`);
 * `sourceAiJobId` is OPTIONAL even on AI logs (`:36`), and two live producers stamp
 * `source: 'ai'` with no job id — the streaming parse path
 * (`features/voice/useVoiceRecorder.ts:253-258`) and `BackendAiClient.ts:149`
 * (`apiResult.sourceAiJobId ?? undefined`). Such a log's buckets hold AI-EXTRACTED
 * figures. Shipping them as a manual draft would have the server persist them with
 * `Provenance.Manual` — model "n/a", no extractor SHA — making an inferred number
 * permanently indistinguishable from one the farmer typed. Doctrine P8 forbids exactly
 * that, and it is irreversible: it converts a gap in the record into a false record.
 *
 * Why ABSENT provenance ships nothing either: absence is genuinely ambiguous here. A
 * voice route reaches this function with no provenance at all —
 * `useLogCommands.ts:242-250` calls `createFromVoice(..., undefined, ...)` ("Provenance
 * might be lost here", its own comment) and then enqueues. Since shipping is the
 * irreversible direction, an unmarked log is treated as unknown-origin and withheld.
 * Genuinely-manual producers therefore DECLARE themselves — `ManualEntry` and the wizard
 * (`logSubmissionService`) stamp `source: 'manual'` — rather than being inferred from a
 * silence that a voice log can also produce.
 *
 * Also returns undefined for a log with no content at all. An absent draft is the
 * pre-task-0b wire exactly, which is what keeps old servers and voice saves untouched.
 */
export function buildManualDraft(log: DailyLog): ManualDraftPayload | undefined {
    if (log.meta?.provenance?.source !== 'manual') {
        return undefined;
    }

    // Only non-empty buckets go on the wire — an empty array says nothing the server
    // does not already assume, and the draft is size-capped at the sync boundary.
    const draft: ManualDraftPayload = {};
    if (log.labour?.length) draft.labour = log.labour;
    if (log.inputs?.length) draft.inputs = log.inputs;
    if (log.irrigation?.length) draft.irrigation = log.irrigation;
    if (log.observations?.length) draft.observations = log.observations;
    if (log.plannedTasks?.length) draft.plannedTasks = log.plannedTasks;
    if (log.cropActivities?.length) draft.cropActivities = log.cropActivities;
    if (log.machinery?.length) draft.machinery = log.machinery;
    if (log.activityExpenses?.length) draft.activityExpenses = log.activityExpenses;

    // FOUNDER DECISION 8 (2026-08-16) — the farmer's own statement about the DAY, and the
    // optional chip explaining it. Both are COPIED, never inferred.
    //
    // 'WORK_RECORDED' is deliberately NOT sent: it is the LogFactory's default for any
    // ordinary day, so putting it on the wire would turn a value the farmer never uttered
    // into a stored declaration (P4). Only a genuine departure from "he worked" travels.
    //
    // These two lines sit BEFORE the length check on purpose. A declared no-work day
    // carries no buckets at all, so without them `buildManualDraft` would return undefined
    // and the declaration would never leave the device — the exact defect decision 8
    // closes.
    if (log.dayOutcome && log.dayOutcome !== 'WORK_RECORDED') draft.dayOutcome = log.dayOutcome;
    if (log.disturbance?.reason) {
        // P9 — the chip is optional. A declaration with no reason writes no `disturbance`
        // key at all, and the record still commits; `DisturbanceEvent.Create` requires a
        // non-empty reason, which is precisely why the DECLARATION does not live here.
        draft.disturbance = {
            scope: log.disturbance.scope,
            cause: log.disturbance.cause,
            reason: log.disturbance.reason,
        };
    }

    return Object.keys(draft).length > 0 ? draft : undefined;
}

async function resolveSyncTarget(log: DailyLog): Promise<ResolvedLogSyncTarget | null> {
    const selection = log.context.selection?.[0];
    const plotId = selection?.selectedPlotIds?.[0];
    if (!plotId) {
        return null;
    }

    const db = getDatabase();
    const plotRecord = await db.plots.get(plotId);
    if (!plotRecord) {
        return null;
    }

    const plotPayload = plotRecord.payload as PlotDto;
    const cropName = normalizeName(selection?.cropName);

    const cycleRecords = await db.cropCycles.where('plotId').equals(plotId).toArray();
    const candidates = cycleRecords
        .map(record => record.payload as CropCycleDto)
        .filter(candidate => normalizeName(candidate.cropName) === cropName);

    const selectedCycle = (candidates.length > 0 ? candidates : cycleRecords.map(record => record.payload as CropCycleDto))
        .sort((left, right) => {
            const leftEnd = left.endDate ? Date.parse(left.endDate) : Number.MAX_SAFE_INTEGER;
            const rightEnd = right.endDate ? Date.parse(right.endDate) : Number.MAX_SAFE_INTEGER;
            if (leftEnd !== rightEnd) {
                return rightEnd - leftEnd;
            }

            return Date.parse(right.modifiedAtUtc) - Date.parse(left.modifiedAtUtc);
        })[0];

    if (!selectedCycle) {
        return null;
    }

    return {
        farmId: plotPayload.farmId,
        plotId,
        cropCycleId: selectedCycle.id,
    };
}

export async function enqueueLogsForSync(logs: DailyLog[]): Promise<{ queuedLogIds: string[]; skippedLogIds: string[] }> {
    const queuedLogIds: string[] = [];
    const skippedLogIds: string[] = [];

    for (const log of logs) {
        const target = await resolveSyncTarget(log);
        if (!target) {
            skippedLogIds.push(log.id);
            continue;
        }

        await CreateDailyLogCommand.enqueue({
            dailyLogId: log.id,
            farmId: target.farmId,
            plotId: target.plotId,
            cropCycleId: target.cropCycleId,
            logDate: log.date,
            // AI Intelligence Plan WP-2a — thread the parse job linkage recorded on
            // the log's provenance (BackendAiClient stamps AiJob.Id there) so the
            // server can derive the typed ledger rows. Undefined for manual logs.
            sourceAiJobId: log.meta?.provenance?.sourceAiJobId,
            // task-0b — the farmer's typed day, so a manual save persists typed
            // children and can be scored. Undefined for voice confirms.
            manualDraft: buildManualDraft(log),
            // B2.8 — carry the weather already captured at confirm-time to the server
            // (persisted into ssf.weather_stamps). Omit the client-only `id` (server generates).
            weatherStamp: log.weatherStamp
                ? {
                      plotId: log.weatherStamp.plotId,
                      timestampLocal: log.weatherStamp.timestampLocal,
                      timestampProvider: log.weatherStamp.timestampProvider,
                      provider: log.weatherStamp.provider,
                      tempC: log.weatherStamp.tempC,
                      humidity: log.weatherStamp.humidity,
                      windKph: log.weatherStamp.windKph,
                      precipMm: log.weatherStamp.precipMm,
                      cloudCoverPct: log.weatherStamp.cloudCoverPct,
                      conditionText: log.weatherStamp.conditionText,
                      iconCode: log.weatherStamp.iconCode,
                      rainProbNext6h: log.weatherStamp.rainProbNext6h,
                      windGustKph: log.weatherStamp.windGustKph,
                      soilMoistureVolumetric0To10: log.weatherStamp.soilMoistureVolumetric0To10,
                      uvIndex: log.weatherStamp.uvIndex,
                      alerts: log.weatherStamp.alerts,
                  }
                : undefined,
        });

        const taskPayloads = buildTaskPayloads(log);
        for (const task of taskPayloads) {
            await AddLogTaskCommand.enqueue({
                dailyLogId: log.id,
                logTaskId: task.logTaskId,
                activityType: task.activityType,
                notes: task.notes,
                occurredAtUtc: task.occurredAtUtc,
            });
        }

        queuedLogIds.push(log.id);
    }

    if (queuedLogIds.length > 0) {
        await backgroundSyncWorker.triggerNow();
    }

    return {
        queuedLogIds,
        skippedLogIds,
    };
}
