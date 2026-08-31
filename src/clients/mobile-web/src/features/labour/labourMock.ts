/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Labour Management — mock/in-memory data for the local UAT shell + preview
 * (`?preview=labour`, and the real app's fallback when there is no farm
 * context yet). All amounts/dates are illustrative.
 *
 * The DATA CONTRACT types live in `labour.types.ts` (Task 1.4) — re-exported
 * here so existing screen imports (`from '../labourMock'`) keep working
 * unchanged. The real backend swaps in via `data/labourClient.ts` +
 * `useLabourState.ts`; screens never see the difference.
 */

export type {
    PresenceStatus,
    LabourRole,
    AvatarTone,
    LabourBalance,
    LabourPerson,
    LedgerRow,
    ReviewItem,
    ReviewVerificationStatus,
    PlotBar,
    DashboardData,
    LabourData,
} from './labour.types';
export { netBalance, inr } from './labour.types';

import type { LabourData, LabourPerson } from './labour.types';

const P = (p: LabourPerson): LabourPerson => p;

// Balances below are constructed so `recorded - paid - advance` reproduces
// the SAME owed amounts the feature shipped with pre-Option-3 (paid was
// folded into recorded for the demo split — no behavioural drift in the mock).
const PEOPLE: Record<string, LabourPerson> = {
    rokade: P({
        id: 'rokade', name: 'रोकडे', initial: 'रो', tone: 'vi', role: 'mukadam', verified: true,
        balance: { recorded: 9500, paid: 3000, advance: 10000 }, memberIds: ['dhanaji', 'ramesh', 'sunita'],
    }),
    dhanaji: P({
        id: 'dhanaji', name: 'धनाजी', initial: 'ध', tone: 'bl', role: 'submukadam', verified: true,
        temporary: true, taskScope: 'छाटणी', appointedById: 'rokade',
        balance: { recorded: 2600, paid: 800, advance: 3000 }, memberIds: ['vilas', 'sandip'],
    }),
    ramesh: P({
        id: 'ramesh', name: 'रमेश', initial: 'र', tone: 'or', role: 'worker', verified: true,
        balance: { recorded: 5400, paid: 1200, advance: 2000 }, todayStatus: 'present', daysThisWeek: 6, trust: 82,
        access: 'review', daysActive: 27, cleanRecord: true,
    }),
    sunita: P({
        id: 'sunita', name: 'सुनीता', initial: 'सु', tone: 'em', role: 'worker', verified: true,
        balance: { recorded: 2000, paid: 500, advance: 0 }, todayStatus: 'present', daysThisWeek: 5, trust: 76,
        access: 'trusted', daysActive: 40, cleanRecord: true,
    }),
    vilas: P({
        id: 'vilas', name: 'विलास जाधव', initial: 'वि', tone: 'rs', role: 'worker', verified: false,
        temporary: true, appointedById: 'dhanaji',
        balance: { recorded: 0, paid: 0, advance: 500 }, todayStatus: 'half', daysThisWeek: 4,
        access: 'review', daysActive: 4, cleanRecord: false,
    }),
    sandip: P({
        id: 'sandip', name: 'संदीप', initial: 'सं', tone: 'am', role: 'worker', verified: false,
        appointedById: 'dhanaji',
        balance: { recorded: 1100, paid: 300, advance: 0 }, todayStatus: 'present', daysThisWeek: 7,
    }),
};

const p = (s: 'present' | 'half' | 'absent') => s;

/**
 * MONEY-SAFETY — the honest empty state for a REAL farm.
 *
 * Used by `useLabourState` whenever a real `farmId` is present: while the
 * fetch is in flight, and again if it fails. It must NEVER be confused with
 * `LABOUR_MOCK` — no fake people, no fake ₹ balances; that half of the rule
 * is unchanged and still stands.
 *
 * Task 6c (spec: 2026-08-28-labour-v2-release-1, P4) — completes Tasks 1 and
 * 6, which made `manDays`/`owed`/`money.recorded`/`money.owed`/`weekTotal`
 * nullable at the server and at every render site, but left THIS constant
 * hardcoding all five back to a fabricated `0`. An outage is not evidence of
 * a zero-labour week — it is evidence of nothing, because we could not reach
 * the record at all. That is the exact absence Ruling R8 calls unknown, not
 * a genuine 0 (a genuine 0 is reserved for a record that exists and truly
 * contains no labour). A farmer on poor rural connectivity hits this
 * fallback often — while loading, and on every failed fetch — so it must
 * render `—`, the same as the server's own "no evidence yet" response, never
 * a confident zero underneath the "couldn't load" banner.
 */
export const EMPTY_LABOUR_DATA: LabourData = {
    topLevelIds: [],
    people: {},
    dashboard: {
        weekLabel: '',
        insight: '',
        manDays: null,
        manDaysTrend: 0,
        wages: 0,
        advances: 0,
        owed: null,
        logs: 0,
        pending: 0,
        plots: [],
        money: { recorded: null, paid: 0, advance: 0, owed: null },
    },
    ledger: { weekLabel: '', days: [], rows: [], dailyTotals: [], weekTotal: null },
    review: [],
    attendance: { plot: '', headcount: 0, rows: [], todaysLabourAssignmentId: '' },
};

