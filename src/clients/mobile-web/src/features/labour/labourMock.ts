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
    LedgerCell,
    LedgerCrewRow,
    LabourView,
    ReviewItem,
    ReviewVerificationStatus,
    PlotBar,
    DashboardData,
    LabourData,
} from './labour.types';
export { netBalance, inr } from './labour.types';

import type { LabourData, LabourPerson, LedgerCell } from './labour.types';

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

// Phase 4 (master review D4) — cell builder for the five-axis LedgerCell.
// `p(null)` (no overrides) is the null CELL: no mark that day at all.
const p = (day: 'full' | 'half' | 'absent' | null, over: Partial<LedgerCell> = {}): LedgerCell | null =>
    day === null && Object.keys(over).length === 0
        ? null
        : { day, night: null, hours: null, extraHours: null, ukte: false, work: null, ...over };

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
        // Phase 4 — pre-fetch there is no evidence for ANY money figure;
        // blank is not zero. Same R8 reasoning as manDays/owed above.
        wages: null,
        advances: null,
        owed: null,
        logs: 0,
        pending: 0,
        plots: [],
        money: null,
    },
    ledger: { weekLabel: '', days: [], rows: [], crewRows: [] },
    view: 'owner' as const,
    review: [],
    attendance: { plot: '', headcount: 0, rows: [], todaysLabourAssignmentId: '' },
};

/**
 * Correction 5 fix round (Task 4.5 review) — the REALISTIC zero-marks wire,
 * distinct from `EMPTY_LABOUR_DATA` above. That one is the PRE-EVIDENCE
 * shape (loading / failed fetch: `days: []`, nulls — "we know nothing").
 * This one models what the backend actually sends when the fetch SUCCEEDS
 * for a farm with no attendance yet: on the default unbounded window with
 * zero marks and zero logs, `GetLabourDataHandler` emits the current
 * farm-local Monday-anchored week, blank (`GetLabourDataHandler.cs:852-857`
 * — "none at all → the current farm-local week, blank"), a machine-date
 * `weekLabel` (suppressed client-side by the shared `weekLabel.ts` guard),
 * no rows, no crew rows, and the owner projection. Used by the real-route
 * click-through pin in `LabourFeature.test.tsx`: the हजेरी वही door opens
 * onto exactly this and the register draws a blank week — blank cells,
 * never zero.
 */
export const EMPTY_WEEK_LABOUR_DATA: LabourData = {
    ...EMPTY_LABOUR_DATA,
    ledger: {
        weekLabel: '2026-08-24',
        days: ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30'],
        rows: [],
        crewRows: [],
    },
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
    // Phase 4 (master review D4) — the CLEAN register fixture: the same four
    // people and week shape, rewritten to five-axis cells. No totals of any
    // kind (they left the contract with `LedgerRow.total`). Hand-drawn
    // preview data, clearly mock — chosen so the preview exercises every
    // approved axis: a split day/night cell, a night-only cell with stated
    // hours, an उक्ते contract cell with tap-detail work context, extra
    // hours, and a crew aggregate row with an unknown (blank) day.
    ledger: {
        weekLabel: '७–१३ जुलै',
        days: ['सो', 'मं', 'बु', 'गु', 'शु', 'श', 'र'],
        rows: [
            { personId: 'ramesh', fieldOperatorId: 'ramesh', name: 'रमेश', initial: 'र', tone: 'or', cells: [p('full', { night: 'worked' }), p('full'), p('half'), p(null, { night: 'worked', hours: 3 }), p('full', { ukte: true, work: 'द्राक्ष छाटणी' }), p('full'), p('absent')] },
            { personId: 'sunita', fieldOperatorId: 'sunita', name: 'सुनीता', initial: 'सु', tone: 'em', cells: [p('full'), p('full'), p('full'), p('full'), p('full', { extraHours: 2 }), p('absent'), p('absent')] },
            { personId: 'vilas', fieldOperatorId: 'vilas', name: 'विलास', initial: 'वि', tone: 'rs', cells: [p('absent'), p('half'), p('full'), p('full'), p('half'), p('absent'), p('absent')] },
            { personId: 'sandip', fieldOperatorId: 'sandip', name: 'संदीप', initial: 'सं', tone: 'am', cells: [p('full'), p('full'), p('full'), p('full'), p('full'), p('full'), p('full')] },
        ],
        crewRows: [{ throughFieldOperatorId: 'shankar-crew', throughName: 'शंकर', counts: [8, 8, null, 8, null, 4, null] }],
    },
    view: 'owner' as const,
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
