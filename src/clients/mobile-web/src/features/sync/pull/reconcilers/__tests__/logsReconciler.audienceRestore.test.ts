/**
 * spec: plr-d10 lane PRV fix pass 2 — the holder's choice is shown on his copy at once; if the server refuses it, the
 * full pull that follows (BackgroundSyncWorker.refusedAudience.prv.test.ts) puts the record's audience back as the server
 * holds it. Pinned on the real `reconcileLogs` rebuild, over the in-memory double the sibling tests use: a local
 * "फक्त मी" the server did not send is gone; one the server did send stays.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { reconcileLogs } from '../logsReconciler';
import type { AgriLogDatabase, DexieLogRecord } from '../../../../../infrastructure/storage/DexieDatabase';
import type { DailyLog } from '../../../../../types';
import type { DailyLogDto, SyncPullResponse } from '../../../../../infrastructure/api/AgriSyncClient';
import type { PlotLookupEntry } from '../profileAndCropsReconciler';

const LOG = 'a0d1e2c3-0000-4000-8000-0000000000e1';
const PLOT = 'plot-1';
const SERVER_VERSION = '2026-11-01T05:00:01.000Z';

const dto = (over: Partial<DailyLogDto> = {}): DailyLogDto => ({
    id: LOG, farmId: 'farm-1', plotId: PLOT, cropCycleId: 'cycle-1', operatorUserId: 'user-2', logDate: '2026-10-30',
    createdAtUtc: '2026-10-30T05:00:00.000Z', modifiedAtUtc: SERVER_VERSION, scope: 'Plot', plotIds: [PLOT], tasks: [],
    verificationEvents: [], ...over,
} as DailyLogDto);

const localWithRefusedChoice = (): DailyLog => ({
    id: LOG, date: '2026-10-30', cropActivities: [], irrigation: [], labour: [], inputs: [], machinery: [],
    meta: { createdAtISO: '2026-10-30T05:00:00.000Z', createdByOperatorId: 'user-2' },
    audience: 'OnlyMe', audienceUserIds: [],
} as unknown as DailyLog);

const plotLookup = new Map<string, PlotLookupEntry>([[PLOT, { cropId: 'crop-1', cropName: 'ऊस', plotName: 'S1' } as PlotLookupEntry]]);
let store: Map<string, DexieLogRecord>;
let db: AgriLogDatabase;
const rebuild = (dtos: DailyLogDto[]) =>
    reconcileLogs(db, { dailyLogs: dtos } as unknown as SyncPullResponse, plotLookup, new Set<string>(), '2026-11-01T06:00:00.000Z', true);
const stored = () => store.get(LOG)?.log as (DailyLog & { audience?: string }) | undefined;

beforeEach(() => {
    store = new Map();
    store.set(LOG, { id: LOG, schemaVersion: 16, log: localWithRefusedChoice(), date: '2026-10-30', isDeleted: 0, serverModifiedAtUtc: SERVER_VERSION } as DexieLogRecord);
    db = {
        logs: {
            get: async (id: string) => store.get(id),
            put: async (row: DexieLogRecord) => { store.set(row.id, row); },
        },
    } as unknown as AgriLogDatabase;
});

describe('a refused audience choice is replaced by the server\'s version on the full pull', () => {
    it('drops a local choice the server did not send', async () => {
        await rebuild([dto()]);
        expect(stored()?.audience).toBeUndefined();
    });

    it('keeps the audience the server did send', async () => {
        await rebuild([dto({ audience: 'Selected', audienceUserIds: ['u-9'] } as Partial<DailyLogDto>)]);
        expect(stored()?.audience).toBe('Selected');
    });
});
