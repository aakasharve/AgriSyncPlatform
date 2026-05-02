import { AddLogTaskCommand } from '../../../application/usecases/sync/AddLogTaskCommand';
import { CreateDailyLogCommand } from '../../../application/usecases/sync/CreateDailyLogCommand';
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
