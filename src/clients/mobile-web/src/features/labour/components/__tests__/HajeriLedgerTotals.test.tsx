// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * HajeriLedgerTotals — Task 6 (spec: 2026-08-28-labour-v2-release-1, P4,
 * D9.9 — supersedes D4). Defect A: `Total`/`DailyTotals`/`WeekTotal` were
 * `int`, so a half day (0.5) had nowhere to go — `labourMock.ts`'s own
 * `LABOUR_MOCK` fixture fabricated this: रमेश (5 present + 1 half) was given
 * `total: 6`, not 5.5, and विलास (2 present + 2 half) was given `total: 4`,
 * not 3 — a whole day of work nobody did, twice over.
 *
 * Distinct from Task 5's `AttendanceDefaultsBlank.test.tsx` (status/presence,
 * `LedgerRow.cells` nullability) — this file owns totals only and does not
 * rework that fixture or its assertions.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import HajeriLedger from '../HajeriLedger';
import { EMPTY_LABOUR_DATA, LABOUR_MOCK } from '../../labourMock';
import type { LabourData } from '../../labour.types';

afterEach(() => cleanup());

/**
 * The "Total" column (per row) and "WeekTotal" (bottom-right) share one
 * class string in HajeriLedger.tsx, distinct from the "day" header cells and
 * the "DailyTotals" row (which use a different, lighter class). Querying by
 * that class scopes these assertions to exactly the totals this task owns,
 * in DOM order: [row1.total, row2.total, ..., rowN.total, weekTotal].
 */
const totalCellsText = (container: HTMLElement): string[] =>
    Array.from(container.querySelectorAll('.font-black.text-slate-800')).map((el) => el.textContent ?? '');

describe('HajeriLedger — Task 6: half-day totals are real decimals, never rounded', () => {
    it('renders every row total and the week total as the real decimal sum, never int-rounded', () => {
        const { container } = render(<HajeriLedger data={LABOUR_MOCK} onToast={vi.fn()} />);

        // LABOUR_MOCK.ledger.rows order: रमेश, सुनीता, विलास, संदीप, then weekTotal.
        // रमेश (5 present + 1 half) = 5.5, not the fabricated 6.
        // विलास (2 present + 2 half) = 3, not the fabricated 4.
        // Week total = the real sum of every row (5.5 + 5 + 3 + 7 = 20.5),
        // never "5.500000"-style padding — decimal's natural minimal-scale
        // representation renders it exactly.
        expect(totalCellsText(container)).toEqual(['5.5', '5', '3', '7', '20.5']);
    });

    it('renders "—" for an unknown week total, never a fabricated 0', () => {
        const data: LabourData = {
            ...EMPTY_LABOUR_DATA,
            ledger: {
                weekLabel: 'wk',
                days: ['सो'],
                rows: [{ personId: 'w1', name: 'कामगार', initial: 'क', tone: 'or', cells: ['present'], total: 1 }],
                dailyTotals: [1],
                weekTotal: null,
            },
        };
        const { container } = render(<HajeriLedger data={data} onToast={vi.fn()} />);

        // [row.total, weekTotal] — the row's own total (1, a real fact) stays
        // real; only the unknown weekTotal renders as "—".
        expect(totalCellsText(container)).toEqual(['1', '—']);
    });

    it('still renders a real, known week total (not "—") once it is known', () => {
        const data: LabourData = {
            ...EMPTY_LABOUR_DATA,
            ledger: {
                weekLabel: 'wk',
                days: ['सो'],
                rows: [{ personId: 'w1', name: 'कामगार', initial: 'क', tone: 'or', cells: ['present'], total: 1 }],
                dailyTotals: [1],
                weekTotal: 7,
            },
        };
        const { container } = render(<HajeriLedger data={data} onToast={vi.fn()} />);

        expect(totalCellsText(container)).toEqual(['1', '7']);
    });
});