export const LABOUR_MOCK: LabourData = {
    topLevelIds: ['rokade', 'ramesh', 'sunita', 'vilas'],
    people: PEOPLE,
    dashboard: {
        weekLabel: '७–१३ जुलै',
        insight: 'छान आठवडा! २८ मजूर-दिवस काम झालं. ३ नोंदी तपासायच्या आहेत.',
        manDays: 28, manDaysTrend: 4,
        wages: 8400, advances: 3000, owed: 5400, logs: 12, pending: 3,
        plots: [
            { name: 'द्राक्ष-२', days: 18, pct: 82 },
            { name: 'केळी-१', days: 7, pct: 34 },
            { name: 'द्राक्ष-१', days: 3, pct: 15 },
        ],
        money: { recorded: 16800, paid: 8400, advance: 3000, owed: 5400 },
    },
    // Task 6 (spec: 2026-08-28-labour-v2-release-1, P4, D9.9 — supersedes D4)
    // — this fixture is the "shipped design fixture" the brief names as
    // ALREADY fabricating a half-day bug: `रमेश` (5 present + 1 half) was
    // given `total: 6`, and `विलास` (2 present + 2 half) was given `total: 4`
    // — both silently rounded every half day up to a whole one. Both totals
    // below are now the real sum (present=1, half=0.5, absent/no-fact=0);
    // `dailyTotals`/`weekTotal` are recomputed to match (the old `weekTotal:
    // 28` did not even equal the sum of the old row totals — 6+5+4+7=22 — it
    // was a stray copy of the unrelated `dashboard.manDays` figure above).
    ledger: {
        weekLabel: '७–१३ जुलै',
        days: ['सो', 'मं', 'बु', 'गु', 'शु', 'श', 'र'],
        rows: [
            { personId: 'ramesh', name: 'रमेश', initial: 'र', tone: 'or', cells: [p('present'), p('present'), p('half'), p('present'), p('present'), p('present'), p('absent')], total: 5.5 },
            { personId: 'sunita', name: 'सुनीता', initial: 'सु', tone: 'em', cells: [p('present'), p('present'), p('present'), p('present'), p('present'), p('absent'), p('absent')], total: 5 },
            { personId: 'vilas', name: 'विलास', initial: 'वि', tone: 'rs', cells: [p('absent'), p('half'), p('present'), p('present'), p('half'), p('absent'), p('absent')], total: 3 },
            { personId: 'sandip', name: 'संदीप', initial: 'सं', tone: 'am', cells: [p('present'), p('present'), p('present'), p('present'), p('present'), p('present'), p('present')], total: 7 },
        ],
        dailyTotals: [3, 3.5, 3.5, 4, 3.5, 2, 1],
        weekTotal: 20.5,
    },
    // ids are GUID-shaped (not literal "r1"/"r2"/"r3") so मंजूर/शंका in preview
    // exercise the SAME `VerifyLogPayload.dailyLogId` zod shape (`ZGuid`) a
    // real backend id has — a non-GUID id would fail client-side wire
    // validation and always show the honest failure toast in preview too.
    review: [
        // Task 20 (spec: 2026-08-28-labour-v2-release-1) — the ONLY fixture row
        // that names a plot, and it says so through `plot`/`plotScope` rather
        // than only inside the free-text `detail`. The other two state no plot,
        // so their card renders the em-dash — which is the honest preview of
        // the rule, not a gap in the fixture.
        { id: 'aaaaaaaa-0000-4000-8000-000000000001', who: 'रमेश', initial: 'र', tone: 'or', detail: 'द्राक्ष-२ · आज', status: 'Confirmed', plot: 'द्राक्ष-२', plotScope: 'Plot', points: { count: 4, shift: 'full', task: 'फवारणी', names: ['रमेश'] } },
        { id: 'aaaaaaaa-0000-4000-8000-000000000002', who: 'धनाजी (मुकादम)', initial: 'ध', tone: 'bl', detail: 'छाटणी टीम · आज', status: 'Draft', points: { count: 4, shift: 'full', task: 'छाटणी' } },
        { id: 'aaaaaaaa-0000-4000-8000-000000000003', who: 'रोकडे', initial: 'रो', tone: 'vi', detail: 'शेतात होता ✓ · आज', status: 'Draft', points: { count: 1, shift: 'night', amount: 200 } },
    ],
    attendance: {
        plot: 'द्राक्ष-२',
        headcount: 4,
        rows: [
            { personId: 'ramesh', status: 'present' },
            { personId: 'vilas', status: 'half' },
        ],
        // Preview fixture: no real engagement exists behind a mock, and an
        // invented id here would let the preview appear to attach to one.
        todaysLabourAssignmentId: '',
    },
};
