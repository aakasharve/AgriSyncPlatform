// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * HajeriLedger — Phase 4 (Labour V2 R1, founder master review 2026-09-02 D4):
 * the CLEAN register. This file previously pinned that totals were never
 * int-rounded; the founder then removed totals from the grid entirely, which
 * is that intent's final form: a total that does not exist cannot fabricate.
 * "नावाखाली कोणताही summary, कामाचा मजकूर किंवा पैशांची कळ नाही."
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import HajeriLedger from '../HajeriLedger';
import HajeriCellDetail from '../HajeriCellDetail';
import { LABOUR_MOCK } from '../../labourMock';
import type { LabourData, LedgerCell, LedgerRow } from '../../labour.types';

// For the deploy-skew pin only: fetchLabourData through the mocked shared
// client, so the wire-without-view case is exercised through the REAL mapper.
const mockGet = vi.hoisted(() => vi.fn());
vi.mock('../../../../infrastructure/api/AgriSyncClient', () => ({
    agriSyncClient: { http: { get: mockGet } },
}));
import { fetchLabourData } from '../../data/labourClient';

afterEach(() => cleanup());

const cell = (over: Partial<LedgerCell>): LedgerCell => ({
    day: null, night: null, hours: null, extraHours: null, ukte: false, work: null, ...over,
});

const withLedger = (ledger: LabourData['ledger']): LabourData => ({ ...LABOUR_MOCK, ledger });

