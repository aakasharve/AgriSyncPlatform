import { AddLogTaskCommand } from '../../../application/usecases/sync/AddLogTaskCommand';
import { CreateDailyLogCommand, type LabourItemPayload } from '../../../application/usecases/sync/CreateDailyLogCommand';
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

    // Labour V1 Task 8.1 — labour deliberately does NOT produce a log_task here.
    // It used to be flattened into a free-text note ("Workers: 6 • Cost: ₹3000")
    // which discarded every structured field. It now travels as structured
    // `labour[]` on the create_daily_log payload (see buildLabourPayloads), which
    // the server stages as canonical Phase-1 rows atomically with the log.

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
 * A number the wire schema will actually accept, or `undefined` so the key is
 * dropped. `Number.isFinite` rejects NaN and ±Infinity, which is not a
 * theoretical concern: `DetailSheet` writes `totalCost` and `contractQuantity`
 * with a bare `parseFloat(e.target.value)` and no fallback, and `parseFloat('')`
 * is NaN, so simply CLEARING a money field produces one.
 */
function finiteOrOmitted(value: number | undefined): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Same, for the three headcount fields, which the schema pins as
 * `z.number().int()`. The inputs are `type="number"`, so "2.5" in Male Split is
 * reachable in one keystroke.
 *
 * A fractional count is DROPPED, never rounded. Rounding would assert a
 * headcount the farmer never stated, and the server deliberately preserves
 * silence as NULL ("we were not told") rather than as a number — inventing 3
 * from 2.5 would put a fabricated count into the canonical record, which is the
 * failure this whole plan exists to remove. The log still saves either way.
 * `Number.isInteger` is already false for NaN and ±Infinity.
 */
function wholeOrOmitted(value: number | undefined): number | undefined {
    return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

/**
 * Labour V1 Task 8.1 — THE STRUCTURED LABOUR PAYLOAD.
 *
 * WHY THIS IS LOAD-BEARING, not a payload tweak: the server routes labour to
 * Phase 1 (atomic with the DailyLog) only when the confirm carries structured
 * `labour[]`. With no client producer, every confirmed labour row was written in
 * Phase 2 — the best-effort side-car, whose failure branches catch, log a
 * warning and return success. The log would commit, the labour rows would
 * vanish, and the idempotency early-return would hand back the existing log on
 * every retry. There is no backfill job in this system. Populating this array is
 * what closes that hole.
 *
 * DURATION: `durationHours` is OMITTED entirely when the farmer did not state
 * it. Absence is the client saying "not stated", and the server then records
 * LabourTime.ServerAssumed. Sending 0 — or any number nobody said — would
 * fabricate a measurement, which is the exact thing this plan removes.
 */
function buildLabourPayloads(log: DailyLog): LabourItemPayload[] {
    return (log.labour || []).map(event => {
        // SANITISED BEFORE THE OBJECT IS BUILT — this is a correctness boundary,
        // not defensive padding. `MutationQueue.enqueue` validates every payload
        // against sync-contract/schemas/payloads/create_daily_log.zod.ts and
        // THROWS on failure, and `enqueueLogsForSync` has no try/catch, so one
        // malformed number would propagate out of the save handler: the farmer
        // sees "Failed to save logs", the log sits in Dexie, and NO mutation row
        // was ever written — so there is nothing queued to retry and, on a
        // multi-plot broadcast, every later log in the batch is abandoned too.
        // The labour would then reach NEITHER Phase 1 nor Phase 2, which is
        // strictly worse than the side-car this array replaced.
        //
        // It would also invert the doctrine the server deliberately honours:
        // CreateDailyLogHandler is fail-OPEN on these fields (P9 / Constraint 7
        // — no optional field may ever reject a record). The client must not be
        // fail-closed on the very fields the server refuses to reject. The fix
        // belongs HERE, at the boundary that introduced the validation: never
        // loosen the schema, and never swallow the enqueue in a try/catch.
        const maleCount = wholeOrOmitted(event.maleCount);
        const femaleCount = wholeOrOmitted(event.femaleCount);
        const workerCount = wholeOrOmitted(event.count);
        // NO-MULTIPLY (ADR 0023): the rate is carried as stated and is never
        // multiplied out into a total. `rate` is the newer B2.4 field the parser
        // can emit; the voice path preferred it server-side, and that derivation
        // is now suppressed for any log carrying this array.
        const wagePerPerson = finiteOrOmitted(event.wagePerPerson ?? event.rate);
        const contractQuantity = finiteOrOmitted(event.contractQuantity);
        // Only an explicitly stated total — never derived from rate × count.
        const totalCost = finiteOrOmitted(event.totalCost);
        // Absent means "the farmer did not state hours"; the server then records
        // Assumed. Zero and negatives are unstated too — not an error (P9).
        const durationHours = finiteOrOmitted(event.durationHours);

        // Conditional spreads, so a value we cannot send is simply NOT SENT: the
        // key is absent rather than present-and-undefined. One uniform rule for
        // every optional number on this payload.
        return {
            // Task 7 mints this at confirm-time on the same array we read here.
            // `ensureUuid` is the last line of defence: Task 6.1 rejects a
            // missing/empty id as a malformed payload, which would 400 the WHOLE
            // log — permanently, since the farmer has no way to repair it. An
            // event with no local id has no identity to diverge from, so minting
            // one at the boundary loses nothing and saves the log. Ids that
            // already exist pass through untouched. It also satisfies the
            // schema's ZGuid, which is the same regex as UUID_REGEX above.
            labourAssignmentId: ensureUuid(event.labourAssignmentId),
            // The server maps this string tolerantly and passes `null` for the
            // legacy arg, so the legacy HIRED/CONTRACT/SELF must be folded in
            // HERE or a contract engagement would silently record as Hired.
            // The final fallback is not a guess: `engagementType` is the one
            // REQUIRED string on this payload, so a legacy Dexie record with
            // neither field would throw at the queue — and the server's total
            // map turns an unrecognised value into Hired anyway, so this
            // produces byte-identical server state to the absent case.
            engagementType: event.engagementType || event.type || 'hired_daily',
            ...(maleCount !== undefined && { maleCount }),
            ...(femaleCount !== undefined && { femaleCount }),
            ...(workerCount !== undefined && { workerCount }),
            ...(wagePerPerson !== undefined && { wagePerPerson }),
            ...(contractQuantity !== undefined && { contractQuantity }),
            ...(totalCost !== undefined && { totalCost }),
            ...(durationHours !== undefined && durationHours > 0 && { durationHours }),
            contractUnit: event.contractUnit,
            shift: event.shiftId,
            task: event.activity,
            notes: event.notes,
        };
    });
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

        const labourPayloads = buildLabourPayloads(log);

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
            // Labour V1 Task 8.1 — structured labour rides on the SAME payload as
            // the log so the server can stage it in Phase 1. Omitted (not `[]`)
            // when there is no labour, so the server's `Count: > 0` guard reads a
            // plainly absent array rather than an empty one.
            labour: labourPayloads.length > 0 ? labourPayloads : undefined,
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
