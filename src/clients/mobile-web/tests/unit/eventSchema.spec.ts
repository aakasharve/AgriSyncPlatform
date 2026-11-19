/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DWC v2 §2.5 — Zod schema unit tests for the 9 client-emitted vocabulary
 * entries. Each test covers:
 *   - happy path (valid payload)
 *   - missing-required-field rejection
 *   - enum-unknown rejection (where the schema has an enum field)
 *
 * The ninth entry is `sync.push_outcome` (ADR 0027 D2; spec
 * control-room-go-live-must-haves-2026-11-10, plan CR-1a Task C2): the app's
 * own report of what happened to work that had failed. Its emit helper is
 * tested at the end of this file, against a stand-in for the event bus.
 *
 * The full vocabulary parity (these 9 + the server-only events) is
 * checked at CI time by `.github/scripts/check-event-vocabulary-parity.mjs`
 * per Plan §2.7, not here.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The event bus writes to the phone's database. Only the last block of this
// file (the emit helper) reaches it, and that block needs to see what was
// handed to the bus, not to store it. The schema tests above it never touch
// the bus, so this stand-in changes nothing for them.
const { enqueueMock } = vi.hoisted(() => ({ enqueueMock: vi.fn() }));
vi.mock('../../src/core/telemetry/AnalyticsEventBus', () => ({
    eventBus: { enqueue: enqueueMock },
}));

import { EventSchemas } from '../../src/core/telemetry/eventSchema';
import * as emitters from '../../src/core/telemetry/eventEmitters';

// Valid v4 UUIDs (4 in 13th hex slot, 8/9/a/b in 17th — required by Zod's
// strict UUID validator).
const FARM = '11111111-1111-4111-8111-111111111111';
const LOG = '22222222-2222-4222-8222-222222222222';
const TASK = '33333333-3333-4333-8333-333333333333';
const VERIFIER = '44444444-4444-4444-8444-444444444444';

describe('EventSchemas — registry shape', () => {
    // Was 'exposes exactly the 8 client-emitted vocabulary entries'. The same
    // pin, moved by name on 2026-11-14: ADR 0027 D6 moves the client registry
    // from 8 to 9 with `sync.push_outcome`.
    it('exposes exactly the 9 client-emitted vocabulary entries', () => {
        expect(Object.keys(EventSchemas).sort()).toEqual([
            'client.error',
            'closure.abandoned',
            'closure.started',
            'closure.submitted',
            'closure.verified',
            'closure_summary.viewed',
            'next_action.created',
            'proof.attached',
            'sync.push_outcome',
        ]);
    });
});

describe('closure.started', () => {
    const schema = EventSchemas['closure.started'];

    it('accepts a valid payload', () => {
        const r = schema.safeParse({ farmId: FARM, method: 'voice', ts: Date.now() });
        expect(r.success).toBe(true);
    });

    it('rejects missing farmId', () => {
        const r = schema.safeParse({ method: 'voice', ts: 1 });
        expect(r.success).toBe(false);
    });

    it('rejects unknown method enum', () => {
        const r = schema.safeParse({ farmId: FARM, method: 'telepathy', ts: 1 });
        expect(r.success).toBe(false);
    });
});

describe('closure.submitted', () => {
    const schema = EventSchemas['closure.submitted'];

    it('accepts a valid payload', () => {
        const r = schema.safeParse({
            farmId: FARM,
            logId: LOG,
            method: 'manual',
            durationMs: 12_500,
            fields_used: 4,
        });
        expect(r.success).toBe(true);
    });

    it('rejects negative durationMs', () => {
        const r = schema.safeParse({
            farmId: FARM,
            logId: LOG,
            method: 'manual',
            durationMs: -1,
            fields_used: 4,
        });
        expect(r.success).toBe(false);
    });

    it('rejects unknown method enum', () => {
        const r = schema.safeParse({
            farmId: FARM,
            logId: LOG,
            method: 'gesture',
            durationMs: 100,
            fields_used: 1,
        });
        expect(r.success).toBe(false);
    });
});

describe('closure.abandoned', () => {
    const schema = EventSchemas['closure.abandoned'];

    it('accepts a valid payload', () => {
        const r = schema.safeParse({
            farmId: FARM,
            method: 'wizard',
            durationMs: 4500,
            lastStep: 'workers',
        });
        expect(r.success).toBe(true);
    });

    it('rejects missing lastStep', () => {
        const r = schema.safeParse({
            farmId: FARM,
            method: 'wizard',
            durationMs: 4500,
        });
        expect(r.success).toBe(false);
    });
});

