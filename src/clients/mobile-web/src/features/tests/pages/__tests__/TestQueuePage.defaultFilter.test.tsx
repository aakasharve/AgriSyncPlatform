// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TASK 15 (Labour V2 R1), founder decision D1 — the same filter-default
 * defect commit `4681eb7a` fixed for `JobCardsPage` / `ComplianceSignalsPage`
 * and explicitly flagged-but-deferred for this screen (see that commit's own
 * message). `TestQueuePage` opened on the "Overdue" filter, so a farm whose
 * tests are all Due (or all Reported, etc.) showed zero rows under it and
 * fell through to
 *
 *     आज कोणत्याही चाचण्या नाहीत  /  No tests pending today
 *
 * even though the farm plainly has tests pending — just not, right now,
 * overdue ones. The founder ruled: default to "All", same treatment as the
 * other two screens. The filter chip itself is untouched — "Overdue" is
 * still one tap away — and the empty-state sentence itself is untouched: it
 * is correct when the list is genuinely empty, which the companion test
 * below proves is still reachable.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

vi.mock('../../../../core/session/FarmContext', () => ({
    useFarmContext: () => ({ currentFarmId: 'farm-1', currentFarm: { farmId: 'farm-1', role: 'Owner' } }),
}));

// `TestQueuePage` statically imports both sheets, and `RecordResultSheet`
// transitively pulls in `CaptureAttachment` -> `AttachmentMutationQueue` ->
// `SyncMutationCatalog` -> the `sync-contract` package, whose own
// `node_modules` was never installed (it has its own `package-lock.json`,
// separate from `mobile-web`'s) — the exact pre-existing, unrelated "zod"
// resolution failure this task's brief calls out as known noise on ~26
// other vitest files. Neither sheet opens on this page without an
// `?action=` URL param or a card tap, and this suite does neither, so
// stubbing both out is a no-op for what is under test here (the default
// filter) and avoids that broken chain entirely.
vi.mock('../../components/MarkCollectedSheet', () => ({ default: () => null }));
vi.mock('../../components/RecordResultSheet', () => ({ default: () => null }));

let dexieRows: Array<Record<string, unknown>> = [];

vi.mock('../../../../infrastructure/storage/DexieDatabase', () => ({
    getDatabase: () => ({
        testInstances: {
            where: () => ({ equals: () => ({ toArray: async () => dexieRows }) }),
            bulkPut: async () => undefined,
        },
        testProtocols: { toArray: async () => [] },
        cropCycles: {
            where: () => ({ equals: () => ({ toArray: async () => [] }) }),
        },
    }),
}));

import TestQueuePage from '../TestQueuePage';

const FALSE_SENTENCE = 'आज कोणत्याही चाचण्या नाहीत';

/** Status 0 = Due (see `domain/tests/TestInstance.ts`'s `TestInstanceStatus`) — deliberately NOT Overdue (3), so the old "Overdue" default hid this row. */
const dueInstance = {
    id: 'ti-1',
    testProtocolId: 'proto-1',
    cropCycleId: 'cycle-1',
    farmId: 'farm-1',
    plotId: 'plot-1',
    stageName: 'Flowering',
    plannedDueDate: '2026-09-01',
    status: 0,
    attachmentIds: [],
    results: [],
    protocolKind: 0,
    modifiedAtUtc: '2026-08-28T00:00:00.000Z',
    createdAtUtc: '2026-08-28T00:00:00.000Z',
};

describe('TestQueuePage — the default filter must not hide real tests behind a false "no tests" claim (Task 15, D1)', () => {
    beforeEach(() => {
        dexieRows = [];
    });

    afterEach(() => {
        cleanup();
    });

    it('one Due test, none overdue: the screen opens showing it, not "no tests"', async () => {
        dexieRows = [dueInstance];

        render(<TestQueuePage />);

        await waitFor(() => expect(screen.getAllByText('Due').length).toBeGreaterThan(0));
        expect(screen.queryByText(FALSE_SENTENCE)).toBeNull();
    });

    it('companion — a farm with genuinely zero tests still sees the true empty state (the sentence itself is correct, unchanged)', async () => {
        dexieRows = [];

        render(<TestQueuePage />);

        await waitFor(() => expect(screen.getByText(FALSE_SENTENCE)).toBeInTheDocument());
    });
});
