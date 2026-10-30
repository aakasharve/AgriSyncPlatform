/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane F1, review N9) — THE ONE TRUTHFUL REBUILD.
 *
 * A log this phone pulled BEFORE lane F1 still holds what the old rebuild invented from its task lines ('Drip',
 * 'Field', five zero totals). The pull is a delta and skips a log whose server version it already holds, so the
 * first pull after the upgrade is a full one that re-merges every log (`rebuildEveryLog`). Pinned here on the real
 * `reconcileLogs`, over the in-memory Dexie double the sibling reconciler tests use:
 *   - an ordinary pull leaves the invented values where they are (that is why the rebuild exists);
 *   - the rebuild replaces them with what the task lines truly say, marked `legacyPartial`;
 *   - a log with unsent local edits is never touched, rebuild or not (the pending guard);
 *   - a log this phone made keeps its own details.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { reconcileLogs } from '../logsReconciler';
import { isLogsRebuildDue, LOGS_REBUILD_MARKER_KEY, markLogsRebuilt } from '../../logsRebuildMarker';
import type { AgriLogDatabase, DexieLogRecord } from '../../../../../infrastructure/storage/DexieDatabase';
import type { DailyLog } from '../../../../../types';
import type { DailyLogDto, SyncPullResponse } from '../../../../../infrastructure/api/AgriSyncClient';
import type { PlotLookupEntry } from '../profileAndCropsReconciler';

const PULLED = 'f1f1f1f1-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OWN = 'f1f1f1f1-cccc-4ccc-8ccc-cccccccccccc';
const PLOT = 'plot-1';
const SERVER_VERSION = '2026-10-20T05:00:01.000Z';

const dto = (id: string, over: Partial<DailyLogDto> = {}): DailyLogDto => ({
    id,
    farmId: 'farm-1',
    plotId: PLOT,
    cropCycleId: 'cycle-1',
    operatorUserId: 'user-2',
    logDate: '2026-10-20',
    createdAtUtc: '2026-10-20T05:00:00.000Z',
    modifiedAtUtc: SERVER_VERSION,
    scope: 'Plot',
    plotIds: [PLOT],
    tasks: [{ id: `${id}-t1`, activityType: 'Irrigation', notes: 'Duration: 2 hrs', occurredAtUtc: '2026-10-20T05:00:00.000Z' }],
    verificationEvents: [],
    ...over,
} as DailyLogDto);

/** What the OLD rebuild wrote for that same task line: constants dressed as his record. */
const inventedPulledLog = (id: string): DailyLog => ({
    id,
    date: '2026-10-20',
    context: { selection: [{ cropId: 'crop-1', cropName: 'ऊस', selectedPlotIds: [PLOT], selectedPlotNames: ['S1'] }] },
    dayOutcome: 'WORK_RECORDED',
    cropActivities: [],
    irrigation: [{ id: `${id}-t1`, method: 'Drip', source: 'Field', notes: 'Duration: 2 hrs' }],
    labour: [],
    inputs: [],
    machinery: [],
    meta: { createdAtISO: '2026-10-20T05:00:00.000Z' },
    financialSummary: { totalLabourCost: 0, totalInputCost: 0, totalMachineryCost: 0, totalActivityExpenses: 0, grandTotal: 0 },
} as unknown as DailyLog);

const ownLog = (): DailyLog => ({
    ...inventedPulledLog(OWN),
    irrigation: [{ id: 'own-i', method: 'Flood', source: 'Canal', durationHours: 2 }],
    meta: { createdAtISO: '2026-10-20T05:00:00.000Z', appVersion: '1.0.17' },
} as unknown as DailyLog);

const plotLookup = new Map<string, PlotLookupEntry>([[PLOT, { cropId: 'crop-1', cropName: 'ऊस', plotName: 'S1' } as PlotLookupEntry]]);
let store: Map<string, DexieLogRecord>;
let db: AgriLogDatabase;
const seed = (log: DailyLog) => store.set(log.id, {
    id: log.id, schemaVersion: 16, log, date: log.date, isDeleted: 0, serverModifiedAtUtc: SERVER_VERSION,
} as DexieLogRecord);
const pull = (dtos: DailyLogDto[], rebuild: boolean, pending = new Set<string>()) =>
    reconcileLogs(db, { dailyLogs: dtos } as unknown as SyncPullResponse, plotLookup, pending, '2026-10-30T06:00:00.000Z', rebuild);

