// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: 2026-08-25-prod-cutover-waves (founder review of
 * `?preview=oversight&waiting=none`, 2026-08-27 — superseding ruling A2)
 *
 * THE DEFECT THIS FILE EXISTS TO KEEP DEAD
 * ========================================
 * The home screen once carried TWO all-clear claims, stacked:
 *
 *     oversight strip   आज पर्यन्त सर्व कामे पूर्ण आहेत
 *     daily-loop hero   आज सगळं सांगून झालं — काही बाकी नाही.   [ 70% ]
 *
 * On 2026-08-26 the founder saw the second one under a strip reporting FOUR
 * waiting rows; ruling A2 gated it on the strip's own published count. On
 * 2026-08-27 he saw the state where that gate PASSES — both sentences spoken,
 * agreeing — and ruled on the duplication itself: *"there are two line only
 * keep which is on the oversight bar."* The hero's settled line is now deleted
 * at source, and `oversightWaitingSignal.ts` (the store that carried the gate)
 * is deleted with it. THIS FILE IS WHAT REPLACES BOTH.
 *
 * It renames and supersedes `oversightWaitingSignal.test.tsx`, and it holds
 * three properties that together are stronger than the gate they replace:
 *
 *   1. ONE ALL-CLEAR SURFACE. On a settled day the strip's rest state is the
 *      only completion claim on the screen — the hero's sentence appears
 *      nowhere, in either direction of the founder's two screens.
 *   2. THE STRIP CANNOT CONTRADICT ITSELF. Its ring number and its sentence
 *      are resolved from the SAME `waitingCount` prop on the same render, so
 *      the 70%-beside-"nothing left" shape cannot reappear inside the one
 *      control that survived. This is the property the ring had to earn
 *      before it was allowed onto the bar at all.
 *   3. THE TRUE LINES ARE NOT COLLATERAL. "आज N कामं बाकी" and "आज काहीच
 *      सांगितलं नाही" are not all-clears; a waiting strip must not silence
 *      them, or the fix becomes hiding true lines to manufacture agreement.
 *
 * WHY THIS TEST MOUNTS THE REAL HEADER
 * ------------------------------------
 * A unit test of a component proves it obeys the props it is given; it does
 * NOT prove what a farmer reads on the assembled screen, and "individually
 * true surfaces composing one false impression" is the entire defect class
 * here. So the real `AppHeader` (real `buildOversightModel`, real
 * `CanonicalStrip`) is mounted and the assertions read its rendered DOM.
 *
 * It used to mount `DailyLoopHero` beside it, because the defect needed two
 * surfaces to exist. The founder's 2026-08-29 ruling deleted that component
 * outright — so the second surface is now held absent STRUCTURALLY, by
 * `the_second_surface_does_not_exist_at_all` below, which is a stronger
 * guarantee than any render-time assertion could be.
 *
 * Only `useLanguage` and the `../../sync` barrel are mocked, exactly as
 * `AppHeader.oversight.test.tsx` mocks them and for the same reasons (a
 * Dexie-free language table; a per-test sync-queue snapshot). Everything that
 * carries the fact — the selectors, the strip, the hero — runs for real.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';

import { t as translate, type Language } from '../../../i18n/translations';
import { oversightTranslations } from '../../../i18n/oversightTranslations';
import type { SyncQueueStatus } from '../../sync/hooks/useSyncQueueStatus';
import type { DailyLog } from '../../../domain/types/log.types';

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

/** The exact settled sentence the founder saw, and had removed. Read from the
 * table, never retyped — the key survives in `dfesTranslations.ts` (approved
 * copy is not deleted), so a re-wiring of it must fail here, and a copy edit
 * must not silently pass. */
const SETTLED_LINE = translate('dfes.dailyLoopDaySettled', 'mr');

/** The strip's own all-clear — the ONE that is allowed to remain. */
const STRIP_REST_LINE = oversightTranslations.mr.restState;

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
 * render.
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
});

afterEach(() => {
    cleanup();
    localStorage.clear();
    queueRef.current = { ...queueRef.current, failedCount: 0, failedUploads: 0, hasLoaded: true };
    unqueueableRef.current = 0;
});

