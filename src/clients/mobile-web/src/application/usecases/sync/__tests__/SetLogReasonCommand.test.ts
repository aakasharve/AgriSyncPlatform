// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane CMP-D3; founder D-68 round 2; doctrine P4, P10) - a reason kept on an item of a saved
 * record ("का केलं") is queued like every other change (no internet needed), is the same request when sent again, carries exactly the contract's
 * fields (no author, no time, no quantity), and touches nothing else: no record, no table other than the outbox.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDatabase, resetDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';
import { LOG_REASON_KINDS, LOG_REASON_MAX_WORDS, SetLogReasonCommand, logReasonRequestId } from '../SetLogReasonCommand';

const FARM = 'f0f0f0f0-0000-4000-8000-0000000000f1';
const LOG = 'c3c3c3c3-0000-4000-8000-000000000003';
const R1 = '11111111-1111-4111-8111-111111111111';
const R2 = '22222222-2222-4222-8222-222222222222';
const KEY = 'work:op_tying';

const base = { farmId: FARM, dailyLogId: LOG, workKey: KEY } as const;
const queued = async () => (await getDatabase().mutationQueue.toArray()).filter(r => r.mutationType === SyncMutationName.LogreasonSet);

beforeEach(async () => {
    await getDatabase().delete();
    await resetDatabase();
});

describe('SetLogReasonCommand (lane CMP-D3)', () => {
    it('is the contract mutation logreason.set', () => {
        expect(SyncMutationName.LogreasonSet).toMatch(/^logreason[.]set$/);
        expect([...LOG_REASON_KINDS]).toEqual(['Practice', 'Extra', 'Weather']);
    });

    it('queues a reason with exactly the contract fields, the queue key from its own id, and no author or time', async () => {
        const r = await SetLogReasonCommand.enqueue({ ...base, kind: 'Weather', words: '  पाऊस आला म्हणून  ', saidByVoice: true, reasonId: R1 });
        const [row] = await queued();
        expect(row.status).toBe('PENDING');
        expect(row.clientRequestId).toBe(logReasonRequestId(R1));
        expect(r.clientRequestId).toBe(`logreason.set:${R1}`);
        expect(r.reasonId).toBe(R1);
        expect(row.payload).toEqual({
            reasonId: R1, farmId: FARM, dailyLogId: LOG, workKey: KEY, kind: 'Weather', words: 'पाऊस आला म्हणून', saidByVoice: true,
        });
        expect(JSON.stringify(row.payload)).not.toMatch(/author|userId|createdAt|quantity|amount/i);
        expect(row.farmId).toBe(FARM);
    });

    it('a picture alone carries no words and is never "said by voice"', async () => {
        await SetLogReasonCommand.enqueue({ ...base, kind: 'Practice', reasonId: R1 });
        await SetLogReasonCommand.enqueue({ ...base, kind: 'Extra', words: '   ', saidByVoice: true, reasonId: R2 });
        const rows = await queued();
        expect(rows).toHaveLength(2);
        for (const row of rows) {
            expect(row.payload).not.toHaveProperty('words');
            expect((row.payload as { saidByVoice: boolean }).saidByVoice).toBe(false);
        }
    });

    it('the same reason sent again (same id) is the SAME request; a new reason is a new request, even with the same words', async () => {
        await SetLogReasonCommand.enqueue({ ...base, kind: 'Weather', words: 'पाऊस', reasonId: R1 });
        await SetLogReasonCommand.enqueue({ ...base, kind: 'Weather', words: 'पाऊस', reasonId: R1 });
        expect(await queued()).toHaveLength(1);
        await SetLogReasonCommand.enqueue({ ...base, kind: 'Weather', words: 'पाऊस', reasonId: R2 });
        await SetLogReasonCommand.enqueue({ ...base, kind: 'Weather', words: 'पाऊस' }); // a fresh id of its own
        expect(await queued()).toHaveLength(3);
    });

    it('words over 1000 characters are refused before they are queued, and exactly 1000 go', async () => {
        await expect(SetLogReasonCommand.enqueue({ ...base, kind: 'Extra', words: 'क'.repeat(LOG_REASON_MAX_WORDS + 1) })).rejects.toThrow(/at most 1000/);
        expect(await queued()).toHaveLength(0);
        await SetLogReasonCommand.enqueue({ ...base, kind: 'Extra', words: 'क'.repeat(LOG_REASON_MAX_WORDS) });
        expect(await queued()).toHaveLength(1);
    });

    it('a kind outside the three, an id that is not a UUID and a missing key are refused by the contract before they are queued', async () => {
        await expect(SetLogReasonCommand.enqueue({ ...base, kind: 'Other' as never })).rejects.toThrow(/Payload validation failed/);
        await expect(SetLogReasonCommand.enqueue({ ...base, kind: 'Practice', reasonId: 'ram' })).rejects.toThrow(/Payload validation failed/);
        await expect(SetLogReasonCommand.enqueue({ ...base, dailyLogId: 'not-a-guid', kind: 'Practice' })).rejects.toThrow(/Payload validation failed/);
        await expect(SetLogReasonCommand.enqueue({ ...base, workKey: '', kind: 'Practice' })).rejects.toThrow(/Payload validation failed/);
        expect(await queued()).toHaveLength(0);
    });

    it('writes nothing but the outbox: no log, no content, no other table', async () => {
        const db = getDatabase();
        const before = await Promise.all(db.tables.filter(t => t.name !== 'mutationQueue').map(async t => [t.name, await t.count()] as const));
        await SetLogReasonCommand.enqueue({ ...base, kind: 'Weather', words: 'पाऊस', reasonId: R1 });
        const after = await Promise.all(db.tables.filter(t => t.name !== 'mutationQueue').map(async t => [t.name, await t.count()] as const));
        expect(after).toEqual(before);
    });
});
