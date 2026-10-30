/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane AI-2, register F71) — the saved entry, as the parse reads it
 * when the farmer speaks a change to it ("बदला"). Pure.
 *
 * The parse answers in its own bucket shape, and the "बदला" merge (`correctionModel.mergeCorrection`, lane RF2, not
 * changed here) REPLACES each bucket the answer carries. So the model is shown the entry in that same shape, with
 * everything it may need to copy unchanged (product, method, units, tank water, cost), and nothing that is only the
 * app's own bookkeeping (ids, provenance flags, the phrase each value came from, links to other records).
 *
 * Labour is the exception, shaped for the merge's identity rule (review B001): only what tells the engagements apart
 * (type, engagement, group) and the numbers a labour correction can change. Names and wages are left out — the merge
 * refuses a labour answer that carries them, and worker changes belong in हजेरी.
 */
import type { DailyLog } from '../../../../types';

/** The buckets, in the order the parse lists them. */
const BUCKETS = ['cropActivities', 'irrigation', 'labour', 'inputs', 'machinery', 'activityExpenses', 'observations', 'plannedTasks'] as const;

/** The app's own bookkeeping: never shown to the model. */
const BOOKKEEPING = new Set([
    'id', 'plotId', 'cropId', 'dateKey', 'timestamp', 'createdAt', 'updatedAt',
    'numbers', 'provenance', 'provenanceVerified', 'sourceText', 'systemInterpretation', 'rawText',
    'linkedActivityId', 'linkedExpenseId', 'linkedExpenseItemId', 'linkedHarvestSessionId', 'costSource',
    'mixId', 'passId', 'motorId', 'operatorId', 'shiftId', 'sourceNoteId',
    'detectedCrop', 'targetPlotName', 'isCommonActivity', 'tags', 'source', 'aiConfidence',
    'status', 'resolvedAt', 'extractedTasks', 'textCleaned', 'issue', 'progress',
]);

/** What a labour row may carry into the parse: identity and the numbers a correction can change. */
const LABOUR_FIELDS = ['type', 'engagementType', 'gender', 'count', 'maleCount', 'femaleCount', 'durationHours', 'activity'] as const;

/** Above this the entry is not sent (the server has its own, larger, cap); the parse is then a normal one, as before. */
export const MAX_CORRECTION_ENTRY_CHARS = 10_000;

const isEmpty = (v: unknown): boolean =>
    v === undefined || v === null || (typeof v === 'string' && v.trim().length === 0)
    || (Array.isArray(v) && v.length === 0)
    || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0);

/** A copy without bookkeeping keys and without empty values, at any depth. */
function clean(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(clean).filter(v => !isEmpty(v));
    }
    if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
            if (BOOKKEEPING.has(key) || typeof v === 'function') continue;
            const c = clean(v);
            if (!isEmpty(c)) out[key] = c;
        }
        return out;
    }
    return value;
}

const labourRow = (row: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const key of LABOUR_FIELDS) {
        if (!isEmpty(row[key])) out[key] = row[key];
    }
    return out;
};

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
        const shaped = bucket === 'labour'
            ? rows.filter((r): r is Record<string, unknown> => !!r && typeof r === 'object').map(labourRow).filter(r => !isEmpty(r))
            : (clean(rows) as unknown[]);
        if (shaped.length > 0) parts[bucket] = shaped;
    }
    const disturbance = clean(log.disturbance);
    if (!isEmpty(disturbance)) parts.disturbance = disturbance;
    if (Object.keys(parts).length === 0) return null;
    return JSON.stringify(parts).length > MAX_CORRECTION_ENTRY_CHARS ? null : parts;
}
