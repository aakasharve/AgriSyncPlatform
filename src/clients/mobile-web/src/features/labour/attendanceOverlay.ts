/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Task 9 (B001, spec: 2026-08-28-labour-v2-release-1) — the compose that
 * CONSUMES Phase 3's local attendance plane. `attendanceLocal.ts` is the one
 * read of both halves (server store + live queue intent); this module is the
 * one place its `source` label becomes a render fact:
 *
 *   - `overlayLocalAttendance` lays LIVE QUEUE INTENT over a successful
 *     labour GET. Only `source: 'queue'` rows overlay — a `'server'`-sourced
 *     Dexie row is the pull's copy and may be STALER than the GET that just
 *     answered; overlaying it could mask a fresh amendment.
 *   - `buildOfflineRegister` builds the register from the plane alone when
 *     the GET failed: `'server'` rows render as acknowledged cells (they are
 *     reconstructable truth), `'queue'` rows render weaker.
 *
 * THE MERGE IS PER-HALF, mirroring RecordAttendanceMarkHandler's amend
 * (`command.Day ?? existing.Day`, B002): a queued mark speaks only the halves
 * its door stated, and an unspoken half must never erase an acknowledged fact
 * from the render. Engagement context (`ukte`/`work`) stays the server's —
 * still true of the day whatever the pending ruling says.
 *
 * P10 binds the output: every cell this module touches carries
 * `unsynced: true`, and the renderer draws that visibly WEAKER than
 * acknowledged truth — never identical, never as saved.
 *
 * Names are never invented (the server's own BuildHajeriLedger posture):
 * existing row → `data.people` → the attach-time snapshot (`nameHints`,
 * from local logs' `displayNameAtAttach`) → `''`.
 */
import type { LabourData, LedgerCell, LedgerRow } from './labour.types';
import { EMPTY_LABOUR_DATA } from './labourMock';
import type { LocalAttendanceMark } from './data/attendanceLocal';

/** Attach-time snapshot names, keyed by fieldOperatorId — see getLocalAttendanceNameHints. */
export type AttendanceNameHints = ReadonlyMap<string, string>;

const mapDay = (raw: string | undefined): LedgerCell['day'] =>
    raw === 'Full' ? 'full' : raw === 'Half' ? 'half' : raw === 'Absent' ? 'absent' : null;

const mapNight = (raw: string | undefined): LedgerCell['night'] =>
    raw === 'Worked' ? 'worked' : raw === 'NotWorked' ? 'notworked' : null;

/**
 * One queued (or server-stored) mark applied over the cell that stands, half
 * by half. An absent half on the mark says NOTHING (B002) and carries the
 * standing fact; an unrecognised value is a broken producer and claims
 * nothing either — never a guess.
 */
const applyMark = (base: LedgerCell | null, mark: LocalAttendanceMark, unsynced: boolean): LedgerCell => ({
    day: mapDay(mark.dayMark) ?? base?.day ?? null,
    night: mapNight(mark.nightMark) ?? base?.night ?? null,
    hours: mark.hoursWorked ?? base?.hours ?? null,
    extraHours: mark.extraHours ?? base?.extraHours ?? null,
    ukte: base?.ukte ?? false,
    work: base?.work ?? null,
    ...(unsynced || base?.unsynced ? { unsynced: true } : {}),
});

const resolveName = (
    data: LabourData, fieldOperatorId: string, nameHints?: AttendanceNameHints,
): string =>
    data.people[fieldOperatorId]?.name
    ?? nameHints?.get(fieldOperatorId)
    ?? '';

const newRow = (data: LabourData, fieldOperatorId: string, dayCount: number, nameHints?: AttendanceNameHints): LedgerRow => {
    const name = resolveName(data, fieldOperatorId, nameHints);
    return {
        personId: `op:${fieldOperatorId}`,
        fieldOperatorId,
        name,
        initial: name === '' ? '' : [...name][0],
        tone: 'em',
        cells: new Array<LedgerCell | null>(dayCount).fill(null),
    };
};

/**
 * Lays live queue intent over a successful labour GET. Returns the SAME
 * object when there is nothing to lay — the hook's money-safety tests pin
 * data identity (`toBe`), and a no-op must never break it.
 */
export function overlayLocalAttendance(
    data: LabourData,
    marks: readonly LocalAttendanceMark[],
    nameHints?: AttendanceNameHints,
): LabourData {
    const queued = marks.filter((m) => m.source === 'queue');
    if (queued.length === 0) return data;

    // ── Day columns. A date the wire did not draw gets one (sorted insert):
    //    the server's own unbounded posture is "every date that carries any
    //    fact", and skipping it would re-create the invisible-mark defect
    //    this module exists to remove. ─────────────────────────────────────
    const missing = [...new Set(queued.map((m) => m.workDate))]
        .filter((d) => !data.ledger.days.includes(d));
    const days = missing.length === 0
        ? data.ledger.days
        : [...data.ledger.days, ...missing].sort();
    const oldIndexByDay = new Map(data.ledger.days.map((d, i) => [d, i]));

    const realignCells = (cells: readonly (LedgerCell | null)[]): (LedgerCell | null)[] =>
        missing.length === 0
            ? [...cells]
            : days.map((d) => {
                const oldIndex = oldIndexByDay.get(d);
                return oldIndex === undefined ? null : cells[oldIndex] ?? null;
            });

    const rows = data.ledger.rows.map((r) => ({ ...r, cells: realignCells(r.cells) }));
    const crewRows = missing.length === 0
        ? data.ledger.crewRows
        : data.ledger.crewRows.map((c) => ({
            ...c,
            // inserted columns are SILENCE for a crew count — null, never 0
            counts: days.map((d) => {
                const oldIndex = oldIndexByDay.get(d);
                return oldIndex === undefined ? null : c.counts[oldIndex] ?? null;
            }),
        }));

    const dayIndex = new Map(days.map((d, i) => [d, i]));
    const rowByOperator = new Map(rows.map((r) => [r.fieldOperatorId, r]));

    for (const mark of queued) {
        const index = dayIndex.get(mark.workDate);
        if (index === undefined) continue; // unreachable — every queued date was inserted above
        let row = rowByOperator.get(mark.fieldOperatorId);
        if (!row) {
            row = newRow(data, mark.fieldOperatorId, days.length, nameHints);
            rows.push(row);
            rowByOperator.set(mark.fieldOperatorId, row);
        }
        row.cells[index] = applyMark(row.cells[index], mark, true);
    }

    return { ...data, ledger: { ...data.ledger, days, rows, crewRows } };
}

/**
 * The outage state's register: what THIS DEVICE knows, and nothing more.
 * Days are every date carrying a local fact; `view: 'own'` fails closed (no
 * owner-only claim card may render over a device-local plane); `weekLabel`
 * stays '' — no fabricated period. Returns null when the plane is empty, so
 * the caller keeps the outage dead-end exactly as before.
 */
export function buildOfflineRegister(
    marks: readonly LocalAttendanceMark[],
    nameHints?: AttendanceNameHints,
): LabourData | null {
    if (marks.length === 0) return null;

    const days = [...new Set(marks.map((m) => m.workDate))].sort();
    const dayIndex = new Map(days.map((d, i) => [d, i]));

    const rows: LedgerRow[] = [];
    const rowByOperator = new Map<string, LedgerRow>();
    // server-acknowledged facts first, then live intent over them per-half —
    // the same ordering the online path gets from GET-then-overlay.
    const ordered = [...marks.filter((m) => m.source === 'server'), ...marks.filter((m) => m.source === 'queue')];
    for (const mark of ordered) {
        const index = dayIndex.get(mark.workDate)!;
        let row = rowByOperator.get(mark.fieldOperatorId);
        if (!row) {
            row = newRow(EMPTY_LABOUR_DATA, mark.fieldOperatorId, days.length, nameHints);
            rows.push(row);
            rowByOperator.set(mark.fieldOperatorId, row);
        }
        row.cells[index] = applyMark(row.cells[index], mark, mark.source === 'queue');
    }

    return {
        ...EMPTY_LABOUR_DATA,
        view: 'own',
        ledger: { weekLabel: '', days, rows, crewRows: [] },
    };
}
