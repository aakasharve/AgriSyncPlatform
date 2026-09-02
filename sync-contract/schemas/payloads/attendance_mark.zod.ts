// Labour V2 R1 — canonical payload for the attendance.mark mutation. The
// shape mirrors PushSyncBatchHandler.HandleAttendanceMarkAsync's PayloadHasOnly
// allow-list; set equality is enforced by tests/allowlist-parity.test.ts.
//
// ABSENCE IS UNMARKED. dayMark/nightMark deliberately have no 'Unmarked'
// member: an omitted key means "nobody said" (AttendanceMark's fourth state),
// and the server maps absence to the enum zero explicitly. A payload stating
// NOTHING (all four fact keys absent) is refused server-side — "both halves
// unmarked is the absence of a mark" (AttendanceMark.cs) — not refined here,
// because a ZodEffects wrapper would blind the parity gate's key-set read.
//
// NO hoursBasis on the wire: the server stamps Explicit when hours are stated,
// Unspecified otherwise. Provenance is derived from the path, never claimed
// by the client. NO money, ever (D9.9: the mark carries no money column).
import { z } from 'zod';
import { ZGuid } from './_shared.zod';

export const AttendanceDayMarkEnum = z.enum(['Full', 'Half', 'Absent']);
export const AttendanceNightMarkEnum = z.enum(['Worked', 'NotWorked']);

const ZWorkDate = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

export const AttendanceMarkPayload = z.object({
    attendanceMarkId: ZGuid,
    farmId: ZGuid,
    fieldOperatorId: ZGuid,
    workDate: ZWorkDate,
    dayMark: AttendanceDayMarkEnum.optional(),
    nightMark: AttendanceNightMarkEnum.optional(),
    // Stated as hour COUNTS, never converted into day fractions (founder §1).
    hoursWorked: z.number().positive().optional(),
    extraHours: z.number().positive().optional(),
    // Present only when re-invoking with the farmer's answer to the
    // AttendanceContradiction question — the engagement he sided with.
    resolvedLabourAssignmentId: ZGuid.optional(),
});

export type AttendanceMarkPayloadType = z.infer<typeof AttendanceMarkPayload>;
