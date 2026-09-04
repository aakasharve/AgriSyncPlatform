// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TASK 8b — the same filter-default defect as `JobCardsPage`, reached
 * through `useComplianceSignals`'s default filter of "Open".
 *
 * A farm whose signals have ALL been acknowledged (or resolved) has zero
 * rows under the "Open" filter, so the screen fell through to
 *
 *     कोणत्याही चेतावण्या नाहीत  /  No signals — your farms are on track
 *
 * even though the farm plainly has signals — they are just not, right now,
 * unacknowledged ones. Same fix as `JobCardsPage`: default to "All" so the
 * empty state is only reachable when it is genuinely true. The filter chip
 * itself is untouched — "Open" is still one tap away.
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

const acknowledgedSignal = {
    id: 'sig-1',
    farmId: 'farm-1',
    plotId: 'plot-1',
    severity: 'NeedsAttention',
    isOpen: false,
    acknowledgedAtUtc: '2026-08-28T04:00:00.000Z',
    resolvedAtUtc: undefined,
    createdAtUtc: '2026-08-27T04:00:00.000Z',
};

describe('ComplianceSignalsPage — the default filter must not hide real signals behind a false "no warnings" claim (Task 8b)', () => {
    beforeEach(() => {
        mockFetch.mockReset();
        vi.stubGlobal('fetch', mockFetch);
    });

    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
    });

    it('one signal, already acknowledged: the screen opens showing it, not "no signals"', async () => {
        mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => [acknowledgedSignal] });

        render(<ComplianceSignalsPage />);

        // "Needs Attention" labels both the band header and the signal's own
        // severity pill, so both copies existing is itself proof the band
        // rendered with the signal inside it.
        await waitFor(() => expect(screen.getAllByText('Needs Attention').length).toBeGreaterThan(0));
        expect(screen.queryByText(FALSE_SENTENCE)).toBeNull();
    });

    it('companion — a farm with genuinely zero signals still sees the true empty state', async () => {
        mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => [] });

        render(<ComplianceSignalsPage />);

        await waitFor(() => expect(screen.getByText(FALSE_SENTENCE)).toBeInTheDocument());
    });
});
