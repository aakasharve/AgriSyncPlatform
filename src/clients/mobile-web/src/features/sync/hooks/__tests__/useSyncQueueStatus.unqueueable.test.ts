// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Labour Phase 2 — final whole-branch review, finding F-2.
 *
 * THE DEFECT, IN ONE TAP
 * ----------------------
 * A save whose log `resolveSyncTarget` refuses (`logSyncMutationService.ts:509-511`)
 * writes NO row anywhere — no mutation, no outbox, nothing. The save path
 * records the fact in `unqueueableLogs.ts`, and the header chip correctly
 * weakens from `शेतनोंदीत जमा ✓` to `मी लिहून घेतलं ✓` because of it.
 *
 * The farmer then taps that chip. It opens `SyncStatusDrawer`, which had no way
 * to see that record at all — so its own condition
 * (`totalPending === 0 && totalFailed === 0`) was satisfied by the absence of
 * rows and it rendered a green tick reading **"All synced"** about the log the
 * farmer had just created. Two surfaces one tap apart, and the second one made
 * the STRONGER claim from the WEAKER evidence. That is verbatim what
 * `syncHonestyState.ts:21-37` was rewritten to forbid: **absence of bad news is
 * not good news.** The rule reached the chip and was never carried to the drawer.
 *
 * WHAT THIS FILE PINS, AND WHAT IT CANNOT
 * ---------------------------------------
 * The `.ts` half: `useSyncQueueStatus.ts` must MAKE the count reachable, and
 * must expose the acknowledgement evidence (`syncedCount`) that any "all clear"
 * claim has to rest on. Whether the drawer then obeys the rule is a `.tsx`
 * assertion and belongs in `SyncStatusDrawer.test.tsx`.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act, cleanup } from '@testing-library/react';

import { getDatabase, resetDatabase } from '../../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';
import { noteUnqueueableLogs, resetUnqueueableLogs } from '../../status/unqueueableLogs';
import { useSyncQueueStatus, useUnqueueableLogCount } from '../useSyncQueueStatus';

const FROZEN_NOW_ISO = '2026-08-13T09:00:00.000Z';

afterEach(() => {
    cleanup();
    resetUnqueueableLogs();
});

beforeEach(async () => {
    const db = getDatabase();
    try {
        await db.delete();
    } catch {
        // first run — nothing to delete
    }
    await resetDatabase();
    resetUnqueueableLogs();
});

async function seedApplied() {
    await getDatabase().mutationQueue.add({
        deviceId: 'test-device',
        clientRequestId: `req-${Math.random().toString(36).slice(2, 8)}`,
        clientCommandId: 'cmd-1',
        mutationType: SyncMutationName.CreateDailyLog,
        payload: { sample: true },
        status: 'APPLIED',
        createdAt: FROZEN_NOW_ISO,
        updatedAt: FROZEN_NOW_ISO,
        retryCount: 0,
    });
}

describe('useUnqueueableLogCount — the record that reached no queue (F-2)', () => {
    it('claims nothing when the session knows of no dropped record', () => {
        const { result } = renderHook(() => useUnqueueableLogCount());

        expect(result.current).toBe(0);
    });

    it('sees a drop recorded BEFORE the drawer was ever opened', () => {
        // The real order of events: the farmer saves, the toast appears, and
        // only then does he tap the chip and mount this hook.
        noteUnqueueableLogs(['log-1']);

        const { result } = renderHook(() => useUnqueueableLogCount());

        expect(result.current).toBe(1);
    });

    it('knows it on the FIRST render, so the drawer never flashes an all-clear', () => {
        // This asserts the initial read, not the effect — and the distinction is
        // the whole user-visible point. An effect-only version settles on the
        // right number too, but its first paint is a zero, and a zero here is a
        // green tick reading "All synced" over the record the farmer just made.
        // A flash of the exact false claim is still the false claim.
        //
        // `result.current` cannot see this: it is read after effects flush. So
        // the value of every render is captured as it happens.
        noteUnqueueableLogs(['log-1']);
        const rendered: number[] = [];

        renderHook(() => {
            const count = useUnqueueableLogCount();
            rendered.push(count);
            return count;
        });

        expect(rendered[0]).toBe(1);
        expect(rendered).not.toContain(0);
    });

    it('updates without waiting for a poll, because the chip does not either', async () => {
        const { result } = renderHook(() => useUnqueueableLogCount());
        expect(result.current).toBe(0);

        act(() => {
            noteUnqueueableLogs(['log-1']);
        });

        // No timer advance, no 3s window: a drawer three seconds behind the chip
        // reading the same registry would contradict it for those three seconds.
        expect(result.current).toBe(1);
    });

    it('counts distinct records, so a re-submitted draft is one loss and not two', () => {
        const { result } = renderHook(() => useUnqueueableLogCount());

        act(() => {
            noteUnqueueableLogs(['log-1', 'log-2']);
            noteUnqueueableLogs(['log-1']);
        });

        expect(result.current).toBe(2);
    });

    it('stops listening when the drawer closes', () => {
        const { result, unmount } = renderHook(() => useUnqueueableLogCount());
        unmount();

        // A live listener on an unmounted component is a React state-update
        // warning at best and a leak on a singleton registry at worst.
        expect(() => noteUnqueueableLogs(['log-1'])).not.toThrow();
        expect(result.current).toBe(0);
    });
});

describe('useSyncQueueStatus — a dropped record is invisible in every table (F-2)', () => {
    it('reports an empty queue for a log nothing will ever send', async () => {
        // The heart of the finding: there is nothing to query. Every Dexie table
        // this hook reads is empty, and that emptiness is exactly what the
        // drawer read as "All synced".
        noteUnqueueableLogs(['log-1']);

        const { result } = renderHook(() => useSyncQueueStatus());

        await waitFor(() => expect(result.current.pendingCount).toBe(0));
        expect(result.current.failedCount).toBe(0);
        expect(result.current.stuckMutations).toEqual([]);
    });

    it('a dropped record must NOT masquerade as a stuck one', async () => {
        // There is no retry to press and no row to list, so it may never inflate
        // the red number — the same refusal `deriveSyncHonestyState` makes for
        // the chip (finding B3).
        noteUnqueueableLogs(['log-1']);
        await seedApplied();

        const { result } = renderHook(() => useSyncQueueStatus());

        await waitFor(() => expect(result.current.syncedCount).toBe(1));
        expect(result.current.failedCount).toBe(0);
        expect(result.current.pendingCount).toBe(0);
    });

    it('exposes the acknowledgement evidence an "all clear" claim needs', async () => {
        // A device that has never pushed anything successfully has an empty
        // queue too. Any "all clear" must rest on `syncedCount > 0`, not on the
        // absence of rows, so that number has to be reachable and has to move.
        const { result } = renderHook(() => useSyncQueueStatus());
        await waitFor(() => expect(result.current.syncedCount).toBe(0));

        await seedApplied();

        await waitFor(() => expect(result.current.syncedCount).toBe(1));
    });
});
