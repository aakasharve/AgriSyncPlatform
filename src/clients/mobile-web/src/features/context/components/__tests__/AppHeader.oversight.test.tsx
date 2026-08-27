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
import type { DetailedWeather } from '../../../../types';
import { oversightTranslations } from '../../../../i18n/oversightTranslations';
// Findings F2/F3 — the two cross-tree hops the drawer's rows and the
// "Close Day" affordances depend on. See that module's header.
import {
    OPEN_REVIEW_INBOX_EVENT,
    requestOpenWaitingDrawer,
} from '../../../oversight/oversightNavigationEvents';
import type { OversightDecision } from '../../../oversight/oversightSelectors';

type OversightDecisionKind = OversightDecision['kind'];

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
        // Finding F7(a) — the DEFAULT for this suite is a queue that has
        // already been read, so the tests below exercise the resolved
        // states. `the_rest_state_never_renders_before_the_data_behind_it_
        // resolves` flips this to `false` deliberately.
        hasLoaded: true,
    },
};

/** Finding F6 — this session's dropped-record count, per test. */
const unqueueableRef = { current: 0 };

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
    // Finding F6 — the count of records that reached NO sync queue. It is
    // NOT part of `SyncQueueStatus` (that type is a snapshot of Dexie, and
    // these records leave no Dexie row at all — see
    // `features/sync/status/unqueueableLogs.ts`), so it is driven by its own
    // ref exactly as production drives it from its own registry.
    useUnqueueableLogCount: () => unqueueableRef.current,
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
        hasLoaded: true,
    };
    unqueueableRef.current = 0;
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
        // the strip is reading real data, not a static shell. Task 12: this
        // fixture is single-farm, so the element is a LABEL and the name is
        // real visible text again (CanonicalStrip.tsx's own header comment).
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
        // Finding F7(a) — "nothing is outstanding" is now a RESOLVED state,
        // not merely an unsupplied one, so this test supplies the evidence
        // for the claim it asserts: a read queue (`hasLoaded`, the suite
        // default) plus hydrated, genuinely empty oversight data. That is
        // what makes the rest tick below correct rather than premature.
        await act(async () => {
            renderHeader({
                oversightData: {
                    logs: [],
                    operatorNameById: {},
                    plotCount: 4,
                    unverifiedCount: 0,
                    yesterdayNotClosed: false,
                    approvalHolderName: null,
                    dataLoaded: true,
                },
            });
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
                    dataLoaded: true,
                },
            });
        });

        // 1. The farm chip's plot count is the REAL one, not the honest-zero
        // fallback (proves the prop actually reached `FarmIdentityElement`).
        // Task 12: real visible text again (single-farm fixture -> label).
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

    it('a_farm_whose_records_have_no_creator_never_shows_the_rest_state', async () => {
        // Finding F8, end to end. Every write site of
        // `meta.createdByOperatorId` copies an OPTIONAL value
        // (`profile.activeOperatorId`, `domain/types/farm.types.ts:325`), so
        // this fixture — two real, plotted logs with no captured creator —
        // is a shape production genuinely produces. Before F8 it rendered
        // the green tick and "आज पर्यन्त सर्व कामे पूर्ण आहेत" over records
        // the owner had never seen, with no badge to make him open the
        // drawer that was already holding the अज्ञात row.
        const logs: DailyLog[] = [
            makeLog({
                id: 'log-anon-1',
                meta: { createdAtISO: '2026-08-14T09:00:00.000Z' },
                context: {
                    selection: [{
                        cropId: 'crop-1', cropName: 'Grapes',
                        selectedPlotIds: ['plot-1'], selectedPlotNames: ['Grapes A'],
                    }],
                },
            }),
            makeLog({
                id: 'log-anon-2',
                meta: { createdAtISO: '2026-08-14T15:00:00.000Z' },
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
                    operatorNameById: {},
                    plotCount: 4,
                    unverifiedCount: 0,
                    yesterdayNotClosed: false,
                    approvalHolderName: null,
                    dataLoaded: true,
                },
            });
        });

        // 1. NO rest state — no green tick, no "all work complete" claim.
        expect(screen.queryByTestId('canonical-strip-waiting-rest-tick')).not.toBeInTheDocument();
        expect(screen.queryByText(oversightTranslations.mr.restState)).not.toBeInTheDocument();

        // 2. A real badge instead: the one अज्ञात row this fixture produces.
        expect(screen.getByTestId('canonical-strip-waiting-count')).toHaveTextContent('1');

        // 3. Opening the drawer proves the count is standing for something
        //    real — the unattributed row, holding both records, with the
        //    people tally still honestly 0 (spec §P-F: "records with no
        //    person" is not a person, and F8 does not change that).
        fireEvent.click(screen.getByTestId('canonical-strip-waiting-button'));
        const unattributedRow = screen.getByTestId('waiting-drawer-unattributed-row');
        expect(unattributedRow).toHaveTextContent(oversightTranslations.mr.unknown);
        expect(unattributedRow).toHaveTextContent('2');
        expect(screen.getByTestId('waiting-drawer-tally-people')).toHaveTextContent('0');
        expect(screen.getByTestId('waiting-drawer-tally-records')).toHaveTextContent('2');
    });

    it('omitting oversightData falls back to the same honest zeros/empties as before', async () => {
        // Control case: proves the fallback path (every OTHER test in this
        // file omits `oversightData`) still yields an honest empty briefing —
        // no leftover "4" plot count, no phantom person row — never a stale
        // echo of the fixture above.
        await act(async () => {
            renderHeader();
        });

        // TRIPWIRE, not a deletion. This assertion used to require the chip to
        // render the fallback "0" and called it "the honest-zero fallback". A
        // zero that is RENDERED is not honest — read by a farmer it says his
        // farm has no plots, when in fact nothing has been read yet.
        //
        // WHAT IT CLAIMED: "० प्लॉट" under the farm name.
        // WHY THE DATA CANNOT BACK IT: `AppHeader.tsx` computes
        // `oversightData?.plotCount ?? 0`, and this very test is the case
        // where `oversightData` was never supplied — the 0 is "not read",
        // not "none". Doctrine P4. Truth audit, question 3.
        //
        // Both numbers are pinned absent: `0` (the fabricated fallback) and
        // `4` (a stale echo of the fixture in the test above).
        const chip = screen.getByTestId('canonical-strip-farm-chip');
        expect(chip).toHaveTextContent('Arve Farm');
        expect(chip).not.toHaveTextContent('0');
        expect(chip).not.toHaveTextContent('4');
        expect(chip.textContent).not.toContain(oversightTranslations.mr.plotsUnit);
        expect(screen.queryByTestId('canonical-strip-waiting-count')).not.toBeInTheDocument();

        // Finding F7(a) — the honest fallback for "no data was supplied at
        // all" is the CHECKING state, not the rest state. A caller that
        // handed this header nothing has certainly not proven that all work
        // is complete, so the green tick and the founder's completion
        // sentence must both stay away.
        expect(screen.getByTestId('canonical-strip-waiting-checking-icon')).toBeInTheDocument();
        expect(screen.queryByTestId('canonical-strip-waiting-rest-tick')).not.toBeInTheDocument();
        expect(screen.queryByText(oversightTranslations.mr.restState)).not.toBeInTheDocument();
    });

    it('the_rest_state_never_renders_before_the_data_behind_it_resolves', async () => {
        // Finding F7(a), the first-load window, reproduced exactly:
        // `useSyncQueueStatus` starts at `EMPTY_STATUS` (`hasLoaded: false`)
        // and `useAppData` starts with empty arrays (`dataLoaded: false`).
        // Every count reads 0, so `waitingCount` reads 0 — and 0 used to
        // mean the green tick plus "आज पर्यन्त सर्व कामे पूर्ण आहेत" over
        // data nobody had read.
        //
        // Each half is flipped independently below, so neither can carry
        // the test on its own.
        const unresolvedCases: Array<[string, boolean, boolean]> = [
            ['neither source read', false, false],
            ['queue read, app data not', true, false],
            ['app data read, queue not', false, true],
        ];

        for (const [label, queueLoaded, appDataLoaded] of unresolvedCases) {
            queueRef.current = { ...queueRef.current, hasLoaded: queueLoaded };

            await act(async () => {
                renderHeader({
                    oversightData: {
                        logs: [],
                        operatorNameById: {},
                        plotCount: 4,
                        unverifiedCount: 0,
                        yesterdayNotClosed: false,
                        approvalHolderName: null,
                        dataLoaded: appDataLoaded,
                    },
                });
            });

            expect(screen.queryByTestId('canonical-strip-waiting-rest-tick'), label).not.toBeInTheDocument();
            expect(screen.queryByText(oversightTranslations.mr.restState), label).not.toBeInTheDocument();
            // The strip keeps its place and its size — the layout never
            // reshuffles when the data lands (spec §2.2).
            const button = screen.getByTestId('canonical-strip-waiting-button');
            expect(button, label).toBeInTheDocument();
            expect(button, label).toHaveStyle({ minHeight: '52px' });

            cleanup();
        }

        // Control: BOTH resolved, same otherwise-identical fixture -> the
        // claim becomes legitimate and the rest state appears. Without this
        // the assertions above would pass against a strip that had simply
        // lost its rest state altogether.
        queueRef.current = { ...queueRef.current, hasLoaded: true };
        await act(async () => {
            renderHeader({
                oversightData: {
                    logs: [],
                    operatorNameById: {},
                    plotCount: 4,
                    unverifiedCount: 0,
                    yesterdayNotClosed: false,
                    approvalHolderName: null,
                    dataLoaded: true,
                },
            });
        });

        expect(screen.getByTestId('canonical-strip-waiting-rest-tick')).toBeInTheDocument();
        expect(screen.getByText(oversightTranslations.mr.restState)).toBeInTheDocument();
    });
});

