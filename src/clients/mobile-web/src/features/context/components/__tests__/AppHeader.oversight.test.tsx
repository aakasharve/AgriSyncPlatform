// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop
 *
 * Task 6 — pins AppHeader's wiring of the Owner Oversight Loop strip (design
 * doc §2/§4.1, task-6 brief). Three named tests:
 *
 *   the_header_renders_the_canonical_strip_on_every_route — spec DoD #1:
 *   "The strip renders identically on Log, Reflect and Compare, and does not
 *   move between them." AppHeader renders on every route by construction, so
 *   this proves the strip's presence does not vary with `currentRoute` /
 *   `currentView` (only with whether `farmContext` is supplied at all, which
 *   was already true of the strip it replaces).
 *
 *   the_header_no_longer_renders_the_sync_indicator — spec §4.1: the chip is
 *   DELETED from the header, even when the underlying evidence
 *   (`useSyncQueueStatus`) is exactly the shape that used to turn it amber
 *   ("NEEDS_FIX"). Proves the deletion holds under the one condition that
 *   used to make the chip most visible, not just when there is nothing to
 *   show.
 *
 *   the_failed_send_row_can_still_open_the_sync_status_drawer — Ruling 4
 *   (plan ledger): removing the chip orphans AppHeader's only opener of
 *   `SyncStatusDrawer`, so the waiting drawer's `failedSend` decision row is
 *   wired to open it instead. `SyncStatusDrawer` itself is stubbed (its own
 *   suite already covers its internals) so this test asserts ONLY the hop:
 *   tapping the row opens the real drawer instance AppHeader owns.
 *
 * MOCKING STRATEGY
 * -----------------
 * `useLanguage` and `PageToggle` are mocked the same way the retired
 * `AppHeader.claim.test.tsx` mocked them (this file's direct replacement —
 * see that file's deletion in this task's report). `../../sync` is mocked to
 * control `useSyncQueueStatus`'s return value per test and to stub
 * `SyncStatusDrawer` down to an `isOpen`-reflecting marker, so this suite
 * asserts the WIRING (which callback opens what), not `SyncStatusDrawer`'s
 * own internals (covered by `SyncStatusDrawer.test.tsx`).
 *
 * Nothing else is mocked: `CanonicalStrip`, `WaitingDrawer`,
 * `oversightSelectors`, `useOversightAcknowledgement` and
 * `LocalOversightAcknowledgementStore` all run for real — the same pattern
 * `oversightAcknowledgement.test.tsx` already establishes for the local
 * adapter (plain jsdom `localStorage`, no further setup needed).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import React from 'react';

import { t as translate, type Language } from '../../../../i18n/translations';
import type { SyncQueueStatus } from '../../../sync/hooks/useSyncQueueStatus';

const queueRef: { current: SyncQueueStatus } = {
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

vi.mock('../../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({
        language: 'mr' as Language,
        setLanguage: () => { },
        t: (key: string) => translate(key, 'mr'),
    }),
}));

vi.mock('../../../../shared/components/ui/PageToggle', () => ({
    default: () => <div data-testid="page-toggle" />,
}));

// The barrel AppHeader imports from — `useSyncQueueStatus` is driven per
// test via `queueRef`; `SyncStatusDrawer` is a thin `isOpen`-reflecting stub
// so this suite proves the HOP (which button opens it), not its own
// internals (already covered by `SyncStatusDrawer.test.tsx`).
vi.mock('../../../sync', () => ({
    useSyncQueueStatus: () => queueRef.current,
    SyncStatusDrawer: ({ isOpen }: { isOpen: boolean }) =>
        isOpen ? <div data-testid="sync-status-drawer-stub" /> : null,
}));

import AppHeader from '../AppHeader';

const farmContext = {
    farms: [
        { farmId: 'farm-1', name: 'Arve Farm', role: 'PrimaryOwner', farmCode: 'ABC123', subscription: null },
    ],
    currentFarmId: 'farm-1',
    onSwitchFarm: vi.fn(),
    onCreateFarm: vi.fn(),
    onJoinViaQr: vi.fn(),
};