describe('proof.attached', () => {
    const schema = EventSchemas['proof.attached'];

    it('accepts a valid payload with optional sizeBytes', () => {
        const r = schema.safeParse({
            farmId: FARM,
            logId: LOG,
            type: 'photo',
            sizeBytes: 102_400,
        });
        expect(r.success).toBe(true);
    });

    it('accepts a valid payload without sizeBytes (optional)', () => {
        const r = schema.safeParse({ farmId: FARM, logId: LOG, type: 'voice' });
        expect(r.success).toBe(true);
    });

    it('rejects unknown proof type enum', () => {
        const r = schema.safeParse({ farmId: FARM, logId: LOG, type: 'video' });
        expect(r.success).toBe(false);
    });
});

describe('closure_summary.viewed', () => {
    const schema = EventSchemas['closure_summary.viewed'];

    it('accepts a valid payload', () => {
        const r = schema.safeParse({
            farmId: FARM,
            dateKey: '2026-05-03',
            logsCount: 3,
            source: 'reflect_mount',
        });
        expect(r.success).toBe(true);
    });

    it('rejects unknown source enum', () => {
        const r = schema.safeParse({
            farmId: FARM,
            dateKey: '2026-05-03',
            logsCount: 3,
            source: 'sidebar',
        });
        expect(r.success).toBe(false);
    });

    it('rejects negative logsCount', () => {
        const r = schema.safeParse({
            farmId: FARM,
            dateKey: '2026-05-03',
            logsCount: -1,
            source: 'drawer_open',
        });
        expect(r.success).toBe(false);
    });
});

describe('closure.verified', () => {
    const schema = EventSchemas['closure.verified'];

    it('accepts a valid payload', () => {
        const r = schema.safeParse({
            farmId: FARM,
            logId: LOG,
            verifierId: VERIFIER,
            status: 'Confirmed',
        });
        expect(r.success).toBe(true);
    });

    it('rejects unknown verify status enum', () => {
        const r = schema.safeParse({
            farmId: FARM,
            logId: LOG,
            verifierId: VERIFIER,
            status: 'Approved',
        });
        expect(r.success).toBe(false);
    });

    it('rejects non-uuid verifierId', () => {
        const r = schema.safeParse({
            farmId: FARM,
            logId: LOG,
            verifierId: 'not-a-uuid',
            status: 'Verified',
        });
        expect(r.success).toBe(false);
    });
});

describe('next_action.created', () => {
    const schema = EventSchemas['next_action.created'];

    it('accepts a valid payload with parentLogId', () => {
        const r = schema.safeParse({
            farmId: FARM,
            taskId: TASK,
            parentLogId: LOG,
        });
        expect(r.success).toBe(true);
    });

    it('accepts a valid payload without parentLogId (optional)', () => {
        const r = schema.safeParse({ farmId: FARM, taskId: TASK });
        expect(r.success).toBe(true);
    });

    it('rejects missing taskId', () => {
        const r = schema.safeParse({ farmId: FARM });
        expect(r.success).toBe(false);
    });
});

