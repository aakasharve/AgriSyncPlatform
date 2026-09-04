// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TASK 8 (spec: 2026-08-28-labour-v2-release-1, P4/P5, Ruling R8) — the
 * warnings screen, the same defect as `JobCardsPage.loadFailure.test.tsx`
 * reached through a second door.
 *
 * `complianceClient.getSignals` used to `return []` on ANY non-OK response, so
 * `useComplianceSignals`'s `try/catch` never fired and the screen stated
 * "कोणत्याही चेतावण्या नाहीत" — and, in English underneath, "your farms are on
 * track" — over a fetch that had failed. That is not a missing number; it is a
 * reassurance a farmer can act on, manufactured out of an HTTP error.
 *
 * Transport-level, like its sibling: real client, real hook, real page.
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
    complianceSignals: {
        where: () => ({ equals: () => ({ toArray: async () => [] }) }),
        bulkPut: async () => undefined,
    },
};

import ComplianceSignalsPage from '../ComplianceSignalsPage';

const FALSE_SENTENCE = 'कोणत्याही चेतावण्या नाहीत';
const FALSE_REASSURANCE_EN = 'No signals — your farms are on track';
const ERROR_LABEL = 'माहिती आणता आली नाही';
const RETRY_LABEL = 'पुन्हा प्रयत्न करा';

describe('ComplianceSignalsPage — "could not load" is not "no warnings" (Task 8)', () => {
    beforeEach(() => {
        mockFetch.mockReset();
        vi.stubGlobal('fetch', mockFetch);
    });

    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
    });

    it('server answers 403: shows the error banner and retry — never the "no warnings" reassurance', async () => {
        mockFetch.mockResolvedValue({ ok: false, status: 403, json: async () => [] });

        render(<ComplianceSignalsPage />);

        await waitFor(() => expect(screen.getByText(ERROR_LABEL)).toBeInTheDocument());
        expect(screen.getByText(RETRY_LABEL)).toBeInTheDocument();
        expect(screen.queryByText(FALSE_SENTENCE)).toBeNull();
        expect(screen.queryByText(FALSE_REASSURANCE_EN)).toBeNull();
    });

    it('server answers 200 with an empty list: still shows the true "no warnings" message, no banner', async () => {
        mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => [] });

        render(<ComplianceSignalsPage />);

        await waitFor(() => expect(screen.getByText(FALSE_SENTENCE)).toBeInTheDocument());
        expect(screen.getByText(FALSE_REASSURANCE_EN)).toBeInTheDocument();
        expect(screen.queryByText(ERROR_LABEL)).toBeNull();
        expect(screen.queryByText(RETRY_LABEL)).toBeNull();
    });
});
