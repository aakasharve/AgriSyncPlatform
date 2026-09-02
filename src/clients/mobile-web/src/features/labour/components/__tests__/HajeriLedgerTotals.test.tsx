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
import { LABOUR_MOCK } from '../../labourMock';
import type { LabourData, LedgerCell } from '../../labour.types';

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
});