describe('client.error', () => {
    const schema = EventSchemas['client.error'];

    it('accepts a valid payload with all optionals', () => {
        const r = schema.safeParse({
            farmId: FARM,
            message: 'TypeError: x is undefined',
            stack: 'at Foo.bar',
        });
        expect(r.success).toBe(true);
    });

    it('accepts a valid payload without farmId (pre-auth pipeline failure)', () => {
        const r = schema.safeParse({ message: 'boot failed' });
        expect(r.success).toBe(true);
    });

    it('rejects missing message', () => {
        const r = schema.safeParse({ farmId: FARM });
        expect(r.success).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// sync.push_outcome — ADR 0027 D2, plan CR-1a Task C2.
//
// The app's report, at most once per sync cycle, of what happened to work
// that had failed: how many saves that had failed have now arrived, how many
// were sent to the farmer to review, how many are still waiting, and the
// app's version. It carries nothing else: no farmer text, no phone number,
// no device id (D7).
// ---------------------------------------------------------------------------

const FULL_OUTCOME = {
    recoveredCount: 2,
    needsReviewCount: 1,
    pendingAfter: 0,
    appVersion: '1.0.18',
    firstFailedAtUtc: '2026-11-14T06:30:00.000Z',
};

const COUNTS = ['recoveredCount', 'needsReviewCount', 'pendingAfter'] as const;

function without<K extends keyof typeof FULL_OUTCOME>(key: K): Record<string, unknown> {
    const copy: Record<string, unknown> = { ...FULL_OUTCOME };
    delete copy[key];
    return copy;
}

describe('sync.push_outcome', () => {
    function outcomeSchema() {
        const schema = EventSchemas['sync.push_outcome'];
        expect(schema, '`sync.push_outcome` is missing from EventSchemas').toBeDefined();
        return schema;
    }

    it('accepts a full outcome', () => {
        const schema = outcomeSchema();

        const full = schema.safeParse(FULL_OUTCOME);
        expect(full.success).toBe(true);
        expect(full.success && full.data).toEqual(FULL_OUTCOME);

        // A report of saves sent for review only has no recovered save, so
        // it has no first-failure time: that key is optional.
        expect(schema.safeParse(without('firstFailedAtUtc')).success).toBe(true);

        // Zero is a count, not a missing value.
        const zeros = schema.safeParse({
            recoveredCount: 0,
            needsReviewCount: 1,
            pendingAfter: 0,
            appVersion: '1.0.18',
        });
        expect(zeros.success).toBe(true);
    });

    it('rejects a negative count', () => {
        const schema = outcomeSchema();

        for (const count of COUNTS) {
            const r = schema.safeParse({ ...FULL_OUTCOME, [count]: -1 });
            expect(r.success, `${count}: -1 must be rejected`).toBe(false);
        }
    });

    it('rejects an outcome with a count missing', () => {
        const schema = outcomeSchema();

        for (const count of COUNTS) {
            const r = schema.safeParse(without(count));
            expect(r.success, `an outcome with no ${count} must be rejected`).toBe(false);
        }
    });

    it('rejects an outcome with no app version', () => {
        const schema = outcomeSchema();

        // The report row carries a person, not a phone: the version is what
        // tells a 1.0.18 report from anything else, so it is never optional.
        expect(schema.safeParse(without('appVersion')).success).toBe(false);
        expect(schema.safeParse({ ...FULL_OUTCOME, appVersion: '' }).success).toBe(false);
    });

    it('rejects a count that is not a whole number', () => {
        const schema = outcomeSchema();

        for (const count of COUNTS) {
            expect(schema.safeParse({ ...FULL_OUTCOME, [count]: 1.5 }).success, `${count}: 1.5`).toBe(false);
            expect(schema.safeParse({ ...FULL_OUTCOME, [count]: '1' }).success, `${count}: "1"`).toBe(false);
        }
    });

    it('rejects a first-failure time that is not a timestamp', () => {
        const schema = outcomeSchema();

        expect(schema.safeParse({ ...FULL_OUTCOME, firstFailedAtUtc: 'yesterday' }).success).toBe(false);
        expect(schema.safeParse({ ...FULL_OUTCOME, firstFailedAtUtc: 1731565800000 }).success).toBe(false);
    });
});

describe('emitSyncPushOutcome', () => {
    beforeEach(() => {
        enqueueMock.mockReset();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    function emitter() {
        expect(
            typeof emitters.emitSyncPushOutcome,
            'eventEmitters must export emitSyncPushOutcome',
        ).toBe('function');
        return emitters.emitSyncPushOutcome;
    }

    it('puts a full outcome on the event bus as sync.push_outcome', () => {
        const emitSyncPushOutcome = emitter();

        emitSyncPushOutcome(FULL_OUTCOME);

        expect(enqueueMock).toHaveBeenCalledTimes(1);
        expect(enqueueMock).toHaveBeenCalledWith({
            eventType: 'sync.push_outcome',
            props: FULL_OUTCOME,
        });
    });

    it('drops an outcome the schema rejects, and never throws into the caller', () => {
        const emitSyncPushOutcome = emitter();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        // The caller is the sync worker. A bad report must cost a log line,
        // never a sync cycle, and it must not reach the server half-formed.
        expect(() => emitSyncPushOutcome({ ...FULL_OUTCOME, recoveredCount: -1 })).not.toThrow();
        expect(() => emitSyncPushOutcome(without('appVersion') as never)).not.toThrow();

        expect(enqueueMock).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalled();
    });

    it('sends the three counts, the app version and the first-failure time, and nothing else', () => {
        const emitSyncPushOutcome = emitter();
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);

        // analytics.events is append-only: a key that reaches it can never
        // be removed. Whatever a caller hands over by mistake, only the five
        // keys of ADR 0027 D2 may leave the phone.
        emitSyncPushOutcome({
            ...FULL_OUTCOME,
            deviceId: 'a-device-id',
            farmId: FARM,
            lastError: 'text from a queue row',
        } as never);

        const allowed = ['appVersion', 'firstFailedAtUtc', 'needsReviewCount', 'pendingAfter', 'recoveredCount'];
        for (const [item] of enqueueMock.mock.calls) {
            const sent = item as { eventType: string; props: Record<string, unknown> };
            expect(sent.eventType).toBe('sync.push_outcome');
            for (const key of Object.keys(sent.props)) {
                expect(allowed, `the key '${key}' must not be sent`).toContain(key);
            }
        }
    });
});
