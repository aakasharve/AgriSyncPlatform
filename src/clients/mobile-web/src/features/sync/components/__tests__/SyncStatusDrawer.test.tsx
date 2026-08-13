// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Labour Phase 2 -> Phase 1 (honesty backstop), Task T3 — findings OPEN-C..F.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The header chip says `अडकलं — तपासा` — "stuck, go check" — and this drawer is
 * the place it sends the farmer to check. It had NO test of any kind.
 *
 * What that allowed: the drawer printed `status.failedCount`, which counts
 * durable rejections, above a list built from its OWN `where('status')
 * .equals('FAILED')` query, which does not. One rejected row and zero failed
 * rows rendered **"1 Failed" above an empty list**, beside a "Retry All" button
 * that deliberately skips exactly that row. Three painted doors on one sheet.
 *
 * These tests are about a property, not a layout: **every number this sheet
 * prints has rows behind it, and every row it shows has an action that works
 * for that row.** Nothing here asserts a colour or a class name.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react';

import type { SyncQueueStatus } from '../../hooks/useSyncQueueStatus';
import type { StuckMutationView } from '../../status/stuckMutations';
import { SyncMutationName } from '../../../../infrastructure/sync/SyncMutationCatalog';

const queueStatus: { current: SyncQueueStatus } = {
    current: {
        pendingCount: 0,
        failedCount: 0,
        stuckMutations: [],
        syncedCount: 0,
        pendingUploads: 0,
        failedUploads: 0,
        pendingAiJobs: 0,
        isOnline: true,
        lastSyncAt: null,
    },
};

/**
 * FINAL REVIEW F-2 — the count of records that reached NO queue.
 *
 * A second hook rather than a field on `SyncQueueStatus`, because this number is
 * not in Dexie and cannot be: the record leaves no row anywhere, which is
 * exactly why this sheet could not see it. It must be mocked here or the
 * component's call resolves to `undefined` and throws.
 */
const unqueueableCount = { current: 0 };

vi.mock('../../hooks/useSyncQueueStatus', () => ({
    useSyncQueueStatus: () => queueStatus.current,
    useUnqueueableLogCount: () => unqueueableCount.current,
}));

const retryFailed = vi.fn();
const retryAllFailed = vi.fn();
const triggerNow = vi.fn();
vi.mock('../../../../infrastructure/sync/BackgroundSyncWorker', () => ({
    backgroundSyncWorker: {
        retryFailed: (...args: unknown[]) => retryFailed(...args),
        retryAllFailed: (...args: unknown[]) => retryAllFailed(...args),
        triggerNow: (...args: unknown[]) => triggerNow(...args),
    },
}));

vi.mock('../../../../infrastructure/storage/DexieDatabase', () => ({
    // Only `loadAiJobStatusCounts` touches Dexie now; the failed-item query this
    // component used to run is gone, which is the point of OPEN-D.
    getDatabase: () => ({
        pendingAiJobs: { where: () => ({ equals: () => ({ count: async () => 0 }) }) },
    }),
}));

import SyncStatusDrawer from '../SyncStatusDrawer';

function stuckRow(over: Partial<StuckMutationView> = {}): StuckMutationView {
    return {
        id: 1,
        clientRequestId: 'req-1',
        mutationType: SyncMutationName.CreateDailyLog,
        status: 'FAILED',
        retryCount: 5,
        lastError: 'Request failed with status code 500',
        remedy: 'RETRY',
        ...over,
    };
}

/** Sets the queue shape, keeping `failedCount` equal to what is actually stuck
 *  — which is production's own invariant (`useSyncQueueStatus.ts:98-99`). */
function setQueue(over: Partial<SyncQueueStatus> = {}) {
    const stuckMutations = over.stuckMutations ?? [];
    queueStatus.current = {
        ...queueStatus.current,
        stuckMutations,
        failedCount: stuckMutations.length,
        ...over,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    retryFailed.mockResolvedValue(undefined);
    retryAllFailed.mockResolvedValue({ mutations: 0, uploads: 0 });
    triggerNow.mockResolvedValue(undefined);
    setQueue({ stuckMutations: [], pendingUploads: 0, failedUploads: 0, pendingAiJobs: 0, pendingCount: 0 });
    unqueueableCount.current = 0;
});