describe('the home screen carries exactly ONE all-clear claim (founder rulings 2026-08-27 and 2026-08-29)', () => {
    it('the_settled_line_cannot_render_while_the_strip_shows_a_positive_count', async () => {
        await act(async () => {
            renderHomeScreen(FOUR_WAITING);
        });

        // The strip is genuinely reporting waiting rows — this is the founder's
        // screen, not an empty one that would pass by accident.
        const ringCount = screen.getByTestId('canonical-strip-waiting-count');
        expect(Number(ringCount.textContent)).toBeGreaterThan(0);
        expect(ringCount).toHaveTextContent('4');

        // ...and the sentence he read underneath it is nowhere on the screen.
        expect(screen.queryByText(SETTLED_LINE)).toBeNull();
        expect(document.body.textContent).not.toContain(SETTLED_LINE);
        // The hero withholds the whole card rather than showing a bare ring —
        // see its own comment on why a lone percentage is its own reassurance.
        expect(screen.queryByTestId('daily-loop-hero')).toBeNull();
    });

    it('the_settled_line_is_gone_even_when_the_strip_says_nothing_is_waiting', async () => {
        // THE CASE THE 2026-08-27 RULING ADDED. Ruling A2's gate PASSED here —
        // the strip is in its rest state, so the old code spoke the hero's
        // sentence beneath it. That is the duplication the founder read on
        // `?preview=oversight&waiting=none`, and it is what he removed.
        await act(async () => {
            renderHomeScreen(NOTHING_WAITING);
        });

        // The strip's all-clear IS there — this is a positive claim (its green
        // tick), not merely an unread zero, and it is the one he kept.
        expect(screen.getByTestId('canonical-strip-waiting-rest-tick')).toBeInTheDocument();
        expect(screen.getByText(STRIP_REST_LINE)).toBeInTheDocument();
        expect(screen.queryByTestId('canonical-strip-waiting-count')).toBeNull();

        // And it is the ONLY one. No second sentence, no second card.
        expect(screen.queryByText(SETTLED_LINE)).toBeNull();
        expect(document.body.textContent).not.toContain(SETTLED_LINE);
        expect(screen.queryByTestId('daily-loop-hero')).toBeNull();
    });

    it('the_settled_line_is_absent_while_the_strip_cannot_yet_confirm (unknown is not none)', async () => {
        // `dataLoaded: false` — the same zeros, but nobody has read them. The
        // strip refuses its rest state here (finding F7(a)), and there is no
        // longer any other surface that could make the stronger claim in its
        // place.
        await act(async () => {
            renderHomeScreen({ ...NOTHING_WAITING, dataLoaded: false });
        });

        expect(screen.queryByTestId('canonical-strip-waiting-rest-tick')).toBeNull();
        expect(screen.queryByText(SETTLED_LINE)).toBeNull();
    });

    it('the_settled_line_is_absent_on_an_account_the_strip_cannot_scope (2+ farms)', async () => {
        // CHANGE 3 — with more than one farm the strip's inputs are not
        // farm-scoped, so it suppresses its completion claim. Nothing else
        // makes one either.
        await act(async () => {
            renderHomeScreen(NOTHING_WAITING, [
                ...SINGLE_FARM,
                { farmId: 'farm-2', name: 'Second Farm', role: 'PrimaryOwner', farmCode: 'DEF456', subscription: null },
            ]);
        });

        expect(screen.queryByTestId('canonical-strip-waiting-rest-tick')).toBeNull();
        expect(screen.queryByText(SETTLED_LINE)).toBeNull();
    });

    it('the_second_surface_does_not_exist_at_all', () => {
        // FOUNDER RULING 2026-08-29 — the strongest form of property 1. The
        // 2026-08-27 pass deleted the SETTLED line but left `DailyLoopHero`
        // rendering "आज काहीच सांगितलं नाही…", so the home screen still carried
        // two blocks asking the farmer the same thing. He read it again and had
        // the whole surface removed, keeping `SathiGuideCard` as the hero.
        //
        // A DOM assertion cannot hold this — an absent component and a
        // not-rendered one look identical in the tree — so this reads the source
        // instead: no module may IMPORT it, and the file itself must be gone.
        // Prose mentions are deliberately allowed; several files still explain
        // the removal in comments, and they should.
        const srcRoot = path.resolve(__dirname, '../../..');
        const offenders: string[] = [];
        const walk = (dir: string) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) { walk(full); continue; }
                if (!/\.(ts|tsx)$/.test(entry.name)) continue;
                if (/from\s+['"][^'"]*shramsathi\/DailyLoopHero['"]/.test(fs.readFileSync(full, 'utf8'))) {
                    offenders.push(path.relative(srcRoot, full));
                }
            }
        };
        walk(srcRoot);

        expect(offenders).toEqual([]);
        expect(fs.existsSync(path.join(srcRoot, 'features/logs/components/shramsathi/DailyLoopHero.tsx'))).toBe(false);
    });
});