describe('AppHeader — the waiting drawer backdrop is not trapped by the sticky header (task-11 portal fix)', () => {
    it('the_backdrop_renders_outside_the_sticky_header_via_a_portal', async () => {
        // Diagnosed defect (task-10 report, confirmed by computed-style
        // inspection in a real browser): `<header className="sticky ...">`
        // is a `position: sticky` ancestor, which creates a containing
        // block that traps `position: fixed` descendants — so the waiting
        // drawer's dark backdrop used to cover only the ~139px sticky
        // header box instead of the full viewport. The fix is
        // `createPortal(..., document.body)`, the same pattern
        // `FarmContextSwitcher.tsx`'s `FarmSwitcherSheet` already uses.
        //
        // jsdom does not compute layout, so this proves the STRUCTURAL fix
        // (the overlay is no longer a DOM descendant of `<header>` at all,
        // which is the actual cause of the trap) rather than a computed
        // style — the right level for jsdom. The task-11 report's own
        // browser measurement is what proves the VISUAL result.
        await act(async () => {
            renderHeader();
        });

        fireEvent.click(screen.getByTestId('canonical-strip-waiting-button'));
        const sheet = screen.getByTestId('waiting-drawer-sheet');
        const header = document.querySelector('header');

        expect(header).not.toBeNull();
        expect(header!.contains(sheet)).toBe(false);
        expect(document.body.contains(sheet)).toBe(true);
    });
});

