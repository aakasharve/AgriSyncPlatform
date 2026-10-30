// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane RF2 fix pass, review B002) — a PULLED हजेरी-door record
 * still says it came from the हजेरी door.
 *
 * The हजेरी door saves labour only (B002) and lane F1's `revise_log_content` refuses a details edit of such a record.
 * The phone kept that fact only on its own write, so after any pull it would queue a "बदला" the server then refused
 * (REJECTED_USER_REVIEW, a ⚠ on the phone). The server now sends `captureScope`; the reconciler keeps it — on a record
 * this phone never held (a second phone, a reinstall), and across a pull of one it did.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { DailyLog } from '../../../../../types';
import type { DailyLogDto, SyncPullResponse } from '../../../../../infrastructure/api/dtos';
import { getDatabase, resetDatabase, type AgriLogDatabase } from '../../../../../infrastructure/storage/DexieDatabase';
import { isLabourDoorLog } from '../../../../logs/components/correction/correctionModel';
import { reconcileLogs } from '../logsReconciler';
import type { PlotLookupEntry } from '../profileAndCropsReconciler';

const PLOT_ID = 'plot-1';
const plotLookup = new Map<string, PlotLookupEntry>([[PLOT_ID, { cropId: 'crop-1', cropName: 'Grapes', plotName: 'North Field' }]]);

const dto = (over: Partial<DailyLogDto> = {}): DailyLogDto => ({
    id: 'log-hajeri',
    farmId: 'farm-1',
    plotId: PLOT_ID,
    cropCycleId: 'cycle-1',
    operatorUserId: 'owner-1',
    logDate: '2026-10-30',
    createdAtUtc: '2026-10-30T04:00:00.000Z',
    modifiedAtUtc: '2026-10-30T04:00:00.000Z',
    lastVerificationStatus: 'Draft',
    tasks: [],
    verificationEvents: [],
    ...over,
});

const pull = (...dailyLogs: DailyLogDto[]): SyncPullResponse => ({
    serverTimeUtc: '2026-10-30T06:00:00.000Z',
    nextCursorUtc: '2026-10-30T06:00:00.000Z',
    farms: [], plots: [], cropCycles: [], dailyLogs, attachments: [], costEntries: [], financeCorrections: [],
    dayLedgers: [], priceConfigs: [], plannedActivities: [], auditEvents: [],
});

async function pullAndRead(db: AgriLogDatabase, d: DailyLogDto): Promise<DailyLog> {
    await reconcileLogs(db, pull(d), plotLookup, new Set<string>());
    return (await db.logs.get(d.id))!.log;
}

describe('review B002 — the हजेरी door survives a pull', () => {
    let db: AgriLogDatabase;
    beforeEach(async () => {
        await getDatabase().delete();
        await resetDatabase();
        db = getDatabase();
    });

    it('a PULLED हजेरी record this phone never held (no local flag) is known as one, so "बदला" refuses it before queueing', async () => {
        const log = await pullAndRead(db, dto({ captureScope: 'labour' }));
        expect(log.captureScope).toBe('labour');
        expect(isLabourDoorLog(log)).toBe(true);
    });

    it('any other record carries no mark (null on the wire is no door)', async () => {
        const log = await pullAndRead(db, dto({ id: 'log-voice', captureScope: null }));
        expect(log.captureScope).toBeUndefined();
        expect(isLabourDoorLog(log)).toBe(false);
    });

    it('an older server that says nothing keeps what this phone already knew', async () => {
        const first = await pullAndRead(db, dto({ captureScope: 'labour' }));
        expect(first.captureScope).toBe('labour');
        const again = await pullAndRead(db, dto({ modifiedAtUtc: '2026-10-30T05:00:00.000Z' }));
        expect(again.captureScope).toBe('labour');
    });
});
