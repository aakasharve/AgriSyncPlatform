// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TASK 8b — the filter default makes a true sentence false.
 *
 * `JobCardsPage` opened on the "Assigned" filter chip. A farm whose ten job
 * cards are ALL still in `Draft` (not yet assigned to anyone) has that filter
 * show zero matching rows, and the screen fell through to
 *
 *     कोणते काम कार्ड नाही  /  No job cards — tap + New to create one
 *
 * over a completely successful load with real records sitting one tap away.
 * The founder ruled the sentence itself stays (no new Marathi) — the only
 * lever left is WHEN it is allowed to show. Defaulting to "All" means the
 * empty state can only ever be reached when `visibleCards` is really empty,
 * which is exactly when the sentence is true.
 *
 * The filter itself is NOT removed — "Assigned" is still one tap away. This
 * file locks the DEFAULT only.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

const mockFetch = vi.fn();

vi.mock('../../../../core/session/FarmContext', () => ({
    useFarmContext: () => ({ currentFarmId: 'farm-1' }),
}));

vi.mock('../../../../infrastructure/storage/AuthTokenStore', () => ({
    getAuthSession: () => ({ accessToken: 'token' }),
}));

vi.mock('../../../../infrastructure/storage/DexieDatabase', () => ({
    getDatabase: () => fakeDb,
}));

const fakeDb = {
    jobCards: {
        where: () => ({ equals: () => ({ toArray: async () => [] }) }),
        bulkPut: async () => undefined,
        put: async () => undefined,
    },
};

import JobCardsPage from '../JobCardsPage';

const FALSE_SENTENCE = 'कोणते काम कार्ड नाही';

const draftCard = {
    id: 'jc-1',
    farmId: 'farm-1',
    plotId: 'plot-1',
    createdByUserId: 'user-1',
    plannedDate: '2026-08-29',
    status: 'Draft',
    lineItems: [],
    estimatedTotalAmount: 500,
    estimatedTotalCurrency: 'INR',
    createdAtUtc: '2026-08-29T04:00:00.000Z',
    modifiedAtUtc: '2026-08-29T04:00:00.000Z',
};

describe('JobCardsPage — the default filter must not hide a real load behind a false empty state (Task 8b)', () => {
    beforeEach(() => {
        mockFetch.mockReset();
        vi.stubGlobal('fetch', mockFetch);
    });

    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
    });

    it('ten cards, all Draft: the screen opens showing them, not "no job cards"', async () => {
        mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => [draftCard] });

        render(<JobCardsPage />);

        // The draft band header only renders when a card is actually visible
        // under the active filter.
        await waitFor(() => expect(screen.getByText('मसुदा')).toBeInTheDocument());
        expect(screen.queryByText(FALSE_SENTENCE)).toBeNull();
    });

    it('companion — a farm with genuinely zero job cards still sees the true empty state', async () => {
        mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => [] });

        render(<JobCardsPage />);

        await waitFor(() => expect(screen.getByText(FALSE_SENTENCE)).toBeInTheDocument());
    });
});
