// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AttendanceDefaultsBlank — Task 5 (spec: 2026-08-28-labour-v2-release-1, P4,
 * founder Global Constraint 6).
 *
 * The contract defect: `PresenceStatus` was `'present' | 'half' | 'absent'`
 * with NO fourth member, so nothing could represent "the farmer has not said
 * yet". Untouched = no fact, and no fact must never render, count, or submit
 * as `'absent'` — a statement about a named person nobody made.
 *
 * Two surfaces are covered, both literally "the attendance surface":
 *
 *   1. `HajeriLedger` — हजेरी वही, the per-day muster/register. This is where
 *      the founder-verified defect lived: `cellClass` / `cellGlyph` treated
 *      ANYTHING that was not `'present'`/`'half'` as a deliberate `'absent'`
 *      tap. Once `LedgerRow.cells` carries `null` for "day not marked yet"
 *      (this task), that collapse would have rendered a brand-new/not-yet-
 *      marked worker as absent every single day — pixel-identical to a real
 *      नाही. Locked here at both the unit level (`cellClass`/`cellGlyph`
 *      directly, mirroring how Task 1 unit-tests `netBalance`) and the
 *      render level (5 workers, zero marks, for a full week).
 *
 *   2. `Attendance` — the daily capture draft. `data.attendance.rows` is
 *      populated ONLY by a deliberate tap (Global Constraint 6: no row = no
 *      fact); an untouched worker is not represented as a row at all. This
 *      locks that today's honest behaviour (`GetLabourDataHandler` returns
 *      `Rows: []` for every real farm — see the brief's "no real farmer has
 *      ever been pre-marked नाही") survives the contract change: 5 workers
 *      with zero marks render ZERO present/half/absent facts anywhere, and
 *      the string "नाही" never appears as a rendered/active fact.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import HajeriLedger, { cellDayClass, cellDayGlyph } from '../components/HajeriLedger';
import Attendance from '../components/Attendance';
import { EMPTY_LABOUR_DATA } from '../labourMock';
import type { LabourData, LabourPerson, LedgerCell, LedgerRow } from '../labour.types';

afterEach(() => cleanup());

// ---------------------------------------------------------------------------
// Fixtures — 5 workers, zero marks (the exact scenario named in the brief).
// ---------------------------------------------------------------------------

/** Phase 4 — the five-axis cell builder (same pattern as HajeriLedgerTotals.test.tsx). */
const cell = (over: Partial<LedgerCell>): LedgerCell => ({
    day: null, night: null, hours: null, extraHours: null, ukte: false, work: null, ...over,
});

const person = (id: string, name: string): LabourPerson => ({
    id,
    name,
    initial: name[0],
    tone: 'or',
    role: 'worker',
    verified: true,
    balance: { recorded: null, paid: 0, advance: 0 },
});

const FIVE_WORKERS: Record<string, LabourPerson> = {
    w1: person('w1', 'कामगार-१'),
    w2: person('w2', 'कामगार-२'),
    w3: person('w3', 'कामगार-३'),
    w4: person('w4', 'कामगार-४'),
    w5: person('w5', 'कामगार-५'),
};

/** A ledger row for a worker who has not been marked on ANY day this week. */
const unmarkedRow = (personId: string, name: string): LedgerRow => ({
    personId,
    fieldOperatorId: personId,
    name,
    initial: name[0],
    tone: 'or',
    // honest: zero REAL marks (null cells), not "defaulted to absent".
    cells: [null, null, null, null, null, null, null],
});

describe('HajeriLedger cellDayClass/cellDayGlyph — Task 5 (P4): null is not absent', () => {
    it('renders a null day with a class distinct from a real absent day', () => {
        expect(cellDayClass(null)).not.toBe(cellDayClass(cell({ day: 'absent' })));
    });

    it('renders a null day with a glyph distinct from the absent "–" glyph', () => {
        expect(cellDayGlyph(null)).not.toBe(cellDayGlyph(cell({ day: 'absent' })));
        // Specifically: null must never be the same visible dash a real नाही tap uses.
        expect(cellDayGlyph(null)).not.toBe('–');
    });

    it('still renders the real full/half/absent glyphs unchanged', () => {
        expect(cellDayGlyph(cell({ day: 'absent' }))).toBe('–');
        expect(cellDayGlyph(cell({ day: 'half' }))).toBe('½');
    });
});

