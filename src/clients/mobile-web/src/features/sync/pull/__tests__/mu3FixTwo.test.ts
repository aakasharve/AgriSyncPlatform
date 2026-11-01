// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * lane MU-3 fix pass 2 — the phone's half of the re-review's N1-N5:
 *   N1  the job-card and worker-page reads say which version this phone is (1.0.17 sent none), so only a phone that
 *       shows a withheld pay as withheld is sent one;
 *   N2  a copy the purge trims says so (`amountsWithheld`), and the edit made on it says so too;
 *   N3  a job card's payout id goes with its pay;
 *   N4  D-67 — the words of a record that mentions money stay only with see WAGES;
 *   N5  the pull names the farms this phone holds even when it holds none (`farms=`).
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import type { AgriLogDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import type { FarmAccessScopeDto } from '../../../../infrastructure/api/dtos';
import type { SyncPullResponse } from '../../../../infrastructure/api/AgriSyncClient';
import type { HttpTransport } from '../../../../infrastructure/api/transport';
import { pullSyncChanges } from '../../../../infrastructure/api/resources/SyncResource';
import { reconcileAccessScopes } from '../reconcilers/accessScopeReconciler';
import { updateLog } from '../../../../application/usecases/UpdateLog';
import { DexieLogsRepository } from '../../../../infrastructure/storage/DexieLogsRepository';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';
import { APP_VERSION } from '../../../../buildInfo';
import type { DailyLog, FarmerProfile } from '../../../../types';

vi.mock('../../../../infrastructure/storage/AuthTokenStore', () => ({
    getAuthSession: () => ({ accessToken: 'test-token', userId: ME }),
}));

const ME = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const FARM_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const LOG = 'f2f2f2f2-0000-4000-8000-0000000000d1';
const AT = '2026-11-01T06:00:00.000Z';

const scope = (over: Partial<FarmAccessScopeDto> = {}): FarmAccessScopeDto => ({
    farmId: FARM_A, ownRecordsOnly: false, seeMoney: true, seeWages: true, seeAttendance: true, seeTests: true,
    seeCompliance: true, seeFarmOverview: true, ...over,
});

/** The owner's priced record as a phone held it from BEFORE MU-3: whole, with his words that state a worker's pay. */
const heldCopy = (): DailyLog => ({
    id: LOG, date: '2026-10-30', context: { selection: [] }, dayOutcome: null,
    fullTranscript: 'आज छाटणी केली, रवीला ५०० रु. दिले',
    cropActivities: [{ id: 'c1', title: 'छाटणी', sourceText: 'छाटणी केली' }],
    irrigation: [], machinery: [], activityExpenses: [],
    labour: [{ id: 'crew', type: 'HIRED', count: 4, wagePerPerson: 500, totalCost: 2000 }],
    inputs: [{ id: 'in-1', productName: 'युरिया', cost: 777, quantity: 2 }],
    contentVersion: 1,
    meta: { createdAtISO: AT, createdByOperatorId: OWNER, farmId: FARM_A },
} as unknown as DailyLog);

const run = (db: AgriLogDatabase, s: FarmAccessScopeDto) =>
    reconcileAccessScopes(db, { accessScopes: [s] } as unknown as SyncPullResponse, {
        userId: ME, pendingLogIds: new Set(), receivedAtUtc: AT,
    });

const put = (db: AgriLogDatabase, log: DailyLog) => db.logs.put({
    id: log.id, schemaVersion: 2, log, date: log.date, createdByOperatorId: OWNER, isDeleted: 0, serverModifiedAtUtc: AT,
});

let db: AgriLogDatabase;
beforeEach(async () => {
    db = getDatabase();
    await db.open();
    await Promise.all(db.tables.map(t => t.clear()));
});

describe('MU-3 fix 2 — the phone', () => {
    it('N1: the job-card and worker-page reads say which version this phone is', async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) });
        vi.stubGlobal('fetch', fetchMock);
        try {
            const client = await import('../../../work/data/jobCardsClient');
            await client.getFarmJobCards(FARM_A);
            await client.getWorkerJobCards(OWNER, FARM_A);
            await client.getWorkerProfile(OWNER, FARM_A);
            for (const [, init] of fetchMock.mock.calls) {
                expect((init as { headers: Record<string, string> }).headers['X-App-Version']).toBe(APP_VERSION);
            }
            expect(fetchMock).toHaveBeenCalledTimes(3);
            // The worker page's list names its farm, so the server reads it under that farm's scope.
            expect(String(fetchMock.mock.calls[1][0])).toContain(`/workers/${OWNER}/job-cards?farmId=${FARM_A}`);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('N2: a copy the purge trims says so — money or wages — and one it leaves whole does not', async () => {
        await put(db, heldCopy());
        await run(db, scope({ seeMoney: false, seeWages: false }));
        expect((await db.logs.get(LOG))!.log.amountsWithheld).toBe(true);

        await db.logs.clear();
        await put(db, heldCopy());
        await run(db, scope({ seeWages: false }));
        expect((await db.logs.get(LOG))!.log.amountsWithheld).toBe(true);

        await db.logs.clear();
        await put(db, heldCopy());
        await run(db, scope());
        expect((await db.logs.get(LOG))!.log.amountsWithheld).toBeUndefined();
    });

    it('N2/N4: an edit of a trimmed copy says it came without its amounts and without its words', async () => {
        await put(db, heldCopy());
        await run(db, scope({ seeMoney: false, seeWages: false }));
        const repo = DexieLogsRepository.getInstance();
        const profile = { activeOperatorId: ME, operators: [], trust: {} } as unknown as FarmerProfile;

        const result = await updateLog({
            logId: LOG,
            updatedData: { inputs: [{ id: 'in-1', productName: 'युरिया', quantity: 3 }] } as Partial<DailyLog>,
            actorId: ME,
            reason: 'दुरुस्ती',
        }, repo, profile);

        expect(result.success).toBe(true);
        const rows = await db.mutationQueue.where('mutationType').equals(SyncMutationName.ReviseLogContent).toArray();
        expect(rows).toHaveLength(1);
        const payload = rows[0].payload as { amountsWithheld?: boolean; wordsWithheld?: boolean };
        expect(payload.amountsWithheld).toBe(true);
        expect(payload.wordsWithheld).toBe(true);
    });

    it('N4: with see money but not see wages, a record whose words state a worker\'s pay keeps its amounts and loses its words', async () => {
        await put(db, heldCopy());
        await run(db, scope({ seeWages: false }));
        const kept = (await db.logs.get(LOG))!.log;
        expect(kept.wordsWithheldForMoney).toBe(true);
        expect(kept.fullTranscript).toBeUndefined();
        expect(kept.cropActivities[0]).toEqual({ id: 'c1', title: 'छाटणी' });
        expect(kept.inputs[0].cost).toBe(777);
        expect(kept.labour[0].totalCost).toBe(2000);
        expect(kept.labour[0].wagePerPerson).toBeUndefined();

        await db.logs.clear();
        await put(db, heldCopy());
        await run(db, scope());
        expect((await db.logs.get(LOG))!.log.fullTranscript).toBe('आज छाटणी केली, रवीला ५०० रु. दिले');
    });

    it('N3: a job card\'s payout id goes with its pay; his own card keeps it', async () => {
        const card = (id: string, worker: string) => ({
            id, farmId: FARM_A, plotId: 'p', createdByUserId: OWNER, assignedWorkerUserId: worker, plannedDate: '2026-10-30',
            status: 'PaidOut', estimatedTotalAmount: 6129, estimatedTotalCurrency: 'INR', payoutCostEntryId: `pay-${id}`,
            createdAtUtc: AT, modifiedAtUtc: AT,
            lineItems: [{ activityType: 'spray', expectedHours: 4, ratePerHourAmount: 1532, ratePerHourCurrencyCode: 'INR', notes: '₹1532 तासाला' }],
        });
        await db.jobCards.bulkPut([card('other', OWNER), card('mine', ME)] as never);

        await run(db, scope({ seeWages: false }));
        const other = (await db.jobCards.get('other'))! as unknown as Record<string, unknown>;
        expect(other.payoutCostEntryId).toBeUndefined();
        expect(other.estimatedTotalAmount).toBeNull();
        expect((other.lineItems as Array<Record<string, unknown>>)[0].notes).toBeUndefined();
        expect((await db.jobCards.get('mine'))!.payoutCostEntryId).toBe('pay-mine');
    });

    it('N5: the pull names the farms this phone holds even when it holds none; a caller that says nothing sends nothing', async () => {
        const get = vi.fn().mockResolvedValue({ data: {} });
        const t = { http: { get } } as unknown as HttpTransport;
        await pullSyncChanges(t, '2026-11-01T06:00:00.123Z', []);
        expect(get).toHaveBeenLastCalledWith('/sync/pull', { params: { since: '2026-11-01T06:00:00Z', farms: '' } });
        await pullSyncChanges(t, '2026-11-01T06:00:00.123Z');
        expect(get).toHaveBeenLastCalledWith('/sync/pull', { params: { since: '2026-11-01T06:00:00Z' } });
    });
});
