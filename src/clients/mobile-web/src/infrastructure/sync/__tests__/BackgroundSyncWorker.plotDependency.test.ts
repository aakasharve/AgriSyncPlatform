// @vitest-environment jsdom
/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I9 — X3, review round 3 B1).
 *
 * A log on a plot made on this phone is queued behind that plot's `create_plot` and
 * `create_crop_cycle` rows. When the server refuses the log with `PlotNotFound` /
 * `CropCycleNotFound`, that is a verdict about the PLOT, not the log — the same third
 * failure class as `DailyLogNotFound` (`BackgroundSyncWorker.dependencyPending.test.ts`).
 * Before this, such a log burned its retries and parked in FAILED with no explanation.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { resetDatabase, getDatabase, type MutationQueueStatus } from '../../storage/DexieDatabase';
import { systemClock } from '../../../core/domain/services/Clock';

const FROZEN_NOW_ISO = '2026-10-25T09:00:00.000Z';
vi.spyOn(systemClock, 'nowISO').mockReturnValue(FROZEN_NOW_ISO);

const { pushBatchMock, pullChangesMock } = vi.hoisted(() => ({
    pushBatchMock: vi.fn(),
    pullChangesMock: vi.fn().mockResolvedValue({
        serverTimeUtc: '2026-10-25T09:00:00.000Z',
        nextCursorUtc: '2026-10-25T09:00:00.000Z',
        farms: [], plots: [], cropCycles: [], dailyLogs: [], attachments: [],
        costEntries: [], financeCorrections: [], dayLedgers: [], priceConfigs: [],
        plannedActivities: [], auditEvents: [],
    }),
}));

vi.mock('../../api/AgriSyncClient', async () => {
    const actual = await vi.importActual<typeof import('../../api/AgriSyncClient')>('../../api/AgriSyncClient');
    return {
        ...actual,
        agriSyncClient: { pushSyncBatch: pushBatchMock, pullSyncChanges: pullChangesMock },
    };
});

vi.mock('../../storage/AuthTokenStore', () => ({
    getAuthSession: () => ({ userId: 'test-user', accessToken: 'test', expiresAtUtc: '2099-01-01T00:00:00Z' }),
}));

vi.mock('../AiJobWorker', () => ({ AiJobWorker: { run: vi.fn().mockResolvedValue(undefined) } }));

vi.mock('../../../app/state/RootStore', () => ({
    getRootStore: () => ({ sync: { send: vi.fn() } }),
}));

Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });

import { mutationQueue } from '../MutationQueue';
import { backgroundSyncWorker } from '../BackgroundSyncWorker';
import { SyncMutationName } from '../SyncMutationCatalog';
import { MAX_AUTO_RETRY_COUNT } from '../retryCap';
import {
    DEPENDENCY_PLOT_UNRESOLVED_CODE,
    cropCycleParentClientRequestId,
    plotParentClientRequestId,
} from '../MutationDependency';

const FARM = '22222222-2222-4222-8222-222222222222';
const PLOT = '33333333-3333-4333-8333-333333333333';
const CYCLE = '44444444-4444-4444-8444-444444444444';
const LOG = '66666666-6666-4666-8666-666666666666';
const LOG_KEY = `${SyncMutationName.CreateDailyLog}:${LOG}`;

async function freshDb() {
    const db = getDatabase();
    try {
        await db.delete();
    } catch {
        // ignore
    }
    await resetDatabase();
}

async function seedRow(clientRequestId: string, mutationType: string, payload: unknown, status: MutationQueueStatus, retryCount = 0) {
    await getDatabase().mutationQueue.add({
        deviceId: mutationQueue.getDeviceId(),
        clientRequestId,
        clientCommandId: clientRequestId,
        mutationType,
        payload,
        status,
        createdAt: FROZEN_NOW_ISO,
        updatedAt: FROZEN_NOW_ISO,
        retryCount,
    });
}

const seedPlotRow = (status: MutationQueueStatus, retryCount = 0) =>
    seedRow(plotParentClientRequestId(PLOT), SyncMutationName.CreatePlot, { plotId: PLOT, farmId: FARM }, status, retryCount);

const seedCycleRow = (status: MutationQueueStatus, retryCount = 0) =>
    seedRow(cropCycleParentClientRequestId(CYCLE), SyncMutationName.CreateCropCycle, { cropCycleId: CYCLE, plotId: PLOT }, status, retryCount);

