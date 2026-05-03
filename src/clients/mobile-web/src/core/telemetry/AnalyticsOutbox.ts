/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Daily Work Closure (DWC v2) — Dexie-backed outbox for analytics events.
 * Implements the all-or-nothing batch policy described in
 * `ADR-2026-05-02_telemetry-batching.md`:
 *
 *   - 200/202 (success or accepted) → bulkDelete the sent rows.
 *   - 400 (validation rejection)    → bulkDelete the rows; the backend has
 *                                     already declared the payload invalid,
 *                                     no point retrying.
 *   - 401 (token expired)           → leave rows; the request infra refreshes
 *                                     the token and a future flush retries.
 *   - 5xx / network failure         → bump `attempts`; drop rows whose
 *                                     attempts cross MAX_ATTEMPTS (5).
 *
 * Backoff in this v1 is per-row attempt count (capped); finer per-row
 * exponential timing lives in the bus's flush scheduler, not here.
 *
 * @module core/telemetry/AnalyticsOutbox
 */

import { getDatabase, type AnalyticsOutboxRow } from '../../infrastructure/storage/DexieDatabase';
import { getAuthSession } from '../../infrastructure/storage/AuthTokenStore';
import { resolveApiBaseUrl } from '../../infrastructure/api/transport';

/** Maximum events shipped in one POST batch. */
export const MAX_BATCH = 50;

/** Maximum retry attempts before dropping a row. */
export const MAX_ATTEMPTS = 5;

/**
 * Outcome of one drain cycle. Useful for tests and for the bus's logging.
 */
export interface DrainOutcome {
    /** Number of rows attempted in this cycle. */
    attempted: number;
    /** Number of rows deleted from the outbox after the cycle. */
    deleted: number;
    /** Number of rows whose attempts counter was bumped. */
    retried: number;
    /** Number of rows dropped because they crossed MAX_ATTEMPTS. */
    droppedAfterMaxAttempts: number;
    /** HTTP status, when one was received; absent on network errors. */
    status?: number;
}

interface IngestPayloadEntry {
    eventType: string;
    props: Record<string, unknown>;
    occurredAtUtc: string;
}

function toIngestPayload(rows: AnalyticsOutboxRow[]): IngestPayloadEntry[] {
    return rows.map((row) => {
        const parsed = JSON.parse(row.payloadJson) as { eventType: string; props: Record<string, unknown> };
        return {
            eventType: parsed.eventType,
            props: parsed.props,
            occurredAtUtc: new Date(row.createdAtUtc).toISOString(),
        };
    });
}

/**
 * Drain at most `maxBatch` rows (oldest first by `createdAtUtc`) from the
 * `analyticsOutbox` table and POST them to `/analytics/ingest`. See module
 * doc for the all-or-nothing policy.
 */
export async function drainBatch(maxBatch: number = MAX_BATCH): Promise<DrainOutcome> {
    const db = getDatabase();
    const rows = await db.analyticsOutbox.orderBy('createdAtUtc').limit(maxBatch).toArray();

    if (rows.length === 0) {
        return { attempted: 0, deleted: 0, retried: 0, droppedAfterMaxAttempts: 0 };
    }

    const ids = rows.map((r) => r.id!).filter((id): id is number => typeof id === 'number');
    const session = getAuthSession();
    const baseUrl = resolveApiBaseUrl();
    const url = `${baseUrl}/analytics/ingest`;

    let response: Response | null = null;
    try {
        response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(session ? { Authorization: `Bearer ${session.accessToken}` } : {}),
            },
            body: JSON.stringify({ events: toIngestPayload(rows) }),
        });
    } catch {
        // Network failure — fall through to the retry path.
        response = null;
    }

    // Success — drop sent rows.
    if (response && (response.status === 200 || response.status === 202)) {
        await db.analyticsOutbox.bulkDelete(ids);
        return {
            attempted: rows.length,
            deleted: rows.length,
            retried: 0,
            droppedAfterMaxAttempts: 0,
            status: response.status,
        };
    }

    // Validation rejection — drop the entire batch (ADR: no point retrying).
    if (response && response.status === 400) {
        await db.analyticsOutbox.bulkDelete(ids);
        return {
            attempted: rows.length,
            deleted: rows.length,
            retried: 0,
            droppedAfterMaxAttempts: 0,
            status: 400,
        };
    }

    // 401 — token expired; leave the rows untouched. The request infra (axios
    // interceptor on AgriSyncClient) refreshes the token; the next flush picks
    // these rows back up. No attempt bump.
    if (response && response.status === 401) {
        return {
            attempted: rows.length,
            deleted: 0,
            retried: 0,
            droppedAfterMaxAttempts: 0,
            status: 401,
        };
    }

    // 5xx or network error — bump attempts, drop rows past MAX_ATTEMPTS.
    let droppedAfterMaxAttempts = 0;
    let retried = 0;
    const toDrop: number[] = [];
    const toBump: AnalyticsOutboxRow[] = [];
    for (const row of rows) {
        const nextAttempts = row.attempts + 1;
        if (nextAttempts >= MAX_ATTEMPTS) {
            toDrop.push(row.id!);
            droppedAfterMaxAttempts += 1;
        } else {
            toBump.push({ ...row, attempts: nextAttempts });
            retried += 1;
        }
    }

    if (toDrop.length > 0) {
        await db.analyticsOutbox.bulkDelete(toDrop);
    }
    if (toBump.length > 0) {
        await db.analyticsOutbox.bulkPut(toBump);
    }

    return {
        attempted: rows.length,
        deleted: toDrop.length,
        retried,
        droppedAfterMaxAttempts,
        status: response?.status,
    };
}