describe('HajeriLedger — the clean register (master review D4)', () => {
    it('renders no ₹ and no trailing column anywhere in the grid', () => {
        const { container } = render(<HajeriLedger data={LABOUR_MOCK} onToast={vi.fn()} />);
        expect(container.textContent).not.toContain('₹');
        expect(container.textContent).not.toContain('एकूण');
        // one header cell per day and nothing after them
        expect(container.querySelectorAll('[data-testid="ledger-day-head"]').length)
            .toBe(LABOUR_MOCK.ledger.days.length);
        expect(container.querySelector('[data-testid="ledger-row-total"]')).toBeNull();
    });

    it('a NIGHT-only cell renders the night marker and never the full-day tick', () => {
        const { container } = render(<HajeriLedger data={withLedger({
            weekLabel: '',
            days: ['2026-08-24'],
            rows: [{ personId: 'op:1', fieldOperatorId: '1', name: 'गणेश', initial: 'ग', tone: 'or',
                cells: [cell({ night: 'worked' })] }],
            crewRows: [],
        })} onToast={vi.fn()} />);

        const c = container.querySelector('[data-testid="ledger-cell"]')!;
        expect(c.textContent).toContain('◾');
        expect(c.querySelector('svg')).toBeNull();   // the ✓ tick is an svg; a night is not a day
    });

    it('stated hours and extra hours render as stated — Nत and +N — never converted', () => {
        const { container } = render(<HajeriLedger data={withLedger({
            weekLabel: '',
            days: ['2026-08-24', '2026-08-25'],
            rows: [{ personId: 'op:1', fieldOperatorId: '1', name: 'गणेश', initial: 'ग', tone: 'or',
                cells: [cell({ night: 'worked', hours: 3 }), cell({ day: 'full', extraHours: 2 })] }],
            crewRows: [],
        })} onToast={vi.fn()} />);

        expect(container.textContent).toContain('3त');
        expect(container.textContent).toContain('+2');
        expect(container.textContent).not.toContain('0.375'); // no day-fraction arithmetic, ever
    });

    it('the उक्ते dot renders exactly on cells whose engagement is a contract', () => {
        const { container } = render(<HajeriLedger data={withLedger({
            weekLabel: '',
            days: ['2026-08-24', '2026-08-25'],
            rows: [{ personId: 'op:1', fieldOperatorId: '1', name: 'गणेश', initial: 'ग', tone: 'or',
                cells: [cell({ day: 'full', ukte: true }), cell({ day: 'full' })] }],
            crewRows: [],
        })} onToast={vi.fn()} />);

        const dots = container.querySelectorAll('[data-testid="ledger-ukte-dot"]');
        expect(dots.length).toBe(1);
    });

    it('a crew row draws stated counts and leaves unknown days blank — never 0', () => {
        const { container } = render(<HajeriLedger data={withLedger({
            weekLabel: '',
            days: ['2026-08-24', '2026-08-25'],
            rows: [],
            crewRows: [{ throughFieldOperatorId: '1', throughName: 'शंकर', counts: [8, null] }],
        })} onToast={vi.fn()} />);

        expect(container.textContent).toContain('शंकरसोबत');
        const cells = container.querySelectorAll('[data-testid="ledger-crew-cell"]');
        expect(cells[0].textContent).toBe('8');
        expect(cells[1].textContent).toBe('');
    });

    it('zero rows still draw the week — the empty card sits BELOW the grid, never instead of it', () => {
        const { container } = render(<HajeriLedger data={withLedger({
            weekLabel: '', days: ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30'],
            rows: [], crewRows: [],
        })} onToast={vi.fn()} />);

        expect(container.querySelectorAll('[data-testid="ledger-day-head"]').length).toBe(7);
        expect(container.textContent).toContain('अजून हजेरी नोंदवली नाही');
    });

    /**
     * F1 CORRECTION (4.2 review, binding): the empty-state CLAIM card
     * ("अजून हजेरी नोंदवली नाही") renders for the OWNER view only. For
     * `data.view !== 'owner'` an empty register is empty BY PROJECTION — rows
     * were WITHHELD, not absent — and rendering the claim would present
     * withholding as the fact "nothing was recorded" (the exact
     * absence-as-fact defect this release removes). Non-owner + empty renders
     * the bare week grid (day headers, no rows) and claims nothing; no new
     * Marathi exists for a withheld state (founder-gate item if ever wanted).
     */
    it('a non-owner view with zero rows draws the bare week and claims NOTHING', () => {
        const { container } = render(<HajeriLedger data={{
            ...LABOUR_MOCK,
            view: 'own',
            ledger: {
                weekLabel: '', days: ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30'],
                rows: [], crewRows: [],
            },
        }} onToast={vi.fn()} />);

        expect(container.querySelectorAll('[data-testid="ledger-day-head"]').length).toBe(7);
        expect(container.textContent).not.toContain('अजून हजेरी नोंदवली नाही');
    });

    /**
     * Carried MINOR (3.4b precedent — display dedup, exact key, never
     * identity resolution): a duplicated parse name resolves to ONE
     * FieldOperator (rule 10), i.e. one `personId` — so if a duplicate ROW
     * for the same personId ever reaches the grid it must render ONCE, the
     * way the result screen renders a duplicated parse name as one chip.
     * Two DIFFERENT people who legitimately share a name (two personIds)
     * stay two rows — identical names are legitimate (B002 ruling); only the
     * exact grouping key dedups, never the display string.
     */
    it('a duplicated row for the same person renders once; same-named REAL people stay two rows', () => {
        const ganesh = { fieldOperatorId: '1', name: 'गणेश', initial: 'ग', tone: 'or' as const, cells: [cell({ day: 'full' })] };
        const duplicated = render(<HajeriLedger data={withLedger({
            weekLabel: '', days: ['2026-08-24'],
            rows: [{ personId: 'op:1', ...ganesh }, { personId: 'op:1', ...ganesh }],
            crewRows: [],
        })} onToast={vi.fn()} />);
        expect(duplicated.container.querySelectorAll('[data-testid="ledger-row"]').length).toBe(1);
        cleanup();

        const twoPeople = render(<HajeriLedger data={withLedger({
            weekLabel: '', days: ['2026-08-24'],
            rows: [
                { personId: 'op:1', ...ganesh },
                { personId: 'op:2', ...ganesh, fieldOperatorId: '2' },
            ],
            crewRows: [],
        })} onToast={vi.fn()} />);
        expect(twoPeople.container.querySelectorAll('[data-testid="ledger-row"]').length).toBe(2);
    });

    /**
     * 4.3 review B001 (controller ruling), end-to-end: a wire WITHOUT `view`
     * (a pre-projection API — forward deploy skew) + empty rows must NOT
     * render the claim card. The mapper fails closed to 'own' (never
     * 'owner', the only view allowed to CLAIM), so the bare week grid
     * renders — true silence. On the real new stack View is always present
     * and this path never runs.
     */
    it('a wire WITHOUT view and empty rows renders the bare grid and claims NOTHING', async () => {
        mockGet.mockResolvedValueOnce({
            status: 200,
            data: {
                topLevelIds: [],
                people: [],
                dashboard: {
                    weekLabel: '', insight: '', manDays: null, manDaysTrend: 0,
                    wages: null, advances: null, owed: null, logs: 0, pending: 0,
                    plots: [], money: null,
                },
                ledger: {
                    weekLabel: '',
                    days: ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30'],
                    rows: [], crewRows: [],
                },
                review: [],
                attendance: { plot: '', headcount: null, rows: [] },
                // deliberately NO `view` member — the old wire's shape
            },
        });

        const data = await fetchLabourData('farm-skew');
        expect(data.view).toBe('own'); // fail closed — never the claiming view

        const { container } = render(<HajeriLedger data={data} onToast={vi.fn()} />);
        expect(container.querySelectorAll('[data-testid="ledger-day-head"]').length).toBe(7);
        expect(container.textContent).not.toContain('अजून हजेरी नोंदवली नाही');
    });
});

