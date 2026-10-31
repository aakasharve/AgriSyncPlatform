// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF-S; founder TAP-1, D-61 = 5A) — "प्लॉट बदला" / "दिवस बदला"
 * on a SAVED entry, with no internet: the move is QUEUED (the real queue over fake-indexeddb, the real contract check
 * at enqueue) and written on this phone through the one edit path; it shows on the entry at once and reaches the
 * server on the next sync. A day that has not come yet is refused before anything is written; pressing again after a
 * failed step queues the SAME move, never a second one.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDatabase, resetDatabase } from '../../../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../../../infrastructure/sync/SyncMutationCatalog';
import { readPendingLogIds } from '../../../../sync/pull/internal/pendingMutations';
import { FutureDayRefused } from '../../../../../core/domain/services/farmDay';
import type { CropProfile, DailyLog, FarmerProfile, LogScope } from '../../../../../types';
import { canMoveSavedEntry, canQueueLabourCountOffline, contextForPlace, queueSavedEntryMove, type SavedEntryMoveDeps } from '../correctionCapabilities';
import { readRefusedChange } from '../refusedRevision';
import { CorrectLabourAssignmentCommand } from '../../../../../application/usecases/sync/CorrectLabourAssignmentCommand';
import { mutationQueue } from '../../../../../infrastructure/sync/MutationQueue';
import { moneyEntryIdFor } from '../../../../finance/moneyEntryIdentity';

vi.mock('../../../../../core/domain/services/DateKeyService', async (orig) => ({
    ...(await orig<typeof import('../../../../../core/domain/services/DateKeyService')>()),
    getDateKey: () => '2026-10-31',
}));

const LOG = '0f5e2000-0000-4000-8000-0000000000a1';
const G1 = '0f5e2000-0000-4000-8000-0000000000b1';
const S1 = '0f5e2000-0000-4000-8000-0000000000b2';
const CROPS = [
    { id: 'grape', name: 'Grapes', plots: [{ id: G1, name: 'सोनाका' }] },
    { id: 'cane', name: 'Sugarcane', plots: [{ id: S1, name: 'खालचा' }] },
] as unknown as CropProfile[];
const PROFILE = { activeOperatorId: 'me' } as unknown as FarmerProfile;
const ENTRY = {
    id: LOG, date: '2026-10-25', contentVersion: 3,
    context: { selection: [{ cropId: 'grape', cropName: 'Grapes', selectedPlotIds: [G1], selectedPlotNames: ['सोनाका'] }] },
} as unknown as DailyLog;
const scope = (plots: string[], crops: string[] = []): LogScope => ({ selectedPlotIds: plots, selectedCropIds: crops, mode: plots.length > 1 ? 'multi' : 'single', applyPolicy: 'broadcast' });

/** The edit path as a stand-in that keeps what it was asked to write (the real one is `UpdateLog`). */
const deps = (failOnce = false) => {
    const written: Partial<DailyLog>[] = [];
    let history: DailyLog[] = [ENTRY];
    let fail = failOnce;
    const d: SavedEntryMoveDeps = {
        crops: CROPS,
        profile: PROFILE,
        updateLog: async (_id, updates) => {
            if (fail) { fail = false; return { success: false, error: 'disk full' }; }
            written.push(updates);
            return { success: true, log: { ...ENTRY, ...updates } as DailyLog };
        },
        setHistory: update => { history = update(history); },
    };
    return { d, written, history: () => history };
};

const moves = async () => (await getDatabase().mutationQueue.toArray()).filter(r => r.mutationType === SyncMutationName.MoveDailyLog);

beforeEach(async () => {
    try { await getDatabase().delete(); } catch { /* first run */ }
    await resetDatabase();
});

