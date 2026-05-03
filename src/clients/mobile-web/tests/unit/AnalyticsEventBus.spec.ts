// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DWC v2 §2.6 — AnalyticsEventBus + Dexie outbox unit tests.
 *
 * Coverage per ADR-2026-05-02_telemetry-batching.md:
 *   - enqueue() persists to Dexie analyticsOutbox
 *   - flush() POSTs serialized batch and bulkDeletes on 200/202
 *   - 400 → drop the entire batch immediately (validation rejection)
 *   - 5xx / network failure → bump attempts; drop after MAX_ATTEMPTS (5)
 *   - 401 → leave rows untouched (token refresh handled elsewhere)
 *
 * The HTTP layer is replaced via `vi.stubGlobal('fetch', ...)` rather
 * than msw — msw is not yet a project dependency, and the contract under
 * test is the per-status-code branch in `AnalyticsOutbox.drainBatch`,
 * which a thin stub exercises just as faithfully.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { getDatabase, resetDatabase } from '../../src/infrastructure/storage/DexieDatabase';
import { eventBus } from '../../src/core/telemetry/AnalyticsEventBus';
import { drainBatch, MAX_ATTEMPTS } from '../../src/core/telemetry/AnalyticsOutbox';

const FARM = '11111111-1111-4111-8111-111111111111';
const LOG = '22222222-2222-4222-8222-222222222222';

function makeResponse(status: number, body: unknown = {}): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

beforeEach(async () => {
    const db = getDatabase();
    await db.delete();
    await resetDatabase();
    // Restore a clean instance with the analyticsOutbox table.
    getDatabase();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('AnalyticsEventBus.enqueue', () => {
    it('persists serialized payload + createdAtUtc + attempts=0 to Dexie', async () => {
        const before = Date.now();
        await eventBus.enqueue({
            eventType: 'closure.started',
            props: { farmId: FARM, method: 'voice', ts: before },
        });

        const rows = await getDatabase().analyticsOutbox.toArray();
        expect(rows.length).toBe(1);
        expect(rows[0].attempts).toBe(0);
        expect(rows[0].createdAtUtc).toBeGreaterThanOrEqual(before);

        const parsed = JSON.parse(rows[0].payloadJson);
        expect(parsed.eventType).toBe('closure.started');
        expect(parsed.props.farmId).toBe(FARM);
    });
});

describe('AnalyticsOutbox.drainBatch — happy path', () => {
    it('on 202 deletes sent rows and reports them as deleted', async () => {
        const fetchMock = vi.fn().mockResolvedValue(makeResponse(202, { accepted: 1 }));
        vi.stubGlobal('fetch', fetchMock);

        await eventBus.enqueue({
            eventType: 'closure.started',
            props: { farmId: FARM, method: 'manual', ts: Date.now() },
        });

        const outcome = await drainBatch();
        expect(outcome.attempted).toBe(1);
        expect(outcome.deleted).toBe(1);
        expect(outcome.status).toBe(202);
        expect(fetchMock).toHaveBeenCalledTimes(1);

        const remaining = await getDatabase().analyticsOutbox.toArray();
        expect(remaining.length).toBe(0);
    });

    it('on 200 deletes sent rows', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse(200, { ok: true })));
        await eventBus.enqueue({
            eventType: 'proof.attached',
            props: { farmId: FARM, logId: LOG, type: 'photo' },
        });

        const outcome = await drainBatch();
        expect(outcome.deleted).toBe(1);
        expect(outcome.status).toBe(200);
    });

    it('POSTs the serialized payload as {events: [...]}', async () => {
        const fetchMock = vi.fn().mockResolvedValue(makeResponse(202));
        vi.stubGlobal('fetch', fetchMock);

        await eventBus.enqueue({
            eventType: 'closure.submitted',
            props: { farmId: FARM, logId: LOG, method: 'voice', durationMs: 500, fields_used: 3 },
        });
        await drainBatch();

        const [, init] = fetchMock.mock.calls[0];
        const body = JSON.parse(init.body);
        expect(body).toHaveProperty('events');
        expect(Array.isArray(body.events)).toBe(true);
        expect(body.events.length).toBe(1);
        expect(body.events[0].eventType).toBe('closure.submitted');
        expect(body.events[0].props.farmId).toBe(FARM);
        expect(body.events[0]).toHaveProperty('occurredAtUtc');
    });
});

