// @vitest-environment jsdom
/**
 * spec: 2026-08-25-prod-cutover-waves
 *
 * The rejected/parked badge reads the in-memory sync actor
 * (RootStore.sync.context.rejectedMutations). The actor is a process singleton,
 * so user A's parked count used to survive logout + login-as-B. Mounts the REAL
 * DataSourceProvider + REAL per-user Dexie databases (fake-indexeddb); only auth
 * and the network are faked.
 */
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, waitFor, cleanup, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../infrastructure/api/AgriSyncClient', async () => {
    const actual = await vi.importActual<typeof import('../../../infrastructure/api/AgriSyncClient')>('../../../infrastructure/api/AgriSyncClient');
    return {
        ...actual,
        agriSyncClient: {
            pushSyncBatch: vi.fn().mockResolvedValue({ serverTimeUtc: 'x', results: [] }),
            pullSyncChanges: vi.fn().mockRejectedValue(new Error('offline')),
        },
    };
});
vi.mock('../../../infrastructure/storage/AuthTokenStore', () => ({
    getAuthSession: () => null,
}));
let authValue: { isAuthenticated: boolean; session: { userId: string; accessToken: string } | null };
vi.mock('../AuthProvider', () => ({ useAuth: () => authValue }));
vi.mock('../../../infrastructure/sync/PayloadValidator', () => ({ validatePayload: vi.fn().mockReturnValue({ ok: true, errors: [] }) }));
vi.mock('../../../infrastructure/voice/VoiceClipRetention', () => ({ purgeExpiredProcessingVoiceClips: vi.fn() }));
vi.mock('../../../infrastructure/storage/LegacyLocalStorageMigrator', () => ({ runLegacyLocalStorageMigration: vi.fn() }));
vi.mock('../../../infrastructure/storage/MigrationService', () => ({ MigrationService: { migrate: vi.fn() } }));

import { DataSourceProvider } from '../DataSourceProvider';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { activateDatabaseForUser } from '../../../infrastructure/storage/activateUserDatabase';
import { mutationQueue } from '../../../infrastructure/sync/MutationQueue';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import { getRootStore, resetRootStore } from '../../state/RootStore';
import { backgroundSyncWorker } from '../../../infrastructure/sync/BackgroundSyncWorker';

const badge = () => getRootStore().sync.getSnapshot().context.rejectedMutations.map(m => m.mutationId);
const as = (u: string | null) => {
    authValue = u === null
        ? { isAuthenticated: false, session: null }
        : { isAuthenticated: true, session: { userId: u, accessToken: 't' } };
};

async function parkRowFor(userId: string, id: string) {
    activateDatabaseForUser(userId);
    const reqId = await mutationQueue.enqueue(SyncMutationName.CreateDailyLog, { s: 1 }, { clientRequestId: id });
    const row = await getDatabase().mutationQueue
        .where('[deviceId+clientRequestId]').equals([mutationQueue.getDeviceId(), reqId]).first();
    await mutationQueue.markRejectedUserReview(row!.id as number, 'CLIENT_TOO_OLD');
}

beforeEach(() => { resetRootStore(); window.localStorage.clear(); });
afterEach(() => { cleanup(); backgroundSyncWorker.stop(); resetRootStore(); });

describe('parked/rejected badge is strictly per user', () => {
    it('A parks a row; B never sees it; A sees it again on return; logout shows none', async () => {
        await parkRowFor('user-A', 'a-1');
        await parkRowFor('user-B', 'b-1');
        await parkRowFor('user-B', 'b-2');

        as('user-A');
        const view = render(<DataSourceProvider><i /></DataSourceProvider>);
        await waitFor(() => expect(badge()).toEqual(['a-1']));

        as('user-B');
        view.rerender(<DataSourceProvider><b /></DataSourceProvider>);
        await waitFor(() => expect(badge().sort()).toEqual(['b-1', 'b-2']));
        expect(badge()).not.toContain('a-1');

        as(null);
        view.rerender(<DataSourceProvider><s /></DataSourceProvider>);
        await waitFor(() => expect(badge()).toEqual([]));

        as('user-A');
        view.rerender(<DataSourceProvider><a /></DataSourceProvider>);
        await waitFor(() => expect(badge()).toEqual(['a-1']));

        // A's parked row was never deleted by any of this
        activateDatabaseForUser('user-A');
        expect(await mutationQueue.getRejectedUserReview()).toHaveLength(1);
    });

    it('a user with nothing parked sees an empty badge even right after another user had some', async () => {
        await parkRowFor('user-A', 'a-1');
        as('user-A');
        const view = render(<DataSourceProvider><i /></DataSourceProvider>);
        await waitFor(() => expect(badge()).toEqual(['a-1']));
        as('user-C');
        view.rerender(<DataSourceProvider><c /></DataSourceProvider>);
        await waitFor(() => expect(badge()).toEqual([]));
        await act(async () => { await new Promise(r => setTimeout(r, 50)); });
        expect(badge()).toEqual([]);
    });
});
