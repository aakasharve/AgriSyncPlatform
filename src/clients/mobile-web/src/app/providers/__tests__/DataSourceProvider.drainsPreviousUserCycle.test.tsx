// @vitest-environment jsdom
/**
 * spec: 2026-08-25-prod-cutover-waves
 *
 * DETERMINISTIC RACE: user A's sync cycle is blocked mid-push (a deferred
 * promise) when the signed-in user changes to B. The provider must DRAIN A's
 * cycle (worker.stop() awaits it) BEFORE it resets the sync badge and points the
 * database at B. Otherwise A's late "rejected" verdict is emitted into B's badge
 * and A's row update lands in whichever database is active.
 */
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, waitFor, cleanup, configure } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

configure({ asyncUtilTimeout: 8000 });

let releasePush!: (v: unknown) => void;
const pushStarted = vi.fn();
vi.mock('../../../infrastructure/api/AgriSyncClient', async () => {
    const actual = await vi.importActual<typeof import('../../../infrastructure/api/AgriSyncClient')>('../../../infrastructure/api/AgriSyncClient');
    return {
        ...actual,
        agriSyncClient: {
            pushSyncBatch: (...a: unknown[]) => new Promise((res) => { pushStarted(...a); releasePush = res; }),
            pullSyncChanges: vi.fn().mockRejectedValue(new Error('offline')),
        },
    };
});
vi.mock('../../../infrastructure/storage/AuthTokenStore', () => ({
    getAuthSession: () => ({ userId: 'x', accessToken: 't', expiresAtUtc: '2099-01-01T00:00:00Z' }),
}));
let authValue: { isAuthenticated: boolean; session: { userId: string; accessToken: string } | null };
vi.mock('../AuthProvider', () => ({ useAuth: () => authValue }));
vi.mock('../../../infrastructure/sync/PayloadValidator', () => ({ validatePayload: vi.fn().mockReturnValue({ ok: true, errors: [] }) }));
vi.mock('../../../infrastructure/voice/VoiceClipRetention', () => ({ purgeExpiredProcessingVoiceClips: vi.fn() }));
vi.mock('../../../infrastructure/storage/LegacyLocalStorageMigrator', () => ({ runLegacyLocalStorageMigration: vi.fn() }));
vi.mock('../../../infrastructure/storage/MigrationService', () => ({ MigrationService: { migrate: vi.fn() } }));
vi.mock('../../../features/sync/pull/SyncPullReconciler', () => ({ reconcileSyncPull: vi.fn() }));
vi.mock('../../../infrastructure/sync/AiJobWorker', () => ({ AiJobWorker: { run: vi.fn() } }));
Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });

import { DataSourceProvider } from '../DataSourceProvider';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { activateDatabaseForUser } from '../../../infrastructure/storage/activateUserDatabase';
import { getActiveDatabaseName } from '../../../infrastructure/storage/activeDatabaseName';
import { perUserDatabaseName } from '../../../infrastructure/storage/userDatabaseName';
import { mutationQueue } from '../../../infrastructure/sync/MutationQueue';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import { getRootStore, resetRootStore } from '../../state/RootStore';
import { backgroundSyncWorker } from '../../../infrastructure/sync/BackgroundSyncWorker';

const as = (u: string) => { authValue = { isAuthenticated: true, session: { userId: u, accessToken: 't' } }; };
const badge = () => getRootStore().sync.getSnapshot().context.rejectedMutations.map(m => m.mutationId);

beforeEach(() => { resetRootStore(); window.localStorage.clear(); pushStarted.mockClear(); });
afterEach(() => { cleanup(); backgroundSyncWorker.stop(); resetRootStore(); });

describe('a user change drains the previous user cycle first', () => {
    it('worker.stop() does not resolve until the in-flight cycle has finished', async () => {
        activateDatabaseForUser('user-A');
        await mutationQueue.enqueue(SyncMutationName.CreateDailyLog, { s: 1 }, { clientRequestId: 'a-1' });
        backgroundSyncWorker.start();
        await waitFor(() => expect(pushStarted).toHaveBeenCalled());

        let settled = false;
        const stopped = backgroundSyncWorker.stop().then(() => { settled = true; });
        await new Promise(r => setTimeout(r, 30));
        expect(settled).toBe(false); // still blocked in A's push

        releasePush({ serverTimeUtc: 'x', results: [] });
        await stopped;
        expect(settled).toBe(true);
    });

    it("A's late rejection never reaches B: B's address is not taken until A's cycle ends, and B's badge starts clean", async () => {
        activateDatabaseForUser('user-A');
        await mutationQueue.enqueue(SyncMutationName.CreateDailyLog, { s: 1 }, { clientRequestId: 'a-2' });
        as('user-A');
        const view = render(<DataSourceProvider><i /></DataSourceProvider>);
        await waitFor(() => expect(pushStarted).toHaveBeenCalled());
        const dbA = getActiveDatabaseName();

        as('user-B');
        view.rerender(<DataSourceProvider><b /></DataSourceProvider>);
        await new Promise(r => setTimeout(r, 50));
        // A's cycle is still blocked: the database address must NOT have moved yet.
        expect(getActiveDatabaseName()).toBe(dbA);

        // A's server answers: permanent rejection of a-1.
        releasePush({
            serverTimeUtc: 'x',
            results: [{ clientRequestId: 'a-2', status: 'rejected', errorCode: 'CLIENT_TOO_OLD', errorMessage: 'too old' }],
        });
        await waitFor(() => expect(getActiveDatabaseName()).toBe(perUserDatabaseName('user-B')));
        await new Promise(r => setTimeout(r, 50));

        // The late A rejection was emitted BEFORE the reset, so B's badge is clean,
        expect(badge()).toEqual([]);
        // B's database holds nothing of A's, and A's row (rejected, kept) is in A's database.
        expect(await getDatabase().mutationQueue.count()).toBe(0);
        activateDatabaseForUser('user-A');
        const rows = (await getDatabase().mutationQueue.toArray()).filter(r => r.clientRequestId === 'a-2');
        expect(rows).toHaveLength(1);
        expect(rows[0].status).toBe('REJECTED_USER_REVIEW');
    });
});