afterEach(cleanup);

describe('OPEN-D — the drawer lists exactly what it counts', () => {
    it('a durable rejection appears in the list instead of being counted into an empty one', async () => {
        // THE defect: `failedCount` included REJECTED_USER_REVIEW, the list
        // query did not, so this exact shape rendered a number above nothing.
        setQueue({
            stuckMutations: [stuckRow({ clientRequestId: 'rej-1', status: 'REJECTED_USER_REVIEW', remedy: 'NEEDS_REVIEW' })],
        });

        render(<SyncStatusDrawer isOpen onClose={vi.fn()} onOpenConflicts={vi.fn()} />);

        expect(screen.getByText('1 need you')).toBeInTheDocument();
        expect(screen.getByTestId('sync-review-rej-1')).toBeInTheDocument();
    });

    it('the number and the number of rows are the same number', async () => {
        setQueue({
            stuckMutations: [
                stuckRow({ id: 1, clientRequestId: 'a' }),
                stuckRow({ id: 2, clientRequestId: 'b' }),
                stuckRow({ id: 3, clientRequestId: 'c' }),
            ],
        });

        render(<SyncStatusDrawer isOpen onClose={vi.fn()} onOpenConflicts={vi.fn()} />);

        expect(screen.getByText('3 can be sent again')).toBeInTheDocument();
        expect(screen.getAllByText('Retry')).toHaveLength(3);
    });
});

describe('OPEN-C — a row the server refused gets the remedy that works for it', () => {
    it('offers Review, not Retry — re-sending the same bytes is known to fail', () => {
        const onOpenConflicts = vi.fn();
        setQueue({
            stuckMutations: [stuckRow({ clientRequestId: 'rej-1', status: 'REJECTED_USER_REVIEW', remedy: 'NEEDS_REVIEW' })],
        });

        render(<SyncStatusDrawer isOpen onClose={vi.fn()} onOpenConflicts={onOpenConflicts} />);

        expect(screen.queryByTestId('sync-retry-rej-1')).toBeNull();
        fireEvent.click(screen.getByTestId('sync-review-rej-1'));
        expect(onOpenConflicts).toHaveBeenCalledTimes(1);
    });

    it('hides "Retry All" when it would do nothing at all', () => {
        // `retryAllFailedByUser` does not touch REJECTED_USER_REVIEW rows. With
        // a rejection-only queue the big obvious button was a guaranteed no-op,
        // and no message explained why. A control that cannot act must not look
        // like it can (`P5`).
        setQueue({
            stuckMutations: [stuckRow({ clientRequestId: 'rej-1', status: 'REJECTED_USER_REVIEW', remedy: 'NEEDS_REVIEW' })],
        });

        render(<SyncStatusDrawer isOpen onClose={vi.fn()} onOpenConflicts={vi.fn()} />);

        expect(screen.queryByTestId('sync-retry-all')).toBeNull();
    });

    it('still offers "Retry All" when at least one row can actually be re-sent', () => {
        setQueue({
            stuckMutations: [
                stuckRow({ id: 1, clientRequestId: 'ok-1' }),
                stuckRow({ id: 2, clientRequestId: 'rej-1', status: 'REJECTED_USER_REVIEW', remedy: 'NEEDS_REVIEW' }),
            ],
        });

        render(<SyncStatusDrawer isOpen onClose={vi.fn()} onOpenConflicts={vi.fn()} />);

        expect(screen.getByTestId('sync-retry-all')).toBeInTheDocument();
        expect(screen.getByText('1 can be sent · 1 need you')).toBeInTheDocument();
    });

    it('the split header stays inside the 34-character clip L5b measured', () => {
        // This box hard-clips with no ellipsis to warn anyone. Three-digit
        // counts are the realistic worst case after a long offline stretch.
        setQueue({
            stuckMutations: [
                ...Array.from({ length: 999 }, (_, i) => stuckRow({ id: i, clientRequestId: `ok-${i}` })),
                ...Array.from({ length: 999 }, (_, i) => stuckRow({ id: 1000 + i, clientRequestId: `rej-${i}`, status: 'REJECTED_USER_REVIEW', remedy: 'NEEDS_REVIEW' })),
            ],
        });

        render(<SyncStatusDrawer isOpen onClose={vi.fn()} onOpenConflicts={vi.fn()} />);

        const header = screen.getByText(/need you$/);
        expect(header.textContent).toBe('999 can be sent · 999 need you');
        expect(header.textContent!.length).toBeLessThanOrEqual(34);
    });
});

