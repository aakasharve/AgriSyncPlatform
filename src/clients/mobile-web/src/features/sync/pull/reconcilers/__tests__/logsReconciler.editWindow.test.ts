// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (Part 03 B5) — the talk's 24-hour change window reaches the phone from the
 * SERVER (`DailyLogDto.editableUntilUtc`, ISO UTC) and is stored on the local log exactly as sent; the phone never computes it (P10).
 * Absent on the wire = no window (the record is not a talk), and a later copy without it does not inherit an older one.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { DailyLog } from '../../../../../types';
import type { DailyLogDto, SyncPullResponse } from '../../../../../infrastructure/api/dtos';
import { getDatabase, resetDatabase, type AgriLogDatabase } from '../../../../../infrastructure/storage/DexieDatabase';
import { editableUntilOf, talkWindowFor } from '../../../../logs/components/voiceFlowV2/editWindow';
import { reconcileLogs } from '../logsReconciler';
import type { PlotLookupEntry } from '../profileAndCropsReconciler';

const PLOT_ID = 'plot-1';
const SPEAKER = 'worker-1';
const plotLookup = new Map<string, PlotLookupEntry>([[PLOT_ID, { cropId: 'crop-1', cropName: 'Grapes', plotName: 'North Field' }]]);
const UNTIL = '2026-11-29T09:23:17.510221Z';

const dto = (over: Partial<DailyLogDto> = {}): DailyLogDto => ({
    id: 'log-talk', farmId: 'farm-1', plotId: PLOT_ID, cropCycleId: 'cycle-1', operatorUserId: SPEAKER, logDate: '2026-11-28',
    createdAtUtc: '2026-11-28T09:23:17.510221Z', modifiedAtUtc: '2026-11-28T09:23:17.510221Z',
    lastVerificationStatus: 'Draft', tasks: [], verificationEvents: [],
    ...over,
});
const pull = (...dailyLogs: DailyLogDto[]): SyncPullResponse => ({
    serverTimeUtc: '2026-11-28T10:00:00.000Z', nextCursorUtc: '2026-11-28T10:00:00.000Z',
    farms: [], plots: [], cropCycles: [], dailyLogs, attachments: [], costEntries: [], financeCorrections: [],
    dayLedgers: [], priceConfigs: [], plannedActivities: [], auditEvents: [],
});
async function pullAndRead(db: AgriLogDatabase, d: DailyLogDto): Promise<DailyLog> {
    await reconcileLogs(db, pull(d), plotLookup, new Set<string>());
    return (await db.logs.get(d.id))!.log;
}

describe('Part 03 B5 — editableUntilUtc from the pull', () => {
    let db: AgriLogDatabase;
    beforeEach(async () => { await getDatabase().delete(); await resetDatabase(); db = getDatabase(); });

    it('a voice talk: stored on the local log exactly as the server sent it, and read by the window accessors', async () => {
        const log = await pullAndRead(db, dto({ editableUntilUtc: UNTIL }));
        expect(log.editableUntilUtc).toBe(UNTIL);
        expect(log.meta?.createdByOperatorId).toBe(SPEAKER);
        expect(editableUntilOf(log)?.toISOString()).toBe('2026-11-29T09:23:17.510Z');
        expect(talkWindowFor([log], SPEAKER, Date.parse('2026-11-29T09:00:00Z'))).toBe('open');
        expect(talkWindowFor([log], SPEAKER, Date.parse('2026-11-29T10:00:00Z'))).toBe('closed');
        expect(talkWindowFor([log], 'owner-1', Date.parse('2026-11-29T10:00:00Z'))).toBe('none');
    });

    it('absent on the wire (not a talk) or null: no window on the phone', async () => {
        expect((await pullAndRead(db, dto({ id: 'log-form' }))).editableUntilUtc).toBeUndefined();
        expect((await pullAndRead(db, dto({ id: 'log-null', editableUntilUtc: null }))).editableUntilUtc).toBeUndefined();
    });

    it('a later copy without it does not keep the older one (the server\'s statement wins, silence is no window)', async () => {
        expect((await pullAndRead(db, dto({ editableUntilUtc: UNTIL }))).editableUntilUtc).toBe(UNTIL);
        const again = await pullAndRead(db, dto({ modifiedAtUtc: '2026-11-28T11:00:00.000Z' }));
        expect(again.editableUntilUtc).toBeUndefined();
    });
});
