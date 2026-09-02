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
});