describe('OPEN-E — rows past the fifth can be reached', () => {
    it('collapses to five, then expands to all of them', () => {
        setQueue({
            stuckMutations: Array.from({ length: 8 }, (_, i) => stuckRow({ id: i, clientRequestId: `r-${i}` })),
        });

        render(<SyncStatusDrawer isOpen onClose={vi.fn()} onOpenConflicts={vi.fn()} />);

        expect(screen.getAllByText('Retry')).toHaveLength(5);
        expect(screen.queryByTestId('sync-retry-r-7')).toBeNull();

        fireEvent.click(screen.getByTestId('sync-toggle-all-stuck'));

        // Row 8 is now inspectable AND individually retryable — it used to be a
        // number in a sentence and nothing else.
        expect(screen.getAllByText('Retry')).toHaveLength(8);
        expect(screen.getByTestId('sync-retry-r-7')).toBeInTheDocument();
    });

    it('does not offer to expand a list that is already whole', () => {
        setQueue({ stuckMutations: [stuckRow()] });

        render(<SyncStatusDrawer isOpen onClose={vi.fn()} onOpenConflicts={vi.fn()} />);

        expect(screen.queryByTestId('sync-toggle-all-stuck')).toBeNull();
    });
});

describe('OPEN-F — a failed photo upload is counted, so it is also explained', () => {
    it('names the upload and points at the button that actually reaches it', () => {
        setQueue({ stuckMutations: [], failedUploads: 2 });

        render(<SyncStatusDrawer isOpen onClose={vi.fn()} onOpenConflicts={vi.fn()} />);

        expect(screen.getByText(/2 photo uploads also stopped/)).toBeInTheDocument();
        // The pointer must never name a button that is off screen. It cannot:
        // failedUploads is one of the two terms in the resendable count.
        expect(screen.getByTestId('sync-retry-all')).toBeInTheDocument();
    });

    it('says nothing about uploads when none have stopped', () => {
        setQueue({ stuckMutations: [stuckRow()], failedUploads: 0 });

        render(<SyncStatusDrawer isOpen onClose={vi.fn()} onOpenConflicts={vi.fn()} />);

        expect(screen.queryByText(/photo upload/)).toBeNull();
    });
});

describe('per-row retry — unchanged behaviour, minus the double-tap window', () => {
    it('sends that one row and marks it so a second tap cannot double-fire', async () => {
        setQueue({ stuckMutations: [stuckRow({ clientRequestId: 'r-1' })] });

        render(<SyncStatusDrawer isOpen onClose={vi.fn()} onOpenConflicts={vi.fn()} />);

        await act(async () => {
            fireEvent.click(screen.getByTestId('sync-retry-r-1'));
        });

        expect(retryFailed).toHaveBeenCalledExactlyOnceWith('r-1');
        await waitFor(() => expect(screen.getByTestId('sync-retry-r-1')).toBeDisabled());
    });

    it('un-marks the row if the retry threw, rather than leaving a spinner over nothing', async () => {
        retryFailed.mockRejectedValueOnce(new Error('boom'));
        setQueue({ stuckMutations: [stuckRow({ clientRequestId: 'r-1' })] });

        render(<SyncStatusDrawer isOpen onClose={vi.fn()} onOpenConflicts={vi.fn()} />);

        await act(async () => {
            fireEvent.click(screen.getByTestId('sync-retry-r-1'));
        });

        await waitFor(() => expect(screen.getByTestId('sync-retry-r-1')).not.toBeDisabled());
    });
});