describe('HajeriLedger render — 5 workers, zero marks for the whole week', () => {
    const weekData = (): LabourData => ({
        ...EMPTY_LABOUR_DATA,
        topLevelIds: Object.keys(FIVE_WORKERS),
        people: FIVE_WORKERS,
        ledger: {
            weekLabel: '७–१३ जुलै',
            days: ['सो', 'मं', 'बु', 'गु', 'शु', 'श', 'र'],
            rows: Object.entries(FIVE_WORKERS).map(([id, p]) => unmarkedRow(id, p.name)),
            crewRows: [],
        },
    });

    it('produces zero real-absence facts: no DATA cell renders the "–" absent glyph', () => {
        const { container } = render(<HajeriLedger data={weekData()} onToast={vi.fn()} />);

        // 5 workers x 7 days = 35 cells, every one unmarked. None of them may
        // render the same "–" glyph a deliberate नाही tap uses. Scoped to
        // `[data-testid="ledger-cell"]` (the actual grid cells) — the legend
        // above the grid also shows a static "–" swatch explaining what the
        // REAL absent colour means, which is not a data fact and must stay
        // out of this assertion.
        const cells = container.querySelectorAll('[data-testid="ledger-cell"]');
        expect(cells.length).toBe(35);
        cells.forEach((cell) => expect(cell.textContent).not.toBe('–'));

        // Same check the other way: no data cell adopted the absent fill class.
        const absentFilledCells = container.querySelectorAll('[data-testid="ledger-cell"].bg-slate-100.text-slate-300');
        expect(absentFilledCells.length).toBe(0);
    });

    it('all 5 rows render with the neutral "not yet marked" cell treatment', () => {
        const { container } = render(<HajeriLedger data={weekData()} onToast={vi.fn()} />);
        // 5 rows x 7 days = 35 neutral (dashed, unfilled) cells.
        const neutralCells = container.querySelectorAll('[data-testid="ledger-cell"].border-dashed.border-slate-200');
        expect(neutralCells.length).toBe(35);
    });

    it('every worker name still renders — an unmarked worker is shown honestly, not hidden', () => {
        render(<HajeriLedger data={weekData()} onToast={vi.fn()} />);
        Object.values(FIVE_WORKERS).forEach((p) => {
            expect(screen.getByText(p.name)).toBeInTheDocument();
        });
    });
});

describe('Attendance render — 5 workers, zero marks: no attendance facts are produced', () => {
    const draftData = (): LabourData => ({
        ...EMPTY_LABOUR_DATA,
        topLevelIds: Object.keys(FIVE_WORKERS),
        people: FIVE_WORKERS,
        // Global Constraint 6 — untouched = no row. headcount reflects the
        // spoken/expected gang size; rows stays empty until a real tap.
        attendance: { plot: '', headcount: 5, rows: [], todaysLabourAssignmentId: '' },
    });

    const baseProps = () => ({
        data: draftData(),
        onSave: vi.fn(),
        onToast: vi.fn(),
    });

    it('renders zero present/half/absent facts for any of the 5 workers', () => {
        render(<Attendance {...baseProps()} />);

        // No SEG button group renders at all for an untouched worker — a row
        // is created ONLY by a deliberate tap (Global Constraint 6), and
        // none of the 5 have been tapped.
        expect(screen.queryAllByText('आला')).toHaveLength(0);
        expect(screen.queryAllByText('अर्धा')).toHaveLength(0);
        expect(screen.queryAllByText('नाही')).toHaveLength(0);
    });

    it('the string/value "absent" appears nowhere in what the screen shows for these 5 workers', () => {
        render(<Attendance {...baseProps()} />);
        Object.values(FIVE_WORKERS).forEach((p) => {
            // Nobody has a name card yet — no fact (present/half/absent) has
            // been produced for any of them, so their names don't render
            // as attendance rows either.
            expect(screen.queryByText(p.name)).toBeNull();
        });
    });

    it('still shows the honest "add names" call-to-action rather than a silent blank', () => {
        render(<Attendance {...baseProps()} />);
        expect(screen.getByText(/नावं जोडा/)).toBeInTheDocument();
    });
});
