// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TASK 8 (spec: 2026-08-28-labour-v2-release-1, P4/P5, Ruling R8) — the job
 * cards screen told a farmer he had no job cards when it had merely failed to
 * load them.
 *
 * WHY THIS TEST DRIVES `fetch`, NOT THE HOOK
 * ------------------------------------------
 * The falsehood is manufactured one layer BELOW the hook.
 * `jobCardsClient.getFarmJobCards` used to `return []` on ANY non-OK response,
 * so a 401/403/500 never reached `useJobCards`'s `try/catch` at all: the hook
 * saw a resolved promise carrying an empty array and reported it as the
 * server's answer. A test that mocked the hook would have passed over a fix
 * that changed nothing a farmer can see. So this file mocks the transport
 * (`fetch`) and Dexie, and runs the REAL client, the REAL hook and the REAL
 * page — the whole chain the lie travelled down:
 *
 *     500 from /farms/:id/job-cards -> client throws -> useJobCards.loadFailed
 *                                   -> JobCardsPage withholds the claim,
 *                                      shows the existing banner + retry.
 *
 * The second test is the anti-over-reach lock and matters as much as the
 * first: a farm that genuinely HAS no job cards gets a real answer from the
 * server, and "कोणते काम कार्ड नाही" is TRUE there. The suppression is keyed
 * on the fetch having FAILED, never on "the list looks empty" — getting that
 * backwards would replace one lie with a different one.
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

// Dexie stands in for the on-device cache. EMPTY on purpose: a fresh install
// under weak rural signal is the pilot's normal condition, and it is exactly
// the state in which a failed fetch used to read as "you have none".
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
const ERROR_LABEL = 'माहिती आणता आली नाही';
const RETRY_LABEL = 'पुन्हा प्रयत्न करा';

describe('JobCardsPage — "could not load" is not "you have no job cards" (Task 8)', () => {
    beforeEach(() => {
        mockFetch.mockReset();
        vi.stubGlobal('fetch', mockFetch);
    });

    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
    });

    it('server answers 500: shows the error banner and retry — never the "no job cards" sentence', async () => {
        mockFetch.mockResolvedValue({ ok: false, status: 500, json: async () => [] });

        render(<JobCardsPage />);

        await waitFor(() => expect(screen.getByText(ERROR_LABEL)).toBeInTheDocument());
        expect(screen.getByText(RETRY_LABEL)).toBeInTheDocument();
        // The falsehood itself.
        expect(screen.queryByText(FALSE_SENTENCE)).toBeNull();
    });

    it('server answers 200 with an empty list: still shows the true "no job cards" message, no banner', async () => {
        mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => [] });

        render(<JobCardsPage />);

        await waitFor(() => expect(screen.getByText(FALSE_SENTENCE)).toBeInTheDocument());
        expect(screen.queryByText(ERROR_LABEL)).toBeNull();
        expect(screen.queryByText(RETRY_LABEL)).toBeNull();
    });
});
