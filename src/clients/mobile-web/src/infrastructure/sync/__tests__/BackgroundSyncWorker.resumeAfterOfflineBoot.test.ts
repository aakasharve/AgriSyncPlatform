// @vitest-environment jsdom
/**
 * spec: 2026-08-25-prod-cutover-waves
 *
 * After an offline COLD START the workers are started (DataSourceProvider) while
 * getAuthSession() is still null, so their first cycle skips. This proves that
 * no extra trigger is needed: once the 'online' refresh mints a real token
 * (REAL AuthTokenStore), the worker's own interval picks up and runs a cycle.
 * Uses a presence-only marker first, to prove the presence marker alone never
 * lets a cycle through.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { pushBatchMock, pullChangesMock } = vi.hoisted(() => ({
    pushBatchMock: vi.fn().mockResolvedValue({ serverTimeUtc: '2026-08-12T09:00:00.000Z', results: [] }),
    pullChangesMock: vi.fn().mockResolvedValue({
        serverTimeUtc: '2026-08-12T09:00:00.000Z',
        nextCursorUtc: '2026-08-12T09:00:00.000Z',
        farms: [], plots: [], cropCycles: [], dailyLogs: [], attachments: [],
        costEntries: [], financeCorrections: [], dayLedgers: [], priceConfigs: [],
        plannedActivities: [], auditEvents: [],
    }),
}));

vi.mock('../../api/AgriSyncClient', async () => {
    const actual = await vi.importActual<typeof import('../../api/AgriSyncClient')>('../../api/AgriSyncClient');
    return { ...actual, agriSyncClient: { pushSyncBatch: pushBatchMock, pullSyncChanges: pullChangesMock } };
});
vi.mock('../SyncPullReconciler', () => ({ reconcileSyncPull: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../PayloadValidator', () => ({ validatePayload: vi.fn().mockReturnValue({ ok: true, errors: [] }) }));
vi.mock('../AiJobWorker', () => ({ AiJobWorker: { run: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('../../storage/endFarmerSession', () => ({ endFarmerSessionLocally: vi.fn() }));

Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });

import { backgroundSyncWorker } from '../BackgroundSyncWorker';
import { clearAuthSession, setAuthSession } from '../../storage/AuthTokenStore';

const KEY = 'agrisync_auth_session_v1';

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    window.localStorage.clear();
    clearAuthSession();
    pullChangesMock.mockClear();
    pushBatchMock.mockClear();
});

afterEach(() => {
    backgroundSyncWorker.stop();
    vi.useRealTimers();
});

describe('BackgroundSyncWorker - resumes after an offline cold start once a real token exists', () => {
    it('skips while only the presence marker exists, then runs on the next tick after refresh', async () => {
        // cold start: marker only, no in-memory token
        window.localStorage.setItem(KEY, JSON.stringify({
            userId: 'u-field',
            expiresAtUtc: new Date(Date.now() - 3 * 3600_000).toISOString(),
        }));

        backgroundSyncWorker.start();
        await vi.advanceTimersByTimeAsync(15_000);
        await vi.advanceTimersByTimeAsync(15_000);
        expect(pullChangesMock).not.toHaveBeenCalled();
        expect(pushBatchMock).not.toHaveBeenCalled();

        // connectivity back: the AuthProvider refresh mints a real session
        setAuthSession({
            userId: 'u-field',
            accessToken: 'tok-real',
            expiresAtUtc: new Date(Date.now() + 15 * 60_000).toISOString(),
        });

        await vi.advanceTimersByTimeAsync(15_000);
        await vi.waitFor(() => expect(pullChangesMock).toHaveBeenCalled());
    });
});
