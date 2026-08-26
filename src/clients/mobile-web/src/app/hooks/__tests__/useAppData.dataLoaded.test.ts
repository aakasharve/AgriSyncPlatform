// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop — finding F7(a).
 *
 * WHY THIS FILE EXISTS
 * ---------------------
 * `useAppData` returns `history: []` and `crops: []` on its very first
 * render and fills them in asynchronously. That is fine for every consumer
 * that merely RENDERS the records — an empty list renders as an empty list.
 *
 * It is not fine for a consumer that turns the ABSENCE of records into a
 * positive claim. The oversight strip is exactly that consumer: no records
 * and no decisions means `waitingCount === 0`, which `CanonicalStrip`
 * renders as a green tick reading "आज पर्यन्त सर्व कामे पूर्ण आहेत" ("all
 * work is complete as of today"). During the first-load window that
 * sentence was being printed over data nobody had read.
 *
 * `dataLoaded` is what tells a measured empty from an unfilled one, so the
 * only two things worth pinning are that it starts FALSE and only becomes
 * TRUE after a hydration pass actually completed.
 *
 * MOCKING: the two providers this hook consumes (`useDataSource`,
 * `useAuth`) and the sync worker are stubbed so the test exercises THIS
 * hook's state machine rather than storage; Dexie itself is the real thing
 * on `fake-indexeddb`, the same way the sync-hook suites run it, so no
 * module that hydrates from it at import time is left holding a stub.
 * `crops.getAll` is a deferred promise so the pre-resolution window is a
 * real, observable state rather than something inferred.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup, act } from '@testing-library/react';

const cropsDeferred: { resolve: (v: unknown[]) => void } = { resolve: () => { } };
let cropsPromise: Promise<unknown[]>;

const dataSource = {
    crops: {
        getAll: vi.fn(() => cropsPromise),
        save: vi.fn(async () => { }),
    },
    profile: { get: vi.fn(async () => null) },
    logs: { getAll: vi.fn(async () => []) },
};

vi.mock('../../providers/DataSourceProvider', () => ({
    useDataSource: () => ({
        dataSource,
        auditPort: {},
        isDemoMode: false,
        setDemoMode: async () => { },
        isLoading: false,
    }),
}));

vi.mock('../../providers/AuthProvider', () => ({
    useAuth: () => ({ isAuthenticated: false, session: null }),
}));

vi.mock('../../../infrastructure/sync/BackgroundSyncWorker', () => ({
    backgroundSyncWorker: { triggerNow: vi.fn(async () => { }) },
}));

import { useAppData } from '../useAppData';

beforeEach(() => {
    cropsPromise = new Promise<unknown[]>((resolve) => {
        cropsDeferred.resolve = resolve;
    });
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('useAppData — dataLoaded separates a measured empty from an unread one (F7a)', () => {
    it('dataLoaded_is_false_before_the_first_hydration_pass_completes', async () => {
        const { result } = renderHook(() => useAppData());

        // First render: empty arrays AND an explicit "we have not read yet".
        expect(result.current.history).toEqual([]);
        expect(result.current.crops).toEqual([]);
        expect(result.current.dataLoaded).toBe(false);

        // Still false while the read is genuinely in flight — this is the
        // window the strip used to claim completion in. `crops.getAll` has
        // not resolved, so nothing downstream may conclude anything.
        await act(async () => { await Promise.resolve(); });
        expect(result.current.dataLoaded).toBe(false);
    });

    it('dataLoaded_becomes_true_only_after_the_hydration_pass_finishes', async () => {
        const { result } = renderHook(() => useAppData());
        expect(result.current.dataLoaded).toBe(false);

        await act(async () => {
            cropsDeferred.resolve([]);
            await cropsPromise;
        });

        await waitFor(() => expect(result.current.dataLoaded).toBe(true));
        // The empty history is the SAME empty history — what changed is that
        // it is now a measured one.
        expect(result.current.history).toEqual([]);
    });
});