describe('lane OF-S — moving a saved entry, offline', () => {
    it('both switches are on', () => {
        expect(canMoveSavedEntry()).toBe(true);
        expect(canQueueLabourCountOffline()).toBe(true);
    });

    it('another plot: queued with the version he saw, written on this phone one version on, held from the pull', async () => {
        const { d, written, history } = deps();
        const moved = await queueSavedEntryMove(ENTRY, { scope: scope([S1], ['cane']) }, d);

        const [row] = await moves();
        expect(row.status).toBe('PENDING');
        expect(row.payload).toMatchObject({ dailyLogId: LOG, baseVersion: 3, newPlotIds: [S1] });
        expect(row.payload).not.toHaveProperty('newLogDate');
        expect(written[0]).toEqual({
            context: { selection: [{ cropId: 'cane', cropName: 'Sugarcane', selectedPlotIds: [S1], selectedPlotNames: ['खालचा'] }] },
            contentVersion: 4,
        });
        expect(moved.context.selection[0].selectedPlotIds).toEqual([S1]);
        expect(history()[0].context.selection[0].selectedPlotNames).toEqual(['खालचा']); // shows on the entry at once
        expect(await readPendingLogIds(getDatabase())).toContain(LOG);
    });

    it('another day, and the whole farm: what the server is told, and what this phone shows', async () => {
        const { d, written } = deps();
        await queueSavedEntryMove(ENTRY, { dateKey: '2026-10-24', scope: scope([], ['FARM_GLOBAL']) }, d);
        const [row] = await moves();
        expect(row.payload).toMatchObject({ dailyLogId: LOG, baseVersion: 3, wholeFarm: true, newLogDate: '2026-10-24' });
        expect(row.payload).not.toHaveProperty('newPlotIds');
        expect(written[0]).toMatchObject({ date: '2026-10-24', contentVersion: 4 });
        expect(written[0].context?.selection[0]).toMatchObject({ cropId: 'FARM_GLOBAL', selectedPlotIds: [] });
    });

    it('several plots go as several plots', async () => {
        const { d } = deps();
        await queueSavedEntryMove(ENTRY, { scope: scope([G1, S1], ['grape', 'cane']) }, d);
        expect((await moves())[0].payload).toMatchObject({ newPlotIds: [G1, S1] });
        expect(contextForPlace(scope([G1, S1]), CROPS)?.selection.map(s => s.cropId)).toEqual(['grape', 'cane']);
    });

    it('a day that has not come yet is refused before anything is queued or written', async () => {
        const { d, written } = deps();
        await expect(queueSavedEntryMove(ENTRY, { dateKey: '2026-11-01' }, d)).rejects.toBeInstanceOf(FutureDayRefused);
        expect(await moves()).toHaveLength(0);
        expect(written).toHaveLength(0);
    });

    it('a plot this phone does not know is refused (never written with a place it cannot name)', async () => {
        const { d } = deps();
        await expect(queueSavedEntryMove(ENTRY, { scope: scope(['not-here']) }, d)).rejects.toThrow(/not on this phone/);
        expect(await moves()).toHaveLength(0);
    });

    it('pressing again after the phone write failed queues the SAME move once, then writes it', async () => {
        const { d, written } = deps(true);
        await expect(queueSavedEntryMove(ENTRY, { dateKey: '2026-10-24' }, d)).rejects.toThrow(/not written on this phone/);
        await queueSavedEntryMove(ENTRY, { dateKey: '2026-10-24' }, d);
        expect(await moves()).toHaveLength(1);
        expect(written).toHaveLength(1);
    });

    it('the place and day it already has: nothing is queued', async () => {
        const { d } = deps();
        await queueSavedEntryMove(ENTRY, { dateKey: '2026-10-25' }, d);
        expect(await moves()).toHaveLength(0);
    });
});


describe('lane OF-S fix 1 — a refused change can be made again (B001), a same-place pick changes nothing (B006)', () => {
    const refuse = async (mutationType: string) => {
        const row = (await getDatabase().mutationQueue.toArray()).find(r => r.mutationType === mutationType)!;
        await getDatabase().mutationQueue.update(row.id!, { status: 'REJECTED_USER_REVIEW', errorCode: 'ShramSafal.LogMoveAttendance.Conflict', lastError: 'refused' });
    };

    it('the same move made again AFTER a refusal is queued again — never shown moved with nothing on its way', async () => {
        const { d } = deps();
        await queueSavedEntryMove(ENTRY, { dateKey: '2026-10-24' }, d);
        await refuse(SyncMutationName.MoveDailyLog);
        expect(await readRefusedChange(LOG)).toMatchObject({ kind: 'move', reason: 'attendance' });

        // He clears the हजेरी ruling, the server's version comes back (version 3 again), and he makes the same move.
        await queueSavedEntryMove(ENTRY, { dateKey: '2026-10-24' }, d);

        const waiting = (await moves()).filter(r => r.status === 'PENDING');
        expect(waiting).toHaveLength(1);
        expect(waiting[0].retryCount).toBe(0);
        expect(waiting[0].errorCode).toBeUndefined();
        expect(await readPendingLogIds(getDatabase())).toContain(LOG); // on its way, so it holds the entry again
        expect(await readRefusedChange(LOG)).toBeNull(); // the old refusal is not shown over the new attempt
    });

    it('pressing save twice while it waits still queues it once', async () => {
        const { d } = deps();
        await queueSavedEntryMove(ENTRY, { dateKey: '2026-10-24' }, d);
        await queueSavedEntryMove(ENTRY, { dateKey: '2026-10-24' }, d);
        expect(await moves()).toHaveLength(1);
    });

    it('a worker-count change made again after a refusal is queued again', async () => {
        const correction = {
            labourAssignmentId: '0f5e2000-0000-4000-8000-0000000000c1', dailyLogId: LOG, farmId: '0f5e2000-0000-4000-8000-0000000000c2',
            quantity: { workerCount: 6 }, seen: { workerCount: 8 }, correctedAtUtc: '2026-10-31T10:00:00.000Z',
        };
        await CorrectLabourAssignmentCommand.enqueue(correction, 3);
        await refuse(SyncMutationName.CorrectLabourAssignment);
        await CorrectLabourAssignmentCommand.enqueue(correction, 3);
        const rows = (await getDatabase().mutationQueue.toArray()).filter(r => r.mutationType === SyncMutationName.CorrectLabourAssignment);
        expect(rows.filter(r => r.status === 'PENDING')).toHaveLength(1);
    });

    it('nothing queued, nothing changed: when the queue refuses the move, the entry is not moved on the phone', async () => {
        const { d, written } = deps();
        const spy = vi.spyOn(mutationQueue, 'enqueue').mockRejectedValueOnce(new Error('queue full'));
        await expect(queueSavedEntryMove(ENTRY, { dateKey: '2026-10-24' }, d)).rejects.toThrow('queue full');
        expect(written).toHaveLength(0);
        spy.mockRestore();
    });

    it('choosing the plot it already has queues nothing and bumps nothing (B006)', async () => {
        const { d, written } = deps();
        const same = await queueSavedEntryMove(ENTRY, { scope: scope([G1], ['grape']) }, d);
        expect(await moves()).toHaveLength(0);
        expect(written).toHaveLength(0);
        expect(same.contentVersion).toBe(3);
        // the same day with the same plot: still nothing
        await queueSavedEntryMove(ENTRY, { scope: scope([G1], ['grape']), dateKey: '2026-10-25' }, d);
        expect(await moves()).toHaveLength(0);
        // the same plot and a NEW day: only the day travels
        await queueSavedEntryMove(ENTRY, { scope: scope([G1], ['grape']), dateKey: '2026-10-24' }, d);
        const [row] = await moves();
        expect(row.payload).toMatchObject({ newLogDate: '2026-10-24' });
        expect(row.payload).not.toHaveProperty('newPlotIds');
        expect(written[0]).not.toHaveProperty('context');
    });
});

