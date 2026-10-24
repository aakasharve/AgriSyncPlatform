/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Task-mutation payload builders, lifted out of `logSyncMutationService.ts`.
 *
 * WHY: that file was 855 lines against an 800-line budget
 * (`npm run check:file-sizes`). PURE CODE MOVE — the three functions below are
 * byte-identical to what they were, and the service imports them back, so the
 * sync payloads it emits are unchanged.
 *
 * WHY THIS GROUP: `buildTaskPayloads` and its two private helpers form the only
 * self-contained cluster in that file — they touch no module state, call nothing
 * else in it, and answer one question (what task rows does this log imply).
 * `normalizeName` and `buildTaskNotes` exist solely to serve it, which is why
 * all three travel together rather than the entry point alone.
 */
import { idGenerator } from '../../../core/domain/services/IdGenerator';
import { type DailyLog } from '../../../types';

interface LogTaskMutationPayload {
    logTaskId: string;
    activityType: string;
    notes?: string;
    occurredAtUtc?: string;
}
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

export function ensureUuid(localId: string | undefined): string {
    if (localId && UUID_REGEX.test(localId)) {
        return localId;
    }
    return idGenerator.generate();
}


export function normalizeName(value?: string): string {
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

export function buildTaskPayloads(log: DailyLog): LogTaskMutationPayload[] {
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
