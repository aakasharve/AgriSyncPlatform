// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TASK 8 (spec: 2026-08-28-labour-v2-release-1, P4/P5, Ruling R8) — the worst
 * of the four, because it sits on the bottom nav and because the sentence it
 * fabricates is a REASSURANCE.
 *
 * `useAttentionBoard` reads `db.attentionCards`, a table written by exactly one
 * thing: `reconcileAttentionBoard`, inside a SUCCESSFUL sync pull. So on a
 * device whose sync has never succeeded — a fresh install on weak rural signal,
 * the pilot's normal first hour — the table is empty for the same reason a
 * blank page is blank, and the screen read that emptiness as an answer:
 *
 *     सगळ्या शेती आज व्यवस्थित आहेत  /  All your farms are on track today
 *
 * (That sentence is now gone altogether — founder D-1, 2026-10-26: the empty board says
 * "सध्या लक्ष देण्यासारखे काही नाही." — but the same gate still applies to the new words.)
 *
 * A farmer who is told his farms are fine does not go and look. That is the
 * whole cost of this one.
 *
 * THE SIGNAL, AND WHY IT IS NOT "the list is empty"
 * -------------------------------------------------
 * `db.syncCursors` carries `lastSyncAt`, written by `MutationQueue.setCursor()`
 * only after a pull completes. No cursor means no pull has EVER succeeded, so
 * the board has never been populated and its emptiness is not evidence of
 * anything. A cursor plus zero cards is a real answer, and the all-clear is
 * TRUE — the second test locks that, because suppressing it would swap this
 * lie for the opposite one.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const cursorRef: { current: { tableName: string; lastSyncAt: string; version: number } | undefined } = {
    current: undefined,
};

vi.mock('../../../../app/context/AppFeatureContexts', () => ({
    useAppNavigationState: () => ({ setCurrentRoute: () => { } }),
}));

vi.mock('../../../../infrastructure/storage/DexieDatabase', () => ({
    getDatabase: () => fakeDb,
}));

const triggerNow = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../../infrastructure/sync/BackgroundSyncWorker', () => ({
    backgroundSyncWorker: { triggerNow: () => triggerNow() },
}));

const fakeDb = {
    // Zero cards in BOTH cases below. That is the point: the two states are
    // indistinguishable from this table alone, which is why the screen must
    // not read its answer out of it.
    attentionCards: { orderBy: () => ({ toArray: async () => [] }) },
    syncCursors: { get: async () => cursorRef.current },
};

import AttentionPage from '../AttentionPage';

// spec: plr-d10 (I14) — founder D-1 (FOUNDER-ANSWERS-2026-10-26): the empty board says "सध्या लक्ष देण्यासारखे
// काही नाही." in his words; the old crop-health sentence is rejected by name ("an empty action list cannot prove
// crop health"), so it must never appear in EITHER state. The honesty gate this file locks is unchanged: on a
// never-synced board even the new sentence would be a false reassurance.
const FALSE_REASSURANCE = 'सध्या लक्ष देण्यासारखे काही नाही.';
const REJECTED_CROP_HEALTH = 'सगळ्या शेती आज व्यवस्थित आहेत';
const FALSE_REASSURANCE_EN = 'All your farms are on track today';
const ERROR_LABEL = 'माहिती आणता आली नाही';
const RETRY_LABEL = 'पुन्हा प्रयत्न करा';

describe('AttentionPage — a never-succeeded sync is not "all your farms are on track" (Task 8)', () => {
    beforeEach(() => {
        triggerNow.mockClear();
        cursorRef.current = undefined;
    });

    afterEach(() => {
        cleanup();
    });

    it('sync has NEVER succeeded: shows the error banner and retry — never the all-clear', async () => {
        cursorRef.current = undefined;

        render(<AttentionPage />);

        await waitFor(() => expect(screen.getByText(ERROR_LABEL)).toBeInTheDocument());
        expect(screen.getByText(RETRY_LABEL)).toBeInTheDocument();
        // The falsehood itself, in both languages it was spoken in.
        expect(screen.queryByText(FALSE_REASSURANCE)).toBeNull();
        expect(screen.queryByText(FALSE_REASSURANCE_EN)).toBeNull();
        expect(screen.queryByText(REJECTED_CROP_HEALTH)).toBeNull();
    });

    it('a sync HAS succeeded and the board is genuinely empty: still shows the true all-clear, no banner', async () => {
        cursorRef.current = { tableName: 'shramsafal', lastSyncAt: '2026-08-28T06:00:00.000Z', version: 1 };

        render(<AttentionPage />);

        await waitFor(() => expect(screen.getByText(FALSE_REASSURANCE)).toBeInTheDocument());
        // spec: plr-d10 (I14, H14) — the page is Marathi only now: the English twin line is gone (no doubled
        // labels). The TRUE all-clear itself is unchanged, which is what this test protects.
        expect(screen.queryByText(FALSE_REASSURANCE_EN)).toBeNull();
        // founder D-1: nothing to act on is NOT "all your farms are fine"
        expect(screen.getByTestId('attention-page').textContent).not.toContain('व्यवस्थित');
        expect(screen.queryByText(ERROR_LABEL)).toBeNull();
        expect(screen.queryByText(RETRY_LABEL)).toBeNull();
    });

    it('the retry re-runs the SYNC, not just a re-read of the same empty table', async () => {
        cursorRef.current = undefined;

        render(<AttentionPage />);

        await waitFor(() => expect(screen.getByText(RETRY_LABEL)).toBeInTheDocument());
        screen.getByText(RETRY_LABEL).click();

        // Re-reading Dexie can only reach the same conclusion; the failure was
        // upstream, so the retry has to go there (Task 6e's rule, applied to
        // the one table nothing but a pull can fill).
        await waitFor(() => expect(triggerNow).toHaveBeenCalled());
    });
});
