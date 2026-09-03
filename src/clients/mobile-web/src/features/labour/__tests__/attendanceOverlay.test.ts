/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Task 9 (B001, spec: 2026-08-28-labour-v2-release-1) — the pure compose that
 * finally CONSUMES Phase 3's local attendance plane. Every pin here is one of
 * the task's named decisions:
 *
 *   - a queue-intent mark renders, labelled `unsynced` (P10: weaker, never
 *     presented as saved);
 *   - the merge is PER-HALF (B002): an unspoken half never erases an
 *     acknowledged fact from the render;
 *   - only `source: 'queue'` overlays a successful fetch — a Dexie 'server'
 *     row may be staler than the GET;
 *   - a person or a date the wire did not draw still gets its row/column —
 *     a hidden fact is the exact defect this task removes;
 *   - no queue marks → the SAME object back (the hook's money-safety tests
 *     pin identity with `toBe`);
 *   - offline, the register is built from the plane: 'server' rows as
 *     acknowledged cells, 'queue' rows weaker, `view: 'own'` (fail-closed —
 *     no owner-only claim card), and NOTHING when the plane is empty.
 */
import { describe, it, expect } from 'vitest';
import { overlayLocalAttendance, buildOfflineRegister } from '../attendanceOverlay';
import { EMPTY_LABOUR_DATA } from '../labourMock';
import type { LabourData, LedgerCell } from '../labour.types';
import type { LocalAttendanceMark } from '../data/attendanceLocal';

const GANESH = '33333333-3333-3333-3333-333333333333';
const SHANKAR = '55555555-5555-5555-5555-555555555555';

const cell = (over: Partial<LedgerCell>): LedgerCell => ({
    day: null, night: null, hours: null, extraHours: null, ukte: false, work: null, ...over,
});

const serverData = (): LabourData => ({
    ...EMPTY_LABOUR_DATA,
    ledger: {
        weekLabel: '',
        days: ['2026-09-01', '2026-09-02'],
        rows: [{
            personId: 'op:ganesh', fieldOperatorId: GANESH, name: 'गणेश', initial: 'ग', tone: 'em',
            cells: [cell({ day: 'full', ukte: true, work: 'छाटणी' }), null],
        }],
        crewRows: [{ throughFieldOperatorId: 'crew-1', throughName: 'शंकर', counts: [8, null] }],
    },
});

const queueMark = (over: Partial<LocalAttendanceMark>): LocalAttendanceMark => ({
    fieldOperatorId: GANESH, workDate: '2026-09-02', dayMark: 'Full', source: 'queue', ...over,
});