describe('AppHeader — row 1 (task-11 founder restructure)', () => {
    const sampleWeather = {
        locationName: 'Arve Farm',
        current: {
            fetchedAt: '', lat: 20, lon: 73, provider: 'tomorrow.io',
            current: { tempC: 28, humidity: 50, windKph: 5, precipMm: 0, conditionText: 'Partly Cloudy', iconCode: '1000' },
            forecast: { rainProb: 0 },
        },
        forecast: [],
        history: [],
        advisory: { title: 'x', content: 'y' },
    } as unknown as DetailedWeather;

    it('the_weather_chip_renders_in_row_1_and_reads_real_data_from_the_weather_prop', async () => {
        await act(async () => {
            renderHeader({
                weather: {
                    data: sampleWeather,
                    status: 'ready',
                    boundaryUnset: false,
                    onRetry: vi.fn(),
                },
            });
        });

        // The compact trigger reads the SAME real tempC the full-size chip
        // would — rounded for the compact display, never a fabricated
        // number (spec §P-F: derived from the data shown).
        const chip = screen.getByTestId('compact-weather-chip');
        expect(chip).toHaveTextContent('28°');
    });

    it('the_weather_chip_renders_even_when_the_weather_prop_is_omitted_entirely', async () => {
        // Honest "no data yet" state — never a fabricated reading (spec
        // §P-F). Row 1 always carries the trigger; it just has nothing to
        // show yet.
        await act(async () => {
            renderHeader();
        });

        expect(screen.getByTestId('compact-weather-chip')).toBeInTheDocument();
    });

    it('the_farm_chip_and_the_avatar_share_row_1_ahead_of_the_row_2_waiting_strip', async () => {
        // Structural proof of the founder's locked layout: the farm chip is
        // a DOM ancestor-sibling of the profile button (both inside the
        // header's first content row), and that whole row appears BEFORE
        // the waiting button's row-2 wrapper in document order.
        await act(async () => {
            renderHeader();
        });

        const header = document.querySelector('header');
        expect(header).not.toBeNull();

        const farmChip = screen.getByTestId('canonical-strip-farm-chip');
        const waitingButton = screen.getByTestId('canonical-strip-waiting-button');

        // DOCUMENT_POSITION_FOLLOWING (4) means `waitingButton` comes AFTER
        // `farmChip` in the tree — i.e. row 1's farm chip precedes row 2's
        // waiting strip, never the reverse.
        const position = farmChip.compareDocumentPosition(waitingButton);
        expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('the_avatar_name_label_is_no_longer_squeezed_to_9px_and_60px (Task 14, change 6)', async () => {
        // Founder: "while enhancing the page selector you compromised the
        // weather and profile navigation buttons." Measured cause: the
        // name label under the avatar was `text-[9px]` truncated at
        // `max-w-[60px]` — sized for when row 1 also fought Task 13's
        // centre toggle for space. That toggle has since moved to its own
        // row (`OversightNavCards`, below row 1), freeing the room back.
        await act(async () => {
            renderHeader({
                activeOperator: {
                    id: 'op-1',
                    name: 'Rokade',
                    role: 'PRIMARY_OWNER',
                    capabilities: [],
                    isVerifier: false,
                },
            });
        });

        const nameLabel = screen.getByText('Rokade');
        expect(nameLabel.className).not.toContain('text-[9px]');
        expect(nameLabel.className).not.toContain('max-w-[60px]');
    });

    it('the_owner_chip_no_longer_collides_with_the_weather_chip_because_it_is_gone', async () => {
        // CHANGE 4. MEASURED, Marathi, deviceScaleFactor 2, on the routes
        // that rendered BOTH (any route outside `PAGE_TOGGLE_ROUTES`;
        // `attention` is the farmer-facing one, reachable from the bottom
        // nav): the owner chip ran 63.5px under the weather chip at 390px,
        // 87.5px at 360px and 99.3px at 320px, and overran the viewport's
        // right edge at the two narrower widths. Pre-existing, and this
        // file's own comment admitted it without fixing it.
        //
        // The chip is what gives because it is the only element in row 1
        // carrying no fact the row does not already carry: the SAME
        // `activeOperator.name.split(' ')[0]` that the profile avatar
        // renders under itself at the far left of the same row, under the
        // same condition. Spec §4.2 ruled on exactly this duplication when
        // it removed the home screen's copy — "redundant, the header
        // already shows the owner". The lockup is founder-approved at
        // 120x36; the weather chip carries a real temperature.
        //
        // jsdom does no layout, so the clearances are in the task report.
        // What IS assertable here is the cause: the duplicate element is
        // absent, and the name it duplicated is still on screen exactly
        // once.
        await act(async () => {
            renderHeader({
                currentRoute: 'attention',
                activeOperator: {
                    id: 'op-1',
                    name: 'Rokade Patil',
                    role: 'PRIMARY_OWNER',
                    capabilities: [],
                    isVerifier: false,
                },
            });
        });

        // The chip's own untranslated English word — the only piece of
        // English row 1 put in front of a Marathi-reading farmer.
        expect(screen.queryByText('Owner')).not.toBeInTheDocument();
        // The name survives, once: under the avatar, where it always was.
        expect(screen.getAllByText('Rokade')).toHaveLength(1);
        // And the two elements it used to sit between are both still here.
        expect(screen.getByAltText('Shram Safal')).toBeInTheDocument();
        expect(screen.getByTestId('compact-weather-chip')).toBeInTheDocument();
    });
});

describe('AppHeader — the farm element is contextual on the real farm list (Task 12)', () => {
    // spec: owner-oversight-loop (Task 12, `G:\VALIDATION\
    // farm-selector-contextual.html`) — "the control appears only if there
    // is a choice." `farmCount` is derived by AppHeader itself from
    // `farmContext.farms.length`, never a literal — these two fixtures are
    // real farm lists of different sizes, not a prop forced directly on
    // `FarmIdentityElement`.
    const singleFarmContext = {
        farms: [
            { farmId: 'farm-1', name: 'Arve Farm', role: 'PrimaryOwner', farmCode: 'ABC123', subscription: null },
        ],
        currentFarmId: 'farm-1',
        onSwitchFarm: vi.fn(),
        onCreateFarm: vi.fn(),
        onJoinViaQr: vi.fn(),
    };

    const multiFarmContext = {
        farms: [
            { farmId: 'farm-1', name: 'Arve Farm', role: 'PrimaryOwner', farmCode: 'ABC123', subscription: null },
            { farmId: 'farm-2', name: 'Bhosale Vasti', role: 'PrimaryOwner', farmCode: 'DEF456', subscription: null },
            { farmId: 'farm-3', name: 'Kadam Mala', role: 'SecondaryOwner', farmCode: 'GHI789', subscription: null },
        ],
        currentFarmId: 'farm-1',
        onSwitchFarm: vi.fn(),
        onCreateFarm: vi.fn(),
        onJoinViaQr: vi.fn(),
    };

    it('a_single_farm_account_renders_no_farm_switcher_control', async () => {
        await act(async () => {
            renderHeader({ farmContext: singleFarmContext });
        });

        const el = screen.getByTestId('canonical-strip-farm-chip');
        expect(el.tagName).not.toBe('BUTTON');
        expect(screen.queryByTestId('canonical-strip-farm-count-badge')).not.toBeInTheDocument();
        expect(el).not.toHaveAttribute('tabindex');
        expect(el).toHaveTextContent('Arve Farm');
    });

    it('a_multi_farm_account_renders_the_switcher_with_a_count', async () => {
        await act(async () => {
            renderHeader({ farmContext: multiFarmContext });
        });

        const el = screen.getByTestId('canonical-strip-farm-chip');
        expect(el.tagName).toBe('BUTTON');

        const badge = screen.getByTestId('canonical-strip-farm-count-badge');
        expect(badge).toHaveTextContent('3');

        // Still opens the SAME existing `FarmSwitcherSheet` (spec §2.1).
        fireEvent.click(el);
        expect(screen.getByTestId('farm-switcher-sheet')).toBeInTheDocument();
    });

    it('the_real_farm_list_decides_whether_the_completion_claim_may_render', async () => {
        // CHANGE 3, proven end-to-end rather than by passing `farmCount`
        // straight to the strip: these are real `farmContext.farms` arrays,
        // and `AppHeader` is the one place the count is derived from them.
        //
        // The claim being gated ("आज पर्यन्त सर्व कामे पूर्ण आहेत") is scoped
        // by a farmer to the farm named in the chip beside it, and the app
        // cannot make that scoped claim: `appContentOversightInputs.ts`
        // states that `history`/`crops` come from
        // `dataSource.{logs,crops}.getAll()` and are "NOT scoped to
        // `currentFarmId` for an account with more than one farm".
        //
        // Everything else about the two renders is identical — same
        // resolved data, same zero counts — so the farm list is the only
        // variable, which is what makes this a test of the rule and not of
        // the fixture.
        const resolvedNothingOutstanding = {
            logs: [],
            operatorNameById: {},
            plotCount: 4,
            unverifiedCount: 0,
            yesterdayNotClosed: false,
            approvalHolderName: null,
            dataLoaded: true,
        };

        await act(async () => {
            renderHeader({ farmContext: multiFarmContext, oversightData: resolvedNothingOutstanding });
        });
        expect(screen.queryByText(oversightTranslations.mr.restState)).not.toBeInTheDocument();
        expect(screen.queryByTestId('canonical-strip-waiting-rest-tick')).not.toBeInTheDocument();
        expect(screen.getByTestId('canonical-strip-waiting-unknown-icon')).toBeInTheDocument();

        cleanup();

        // Control: one farm, everything else byte-identical -> the claim is
        // scopeable and the rest state is back. Without this the assertions
        // above would pass against a strip that had lost its rest state.
        await act(async () => {
            renderHeader({ farmContext: singleFarmContext, oversightData: resolvedNothingOutstanding });
        });
        expect(screen.getByText(oversightTranslations.mr.restState)).toBeInTheDocument();
        expect(screen.getByTestId('canonical-strip-waiting-rest-tick')).toBeInTheDocument();
    });

    // TRUTH FIX (truth audit, question 3) — the same rule, for the NUMBER.
    //
    // CHANGE 3 gated the completion SENTENCE on the real farm list and left
    // the plot count beside it ungated, so the strip suppressed a mis-scoped
    // claim in words while still printing it in digits 100px away.
    //
    // WHAT IT CLAIMED: "N प्लॉट" under ONE farm's name reads as that farm's
    // plot count.
    // WHY THE DATA CANNOT BACK IT: `appContentOversightInputs.ts` sums
    // `crop.plots.length` over `dataSource.crops.getAll()` — every crop of the
    // signed-in USER — and states in its own header that this "is NOT scoped
    // to `currentFarmId` for an account with more than one farm".
    // Doctrine P4. Proven end-to-end off real `farmContext.farms` arrays, the
    // same way the sentence's own test is, so this tests the rule and not a
    // prop forced onto `FarmIdentityElement`.
    it('the_real_farm_list_decides_whether_the_plot_count_may_render', async () => {
        const resolvedFourPlots = {
            logs: [],
            operatorNameById: {},
            plotCount: 4,
            unverifiedCount: 0,
            yesterdayNotClosed: false,
            approvalHolderName: null,
            dataLoaded: true,
        };

        await act(async () => {
            renderHeader({ farmContext: multiFarmContext, oversightData: resolvedFourPlots });
        });
        const multi = screen.getByTestId('canonical-strip-farm-chip');
        expect(multi).toHaveTextContent('Arve Farm');
        expect(multi.textContent).not.toContain('4');
        expect(multi.textContent).not.toContain(oversightTranslations.mr.plotsUnit);

        cleanup();

        // Control: one farm, everything else byte-identical -> the count is
        // scopeable and renders. Without this the assertion above would pass
        // against a chip that had lost its plot line entirely.
        await act(async () => {
            renderHeader({ farmContext: singleFarmContext, oversightData: resolvedFourPlots });
        });
        expect(screen.getByTestId('canonical-strip-farm-chip')).toHaveTextContent('4');
    });

    // The second half of the same rule: a single farm is not enough on its own
    // — `oversightData?.plotCount ?? 0` is `0` before anything has been read,
    // and "० प्लॉट" is a confident claim that the farm has no plots.
    it('a_single_farm_still_states_no_plot_count_until_the_data_is_read', async () => {
        // No `oversightData` at all — the unresolved case by definition, and
        // exactly what production renders on first paint.
        await act(async () => {
            renderHeader({ farmContext: singleFarmContext });
        });

        const el = screen.getByTestId('canonical-strip-farm-chip');
        expect(el).toHaveTextContent('Arve Farm');
        expect(el.textContent).not.toContain(oversightTranslations.mr.plotsUnit);
        expect(el.textContent).not.toContain('0');
    });
});

// ---------------------------------------------------------------------------
// FINDING F2 — every decision row the drawer renders as tappable must land on
// a real destination, and FINDING F3 — the waiting drawer is now the "Close
// Day" destination, so something outside this component must be able to open
// it.
//
// The comment these tests replace claimed `failedSend` was the only kind that
// could ever be non-empty here "because the two inputs above are always
// 0/false". Ruling 12 made that false: `AppContent.tsx` fills
// `oversightData.unverifiedCount` / `.yesterdayNotClosed` from real records.
// The `approval` and `dayNotClosed` rows therefore rendered as `<button>`s
// with a chevron and did nothing on tap. These fixtures reproduce exactly
// that data shape.
// ---------------------------------------------------------------------------
describe('AppHeader — every tappable decision row has a destination (F2)', () => {
    /** One case per `OversightDecision['kind']`. Typed as a total `Record`
     * over the union DELIBERATELY: adding a fourth decision kind to
     * `oversightSelectors.ts` without giving it a destination breaks `tsc`
     * here, so this list can never silently fall behind the union it claims
     * to cover. */
    const DESTINATION_CASES: Record<
        OversightDecisionKind,
        {
            arrange: () => Partial<React.ComponentProps<typeof AppHeader>>;
            expectLanded: (spies: { onNavigate: ReturnType<typeof vi.fn>; onViewChange: ReturnType<typeof vi.fn>; reviewInboxRequests: () => number }) => void;
        }
    > = {
        approval: {
            arrange: () => ({
                oversightData: {
                    logs: [],
                    operatorNameById: {},
                    plotCount: 4,
                    unverifiedCount: 6,
                    yesterdayNotClosed: false,
                    approvalHolderName: null,
                    dataLoaded: true,
                },
            }),
            // `ReviewInboxSheet` — the app's existing batch approve/dispute
            // surface — is mounted by `AppRouter`, outside this component's
            // tree, so the hop is observed exactly as production observes
            // it: the window event `AppRouter` listens for.
            expectLanded: ({ reviewInboxRequests }) => expect(reviewInboxRequests()).toBe(1),
        },
        dayNotClosed: {
            arrange: () => ({
                oversightData: {
                    logs: [],
                    operatorNameById: {},
                    plotCount: 4,
                    unverifiedCount: 0,
                    yesterdayNotClosed: true,
                    approvalHolderName: null,
                    dataLoaded: true,
                },
            }),
            // The Reflect view: the one screen showing (and able to resolve)
            // both terms `dayState.ts` derives `isClosed` from — pending
            // planned tasks and unverified entries.
            expectLanded: ({ onViewChange }) => expect(onViewChange).toHaveBeenCalledWith('reflect'),
        },
        failedSend: {
            arrange: () => {
                queueRef.current = { ...queueRef.current, failedCount: 2, failedUploads: 1 };
                return {};
            },
            expectLanded: () => expect(screen.getByTestId('sync-status-drawer-stub')).toBeInTheDocument(),
        },
        // FINDING F6 — the SAME sheet, reached for a different reason.
        // `SyncStatusDrawer` has rendered an honest block about exactly
        // these records since finding F-2 ("N records will not reach your
        // farm records / Saved on this phone. Nothing will send it."), and
        // that block had no reachable opener at all: the sync chip that used
        // to open the sheet on `ON_PHONE` is deleted (spec §4.1), and these
        // records never raise `NEEDS_FIX`, so they produce no `failedSend`
        // row either. Note the queue is left at ALL ZEROES on purpose —
        // that is the whole point of the finding. A dropped record leaves no
        // Dexie row, so every `SyncQueueStatus` count reads 0 and only
        // `useUnqueueableLogCount` knows.
        unqueueable: {
            arrange: () => {
                unqueueableRef.current = 2;
                return {};
            },
            expectLanded: () => expect(screen.getByTestId('sync-status-drawer-stub')).toBeInTheDocument(),
        },
    };

    let reviewInboxRequestCount = 0;
    const countReviewInboxRequest = () => { reviewInboxRequestCount += 1; };

    beforeEach(() => {
        reviewInboxRequestCount = 0;
        window.addEventListener(OPEN_REVIEW_INBOX_EVENT, countReviewInboxRequest);
    });

    afterEach(() => {
        window.removeEventListener(OPEN_REVIEW_INBOX_EVENT, countReviewInboxRequest);
    });

    it.each(Object.keys(DESTINATION_CASES) as OversightDecisionKind[])(
        'every_tappable_decision_row_lands_on_a_real_destination (%s)',
        async (kind) => {
            const testCase = DESTINATION_CASES[kind];
            const onNavigate = vi.fn();
            const onViewChange = vi.fn();

            await act(async () => {
                renderHeader({ onNavigate, onViewChange, ...testCase.arrange() });
            });

            fireEvent.click(screen.getByTestId('canonical-strip-waiting-button'));
            const row = screen.getByTestId(`waiting-drawer-decision-${kind}`);

            // It PRESENTS as tappable — a real <button>, which is the promise
            // this finding is about.
            expect(row.tagName).toBe('BUTTON');

            fireEvent.click(row);

            // ...and the promise is kept.
            testCase.expectLanded({ onNavigate, onViewChange, reviewInboxRequests: () => reviewInboxRequestCount });

            // Every destination is a different surface, so the drawer gets
            // out of its way — the same rule the `onOpenConflicts` comment
            // already states for this header's other sheet hop.
            expect(screen.queryByTestId('waiting-drawer-sheet')).not.toBeInTheDocument();
        },
    );

    it('a_delegated_approval_row_is_still_not_tappable_at_all', async () => {
        // Spec §3's delegated case: same row, same position, NO action
        // affordance. This is the one shape that legitimately has no
        // destination, and it must not look like it has one.
        await act(async () => {
            renderHeader({
                oversightData: {
                    logs: [],
                    operatorNameById: {},
                    plotCount: 4,
                    unverifiedCount: 6,
                    yesterdayNotClosed: false,
                    approvalHolderName: 'Ganesh Mukadam',
                    dataLoaded: true,
                },
            });
        });

        fireEvent.click(screen.getByTestId('canonical-strip-waiting-button'));
        const row = screen.getByTestId('waiting-drawer-decision-approval');
        expect(row.tagName).not.toBe('BUTTON');

        fireEvent.click(row);
        expect(screen.getByTestId('waiting-drawer-sheet')).toBeInTheDocument();
    });

    it('the_unqueueable_row_is_absent_when_no_record_was_dropped', async () => {
        // Founder ruling 2026-08-24: "if there is nothing the user must
        // know, do not show it." `unqueueableRef` is 0 here (the suite
        // default), and a row saying "0 records will not reach your farm
        // records" is plumbing, not a task.
        await act(async () => {
            renderHeader();
        });

        fireEvent.click(screen.getByTestId('canonical-strip-waiting-button'));
        expect(screen.queryByTestId('waiting-drawer-decision-unqueueable')).not.toBeInTheDocument();
    });

    it('the_unqueueable_row_never_borrows_the_failed_send_promise_of_a_retry', async () => {
        // The register this row must NOT use. `failedSends` reads
        // "{count} कामे अडकली आहेत — मी मदत करतो" ("stuck — I will help"),
        // which promises a retry. Nothing will ever send an unqueueable
        // record, so that promise would be false (`P5`).
        //
        // `unsendableRecordsLine` shipped `mr: ''` and resolved through to
        // English; the founder supplied his own Marathi for it on
        // 2026-08-24 and this suite renders in Marathi, so the row now
        // carries HIS words — and, critically, the real count substituted
        // into them. He wrote the token as `{counts }`, which
        // `formatOversightTemplate` (a literal `{count}` split) would not
        // have matched: the farmer would have read the characters
        // `{counts }` where the 2 is below. This assertion is the end-to-end
        // proof that the corrected token substitutes, rendered from a real
        // model rather than checked against the string constant.
        unqueueableRef.current = 2;

        await act(async () => {
            renderHeader();
        });

        fireEvent.click(screen.getByTestId('canonical-strip-waiting-button'));
        const row = screen.getByTestId('waiting-drawer-decision-unqueueable');

        expect(row).toHaveTextContent('2 श्रम सफल पर्यन्त पोहचू शकले नाहीत');
        expect(row.textContent ?? '').not.toContain('{count');
        expect(row.textContent ?? '').not.toContain('अडकली');
        expect(row.textContent ?? '').not.toContain('मी मदत करतो');
        // And it is a genuinely separate row, not a relabelled failedSend:
        // the queue is empty, so no failedSend row exists at all here.
        expect(screen.queryByTestId('waiting-drawer-decision-failedSend')).not.toBeInTheDocument();
    });
});

describe('AppHeader — the waiting drawer can be opened from outside (F3)', () => {
    it('the_header_opens_the_waiting_drawer_when_another_surface_requests_it', async () => {
        // SchedulerPage's "Close Day" button and the `?nudge=close-day`
        // notification deep-link both land here (spec §4.2 routes the Daily
        // Closure card into this drawer). Neither has a prop path to this
        // component's local `isWaitingDrawerOpen`, so both dispatch
        // `OPEN_WAITING_DRAWER_EVENT` — this is the listener that makes them
        // land rather than navigate and do nothing.
        await act(async () => {
            renderHeader();
        });

        expect(screen.queryByTestId('waiting-drawer-sheet')).not.toBeInTheDocument();

        await act(async () => {
            requestOpenWaitingDrawer();
        });

        expect(screen.getByTestId('waiting-drawer-sheet')).toBeInTheDocument();
    });
});
