// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT4 Task 2; founders D-92 / D-95, doctrine P7, P10) - his हो / नाही / फोटो
 * answer is queued like every other change (no internet needed), carries no "is check" (the server decides), is the same request
 * when sent again, and changes nothing of the record but its own overlay.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { VersionRegistry } from '../../../../core/contracts/VersionRegistry';
import type { DailyLog } from '../../../../domain/types/log.types';
import { getDatabase, resetDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';
import { AssertInputIdentityCommand, assertRequestId } from '../AssertInputIdentityCommand';

const FARM = 'f0f0f0f0-0000-4000-8000-0000000000f1';
const LOG = 'c3c3c3c3-0000-4000-8000-000000000003';
const ATT = '9a9a9a9a-0000-4000-8000-0000000000a1';
const A1 = '11111111-1111-4111-8111-111111111111';
const A2 = '22222222-2222-4222-8222-222222222222';

const base = { farmId: FARM, dailyLogId: LOG, inputEventId: 'ev-1', mixIndex: 0, catalogVersion: 'inputs-2' } as const;
const queued = async () => (await getDatabase().mutationQueue.toArray()).filter(r => r.mutationType === SyncMutationName.AssertInputIdentity);

beforeEach(async () => {
    await getDatabase().delete();
    await resetDatabase();
});

describe('AssertInputIdentityCommand (lane IT4)', () => {
    it('queues a हो with its product, exactly the contract fields, and no "is check"', async () => {
        const r = await AssertInputIdentityCommand.enqueue({ ...base, verdict: 'confirmed', catalogProductId: 'p-imidacloprid-17-8-sl', assertionId: A1 });
        const [row] = await queued();
        expect(row.status).toBe('PENDING');
        expect(row.clientRequestId).toBe(assertRequestId(A1));
        expect(r.clientRequestId).toBe(`assert_input_identity:${A1}`);
        expect(row.payload).toEqual({
            assertionId: A1, farmId: FARM, dailyLogId: LOG, inputEventId: 'ev-1', mixIndex: 0, verdict: 'confirmed',
            catalogProductId: 'p-imidacloprid-17-8-sl', catalogVersion: 'inputs-2',
        });
        expect(JSON.stringify(row.payload)).not.toMatch(/check/i);
    });

    it('a नाही carries no product; a फोटो carries its attachment pointer and no product', async () => {
        await AssertInputIdentityCommand.enqueue({ ...base, verdict: 'rejected', catalogProductId: 'p-ignored', assertionId: A1 });
        await AssertInputIdentityCommand.enqueue({ ...base, mixIndex: 1, verdict: 'photo', attachmentId: ATT, catalogProductId: 'p-ignored', assertionId: A2 });
        const rows = await queued();
        expect(rows[0].payload).not.toHaveProperty('catalogProductId');
        expect(rows[1].payload).toMatchObject({ verdict: 'photo', attachmentId: ATT, mixIndex: 1 });
        expect(rows[1].payload).not.toHaveProperty('catalogProductId');
    });

    it('the same answer sent again (same id) is the SAME request; a new tap is a new request, even with the same words', async () => {
        await AssertInputIdentityCommand.enqueue({ ...base, verdict: 'rejected', assertionId: A1 });
        await AssertInputIdentityCommand.enqueue({ ...base, verdict: 'rejected', assertionId: A1 });
        expect(await queued()).toHaveLength(1);
        await AssertInputIdentityCommand.enqueue({ ...base, verdict: 'confirmed', catalogProductId: 'p-x', assertionId: A2 });
        await AssertInputIdentityCommand.enqueue({ ...base, verdict: 'rejected' }); // a fresh id of its own
        expect(await queued()).toHaveLength(3);
    });

    it('a हो without a product and a फोटो without a photo are refused at the boundary', async () => {
        await expect(AssertInputIdentityCommand.enqueue({ ...base, verdict: 'confirmed' })).rejects.toThrow(/library product/);
        await expect(AssertInputIdentityCommand.enqueue({ ...base, verdict: 'photo' })).rejects.toThrow(/photo/);
        expect(await queued()).toHaveLength(0);
    });

    it('an id that is not a UUID is refused by the contract before it is queued', async () => {
        await expect(AssertInputIdentityCommand.enqueue({ ...base, dailyLogId: 'not-a-guid', verdict: 'rejected' })).rejects.toThrow(/validation/i);
        expect(await queued()).toHaveLength(0);
    });

    it('shows the answer on the record at once and changes NOTHING else of it (P7)', async () => {
        const db = getDatabase();
        const log = {
            id: LOG, date: '2026-11-09', context: { selection: [] }, dayOutcome: 'WORK_RECORDED', cropActivities: [], irrigation: [], labour: [], machinery: [],
            inputs: [{ id: 'ev-1', method: 'Spray', mix: [{ id: 'm1', productName: 'कॉन्फिडॉर', dose: 1, unit: 'ml' }] }],
        } as unknown as DailyLog;
        await db.logs.put({ id: LOG, schemaVersion: VersionRegistry.DB_SCHEMA_VERSION, log, date: log.date, isDeleted: 0, serverModifiedAtUtc: '2026-11-09T04:00:00.000Z' });
        const first = await AssertInputIdentityCommand.enqueue({ ...base, verdict: 'confirmed', catalogProductId: 'p-imidacloprid-17-8-sl', assertionId: A1 });
        // He changes his mind: his own newer pending answer for the same product replaces the older one.
        await AssertInputIdentityCommand.enqueue({ ...base, verdict: 'rejected', assertionId: A2 });
        const after = (await db.logs.get(LOG))!;
        const { inputIdentities, ...rest } = after.log;
        expect(rest).toEqual(log);
        expect(after.serverModifiedAtUtc).toBe('2026-11-09T04:00:00.000Z');
        expect(inputIdentities).toHaveLength(1);
        expect(inputIdentities?.[0]).toMatchObject({ assertionId: A2, verdict: 'rejected', pending: true, isCheck: false });
        expect(first.answer.pending).toBe(true);
    });

    it('TwoAnswersAtOnce_BothReachTheRecord (lane IT4 fix 1, F6: one transaction, no lost update)', async () => {
        const db = getDatabase();
        const log = {
            id: LOG, date: '2026-11-09', context: { selection: [] }, dayOutcome: 'WORK_RECORDED', cropActivities: [], irrigation: [], labour: [], machinery: [],
            inputs: [{ id: 'ev-1', method: 'Spray', mix: [{ id: 'm1', productName: 'a' }, { id: 'm2', productName: 'b' }, { id: 'm3', productName: 'c' }] }],
        } as unknown as DailyLog;
        await db.logs.put({ id: LOG, schemaVersion: VersionRegistry.DB_SCHEMA_VERSION, log, date: log.date, isDeleted: 0 });
        await Promise.all([0, 1, 2].map(i => AssertInputIdentityCommand.enqueue({ ...base, mixIndex: i, verdict: 'rejected' })));
        expect((await db.logs.get(LOG))!.log.inputIdentities?.map(a => a.mixIndex).sort()).toEqual([0, 1, 2]);
    });

    it('TellsTheApp_ToReadAgain: the answer\'s write fires agrisync:sync-reconciled, after it is on the record (lane IT4 fix 1, F1)', async () => {
        const db = getDatabase();
        const log = { id: LOG, date: '2026-11-09', context: { selection: [] }, dayOutcome: 'WORK_RECORDED', cropActivities: [], irrigation: [], labour: [], machinery: [], inputs: [] } as unknown as DailyLog;
        await db.logs.put({ id: LOG, schemaVersion: VersionRegistry.DB_SCHEMA_VERSION, log, date: log.date, isDeleted: 0 });
        let seen: number | undefined;
        const onEvent = () => { void db.logs.get(LOG).then(r => { seen = r?.log.inputIdentities?.length; }); };
        window.addEventListener('agrisync:sync-reconciled', onEvent);
        try {
            await AssertInputIdentityCommand.enqueue({ ...base, verdict: 'rejected' });
            await new Promise(r => setTimeout(r, 20));
        } finally { window.removeEventListener('agrisync:sync-reconciled', onEvent); }
        expect(seen).toBe(1);
    });

    it('an answer about a record this phone does not hold is still queued (the server answers it on its merits)', async () => {
        await AssertInputIdentityCommand.enqueue({ ...base, verdict: 'rejected', assertionId: A1 });
        expect(await queued()).toHaveLength(1);
        expect(await getDatabase().logs.get(LOG)).toBeUndefined();
    });
});
