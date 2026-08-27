// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: 2026-08-25-prod-cutover-waves (founder review of `?preview=oversight`,
 * 2026-08-26 — ruling A2)
 *
 * THE DEFECT THIS FILE EXISTS TO KEEP DEAD
 * ========================================
 * The founder opened the home screen and read the oversight strip reporting
 * FOUR rows waiting for him, and directly beneath it the daily-loop hero's
 * "आज सगळं सांगून झालं — काही बाकी नाही" ("today everything is told — nothing
 * left"). Both numbers were true about different subjects and neither was
 * fabricated; composed on one screen they told him something false, which is
 * what doctrine P4 actually forbids.
 *
 * WHY THIS TEST MOUNTS BOTH REAL COMPONENTS IN ONE TREE
 * -----------------------------------------------------
 * A unit test of `DailyLoopHero` with a hand-set signal would prove the
 * component obeys a number it is given; it would NOT prove the number ever
 * arrives, and "the wiring was never connected" is the failure mode that
 * produced the defect in the first place. So the real `AppHeader` (real
 * `buildOversightModel`, real `CanonicalStrip`) and the real `DailyLoopHero`
 * are rendered as siblings — the same relationship they have in
 * `AppContent.tsx` — and the assertions read the rendered DOM of both.
 *
 * Only `useLanguage` and the `../../sync` barrel are mocked, exactly as
 * `AppHeader.oversight.test.tsx` mocks them and for the same reasons (a
 * Dexie-free language table; a per-test sync-queue snapshot). Everything that
 * carries the fact — the selectors, the signal module, the strip, the hero —
 * runs for real.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import React from 'react';

import { t as translate, type Language } from '../../../i18n/translations';
import type { SyncQueueStatus } from '../../sync/hooks/useSyncQueueStatus';
import type { DailyLog } from '../../../domain/types/log.types';
import {
    resetOversightWaitingSignal,
    resolveWaitingSignal,
} from '../oversightWaitingSignal';

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
        // Finding F7(a) — a queue that has already been read, so the strip is
        // allowed to reach a resolved state at all. One case below flips it.
        hasLoaded: true,
    },
};

const unqueueableRef = { current: 0 };

vi.mock('../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({
        language: 'mr' as Language,
        setLanguage: () => { },
        t: (key: string) => translate(key, 'mr'),
    }),
}));

vi.mock('../../sync', () => ({
    useSyncQueueStatus: () => queueRef.current,
    useUnqueueableLogCount: () => unqueueableRef.current,
    SyncStatusDrawer: ({ isOpen }: { isOpen: boolean }) =>
        isOpen ? <div data-testid="sync-status-drawer-stub" /> : null,
}));

import AppHeader from '../../context/components/AppHeader';
import CanonicalStrip from '../components/CanonicalStrip';
import DailyLoopHero from '../../logs/components/shramsathi/DailyLoopHero';

/** The exact settled sentence the founder saw. Read from the table, never
 * retyped — a copy change must not silently pass this suite. */
const SETTLED_LINE = translate('dfes.dailyLoopDaySettled', 'mr');

const SINGLE_FARM = [
    { farmId: 'farm-1', name: 'Arve Farm', role: 'PrimaryOwner', farmCode: 'ABC123', subscription: null },
];

function makeFarmContext(farms = SINGLE_FARM) {
    return {
        farms,
        currentFarmId: 'farm-1',
        onSwitchFarm: vi.fn(),
        onCreateFarm: vi.fn(),
        onJoinViaQr: vi.fn(),
    };
}

/** Minimal real `DailyLog` — same hand-built shape `oversightSelectors.test.ts`
 * and `AppHeader.oversight.test.tsx` use. */
function makeLog(id: string, operatorId: string | undefined): DailyLog {
    return {
        id,
        date: '2026-08-26',
        context: {
            selection: [{
                cropId: 'crop-1',
                cropName: 'Grapes',
                selectedPlotIds: ['plot-1'],
                selectedPlotNames: ['Grapes A'],
            }],
        },
        dayOutcome: 'WORK_RECORDED',
        cropActivities: [],
        irrigation: [],
        labour: [],
        inputs: [],
        machinery: [],
        meta: operatorId ? { createdByOperatorId: operatorId } : undefined,
        financialSummary: {
            totalLabourCost: 0,
            totalInputCost: 0,
            totalMachineryCost: 0,
            grandTotal: 0,
        },
    } as DailyLog;
}