beforeEach(() => {
    store = new Map();
    db = {
        logs: {
            get: async (id: string) => store.get(id),
            put: async (row: DexieLogRecord) => { store.set(row.id, row); },
        },
    } as unknown as AgriLogDatabase;
});

describe('the one full rebuild after the upgrade (review N9)', () => {
    it('an ordinary pull of the same server version leaves the invented values in place — the reason the rebuild exists', async () => {
        seed(inventedPulledLog(PULLED));
        await pull([dto(PULLED)], false);

        expect(store.get(PULLED)!.log.irrigation[0].method).toBe('Drip');
    });

    it('the rebuild replaces them with what the task line truly says, marked legacy-partial, with no invented totals', async () => {
        seed(inventedPulledLog(PULLED));
        await pull([dto(PULLED)], true);

        const log = store.get(PULLED)!.log;
        expect(log.irrigation).toEqual([{ id: `${PULLED}-t1`, notes: 'Duration: 2 hrs' }]);
        expect(log.legacyPartial).toBe(true);
        expect(JSON.stringify(log)).not.toMatch(/"Drip"|"Field"/);
        expect(log.financialSummary).toBeUndefined(); // the old rebuild's five zeros were never his totals
    });

    it('takes the server\'s stored details where it has them', async () => {
        seed(inventedPulledLog(PULLED));
        await pull([dto(PULLED, {
            contentVersion: 2,
            content: { version: 2, schema: 1, document: { schema: 1, irrigation: [{ id: 'i1', method: 'Flood', source: 'Canal', durationHours: 2 }] } },
        } as Partial<DailyLogDto>)], true);

        const log = store.get(PULLED)!.log;
        expect(log.irrigation).toEqual([{ id: 'i1', method: 'Flood', source: 'Canal', durationHours: 2 }]);
        expect(log.legacyPartial).toBe(false);
        expect(log.contentVersion).toBe(2);
    });

    it('never touches a log with unsent local edits, rebuild or not (the pending guard)', async () => {
        seed(inventedPulledLog(PULLED));
        await pull([dto(PULLED)], true, new Set([PULLED]));

        expect(store.get(PULLED)!.log.irrigation[0].method).toBe('Drip');
    });

    it('a log this phone made keeps its own details and its own totals', async () => {
        seed(ownLog());
        await pull([dto(OWN)], true);

        expect(store.get(OWN)!.log.irrigation).toEqual([{ id: 'own-i', method: 'Flood', source: 'Canal', durationHours: 2 }]);
        expect(store.get(OWN)!.log.financialSummary).toBeDefined();
    });
});

describe('the marker that makes it ONE rebuild', () => {
    const meta = new Map<string, unknown>();
    const metaDb = {
        appMeta: {
            get: async (key: string) => meta.get(key),
            put: async (row: { key: string }) => { meta.set(row.key, row); },
        },
    } as unknown as AgriLogDatabase;

    beforeEach(() => meta.clear());

    it('is due until it is written, then never again', async () => {
        expect(await isLogsRebuildDue(metaDb)).toBe(true);
        await markLogsRebuilt(metaDb, '2026-10-30T06:00:00.000Z');
        expect(meta.get(LOGS_REBUILD_MARKER_KEY)).toMatchObject({ value: { rebuiltAtUtc: '2026-10-30T06:00:00.000Z' } });
        expect(await isLogsRebuildDue(metaDb)).toBe(false);
    });

    it('an unreadable store does not force a full re-pull', async () => {
        const broken = { appMeta: { get: async () => { throw new Error('IDB gone'); } } } as unknown as AgriLogDatabase;
        expect(await isLogsRebuildDue(broken)).toBe(false);
    });
});