describe('AnalyticsOutbox.drainBatch — 400 batch rejection', () => {
    it('drops the entire batch immediately on HTTP 400 (no retry)', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse(400, { error: 'invalid' })));

        await eventBus.enqueue({
            eventType: 'closure.started',
            props: { farmId: FARM, method: 'voice', ts: Date.now() },
        });
        await eventBus.enqueue({
            eventType: 'closure.started',
            props: { farmId: FARM, method: 'manual', ts: Date.now() },
        });

        const outcome = await drainBatch();
        expect(outcome.deleted).toBe(2);
        expect(outcome.status).toBe(400);

        const remaining = await getDatabase().analyticsOutbox.toArray();
        expect(remaining.length).toBe(0);
    });
});

describe('AnalyticsOutbox.drainBatch — 401 token expired', () => {
    it('leaves rows untouched on HTTP 401 (token refresh handles it)', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse(401)));

        await eventBus.enqueue({
            eventType: 'closure.started',
            props: { farmId: FARM, method: 'voice', ts: Date.now() },
        });

        const outcome = await drainBatch();
        expect(outcome.deleted).toBe(0);
        expect(outcome.retried).toBe(0);
        expect(outcome.status).toBe(401);

        const remaining = await getDatabase().analyticsOutbox.toArray();
        expect(remaining.length).toBe(1);
        expect(remaining[0].attempts).toBe(0); // not bumped
    });
});

describe('AnalyticsOutbox.drainBatch — 5xx + network retries', () => {
    it('bumps attempts and preserves rows on HTTP 503', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse(503)));

        await eventBus.enqueue({
            eventType: 'closure.started',
            props: { farmId: FARM, method: 'voice', ts: Date.now() },
        });

        const outcome = await drainBatch();
        expect(outcome.deleted).toBe(0);
        expect(outcome.retried).toBe(1);
        expect(outcome.status).toBe(503);

        const rows = await getDatabase().analyticsOutbox.toArray();
        expect(rows.length).toBe(1);
        expect(rows[0].attempts).toBe(1);
    });

    it('bumps attempts on network failure (fetch throws)', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

        await eventBus.enqueue({
            eventType: 'closure.started',
            props: { farmId: FARM, method: 'voice', ts: Date.now() },
        });

        const outcome = await drainBatch();
        expect(outcome.retried).toBe(1);
        expect(outcome.status).toBeUndefined();

        const rows = await getDatabase().analyticsOutbox.toArray();
        expect(rows[0].attempts).toBe(1);
    });

    it(`drops a row after ${MAX_ATTEMPTS} failed attempts`, async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse(503)));

        await eventBus.enqueue({
            eventType: 'closure.started',
            props: { farmId: FARM, method: 'voice', ts: Date.now() },
        });

        // Drain MAX_ATTEMPTS times. After the MAX_ATTEMPTS-th failure, the row's
        // attempts counter would reach MAX_ATTEMPTS, so the policy drops it.
        let lastOutcome;
        for (let i = 0; i < MAX_ATTEMPTS; i++) {
            lastOutcome = await drainBatch();
        }

        expect(lastOutcome!.droppedAfterMaxAttempts).toBe(1);
        const rows = await getDatabase().analyticsOutbox.toArray();
        expect(rows.length).toBe(0);
    });
});

describe('AnalyticsEventBus.flush', () => {
    it('coalesces concurrent flush calls into a single in-flight POST', async () => {
        const fetchMock = vi.fn().mockResolvedValue(makeResponse(202));
        vi.stubGlobal('fetch', fetchMock);

        await eventBus.enqueue({
            eventType: 'closure.started',
            props: { farmId: FARM, method: 'voice', ts: Date.now() },
        });

        const [a, b] = await Promise.all([eventBus.flush(), eventBus.flush()]);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        // Both callers see the same outcome because the in-flight promise is shared.
        expect(a).toEqual(b);
    });

    it('returns a no-op outcome when the outbox is empty', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        const outcome = await eventBus.flush();
        expect(outcome.attempted).toBe(0);
        expect(outcome.deleted).toBe(0);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