describe('overlayLocalAttendance — queue intent reaches the register, weaker', () => {
    it('renders a queue mark in the matching row/day cell, labelled unsynced', () => {
        const out = overlayLocalAttendance(serverData(), [queueMark({})]);
        const c = out.ledger.rows[0].cells[1];
        expect(c).not.toBeNull();
        expect(c!.day).toBe('full');
        expect(c!.unsynced).toBe(true);
        // the acknowledged cell is untouched and NOT relabelled
        expect(out.ledger.rows[0].cells[0]!.unsynced).not.toBe(true);
    });

    it('merges PER-HALF: a night-only amend never erases the acknowledged day half', () => {
        const out = overlayLocalAttendance(serverData(), [
            queueMark({ workDate: '2026-09-01', dayMark: undefined, nightMark: 'Worked' }),
        ]);
        const c = out.ledger.rows[0].cells[0]!;
        expect(c.day).toBe('full');        // acknowledged, carried
        expect(c.night).toBe('worked');    // the queued half
        expect(c.ukte).toBe(true);         // engagement context stays the server's
        expect(c.unsynced).toBe(true);
    });

    it('a person the wire did not row gets a row, named from people, cells aligned to days', () => {
        const data = serverData();
        data.people = {
            [SHANKAR]: { id: SHANKAR, name: 'शंकर', initial: 'श', tone: 'or', role: 'worker', verified: false, temporary: false, balance: { recorded: null, paid: null, advance: null } },
        } as LabourData['people'];
        const out = overlayLocalAttendance(data, [queueMark({ fieldOperatorId: SHANKAR, dayMark: 'Half' })]);
        const row = out.ledger.rows.find((r) => r.fieldOperatorId === SHANKAR);
        expect(row).toBeDefined();
        expect(row!.name).toBe('शंकर');
        expect(row!.cells).toHaveLength(out.ledger.days.length);
        expect(row!.cells[1]!.day).toBe('half');
        expect(row!.cells[1]!.unsynced).toBe(true);
    });

    it('falls back to the attach-time snapshot, then blank — never an invented name', () => {
        const hints = new Map([[SHANKAR, 'शंकर मुकादम']]);
        const withHint = overlayLocalAttendance(serverData(), [queueMark({ fieldOperatorId: SHANKAR })], hints);
        expect(withHint.ledger.rows.find((r) => r.fieldOperatorId === SHANKAR)!.name).toBe('शंकर मुकादम');

        const without = overlayLocalAttendance(serverData(), [queueMark({ fieldOperatorId: SHANKAR })]);
        expect(without.ledger.rows.find((r) => r.fieldOperatorId === SHANKAR)!.name).toBe('');
    });

    it('a date the wire did not draw gains a sorted column, every row and crew row realigned', () => {
        const out = overlayLocalAttendance(serverData(), [queueMark({ workDate: '2026-08-30' })]);
        expect(out.ledger.days).toEqual(['2026-08-30', '2026-09-01', '2026-09-02']);
        expect(out.ledger.rows[0].cells).toHaveLength(3);
        expect(out.ledger.rows[0].cells[0]!.day).toBe('full');   // the queue mark, first column
        expect(out.ledger.rows[0].cells[0]!.unsynced).toBe(true);
        expect(out.ledger.rows[0].cells[1]!.day).toBe('full');   // the acknowledged cell moved with its date
        expect(out.ledger.crewRows[0].counts).toEqual([null, 8, null]); // inserted silence, never 0
    });

    it('returns the SAME object when no queue mark exists (identity — money-safety toBe pins)', () => {
        const data = serverData();
        expect(overlayLocalAttendance(data, [])).toBe(data);
        expect(overlayLocalAttendance(data, [queueMark({ source: 'server' })])).toBe(data);
    });
});

describe('buildOfflineRegister — the outage state renders the local plane', () => {
    it('renders server-sourced marks as acknowledged cells and queue marks weaker', () => {
        const out = buildOfflineRegister([
            queueMark({ workDate: '2026-09-01', source: 'server' }),
            queueMark({ workDate: '2026-09-02', dayMark: 'Half' }),
        ], new Map([[GANESH, 'गणेश']]));
        expect(out).not.toBeNull();
        expect(out!.ledger.days).toEqual(['2026-09-01', '2026-09-02']);
        const row = out!.ledger.rows[0];
        expect(row.name).toBe('गणेश');
        expect(row.cells[0]!.day).toBe('full');
        expect(row.cells[0]!.unsynced).not.toBe(true); // acknowledged, reconstructable
        expect(row.cells[1]!.day).toBe('half');
        expect(row.cells[1]!.unsynced).toBe(true);
    });

    it('a queued amend overlays the server-sourced fact per-half, offline too', () => {
        const out = buildOfflineRegister([
            queueMark({ workDate: '2026-09-01', source: 'server' }),
            queueMark({ workDate: '2026-09-01', dayMark: undefined, nightMark: 'Worked' }),
        ]);
        const c = out!.ledger.rows[0].cells[0]!;
        expect(c.day).toBe('full');
        expect(c.night).toBe('worked');
        expect(c.unsynced).toBe(true);
    });

    it("is view: 'own' (fail-closed — no owner claim may render over a device-local plane)", () => {
        const out = buildOfflineRegister([queueMark({})]);
        expect(out!.view).toBe('own');
        expect(out!.ledger.weekLabel).toBe(''); // no fabricated period
    });

    it('returns null when the plane is empty — the outage dead-end stays the outage dead-end', () => {
        expect(buildOfflineRegister([])).toBeNull();
    });
});
