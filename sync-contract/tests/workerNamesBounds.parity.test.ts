// spec: 2026-08-25-prod-cutover-waves — WORKER-NAME BOUNDS PARITY GATE.
//
// The same two numbers live in two languages:
//   - the server refuses a create_daily_log whose labour[].workerNames exceed
//     LabourAssignmentFactory.MaxWorkerNamesPerEngagement / .MaxWorkerNameLength
//     (PushSyncBatchHandler.ValidateLabourWorkerNames, CreateDailyLogValidator);
//   - the client's MutationQueue.enqueue refuses — by THROWING — a payload this
//     zod schema rejects, and the client clamps to WORKER_NAMES_MAX_PER_ENGAGEMENT
//     / WORKER_NAME_MAX_LENGTH before it enqueues.
//
// If the zod side is the stricter one, an accepted dictation throws on the phone
// and the farmer loses his whole day. If the server side is the stricter one, a
// payload the phone happily queued is refused on every retry, forever. Either
// drift costs a record, so the two are compared here, from the repo.
//
// MEASURED, NOT COPIED. The zod side is measured by asking the schema itself
// (safeParse at N and N+1), not by reading the exported constant — a constant
// the schema forgot to use would otherwise pass. The C# side is read from the
// source text and its match count is asserted, so a renamed constant fails
// loudly instead of silently comparing nothing.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
    CreateDailyLogPayload,
    WORKER_NAME_MAX_LENGTH,
    WORKER_NAMES_MAX_PER_ENGAGEMENT,
} from '../schemas/payloads/create_daily_log.zod';

const here = dirname(fileURLToPath(import.meta.url));
const FACTORY_PATH = resolve(
    here,
    '../..',
    'src/apps/ShramSafal/ShramSafal.Application/UseCases/Labour/LabourAssignmentFactory.cs',
);

const factorySource = readFileSync(FACTORY_PATH, 'utf8');

function csharpConst(name: string): number {
    const matches = [...factorySource.matchAll(new RegExp(`public\\s+const\\s+int\\s+${name}\\s*=\\s*(\\d+)\\s*;`, 'g'))];
    expect(matches, `expected exactly one 'public const int ${name}' in ${FACTORY_PATH}`).toHaveLength(1);
    return Number(matches[0][1]);
}

const CS_MAX_NAMES = csharpConst('MaxWorkerNamesPerEngagement');
const CS_MAX_LENGTH = csharpConst('MaxWorkerNameLength');

const payloadWith = (workerNames: string[]) => ({
    dailyLogId: '11111111-1111-1111-1111-111111111111',
    farmId: '22222222-2222-2222-2222-222222222222',
    plotId: '33333333-3333-3333-3333-333333333333',
    cropCycleId: '44444444-4444-4444-4444-444444444444',
    logDate: '2026-10-17',
    labour: [{
        labourAssignmentId: '55555555-5555-5555-5555-555555555555',
        engagementType: 'hired_daily',
        workerNames,
    }],
});

const accepts = (workerNames: string[]) => CreateDailyLogPayload.safeParse(payloadWith(workerNames)).success;

describe('worker-name bounds — zod schema vs LabourAssignmentFactory', () => {
    it('reads both C# constants as positive numbers', () => {
        expect(CS_MAX_NAMES).toBeGreaterThan(0);
        expect(CS_MAX_LENGTH).toBeGreaterThan(0);
    });

    it('the schema accepts exactly MaxWorkerNamesPerEngagement names and refuses one more', () => {
        const names = (n: number) => Array.from({ length: n }, (_, i) => `n${i}`);
        expect(accepts(names(CS_MAX_NAMES))).toBe(true);
        expect(accepts(names(CS_MAX_NAMES + 1))).toBe(false);
    });

    it('the schema accepts a name of exactly MaxWorkerNameLength and refuses one longer', () => {
        // Devanagari is one UTF-16 code unit per letter — the unit zod .max() and
        // C# string.Length both count.
        expect(accepts(['अ'.repeat(CS_MAX_LENGTH)])).toBe(true);
        expect(accepts(['अ'.repeat(CS_MAX_LENGTH + 1)])).toBe(false);
    });

    it('the constants the client clamps to are the server constants', () => {
        expect({ names: WORKER_NAMES_MAX_PER_ENGAGEMENT, length: WORKER_NAME_MAX_LENGTH })
            .toEqual({ names: CS_MAX_NAMES, length: CS_MAX_LENGTH });
    });
});