/**
 * The exact screen the founder was looking at: the real header above the real
 * hero, with the hero in its SETTLED input state — no tasks left today
 * (`pendingCount: 0`) and a day that has genuinely been recorded
 * (`closurePercent: 100`). That input is what used to make the settled line
 * unconditional.
 */
function renderHomeScreen(oversightData: React.ComponentProps<typeof AppHeader>['oversightData'], farms = SINGLE_FARM) {
    return render(
        <>
            <AppHeader
                currentRoute="main"
                currentView="log"
                onNavigate={vi.fn()}
                onViewChange={vi.fn()}
                farmContext={makeFarmContext(farms)}
                oversightData={oversightData}
            />
            <DailyLoopHero
                pendingCount={0}
                carriedCount={0}
                closurePercent={100}
                onFocusRecorder={vi.fn()}
            />
        </>,
    );
}

const NOTHING_WAITING: React.ComponentProps<typeof AppHeader>['oversightData'] = {
    logs: [],
    operatorNameById: {},
    plotCount: 4,
    unverifiedCount: 0,
    yesterdayNotClosed: false,
    approvalHolderName: null,
    dataLoaded: true,
};

/** Four waiting rows, the number the founder actually read: two decision rows
 * (an approval batch, an unclosed yesterday) and two named people with unseen
 * records. Every one is derived by the real selector, none is a literal. */
const FOUR_WAITING: React.ComponentProps<typeof AppHeader>['oversightData'] = {
    logs: [makeLog('log-1', 'op-1'), makeLog('log-2', 'op-2')],
    operatorNameById: { 'op-1': 'Ramesh', 'op-2': 'Sunita' },
    plotCount: 4,
    unverifiedCount: 4,
    yesterdayNotClosed: true,
    approvalHolderName: null,
    dataLoaded: true,
};

beforeEach(() => {
    localStorage.clear();
    resetOversightWaitingSignal();
});

afterEach(() => {
    cleanup();
    localStorage.clear();
    resetOversightWaitingSignal();
    queueRef.current = { ...queueRef.current, failedCount: 0, failedUploads: 0, hasLoaded: true };
    unqueueableRef.current = 0;
});

