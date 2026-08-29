// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TASK 8b — the stale all-clear.
 *
 * `AttentionPage.loadFailure.test.tsx` fixed the case where sync has NEVER
 * succeeded (no cursor at all). It did not fix the case one door over: sync
 * succeeded YESTERDAY, the board was genuinely empty then, and TODAY's pull
 * has failed silently (the cursor is not touched by a failed pull, so
 * `loadFailed` stays false). `cards.length === 0` is still a real answer —
 * just not necessarily a fresh one — and the screen renders
 *
 *     सगळ्या शेती आज व्यवस्थित आहेत  /  All your farms are on track today
 *
 * asserting "today" from data that may be a day old. The fix is not new
 * copy: it is showing the SAME "as of <time>" stamp the non-empty branch
 * already renders, so the sentence reads as true regardless of which day
 * the underlying pull actually landed.
 *
 * WHY THE HOOK ALSO CHANGES, NOT JUST THE PAGE
 * ---------------------------------------------
 * `useAttentionBoard`'s `asOf` was computed ONLY from `computedAtUtc` on the
 * cards themselves (`all.reduce(...)`). With zero cards there is nothing to
 * reduce, so `asOf` was `null` in exactly this branch, always — reusing the
 * page's existing `asOfLabel` element alone would render no stamp at all and
 * leave the bug exactly as it was. The hook now falls back to
 * `syncCursors.lastSyncAt` — the one other timestamp on the device that
 * genuinely answers "when do we know this from" — only when there is no
 * card to derive it from. That is not new information invented for the
 * screen: `lastSyncAt` is the same field `loadFailed` already reads.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { formatDisplayTime } from '../../../../shared/utils/displayTime';

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
    // Genuinely zero cards — this is the SAME shape as "board is genuinely
    // empty" in the sibling test. What differs is only how stale that answer
    // might be, which the cursor timestamp below stands in for.
    attentionCards: { orderBy: () => ({ toArray: async () => [] }) },
    syncCursors: { get: async () => cursorRef.current },
};

import AttentionPage from '../AttentionPage';

const FALSE_REASSURANCE = 'सगळ्या शेती आज व्यवस्थित आहेत';
const YESTERDAY_SYNC_ISO = '2026-08-28T06:00:00.000Z';

describe('AttentionPage — the all-clear says WHEN it is from, even on a stale-but-not-failed board (Task 8b)', () => {
    beforeEach(() => {
        triggerNow.mockClear();
        cursorRef.current = { tableName: 'shramsafal', lastSyncAt: YESTERDAY_SYNC_ISO, version: 1 };
    });

    afterEach(() => {
        cleanup();
    });

    it('board is empty and the last successful sync was not today: the all-clear carries an as-of stamp, not a bare claim', async () => {
        render(<AttentionPage />);

        await waitFor(() => expect(screen.getByText(FALSE_REASSURANCE)).toBeInTheDocument());

        // The exact wording the non-empty branch already uses for this —
        // reused verbatim, not invented for this branch.
        const expectedLabel = formatDisplayTime(YESTERDAY_SYNC_ISO);
        expect(expectedLabel).not.toBe('');
        await waitFor(() => expect(screen.getByText(`as of ${expectedLabel}`)).toBeInTheDocument());
    });
});