const seedLog = () =>
    seedRow(LOG_KEY, SyncMutationName.CreateDailyLog, {
        dailyLogId: LOG, farmId: FARM, scope: 'Plot', plotIds: [PLOT], plotId: PLOT, cropCycleId: CYCLE, logDate: '2026-10-25',
    }, 'PENDING');

async function readLog() {
    return getDatabase().mutationQueue
        .where('[deviceId+clientRequestId]')
        .equals([mutationQueue.getDeviceId(), LOG_KEY])
        .first();
}

/** The server's real answers — `ShramSafalErrors.cs:27-28`. */
function respondWith(errorCode: string, errorMessage: string) {
    pushBatchMock.mockImplementation(async (request: { mutations: Array<{ clientRequestId: string; mutationType: string }> }) => ({
        serverTimeUtc: FROZEN_NOW_ISO,
        results: request.mutations.map(m => ({
            clientRequestId: m.clientRequestId,
            mutationType: m.mutationType,
            status: 'failed' as const,
            errorCode,
            errorMessage,
        })),
    }));
}

describe('BackgroundSyncWorker — a log refused for its phone-made plot is not the log\'s fault', () => {
    beforeEach(async () => {
        await freshDb();
        pushBatchMock.mockReset();
        respondWith('ShramSafal.PlotNotFound', 'Plot was not found.');
    });

    it('waits, uncharged, while its plot is still on the way — and says which plot', async () => {
        await seedPlotRow('SENDING');
        await seedCycleRow('SENDING');
        await seedLog();

        await backgroundSyncWorker.triggerNow();

        const log = await readLog();
        expect(log?.status).toBe('FAILED');
        expect(log?.retryCount).toBe(0);
        expect(log?.lastError).toContain(`plot ${PLOT}`);
    });

    it('is refused NAMING the plot once the server refused the plot', async () => {
        await seedPlotRow('REJECTED_USER_REVIEW');
        await seedCycleRow('SENDING');
        await seedLog();

        await backgroundSyncWorker.triggerNow();

        const log = await readLog();
        expect(log?.status).toBe('REJECTED_USER_REVIEW');
        expect(log?.lastError).toContain(DEPENDENCY_PLOT_UNRESOLVED_CODE);
        expect(log?.lastError).toContain(PLOT);
    });

    it('is refused when the farmer discarded the plot on the conflict screen', async () => {
        await seedPlotRow('REJECTED_DROPPED');
        await seedCycleRow('APPLIED');
        await seedLog();

        await backgroundSyncWorker.triggerNow();

        expect((await readLog())?.status).toBe('REJECTED_USER_REVIEW');
    });

    it('CropCycleNotFound with the cycle out of retries names the crop cycle', async () => {
        respondWith('ShramSafal.CropCycleNotFound', 'Crop cycle was not found.');
        await seedPlotRow('APPLIED');
        await seedCycleRow('FAILED', MAX_AUTO_RETRY_COUNT);
        await seedLog();

        await backgroundSyncWorker.triggerNow();

        const log = await readLog();
        expect(log?.status).toBe('REJECTED_USER_REVIEW');
        expect(log?.lastError).toContain(`crop cycle ${CYCLE}`);
    });

    it('the plot\'s own crop cycle is refused naming the plot too, not left to burn its retries', async () => {
        await seedPlotRow('REJECTED_USER_REVIEW');
        await seedCycleRow('PENDING');

        await backgroundSyncWorker.triggerNow();

        const cycle = await getDatabase().mutationQueue
            .where('[deviceId+clientRequestId]')
            .equals([mutationQueue.getDeviceId(), cropCycleParentClientRequestId(CYCLE)])
            .first();
        expect(cycle?.status).toBe('REJECTED_USER_REVIEW');
        expect(cycle?.lastError).toContain(`plot ${PLOT}`);
    });

    it('a plot with no row on this phone (made on the server) is NOT a dependency — ordinary, charged retry', async () => {
        await seedLog();

        await backgroundSyncWorker.triggerNow();

        const log = await readLog();
        expect(log?.status).toBe('FAILED');
        expect(log?.retryCount).toBe(1);
        expect(log?.lastError ?? '').not.toContain(DEPENDENCY_PLOT_UNRESOLVED_CODE);
    });
});