describe('lane OF-S fix pass 4 — the server alone decides which money moves: the phone names none and claims nothing', () => {
    const ASSIGNMENT = '0f5e2000-0000-4000-8000-0000000000d1';
    const CREW_LINE = 'crew-line-1';
    // Made on THIS phone (it holds the details). The tractor's ₹300 was priced by a LATER edit: no money was ever made for it.
    const PRICED = {
        ...ENTRY,
        meta: { appVersion: '1.0.18' },
        labour: [{ id: CREW_LINE, labourAssignmentId: ASSIGNMENT, type: 'HIRED', count: 8, totalCost: 2800 }],
        inputs: [{ id: 'in-1', productName: 'इथरेल', cost: 500 }],
        machinery: [{ id: 'm-1', type: 'tractor', rentalCost: 300 }],
        activityExpenses: [{ id: 'exp-1', category: 'Transport', totalAmount: 200 }],
    } as unknown as DailyLog;
    const row = (id: string, amount: number) => ({
        id, farmId: 'farm-1', updatedAt: 'T',
        payload: { id, farmId: 'farm-1', plotId: G1, cropCycleId: 'cycle-g1', amount, entryDate: '2026-10-25', categoryId: 'other' },
    });
    const payloadOf = async (id: string) => (await getDatabase().costEntries.get(id))?.payload as Record<string, unknown>;

    it('a line priced by a later edit is never named: the move carries no money lines and no "whole list" claim (R3-1, R3-4)', async () => {
        await getDatabase().costEntries.bulkPut([row(moneyEntryIdFor(`${LOG}:input:in-1`), 500)]);
        const { d } = deps();
        await queueSavedEntryMove(PRICED, { scope: scope([S1], ['cane']) }, d);
        const [move] = await moves();
        expect(move.payload).not.toHaveProperty('moneyLines');
        expect(move.payload).not.toHaveProperty('moneyLinesComplete');
    });

    it('money saved under the OLD key and money of withheld details: nothing on this phone moves when the move is queued', async () => {
        // The crew's money as a build before fix 1 keyed it (its local line id), and an expense the server never saw.
        const oldKeyLabour = moneyEntryIdFor(`${LOG}:labour:${CREW_LINE}`);
        const keptExpense = moneyEntryIdFor(`${LOG}:activity-expense:exp-1`);
        const inputMoney = moneyEntryIdFor(`${LOG}:input:in-1`);
        await getDatabase().costEntries.bulkPut([row(oldKeyLabour, 2800), row(keptExpense, 200), row(inputMoney, 500)]);
        const { d } = deps();

        await queueSavedEntryMove(PRICED, { scope: scope([S1], ['cane']), dateKey: '2026-10-24' }, d);

        for (const id of [oldKeyLabour, keptExpense, inputMoney]) {
            expect(await payloadOf(id)).toMatchObject({ plotId: G1, cropCycleId: 'cycle-g1', entryDate: '2026-10-25' });
        }
    });
});
