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
        hasLoaded: true,
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

        // Task 12: real visible text again — assert the honest-zero
        // fallback directly.
        expect(screen.getByTestId('canonical-strip-farm-chip')).toHaveTextContent('0');
        expect(screen.getByTestId('canonical-strip-farm-chip')).not.toHaveTextContent('4');
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
});