/**
 * Deferred acceptance halves from Task 5's fix round, CLOSED here (Task 6,
 * brief 4.2 — the task where the no-work-day flow lands). The backend half is
 * already pinned by `ANoWorkDayStillCarriesItsColumnAndItsMarks`: a declared
 * no-work day (a NO_WORK_PLANNED DailyLog) keeps its column and its marks,
 * and — having no engagements — contributes no work context to any cell.
 * These are the FRONTEND halves of the same truth (rules 6/7): the register
 * renders WHO came and NOTHING that concludes work happened, and it opens
 * with no headcount at all — blank cells, never zero, never fabricated
 * absence.
 */
describe('Deferred from Task 5 acceptance — the no-work day and the headcount-less open', () => {
    /** The wire shape a declared no-work day produces: a mark, no work context. */
    const noWorkDayRow: LedgerRow = {
        personId: 'op:1', fieldOperatorId: '1', name: 'गणेश', initial: 'ग', tone: 'or',
        cells: [null, null, null, null, cell({ day: 'full', work: null }), null, null],
    };
    const noWorkWeek = (): LabourData => withLedger({
        weekLabel: '',
        days: ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30'],
        rows: [noWorkDayRow],
        crewRows: [],
    });

    it('a declared no-work day renders WHO came and nothing that claims work', () => {
        const { container } = render(<HajeriLedger data={noWorkWeek()} onToast={vi.fn()} />);

        // The day keeps its column and the mark renders — the हजेरी fact.
        expect(container.querySelectorAll('[data-testid="ledger-day-head"]').length).toBe(7);
        const cells = container.querySelectorAll('[data-testid="ledger-cell"]');
        expect(cells.length).toBe(7);
        expect(cells[4].querySelector('svg')).not.toBeNull(); // the ✓ tick

        // Nothing concludes work happened: no work text in any cell (the ✓ is
        // an svg — the cells carry NO text), no उक्ते dot, and the six
        // unmarked days stay blank — never '–', never 0.
        cells.forEach((c) => expect(c.textContent).toBe(''));
        expect(container.querySelector('[data-testid="ledger-ukte-dot"]')).toBeNull();
    });

    it('tap-detail on the no-work-day mark says पूर्ण and shows no work — WHO without a WHAT', () => {
        const { container } = render(
            <HajeriCellDetail row={noWorkDayRow} dayIndex={4} dayIso="2026-08-28" onClose={vi.fn()} />);
        expect(container.textContent).toContain('पूर्ण');
        // No work chip renders: the string 'काम' reaches this surface only
        // through a work context ('उक्ते काम' or the work string itself), and
        // a declared no-work day has none to show.
        expect(container.textContent).not.toContain('काम');
    });

    it('no headcount anywhere: the register opens from marks alone and blank stays blank', () => {
        const { container } = render(<HajeriLedger data={{
            ...noWorkWeek(),
            attendance: { plot: '', headcount: null, rows: [], todaysLabourAssignmentId: '' },
        }} onToast={vi.fn()} />);

        expect(container.querySelectorAll('[data-testid="ledger-day-head"]').length).toBe(7);
        expect(container.querySelectorAll('[data-testid="ledger-row"]').length).toBe(1);
        container.querySelectorAll('[data-testid="ledger-cell"]').forEach((c) => {
            expect(c.textContent).not.toBe('0'); // never a fabricated count
            expect(c.textContent).not.toBe('–'); // never a fabricated absence
        });
    });
});

import LabourHub from '../LabourHub';
import WeeklyDashboard from '../WeeklyDashboard';

describe('Correction 5 — the ledger door is not a switch', () => {
    it('the हजेरी वही tile renders on a real farm (no preview, no flag)', () => {
        const { getAllByText } = render(
            <LabourHub
                data={LABOUR_MOCK}
                onOpenMukadam={vi.fn()} onOpenPerson={vi.fn()} onAttendance={vi.fn()}
                onDashboard={vi.fn()} onLedger={vi.fn()} onReview={vi.fn()} onGoToLog={vi.fn()}
            />);
        expect(getAllByText('हजेरी वही').length).toBeGreaterThan(0);
    });

    it('the dashboard हजेरी वही button renders unconditionally', () => {
        const { getAllByText } = render(
            <WeeklyDashboard
                data={LABOUR_MOCK}
                onReview={vi.fn()} onLedger={vi.fn()} onToast={vi.fn()}
                timeWindow="alltime" onTimeWindowChange={vi.fn()}
            />);
        expect(getAllByText('हजेरी वही').length).toBeGreaterThan(0);
    });
});
