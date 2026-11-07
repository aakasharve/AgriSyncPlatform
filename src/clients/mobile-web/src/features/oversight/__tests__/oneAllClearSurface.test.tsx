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
 * `StripSignals` since lane L4b) is mounted and the assertions read its rendered DOM.
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
import { publishApprovalQueue, resetApprovalQueueForTests } from '../../approval/approvalQueue';
import { EMPTY_LABOUR_DATA } from '../../labour/labourMock';

/** lane L4b — the farm's server approval list, as the server would answer it (the strip's only count). */
const serverListOf = (n: number) => ({
    ...EMPTY_LABOUR_DATA,
    canConfirm: true,
    review: Array.from({ length: n }, (_, i) => ({ id: `r${i}`, who: 'w', initial: 'w', tone: 'or' as const, detail: '2026-10-30', status: 'Draft' as const, points: {} })),
});

/** The exact settled sentence the founder saw, and had removed. Read from the
 * table, never retyped — the key survives in `dfesTranslations.ts` (approved
 * copy is not deleted), so a re-wiring of it must fail here, and a copy edit
 * must not silently pass. */
const SETTLED_LINE = translate('dfes.dailyLoopDaySettled', 'mr');

/**
 * lane L4b fix round 1 (review L-3) — the strip's two rest lines. `RETIRED_ALL_CLEAR` is the old ring's rest state
 * (founder D-3 retired it; lane L4b deleted its key). `EMPTY_LIST_LINE` is the founder's D-40 §6 line — the ONE rest
 * line allowed to remain, and only on the farm's server list read empty.
 */
const RETIRED_ALL_CLEAR = 'आज पर्यन्त सर्व कामे पूर्ण आहेत';
const EMPTY_LIST_LINE = 'मंजुरीसाठी नोंदी बाकी नाहीत';

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
    yesterdayNotClosed: false,
    approvalHolderName: null,
};

/** Four waiting rows, the number the founder actually read: two decision rows
 * (an approval batch, an unclosed yesterday) and two named people with unseen
 * records. Every one is derived by the real selector, none is a literal. */
const FOUR_WAITING: React.ComponentProps<typeof AppHeader>['oversightData'] = {
    logs: [makeLog('log-1', 'op-1'), makeLog('log-2', 'op-2')],
    operatorNameById: { 'op-1': 'Ramesh', 'op-2': 'Sunita' },
    plotCount: 4,
    yesterdayNotClosed: true,
    approvalHolderName: null,
};

beforeEach(() => {
    localStorage.clear();
});

afterEach(() => {
    cleanup();
    localStorage.clear();
    resetApprovalQueueForTests();
    queueRef.current = { ...queueRef.current, failedCount: 0, failedUploads: 0, hasLoaded: true };
    unqueueableRef.current = 0;
});

describe('the home screen carries exactly ONE all-clear claim (founder rulings 2026-08-27 and 2026-08-29)', () => {
    it('the_settled_line_cannot_render_while_the_strip_shows_a_positive_count', async () => {
        publishApprovalQueue('farm-1', serverListOf(4));
        await act(async () => {
            renderHomeScreen(FOUR_WAITING);
        });

        // The strip is genuinely reporting waiting work — this is the founder's
        // screen, not an empty one that would pass by accident. lane L4b fix round 1 (review L-3): its approval
        // signal carries the farm's server count ("मंजुरीसाठी ४"), so an empty strip fails here.
        expect(screen.getByTestId('strip-approval')).toHaveTextContent('मंजुरीसाठी ४');
        expect(screen.queryByTestId('strip-rest')).toBeNull();
        expect(screen.getByTestId('canonical-strip-waiting-button')).toBeInTheDocument();

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
        publishApprovalQueue('farm-1', serverListOf(0));
        await act(async () => {
            renderHomeScreen(NOTHING_WAITING);
        });

        // lane L4b (founder D-3 / D-40 §6) — the strip's own all-clear is RETIRED too: it said
        // "आज पर्यन्त सर्व कामे पूर्ण आहेत" while late work waited (D-3). With nothing to show it
        // states only what it read: the farm's approval list, read empty (the founder's D-40 §6 line).
        expect(screen.queryByText(RETIRED_ALL_CLEAR)).toBeNull();
        expect(document.body.textContent).not.toMatch(/सर्व कामे पूर्ण/);
        expect(screen.getByTestId('strip-rest')).toHaveTextContent(EMPTY_LIST_LINE);

        // And it is the ONLY one. No second sentence, no second card.
        expect(screen.queryByText(SETTLED_LINE)).toBeNull();
        expect(document.body.textContent).not.toContain(SETTLED_LINE);
        expect(screen.queryByTestId('daily-loop-hero')).toBeNull();
    });

    it('the_settled_line_is_absent_while_the_strip_cannot_yet_confirm (unknown is not none)', async () => {
        // The same zeros, but the farm's list was never read (lane L4b: the strip's only rest claim rests on that
        // list). The strip says so (finding F7(a)), and there is no longer any other surface that could make the
        // stronger claim in its place.
        await act(async () => {
            renderHomeScreen({ ...NOTHING_WAITING });
        });

        expect(screen.getByTestId('strip-rest')).toHaveTextContent('यादी आत्ता दिसत नाही');
        expect(screen.queryByText(EMPTY_LIST_LINE)).toBeNull();
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

    // 20s, not the 5s default: this walks every .ts/.tsx under src and reads
    // each one. That is real IO — ~1000 files — and it is the point of the test,
    // but under a full parallel run it exceeded the render-tuned default and
    // flaked. A slow honest test beats a fast one that only checks the DOM.
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
    }, 20000);
});

// lane L4b fix round 0 — the ring strip (`CanonicalStrip` / `StripStateRing`) is deleted: the strip is three separate
// signals now (`StripSignals`, founder D-40 §2), tested in `features/approval/__tests__/oneApprovalPath.doors.test.tsx`.