function renderHeader(overrides: Partial<React.ComponentProps<typeof AppHeader>> = {}) {
    return render(
        <AppHeader
            currentRoute="main"
            currentView="log"
            onNavigate={vi.fn()}
            onViewChange={vi.fn()}
            farmContext={farmContext}
            {...overrides}
        />,
    );
}

beforeEach(() => {
    localStorage.clear();
});

afterEach(() => {
    cleanup();
    localStorage.clear();
    queueRef.current = {
        pendingCount: 0,
        failedCount: 0,
        stuckMutations: [],
        syncedCount: 0,
        pendingUploads: 0,
        failedUploads: 0,
        pendingAiJobs: 0,
        isOnline: true,
        lastSyncAt: null,
    };
});

describe('AppHeader — the canonical strip renders on every route', () => {
    it.each([
        ['main', 'log'],
        ['main', 'reflect'],
        ['main', 'compare'],
        ['attention', 'log'],
    ] as const)('the_header_renders_the_canonical_strip_on_every_route (%s / %s)', async (route, view) => {
        await act(async () => {
            renderHeader({ currentRoute: route, currentView: view });
        });

        expect(screen.getByTestId('canonical-strip-farm-chip')).toBeInTheDocument();
        expect(screen.getByTestId('canonical-strip-waiting-button')).toBeInTheDocument();
        // The farm chip carries the real farm name from `farmContext` — proves
        // the strip is reading real data, not a static shell.
        expect(screen.getByTestId('canonical-strip-farm-chip')).toHaveTextContent('Arve Farm');
    });
});

describe('AppHeader — the sync chip is gone', () => {
    it('the_header_no_longer_renders_the_sync_indicator', async () => {
        // Exactly the evidence shape that used to turn the old chip amber
        // ("NEEDS_FIX"): a stuck mutation AND a failed upload.
        queueRef.current = {
            ...queueRef.current,
            failedCount: 2,
            failedUploads: 1,
        };

        await act(async () => {
            renderHeader();
        });

        expect(screen.queryByTestId('sync-status-indicator')).not.toBeInTheDocument();
        // The strip itself survives, and the SAME evidence now reaches the
        // waiting button instead — one waiting KIND (failedSend), never a
        // fabricated literal.
        expect(screen.getByTestId('canonical-strip-waiting-button')).toBeInTheDocument();
        expect(screen.getByTestId('canonical-strip-waiting-count')).toHaveTextContent('1');
    });

    it('renders no sync chip even when nothing is outstanding', async () => {
        await act(async () => {
            renderHeader();
        });

        expect(screen.queryByTestId('sync-status-indicator')).not.toBeInTheDocument();
        expect(screen.getByTestId('canonical-strip-waiting-rest-tick')).toBeInTheDocument();
    });
});

describe('AppHeader — NEEDS_FIX still reaches the farmer (Ruling 4)', () => {
    it('the_failed_send_row_can_still_open_the_sync_status_drawer', async () => {
        queueRef.current = {
            ...queueRef.current,
            failedCount: 3,
        };

        await act(async () => {
            renderHeader();
        });

        // 1. Open the waiting drawer via the strip.
        fireEvent.click(screen.getByTestId('canonical-strip-waiting-button'));
        expect(screen.getByTestId('waiting-drawer-sheet')).toBeInTheDocument();

        const failedSendRow = screen.getByTestId('waiting-drawer-decision-failedSend');
        // The row carries the REAL count from `useSyncQueueStatus`, not a
        // literal — same evidence, same number, all the way through.
        expect(failedSendRow).toHaveTextContent('3');
        expect(screen.queryByTestId('sync-status-drawer-stub')).not.toBeInTheDocument();

        // 2. Tap it — Ruling 4's wiring.
        fireEvent.click(failedSendRow);

        // 3. `SyncStatusDrawer` opens...
        expect(screen.getByTestId('sync-status-drawer-stub')).toBeInTheDocument();
        // ...and the waiting sheet gets out of its way, or the farmer lands
        // on the retry surface behind a black overlay (same rule the
        // existing `onOpenConflicts` comment already states for this drawer).
        expect(screen.queryByTestId('waiting-drawer-sheet')).not.toBeInTheDocument();
    });
});
