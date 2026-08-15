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
import { SYNC_HONESTY_I18N_KEYS } from '../../../sync/status/syncHonestyState';
import type { DailyLog } from '../../../../domain/types/log.types';

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

/** Minimal, real `DailyLog` fixture — same shape `oversightSelectors.test.ts`
 * builds by hand, not fetched from storage. */
function makeLog(overrides: Partial<DailyLog> & { id: string }): DailyLog {
    return {
        id: overrides.id,
        date: overrides.date ?? '2026-08-14',
        context: overrides.context ?? {
            selection: [
                {
                    cropId: 'crop-1',
                    cropName: 'Grapes',
                    selectedPlotIds: ['plot-1'],
                    selectedPlotNames: ['Grapes A'],
                },
            ],
        },
        dayOutcome: overrides.dayOutcome ?? 'WORK_RECORDED',
        cropActivities: overrides.cropActivities ?? [],
        irrigation: overrides.irrigation ?? [],
        labour: overrides.labour ?? [],
        inputs: overrides.inputs ?? [],
        machinery: overrides.machinery ?? [],
        observations: overrides.observations,
        meta: overrides.meta,
        financialSummary: overrides.financialSummary ?? {
            totalLabourCost: 0,
            totalInputCost: 0,
            totalMachineryCost: 0,
            grandTotal: 0,
        },
    };
}

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

        // Ruling 12 fix-round: the retired `AppHeader.claim.test.tsx` also
        // asserted none of the three sync-honesty labels "leak in by another
        // route" (its own wording). Restated here, at the AppHeader level —
        // not just structurally (SyncIndicator is never imported by this
        // file any more) but by an explicit DOM-negative assertion, so a
        // future regression that re-adds ANY SyncIndicator render here would
        // fail a NAMED test, not just a code review.
        for (const key of Object.values(SYNC_HONESTY_I18N_KEYS)) {
            expect(screen.queryByText(translate(key, 'mr'))).not.toBeInTheDocument();
        }
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
        // Ruling 12 fix-round: BOTH terms set (not just `failedCount`),
        // exactly like the retired `AppHeader.claim.test.tsx`'s "the chip
        // carries the number it is standing beside" — restores that test's
        // arithmetic proof (`failedCount + failedUploads`, not just one of
        // the two summands) at its new destination, the waiting row.
        queueRef.current = {
            ...queueRef.current,
            failedCount: 2,
            failedUploads: 1,
        };

        await act(async () => {
            renderHeader();
        });

        // 1. Open the waiting drawer via the strip.
        fireEvent.click(screen.getByTestId('canonical-strip-waiting-button'));
        expect(screen.getByTestId('waiting-drawer-sheet')).toBeInTheDocument();

        const failedSendRow = screen.getByTestId('waiting-drawer-decision-failedSend');
        // The row carries the REAL sum from `useSyncQueueStatus`
        // (2 + 1 = 3), not a literal and not just one of the two terms.
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

describe('AppHeader — real oversight data populates a non-empty briefing (Ruling 12)', () => {
    it('the_header_receives_real_oversight_data_and_the_drawer_shows_a_non_empty_briefing', async () => {
        // Two real logs from a NAMED operator, on two named plots — exactly
        // the shape `app/helpers/appContentOversightInputs.ts` produces from
        // `AppContent.tsx`'s real `data.history`/`data.crops`/
        // `data.farmerProfile.operators`. Nothing here is a literal echoed by
        // the component — every assertion below reads a number/name back off
        // THIS fixture.
        const logs: DailyLog[] = [
            makeLog({
                id: 'log-1',
                date: '2026-08-14',
                meta: { createdAtISO: '2026-08-14T09:00:00.000Z', createdByOperatorId: 'op-rokade' },
                context: {
                    selection: [{
                        cropId: 'crop-1', cropName: 'Grapes',
                        selectedPlotIds: ['plot-1'], selectedPlotNames: ['Grapes A'],
                    }],
                },
            }),
            makeLog({
                id: 'log-2',
                date: '2026-08-14',
                meta: { createdAtISO: '2026-08-14T15:00:00.000Z', createdByOperatorId: 'op-rokade' },
                context: {
                    selection: [{
                        cropId: 'crop-2', cropName: 'Sugarcane',
                        selectedPlotIds: ['plot-2'], selectedPlotNames: ['Sugarcane B'],
                    }],
                },
            }),
        ];

        await act(async () => {
            renderHeader({
                oversightData: {
                    logs,
                    operatorNameById: { 'op-rokade': 'Rokade' },
                    plotCount: 4,
                    unverifiedCount: 0,
                    yesterdayNotClosed: false,
                    approvalHolderName: null,
                },
            });
        });

        // 1. The farm chip's plot count is the REAL one, not the honest-zero
        // fallback (proves the prop actually reached CanonicalStrip).
        expect(screen.getByTestId('canonical-strip-farm-chip')).toHaveTextContent('4');

        // 2. The waiting count reflects one real PERSON (no decisions were
        // supplied), and opening the drawer proves the briefing itself —
        // not just that a prop was passed — is populated.
        expect(screen.getByTestId('canonical-strip-waiting-count')).toHaveTextContent('1');
        fireEvent.click(screen.getByTestId('canonical-strip-waiting-button'));

        expect(screen.getByTestId('waiting-drawer-tally-people')).toHaveTextContent('1');
        expect(screen.getByTestId('waiting-drawer-tally-records')).toHaveTextContent('2');
        expect(screen.getByTestId('waiting-drawer-tally-plots')).toHaveTextContent('2');

        // 3. The named person row itself — real name, real per-person tally
        // (`recordCount · plotNames.length`), not a zero/empty placeholder.
        const personRow = screen.getByTestId('waiting-drawer-person-row-op-rokade');
        expect(personRow).toHaveTextContent('Rokade');
        expect(personRow).toHaveTextContent('2');

        // 4. No unattributed row — every log in this fixture named its creator.
        expect(screen.queryByTestId('waiting-drawer-unattributed-row')).not.toBeInTheDocument();
    });

    it('omitting oversightData falls back to the same honest zeros/empties as before', async () => {
        // Control case: proves the fallback path (every OTHER test in this
        // file omits `oversightData`) still yields an honest empty briefing —
        // no leftover "4" plot count, no phantom person row — never a stale
        // echo of the fixture above.
        await act(async () => {
            renderHeader();
        });

        expect(screen.getByTestId('canonical-strip-farm-chip')).not.toHaveTextContent('4');
        expect(screen.getByTestId('canonical-strip-waiting-rest-tick')).toBeInTheDocument();
        expect(screen.queryByTestId('canonical-strip-waiting-count')).not.toBeInTheDocument();
    });
});
