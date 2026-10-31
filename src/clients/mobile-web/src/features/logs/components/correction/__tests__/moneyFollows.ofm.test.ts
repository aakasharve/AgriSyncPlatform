// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF-M) —
 *   - R4-1: a move refused because a line's money was not found NAMES that money (`[money:<id>]` in the refusal's own
 *     message, the existing refusal shape). The words, and the wait, look at that money row only — never at another line's
 *     row, which once sent him to the sync page when the real cause was money saved the old way.
 *   - F89: when an edit's money could not follow, he is told why in plain words, in his language only.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDatabase, resetDatabase } from '../../../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../../../infrastructure/sync/SyncMutationCatalog';
import { missingMoneyIdsIn, resolveMoneyDependency } from '../../../../../infrastructure/sync/MutationDependency';
import { readRefusedChange } from '../refusedRevision';
import { moneyNotFollowedLines } from '../moneyNotFollowed';
import { moneyEntryIdFor } from '../../../../finance/moneyEntryIdentity';

const LOG = 'log-ofm-1';
const inputMoney = moneyEntryIdFor(`${LOG}:input:in-1`);
const expenseMoney = moneyEntryIdFor(`${LOG}:activity-expense:exp-1`);
const NOT_FOUND = 'ShramSafal.LogMoveMoneyNotFound.Conflict';
const message = (...ids: string[]) =>
    `This entry's money was saved the old way or has not arrived yet, so it cannot be moved. Nothing was changed. [money:${ids.join(',')}]`;

const putLocalRecord = () => getDatabase().logs.put({
    id: LOG, schemaVersion: 1, date: '2026-10-30',
    log: {
        id: LOG, date: '2026-10-30', labour: [], machinery: [],
        inputs: [{ id: 'in-1', productName: 'इथरेल', cost: 500 }],
        activityExpenses: [{ id: 'exp-1', category: 'Transport', totalAmount: 200 }],
    },
} as never);

const refusedMove = (lastError: string) => getDatabase().mutationQueue.add({
    deviceId: 'd', clientRequestId: 'move-1', clientCommandId: 'move-1', mutationType: SyncMutationName.MoveDailyLog,
    payload: { dailyLogId: LOG }, status: 'REJECTED_USER_REVIEW', createdAt: '2026-10-31T10:00:00.000Z', updatedAt: 'T',
    retryCount: 1, errorCode: NOT_FOUND, lastError,
} as never);

const moneyRow = (id: string, status: string) => getDatabase().mutationQueue.add({
    deviceId: 'd', clientRequestId: `${SyncMutationName.AddCostEntry}:${id}`, clientCommandId: `${SyncMutationName.AddCostEntry}:${id}`,
    mutationType: SyncMutationName.AddCostEntry, payload: { costEntryId: id }, status, createdAt: '2026-10-31T09:00:00.000Z',
    updatedAt: 'T', retryCount: 0,
} as never);

beforeEach(async () => {
    try { await getDatabase().delete(); } catch { /* first run */ }
    await resetDatabase();
    await putLocalRecord();
});

describe('OF-M R4-1 — the refusal names the money it could not find', () => {
    it('reads the named money ids, and none from a message that names none', () => {
        expect(missingMoneyIdsIn(message(inputMoney, expenseMoney))).toEqual([inputMoney, expenseMoney]);
        expect(missingMoneyIdsIn('refused')).toEqual([]);
        expect(missingMoneyIdsIn(undefined)).toEqual([]);
    });

    it('the input\'s money was saved the old way while the expense\'s row waits for review: the words are about the input', async () => {
        await refusedMove(message(inputMoney));
        await moneyRow(expenseMoney, 'REJECTED_USER_REVIEW');
        expect(await readRefusedChange(LOG)).toMatchObject({ kind: 'move', reason: 'moneyNotFound' });
    });

    it('when the named money is the row waiting for review, he is sent to the sync page', async () => {
        await refusedMove(message(expenseMoney));
        await moneyRow(expenseMoney, 'REJECTED_USER_REVIEW');
        expect(await readRefusedChange(LOG)).toMatchObject({ reason: 'moneyNeedsReview' });
    });

    it('a refusal that names no money (an older server) still reads every row of the record, as before', async () => {
        await refusedMove('refused');
        await moneyRow(expenseMoney, 'REJECTED_USER_REVIEW');
        expect(await readRefusedChange(LOG)).toMatchObject({ reason: 'moneyNeedsReview' });
    });

    it('the move waits only while the NAMED money is still on its way from this phone', async () => {
        await moneyRow(inputMoney, 'PENDING');
        const payload = { dailyLogId: LOG };
        expect((await resolveMoneyDependency('d', SyncMutationName.MoveDailyLog, payload, [expenseMoney])).disposition)
            .toBe('NOT_A_DEPENDENCY');
        expect((await resolveMoneyDependency('d', SyncMutationName.MoveDailyLog, payload, [inputMoney])).disposition)
            .toBe('PARENT_IN_PROGRESS');
        expect((await resolveMoneyDependency('d', SyncMutationName.MoveDailyLog, payload)).disposition)
            .toBe('PARENT_IN_PROGRESS');
    });
});

describe('OF-M F89 — money that could not follow an edit, said plainly in his language only', () => {
    const reasons = ['notFound', 'shared', 'jobCard', 'detailsNotHeld', 'notAllowed', 'idTaken'] as const;

    it('one plain line per reason, never repeated, in Marathi or English only', () => {
        for (const reason of reasons) {
            const mr = moneyNotFollowedLines([reason, reason], 'mr');
            const en = moneyNotFollowedLines([reason], 'en');
            expect(mr).toHaveLength(1);
            expect(en).toHaveLength(1);
            expect(mr[0]).not.toMatch(/[A-Za-z]/);
            expect(en[0]).not.toMatch(/[ऀ-ॿ]/);
            expect(en[0]).not.toMatch(/\b(AI|draft|policy|permission|grant|role|claim|access)\b/i);
            expect(mr[0]).not.toMatch(/मसुदा|परवानगी|भूमिका|धोरण|प्रवेश/);
        }
        expect(new Set(reasons.map(r => moneyNotFollowedLines([r], 'en')[0])).size).toBe(reasons.length);
        expect(moneyNotFollowedLines([], 'mr')).toEqual([]);
    });

    it('says what did not change and why', () => {
        expect(moneyNotFollowedLines(['notFound'], 'en')[0]).toContain('saved the old way');
        expect(moneyNotFollowedLines(['notFound'], 'mr')[0]).toContain('जुन्या पद्धतीने');
        expect(moneyNotFollowedLines(['shared'], 'en')[0]).toContain('shared out across plots');
        expect(moneyNotFollowedLines(['jobCard'], 'mr')[0]).toContain('काम कार्ड');
        expect(moneyNotFollowedLines(['detailsNotHeld'], 'en')[0]).toContain('older version of the app');
        for (const line of [...moneyNotFollowedLines([...reasons], 'en'), ...moneyNotFollowedLines([...reasons], 'mr')]) {
            expect(line.length).toBeGreaterThan(20);
        }
        expect(moneyNotFollowedLines(['shared'], 'en')[0]).toMatch(/not changed/);
    });
});
