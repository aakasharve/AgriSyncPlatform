/**
 * Labour V2 R1 Task 3.5c — the pull carriage's client half.
 *
 * One pulled mark lands in `db.attendanceMarks` (P10: the acknowledged fact
 * is reconstructable without the device that spoke it); a pull with the
 * field ABSENT is a no-op — the wire field is additive and optional, so an
 * older server that has never heard of attendance stays compatible instead
 * of erroring the whole sync.
 *
 * Fake-store idiom from `reconcilers/__tests__/logsReconciler.farmScope.test.ts`.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { reconcileAttendance } from '../reconcilers/attendanceReconciler';
import type { AgriLogDatabase, AttendanceMarkCacheRecord } from '../../../../infrastructure/storage/DexieDatabase';
import type { AttendanceMarkDto, SyncPullResponse } from '../../../../infrastructure/api/AgriSyncClient';

const MARK_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RECEIVED_AT = '2026-09-02T06:30:00.000Z';

const markDto = (over: Partial<AttendanceMarkDto> = {}): AttendanceMarkDto => ({
    id: MARK_ID,
    farmId: '22222222-2222-2222-2222-222222222222',
    fieldOperatorId: '33333333-3333-3333-3333-333333333333',
    workDate: '2026-09-02',
    dayMark: 'Full',
    nightMark: null,        // Unmarked — a silence, never a zero
    hoursWorked: null,
    extraHours: null,
    hoursBasis: 'Unspecified',
    recordedByUserId: '44444444-4444-4444-4444-444444444444',
    recordedAtUtc: '2026-09-02T06:00:00.000Z',
    modifiedAtUtc: '2026-09-02T06:00:00.000Z',
    ...over,
});

let store: Map<string, AttendanceMarkCacheRecord>;
let db: AgriLogDatabase;

const run = (payload: Partial<SyncPullResponse>) =>
    reconcileAttendance(db, payload as unknown as SyncPullResponse, RECEIVED_AT);

describe('reconcileAttendance — pulled marks land; an absent field is a no-op', () => {
    beforeEach(() => {
        store = new Map();
        db = {
            attendanceMarks: {
                put: async (record: AttendanceMarkCacheRecord) => { store.set(record.id, record); },
            },
        } as unknown as AgriLogDatabase;
    });

    it('one pulled mark lands in db.attendanceMarks with its index fields and full payload', async () => {
        await run({ attendanceMarks: [markDto()] });

        const row = store.get(MARK_ID);
        expect(row).toBeDefined();
        expect(row!.farmId).toBe('22222222-2222-2222-2222-222222222222');
        expect(row!.fieldOperatorId).toBe('33333333-3333-3333-3333-333333333333');
        expect(row!.workDate).toBe('2026-09-02');
        expect(row!.payload.dayMark).toBe('Full');
        expect(row!.payload.nightMark).toBeNull(); // Unmarked survives as null, never 0
        expect(row!.updatedAt).toBe(RECEIVED_AT);
    });

    it('a pull with the field absent writes nothing (old servers stay compatible)', async () => {
        await run({});
        expect(store.size).toBe(0);
    });

    it('re-pulling the same mark is idempotent (put by server id)', async () => {
        await run({ attendanceMarks: [markDto()] });
        await run({ attendanceMarks: [markDto({ dayMark: 'Half', modifiedAtUtc: '2026-09-02T07:00:00.000Z' })] });
        expect(store.size).toBe(1);
        expect(store.get(MARK_ID)!.payload.dayMark).toBe('Half');
    });
});
