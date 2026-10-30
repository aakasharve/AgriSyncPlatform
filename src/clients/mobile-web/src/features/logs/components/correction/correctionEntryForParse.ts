/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane AI-2) — the saved entry, as the parse reads it when the
 * farmer speaks a change to it ("बदला"). Pure.
 *
 * The parse answers in its own bucket shape, and the "बदला" merge (`correctionModel.mergeCorrection`, lane RF2, not
 * changed here) REPLACES each bucket the answer carries. So the model is shown the entry in that same shape, with
 * the values it may need to copy unchanged (product, method, units, tank water, cost, the work and the note words).
 *
 * Fix pass (review B006): an ALLOW-LIST per bucket — only the fields the model needs to copy reach the parse. No ids of
 * any kind (row ids, assigneeId, sourceObservationId, observation links, gradeId, weather links), no vendor or vendor
 * phone, no recommendedBy, no worker names or wages. A field not listed here never leaves the phone with a correction.
 * Labour is shaped for the merge's identity rule (review B001): what tells the engagements apart (type, engagement,
 * group) and the numbers a labour correction can change.
 */
import type { DailyLog } from '../../../../types';

type Fields = readonly string[];

/** Per bucket: exactly the fields the parse may see. */
const ALLOWED: Readonly<Record<string, Fields>> = {
    cropActivities: ['title', 'workTypes', 'quantity', 'unit', 'areaCovered', 'notes'],
    irrigation: ['method', 'source', 'durationHours', 'waterVolumeLitres', 'role', 'notes'],
    labour: ['type', 'engagementType', 'gender', 'count', 'maleCount', 'femaleCount', 'durationHours', 'activity'],
    inputs: [
        'productName', 'rawProductName', 'type', 'method', 'quantity', 'unit', 'dose', 'npkGrade', 'reason',
        'carrierMedium', 'carrierType', 'carrierCount', 'carrierCapacity', 'carrierVolume', 'carrierUnit',
        'computedWaterVolume', 'cost', 'notes', 'mix',
    ],
    machinery: ['type', 'ownership', 'hoursUsed', 'rentalCost', 'fuelCost', 'fuelType', 'fuelQuantity', 'implement', 'nozzlesActive', 'operationPerformed', 'notes'],
    activityExpenses: ['reason', 'category', 'totalAmount', 'items', 'notes'],
    observations: ['noteType', 'textRaw', 'severity'],
    plannedTasks: ['title', 'dueHint', 'category'],
};

/** Inside a list field, the same rule: the mixed products of a spray, the items of an expense. */
const ALLOWED_INSIDE: Readonly<Record<string, Fields>> = {
    mix: ['productName', 'dose', 'unit', 'npkGrade', 'basisQty', 'basisUnit'],
    items: ['name', 'qty', 'unit', 'unitPrice', 'total'],
    workTypes: [],
};

const DISTURBANCE: Fields = ['scope', 'group', 'reason', 'severity', 'blockedSegments', 'note', 'cause', 'impact'];

/** The buckets, in the order the parse lists them. */
const BUCKETS = Object.keys(ALLOWED);

/** Above this the entry is not sent (the server has its own, larger, cap); the parse is then a normal one, as before. */
export const MAX_CORRECTION_ENTRY_CHARS = 10_000;

const isEmpty = (v: unknown): boolean =>
    v === undefined || v === null || (typeof v === 'string' && v.trim().length === 0)
    || (Array.isArray(v) && v.length === 0)
    || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0);

const isPlainValue = (v: unknown): boolean => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';

/** Only the allowed fields of a row, each a plain value (or, for a listed list field, its allowed inside). */
function pick(row: unknown, fields: Fields): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (!row || typeof row !== 'object') return out;
    const source = row as Record<string, unknown>;
    for (const key of fields) {
        const value = source[key];
        if (isEmpty(value)) continue;
        if (isPlainValue(value)) { out[key] = value; continue; }
        const inside = ALLOWED_INSIDE[key];
        if (!inside || !Array.isArray(value)) continue; // an object or list nobody listed: not sent
        const list = inside.length === 0
            ? value.filter(isPlainValue)
            : value.map(item => pick(item, inside)).filter(item => !isEmpty(item));
        if (list.length > 0) out[key] = list;
    }
    return out;
}

/**
 * The entry's current parts in the parse's bucket shape, or `null` when it holds nothing a change could be about (or
 * is too large to send).
 */
export function correctionEntryForParse(log: DailyLog): Record<string, unknown> | null {
    const parts: Record<string, unknown> = {};
    const source = log as unknown as Record<string, unknown>;
    for (const bucket of BUCKETS) {
        const rows = source[bucket];
        if (!Array.isArray(rows) || rows.length === 0) continue;
        const shaped = rows.map(row => pick(row, ALLOWED[bucket])).filter(row => !isEmpty(row));
        if (shaped.length > 0) parts[bucket] = shaped;
    }
    const disturbance = log.disturbance ? pick({ ...log.disturbance, blockedSegments: undefined }, DISTURBANCE) : {};
    const blocked = (log.disturbance?.blockedSegments ?? []).filter(isPlainValue);
    if (blocked.length > 0) disturbance.blockedSegments = blocked;
    if (!isEmpty(disturbance)) parts.disturbance = disturbance;
    if (Object.keys(parts).length === 0) return null;
    return JSON.stringify(parts).length > MAX_CORRECTION_ENTRY_CHARS ? null : parts;
}
