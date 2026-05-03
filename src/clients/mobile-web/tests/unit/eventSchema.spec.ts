/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DWC v2 §2.5 — Zod schema unit tests for the 8 client-emitted vocabulary
 * entries. Each test covers:
 *   - happy path (valid payload)
 *   - missing-required-field rejection
 *   - enum-unknown rejection (where the schema has an enum field)
 *
 * The full vocabulary parity (these 8 + the 5 server-only events) is
 * checked at CI time by `scripts/check-event-vocabulary-parity.mjs` per
 * Plan §2.7, not here.
 */

import { describe, it, expect } from 'vitest';
import { EventSchemas } from '../../src/core/telemetry/eventSchema';

// Valid v4 UUIDs (4 in 13th hex slot, 8/9/a/b in 17th — required by Zod's
// strict UUID validator).
const FARM = '11111111-1111-4111-8111-111111111111';
const LOG = '22222222-2222-4222-8222-222222222222';
const TASK = '33333333-3333-4333-8333-333333333333';
const VERIFIER = '44444444-4444-4444-8444-444444444444';

describe('EventSchemas — registry shape', () => {
    it('exposes exactly the 8 client-emitted vocabulary entries', () => {
        expect(Object.keys(EventSchemas).sort()).toEqual([
            'client.error',
            'closure.abandoned',
            'closure.started',
            'closure.submitted',
            'closure.verified',
            'closure_summary.viewed',
            'next_action.created',
            'proof.attached',
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
