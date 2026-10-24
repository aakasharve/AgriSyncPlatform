// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 5 Task 5.3 (founder master review 2026-09-02, D4) — the render half
 * of the clean register: no ₹ anywhere in the grid, no totals column, no
 * totals row. Name + seven day cells, details only on tap.
 *
 * Companion pins that stay where they are: AttendanceDefaultsBlank.test.tsx
 * owns blank(unknown) ≠ absent; CleanRegisterRules.cs owns the DTO contract.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import HajeriLedger from '../HajeriLedger';
import type { LabourData, LedgerCell } from '../../labour.types';
import { EMPTY_LABOUR_DATA } from '../../labourMock';

afterEach(() => cleanup());

const cell = (partial: Partial<LedgerCell>): LedgerCell => ({
    day: null, night: null, hours: null, extraHours: null, ukte: false, work: null, ...partial,
});

/** A week exercising all five stated realities + the उक्ते marker. */
const FIXTURE: LabourData = {
    ...EMPTY_LABOUR_DATA,
    ledger: {
        weekLabel: '३१ ऑग – ६ सप्टें',
        days: ['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06'],
        crewRows: [],
        rows: [
            {
                personId: 'w1', fieldOperatorId: 'op-1', name: 'गणेश', initial: 'ग', tone: 'em',
                cells: [
                    cell({ day: 'full' }),
                    cell({ day: 'half' }),
                    cell({ day: 'absent' }),
                    null, // कुणी माहिती नाही — blank, never '–'
                    cell({ day: 'full', night: 'worked' }), // split cell
                    cell({ day: 'full', extraHours: 2 }),   // +2 जादा
                    cell({ night: 'worked', hours: 3 }),    // 3त, रात्र
                ],
            },
            {
                personId: 'w2', fieldOperatorId: 'op-2', name: 'शंकर', initial: 'श', tone: 'or',
                cells: [
                    cell({ day: 'full', ukte: true }), // violet dot — उक्ते engagement
                    null, null, null, null, null, null,
                ],
            },
        ],
    },
} as LabourData;

describe('HajeriLedger — the clean register (D4, 2026-09-02)', () => {
    it('renders no ₹ anywhere', () => {
        const { container } = render(<HajeriLedger data={FIXTURE} onToast={vi.fn()} />);
        expect(container.textContent).not.toContain('₹');
    });

    it('every row is name + one cell per day, nothing trailing', () => {
        const { container } = render(<HajeriLedger data={FIXTURE} onToast={vi.fn()} />);
        const rows = container.querySelectorAll('[data-testid="ledger-row"]');
        expect(rows.length).toBe(FIXTURE.ledger.rows.length);

        rows.forEach((row) => {
            const cells = row.querySelectorAll('[data-testid="ledger-cell"]');
            expect(cells.length).toBe(FIXTURE.ledger.days.length);
            // No totals column: the strip holding the day cells is the row's
            // LAST element — nothing may render after the seventh cell.
            const last = row.lastElementChild;
            expect(last).not.toBeNull();
            expect(last!.contains(cells[cells.length - 1])).toBe(true);
        });
    });

    it('no totals row renders', () => {
        const { container } = render(<HajeriLedger data={FIXTURE} onToast={vi.fn()} />);
        // The old grid closed with an 'एकूण' row summing every column. The
        // clean register has no bottom line of any kind; day-count reads
        // live in detail views only.
        expect(container.textContent).not.toContain('एकूण');
    });
});