describe('the settled line and the oversight strip can never contradict (ruling A2)', () => {
    it('the_settled_line_cannot_render_while_the_strip_shows_a_positive_count', async () => {
        await act(async () => {
            renderHomeScreen(FOUR_WAITING);
        });

        // The strip is genuinely reporting waiting rows — this is the founder's
        // screen, not an empty one that would pass by accident.
        const badge = screen.getByTestId('canonical-strip-waiting-count');
        expect(Number(badge.textContent)).toBeGreaterThan(0);
        expect(badge).toHaveTextContent('4');

        // ...and the sentence he read underneath it is nowhere on the screen.
        expect(screen.queryByText(SETTLED_LINE)).toBeNull();
        expect(document.body.textContent).not.toContain(SETTLED_LINE);
        // The hero withholds the whole card rather than showing a bare ring —
        // see its own comment on why a lone percentage is its own reassurance.
        expect(screen.queryByTestId('daily-loop-hero')).toBeNull();
    });

    it('the_settled_line_still_renders_when_the_strip_says_nothing_is_waiting', async () => {
        await act(async () => {
            renderHomeScreen(NOTHING_WAITING);
        });

        // The strip is in its REST state — the positive claim, not merely an
        // unread zero.
        expect(screen.getByTestId('canonical-strip-waiting-rest-tick')).toBeInTheDocument();
        expect(screen.queryByTestId('canonical-strip-waiting-count')).toBeNull();

        // Ruling A2: "the line stays." It does.
        expect(screen.getByTestId('daily-loop-hero-line')).toHaveTextContent(SETTLED_LINE);
    });

    it('the_settled_line_is_withheld_while_the_strip_cannot_yet_confirm (unknown is not none)', async () => {
        // `dataLoaded: false` — the same zeros, but nobody has read them. The
        // strip refuses its rest state here (finding F7(a)); the hero must
        // refuse the stronger claim for the same reason.
        await act(async () => {
            renderHomeScreen({ ...NOTHING_WAITING, dataLoaded: false });
        });

        expect(screen.queryByTestId('canonical-strip-waiting-rest-tick')).toBeNull();
        expect(screen.queryByText(SETTLED_LINE)).toBeNull();
    });

    it('the_settled_line_is_withheld_on_an_account_the_strip_cannot_scope (2+ farms)', async () => {
        // CHANGE 3 — with more than one farm the strip's inputs are not
        // farm-scoped, so it suppresses its completion claim. Same rule here.
        await act(async () => {
            renderHomeScreen(NOTHING_WAITING, [
                ...SINGLE_FARM,
                { farmId: 'farm-2', name: 'Second Farm', role: 'PrimaryOwner', farmCode: 'DEF456', subscription: null },
            ]);
        });

        expect(screen.queryByTestId('canonical-strip-waiting-rest-tick')).toBeNull();
        expect(screen.queryByText(SETTLED_LINE)).toBeNull();
    });

    it('a_positive_waiting_count_does_not_silence_the_states_that_do_not_contradict_it', async () => {
        // Ruling A2 gates ONE branch. "आज N कामं बाकी" agrees with a waiting
        // strip (work outstanding AND records outstanding are both true), so
        // gating it too would be hiding a true line to fake agreement — which
        // the ruling explicitly forbids.
        await act(async () => {
            render(
                <>
                    <AppHeader
                        currentRoute="main"
                        currentView="log"
                        onNavigate={vi.fn()}
                        onViewChange={vi.fn()}
                        farmContext={makeFarmContext()}
                        oversightData={FOUR_WAITING}
                    />
                    <DailyLoopHero
                        pendingCount={3}
                        carriedCount={0}
                        closurePercent={40}
                        onFocusRecorder={vi.fn()}
                    />
                </>,
            );
        });

        expect(screen.getByTestId('canonical-strip-waiting-count')).toHaveTextContent('4');
        expect(screen.getByTestId('daily-loop-hero-line')).toHaveTextContent('आज 3 कामं बाकी');
    });
});

describe('resolveWaitingSignal agrees with what CanonicalStrip actually renders', () => {
    // The signal helper encodes "is the strip claiming a count?". If it ever
    // drifts from the strip's own four-state selection, the hero would gate on
    // a state the strip is not in — so the agreement is MEASURED against the
    // real component, not assumed.
    const cases: Array<{ waitingCount: number; dataResolved: boolean; farmCount: number }> = [
        { waitingCount: 0, dataResolved: true, farmCount: 1 },
        { waitingCount: 0, dataResolved: true, farmCount: 2 },
        { waitingCount: 0, dataResolved: false, farmCount: 1 },
        { waitingCount: 0, dataResolved: false, farmCount: 2 },
        { waitingCount: 3, dataResolved: true, farmCount: 1 },
        { waitingCount: 3, dataResolved: false, farmCount: 1 },
        { waitingCount: 3, dataResolved: true, farmCount: 2 },
    ];

    it.each(cases)(
        'signal 0 iff the rest tick renders (waiting %#)',
        async ({ waitingCount, dataResolved, farmCount }) => {
            await act(async () => {
                render(
                    <CanonicalStrip
                        language="mr"
                        waitingCount={waitingCount}
                        dataResolved={dataResolved}
                        farmCount={farmCount}
                        lastSyncAt={null}
                        onToggleWaiting={vi.fn()}
                    />,
                );
            });

            const restTickRendered = screen.queryByTestId('canonical-strip-waiting-rest-tick') !== null;
            const signal = resolveWaitingSignal(waitingCount, dataResolved, farmCount);
            expect(signal === 0).toBe(restTickRendered);

            // And when the strip IS showing a badge, the signal is that badge.
            const badge = screen.queryByTestId('canonical-strip-waiting-count');
            if (badge) {
                expect(String(signal)).toBe(badge.textContent);
            }
        },
    );
});
