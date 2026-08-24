// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop — finding F7(a).
 *
 * WHY THIS FILE EXISTS
 * ---------------------
 * `useSyncQueueStatus` starts at `EMPTY_STATUS` and only fills in after its
 * first Dexie read resolves. Every count in that initial object is 0 — and
 * one layer up, `AppHeader` turns those zeros into `waitingCount === 0`,
 * which `CanonicalStrip` renders as the REST state: a green tick and
 * "आज पर्यन्त सर्व कामे पूर्ण आहेत" ("all work is complete as of today").
 *
 * That is the strongest claim in the feature, made from the weakest possible
 * evidence: the absence of rows nobody has read. `hasLoaded` is what tells
 * the difference between a MEASURED zero and an unfilled one, and this file
 * pins the only two things that make it worth having —
 *
 *   1. it starts FALSE (a component that reads it before the first poll
 *      learns "not known yet", not "nothing outstanding"), and
 *   2. it becomes TRUE only after a read actually completed.
 *
 * The rest of this suite's sibling files cover what the counts mean; this
 * one covers whether they mean anything yet.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup, act } from '@testing-library/react';

import { getDatabase, resetDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';
import { useSyncQueueStatus } from '../useSyncQueueStatus';

const FROZEN_NOW_ISO = '2026-08-24T09:00:00.000Z';

afterEach(cleanup);

async function freshDb() {
    const db = getDatabase();
    try {
        await db.delete();
    } catch {
        // first run — nothing to delete
    }
    await resetDatabase();
}

describe('useSyncQueueStatus — hasLoaded separates a measured zero from an unread one (F7a)', () => {
    beforeEach(async () => {
        await freshDb();
    });

    it('the_initial_status_reports_hasLoaded_false_alongside_its_zeros', () => {
        // Read SYNCHRONOUSLY, before any `waitFor`/`act` flush, so this is
        // genuinely the first-render value a component would see — the exact
        // window in which the strip used to claim all work was complete.
        //
        // `renderHook` is not awaited and nothing is flushed here on
        // purpose: awaiting would defeat the test by letting the poll land.
        const { result } = renderHook(() => useSyncQueueStatus());

        expect(result.current.pendingCount).toBe(0);
        expect(result.current.failedCount).toBe(0);
        expect(result.current.syncedCount).toBe(0);
        // ...and every one of those zeros is unproven.
        expect(result.current.hasLoaded).toBe(false);
    });

    it('hasLoaded_becomes_true_once_a_read_actually_completes', async () => {
        const { result } = renderHook(() => useSyncQueueStatus());

        expect(result.current.hasLoaded).toBe(false);
        await waitFor(() => expect(result.current.hasLoaded).toBe(true));

        // The zeros are the same zeros — what changed is that they are now
        // measured. Both halves matter: a flag that flipped while the counts
        // were still wrong would be no better than no flag.
        expect(result.current.pendingCount).toBe(0);
        expect(result.current.failedCount).toBe(0);
    });

    it('a_real_row_is_reported_together_with_hasLoaded_true', async () => {
        // The flag and the evidence must arrive together. A flag that
        // flipped before the counts were filled in would be no better than
        // no flag at all — the strip would stop saying "checking" while
        // still holding an unread zero.
        await getDatabase().mutationQueue.add({
            deviceId: 'test-device',
            clientRequestId: 'req-hasloaded-1',
            clientCommandId: 'cmd-1',
            mutationType: SyncMutationName.CreateDailyLog,
            payload: { sample: true },
            status: 'PENDING',
            createdAt: FROZEN_NOW_ISO,
            updatedAt: FROZEN_NOW_ISO,
            retryCount: 0,
        });

        const { result } = renderHook(() => useSyncQueueStatus());
        expect(result.current.hasLoaded).toBe(false);
        expect(result.current.pendingCount).toBe(0); // the unread zero

        await waitFor(() => expect(result.current.hasLoaded).toBe(true));
        expect(result.current.pendingCount).toBe(1);
    });

    it('hasLoaded_survives_a_connectivity_change', async () => {
        // The online/offline listeners patch `status` with a partial update.
        // A listener that rebuilt the object instead of spreading `prev`
        // would silently drop the flag, and the strip would fall back into
        // "checking" the moment the phone changed network — the exact class
        // of bug this file exists to catch.
        const { result } = renderHook(() => useSyncQueueStatus());
        await waitFor(() => expect(result.current.hasLoaded).toBe(true));

        await act(async () => {
            window.dispatchEvent(new Event('offline'));
        });
        expect(result.current.isOnline).toBe(false);
        expect(result.current.hasLoaded).toBe(true);

        await act(async () => {
            window.dispatchEvent(new Event('online'));
        });
        expect(result.current.isOnline).toBe(true);
        expect(result.current.hasLoaded).toBe(true);
    });
});