describe('the sheet as a whole', () => {
    it('claims everything is clear only on evidence the server answered', () => {
        // RETITLED, AND THE ASSERTION CHANGED WITH IT (final review F-2). The
        // old title — "…only when there is nothing in either queue" — endorsed
        // the exact rule this sheet had to stop obeying. An empty queue is the
        // ABSENCE of bad news: a device that has never pushed anything
        // successfully has one, and so does a device whose records were dropped
        // before reaching a queue. `syncedCount` is the only positive evidence
        // in this shape, so the claim now rests on it — the same thing
        // `deriveSyncHonestyState` demands of `ON_SERVER`.
        setQueue({
            stuckMutations: [], pendingCount: 0, pendingUploads: 0,
            pendingAiJobs: 0, failedUploads: 0, syncedCount: 1,
        });

        render(<SyncStatusDrawer isOpen onClose={vi.fn()} onOpenConflicts={vi.fn()} />);

        expect(screen.getByText('All synced')).toBeInTheDocument();
        expect(screen.queryByTestId('sync-retry-all')).toBeNull();
    });

    it('says NOTHING when the queue is empty and nothing was ever acknowledged', () => {
        // A fresh install and a device whose every log was silently dropped look
        // identical from here. The chip answers `null` — no claim at all — and
        // this sheet must not answer "All synced" in its place (`P5`).
        setQueue({
            stuckMutations: [], pendingCount: 0, pendingUploads: 0,
            pendingAiJobs: 0, failedUploads: 0, syncedCount: 0,
        });

        render(<SyncStatusDrawer isOpen onClose={vi.fn()} onOpenConflicts={vi.fn()} />);

        expect(screen.queryByText('All synced')).toBeNull();
    });

    it('never says "All synced" over a record that reached no queue', () => {
        // THE DEFECT, one tap from the chip. `resolveSyncTarget` refused the log,
        // so no row exists in any table this sheet reads — and that emptiness was
        // read as success about the record the farmer had just created, while the
        // chip one tap above had correctly weakened to `मी लिहून घेतलं ✓`.
        unqueueableCount.current = 1;
        setQueue({
            stuckMutations: [], pendingCount: 0, pendingUploads: 0,
            pendingAiJobs: 0, failedUploads: 0, syncedCount: 3,
        });

        render(<SyncStatusDrawer isOpen onClose={vi.fn()} onOpenConflicts={vi.fn()} />);

        expect(screen.queryByText('All synced')).toBeNull();
        expect(screen.getByText(/1 record will not reach your farm records/)).toBeInTheDocument();
    });

    it('offers no button for a dropped record, because there is nothing to tap', () => {
        // Not NEEDS_FIX: no queue row, no worker, no retry. A control here would
        // be a painted door beside three that work — the same reason the chip
        // stays on `ON_PHONE` for these and the toast stopped saying `तपासा`.
        unqueueableCount.current = 2;
        setQueue({
            stuckMutations: [], pendingCount: 0, pendingUploads: 0,
            pendingAiJobs: 0, failedUploads: 0, syncedCount: 3,
        });

        render(<SyncStatusDrawer isOpen onClose={vi.fn()} onOpenConflicts={vi.fn()} />);

        expect(screen.queryByTestId('sync-retry-all')).toBeNull();
        expect(screen.getByText(/2 records will not reach your farm records/)).toBeInTheDocument();
    });

    it('renders nothing at all when closed', () => {
        setQueue({ stuckMutations: [stuckRow()] });

        const { container } = render(<SyncStatusDrawer isOpen={false} onClose={vi.fn()} onOpenConflicts={vi.fn()} />);

        expect(container).toBeEmptyDOMElement();
    });
});
