/**
 * Labour V2 R1 Task 3.5c — MarkAttendanceCommand's derivable, VALUE-KEYED
 * clientRequestId, exercised through the REAL MutationQueue over fake-indexeddb
 * (the folder's LogCommandService idiom). Same fact re-tapped = same key
 * (retry-safe dedupe on both device and server); a CHANGED ruling about the
 * same person-day = a new key (the server handler amends — never a blind
 * insert, so no 23505 reaches the farmer); an empty ruling is refused at the
 * boundary.
 */
// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { MarkAttendanceCommand } from '../MarkAttendanceCommand';
import { getDatabase } from '../../../../infrastructure/storage/DexieDatabase';

const base = {
    attendanceMarkId: '11111111-1111-1111-1111-111111111111',
    farmId: '22222222-2222-2222-2222-222222222222',
    fieldOperatorId: '33333333-3333-3333-3333-333333333333',
    workDate: '2026-09-02',
} as const;

describe('MarkAttendanceCommand — derivable, value-keyed idempotency', () => {
    it('the SAME fact twice derives the SAME clientRequestId (retry-safe)', async () => {
        const a = await MarkAttendanceCommand.enqueue({ ...base, dayMark: 'Full' });
        const b = await MarkAttendanceCommand.enqueue({ ...base, dayMark: 'Full' });
        expect(a).toBe(b);
        expect(a).toBe('attendance.mark:22222222-2222-2222-2222-222222222222:33333333-3333-3333-3333-333333333333:2026-09-02:Full:-:-:-');
    });
    it('a CHANGED ruling on the same person-day derives a DIFFERENT key (amendable)', async () => {
        const a = await MarkAttendanceCommand.enqueue({ ...base, dayMark: 'Full' });
        const b = await MarkAttendanceCommand.enqueue({ ...base, dayMark: 'Half' });
        expect(a).not.toBe(b);
    });
    it('a payload stating nothing is refused at the boundary — a mark must state something', async () => {
        await expect(MarkAttendanceCommand.enqueue({ ...base })).rejects.toThrow(/state/i);
    });

    // ── Defect (spec LABOUR_COMPLETION §2): the key was facts-only, so
    // A -> B -> A on one person-day de-duplicated the THIRD tap against the
    // FIRST row and silently dropped it. The farmer's last word must queue.
    describe('a revert is a NEW request (A -> B -> A)', () => {
        const op = '44444444-4444-4444-4444-444444444444';
        const revert = { ...base, fieldOperatorId: op, workDate: '2026-09-03' } as const;

        it('A -> B -> A enqueues THREE distinct rows; the last A is not swallowed', async () => {
            const a1 = await MarkAttendanceCommand.enqueue({ ...revert, dayMark: 'Full' });
            const b = await MarkAttendanceCommand.enqueue({ ...revert, dayMark: 'Half' });
            const a2 = await MarkAttendanceCommand.enqueue({ ...revert, dayMark: 'Full' });
            expect(new Set([a1, b, a2]).size).toBe(3);

            const rows = (await getDatabase().mutationQueue.toArray())
                .filter((r) => (r.payload as { fieldOperatorId: string }).fieldOperatorId === op);
            expect(rows.map((r) => (r.payload as { dayMark: string }).dayMark)).toEqual(['Full', 'Half', 'Full']);
        });

        it('A -> B -> A -> B keeps going: every change is a request', async () => {
            const op2 = '55555555-5555-5555-5555-555555555555';
            const p = { ...base, fieldOperatorId: op2, workDate: '2026-09-04' } as const;
            const ids = [
                await MarkAttendanceCommand.enqueue({ ...p, dayMark: 'Full' }),
                await MarkAttendanceCommand.enqueue({ ...p, dayMark: 'Half' }),
                await MarkAttendanceCommand.enqueue({ ...p, dayMark: 'Full' }),
                await MarkAttendanceCommand.enqueue({ ...p, dayMark: 'Half' }),
            ];
            expect(new Set(ids).size).toBe(4);
        });

        it('the SAME fact tapped twice in a row still de-duplicates (double-tap = one row)', async () => {
            const op3 = '66666666-6666-6666-6666-666666666666';
            const p = { ...base, fieldOperatorId: op3, workDate: '2026-09-05' } as const;
            await MarkAttendanceCommand.enqueue({ ...p, dayMark: 'Full' });
            await MarkAttendanceCommand.enqueue({ ...p, dayMark: 'Half' });
            const x = await MarkAttendanceCommand.enqueue({ ...p, dayMark: 'Half' });
            const y = await MarkAttendanceCommand.enqueue({ ...p, dayMark: 'Half' });
            expect(x).toBe(y);
            const rows = (await getDatabase().mutationQueue.toArray())
                .filter((r) => (r.payload as { fieldOperatorId: string }).fieldOperatorId === op3);
            expect(rows).toHaveLength(2);
        });
    });
});