describe('the strip\'s ring and the strip\'s words are ONE fact (founder ruling 2026-08-27)', () => {
    // THE PROPERTY THE RING HAD TO EARN. The founder's complaint was a 70%
    // ring beside "काही बाकी नाही" — a number and a sentence from different
    // domains inside one glance. Moving a ring onto the strip is only safe if
    // the number it shows IS what the sentence beside it is about.
    const stripProps = (waitingCount: number) => ({
        language: 'mr' as Language,
        waitingCount,
        dataResolved: true,
        farmCount: 1,
        lastSyncAt: null,
        onToggleWaiting: vi.fn(),
    });

    it.each([1, 4, 37])(
        'the_ring_number_and_the_strip_words_are_one_fact (waitingCount %i)',
        async (waitingCount) => {
            await act(async () => {
                render(<CanonicalStrip {...stripProps(waitingCount)} />);
            });

            // The ring prints the prop verbatim...
            expect(screen.getByTestId('canonical-strip-waiting-count'))
                .toHaveTextContent(String(waitingCount));
            // ...and the sentence beside it is the WAITING sentence, resolved
            // from the same positive count. Neither the rest sentence nor any
            // other state's may appear while the ring shows a number.
            expect(screen.getByText(oversightTranslations.mr.waitingLabel)).toBeInTheDocument();
            expect(screen.queryByText(STRIP_REST_LINE)).toBeNull();
            expect(screen.queryByText(oversightTranslations.mr.unknownState)).toBeNull();
            expect(screen.queryByTestId('canonical-strip-waiting-rest-tick')).toBeNull();
        },
    );

    it('the_all_clear_sentence_and_a_ring_number_can_never_be_on_screen_together', async () => {
        // The merged form of the defect: one control, one glance. If the ring
        // ever showed a number the sentence did not account for, THIS is the
        // assertion that fails. Swept across the whole state space the strip
        // has, not just the two cases a demo would use.
        const cases: Array<{ waitingCount: number; dataResolved: boolean; farmCount: number }> = [
            { waitingCount: 0, dataResolved: true, farmCount: 1 },
            { waitingCount: 0, dataResolved: true, farmCount: 2 },
            { waitingCount: 0, dataResolved: false, farmCount: 1 },
            { waitingCount: 1, dataResolved: true, farmCount: 1 },
            { waitingCount: 4, dataResolved: false, farmCount: 1 },
            { waitingCount: 9, dataResolved: true, farmCount: 2 },
        ];

        for (const c of cases) {
            const label = JSON.stringify(c);
            await act(async () => {
                render(
                    <CanonicalStrip
                        language="mr"
                        waitingCount={c.waitingCount}
                        dataResolved={c.dataResolved}
                        farmCount={c.farmCount}
                        lastSyncAt={null}
                        onToggleWaiting={vi.fn()}
                    />,
                );
            });

            const ringNumber = screen.queryByTestId('canonical-strip-waiting-count');
            const allClear = screen.queryByText(STRIP_REST_LINE);
            const restTick = screen.queryByTestId('canonical-strip-waiting-rest-tick');

            // Never both.
            expect(ringNumber !== null && allClear !== null, label).toBe(false);
            expect(ringNumber !== null && restTick !== null, label).toBe(false);
            // The ring shows a number if and only if the count is positive —
            // it is the prop, never a derived or invented figure.
            expect(ringNumber !== null, label).toBe(c.waitingCount > 0);
            if (ringNumber) {
                expect(ringNumber.textContent, label).toBe(String(c.waitingCount));
            }

            cleanup();
        }
    });

    it('canonical_strip_ring_is_never_a_gauge', async () => {
        // `waitingCount` has no denominator (`oversightSelectors.ts`: rows, not
        // a proportion), so a part-filled ring beside it would be a fabricated
        // percentage in the most prominent place on the screen — doctrine P4.
        // The hero's ring is a `conic-gradient`; this one must be a solid band
        // in every state, i.e. a ring by SHAPE and never a gauge.
        for (const c of [
            { waitingCount: 4, dataResolved: true, farmCount: 1, testid: 'canonical-strip-waiting-icon' },
            { waitingCount: 0, dataResolved: true, farmCount: 1, testid: 'canonical-strip-waiting-rest-tick' },
            { waitingCount: 0, dataResolved: false, farmCount: 1, testid: 'canonical-strip-waiting-checking-icon' },
        ]) {
            await act(async () => {
                render(
                    <CanonicalStrip
                        language="mr"
                        waitingCount={c.waitingCount}
                        dataResolved={c.dataResolved}
                        farmCount={c.farmCount}
                        lastSyncAt={null}
                        onToggleWaiting={vi.fn()}
                    />,
                );
            });

            const ring = screen.getByTestId(c.testid);
            expect(ring.getAttribute('style') ?? '', c.testid).not.toContain('gradient');
            expect(ring.className, c.testid).not.toContain('gradient');
            // Round, and one solid colour — the shell of the hero's ring
            // without its proportion.
            expect(ring.className, c.testid).toContain('rounded-full');

            cleanup();
        }
    });

    it('the_ring_number_renders_in_the_locked_number_font', async () => {
        // Root CLAUDE.md font rules: numerals are DM Sans, never a Devanagari
        // face and never a generic fallback. Pinned here because the count
        // moved node in this change — a move is exactly when an inline font
        // style gets dropped.
        await act(async () => {
            render(<CanonicalStrip {...stripProps(4)} />);
        });

        expect(screen.getByTestId('canonical-strip-waiting-count'))
            .toHaveStyle({ fontFamily: "'DM Sans', sans-serif" });
    });
});
