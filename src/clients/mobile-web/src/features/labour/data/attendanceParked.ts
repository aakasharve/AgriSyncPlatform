/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Task 9 (B001, spec: 2026-08-28-labour-v2-release-1) — the client half of
 * the attendance contradiction loop.
 *
 * THE LOOP, end to end: RecordAttendanceMarkHandler refuses a mark when two
 * of the day's engagements claim different facts for the person
 * (`ShramSafal.AttendanceContradiction`, PERMANENT). RejectionPolicy parks
 * the row (`REJECTED_USER_REVIEW`), attendanceLocal keeps it VISIBLE in the
 * register as weaker intent, and THIS module renders it answerable: it finds
 * the parked rows by their persisted error CODE, rebuilds the question from
 * the device's own log history, and sends the farmer's answer back as the
 * same queue row re-enqueued with `resolvedLabourAssignmentId` — the server
 * contract that skips the contradiction check because the question has been
 * answered.
 *
 * WHY `replacePayload` AND NOT a fresh `MarkAttendanceCommand.enqueue`: the
 * command's value-keyed `clientRequestId` does not include
 * `resolvedLabourAssignmentId`, so a fresh enqueue whose halves match the
 * refused bytes would collide with the parked row's `[deviceId+
 * clientRequestId]` key and silently return the parked row untouched — the
 * answer would vanish. `replacePayload` validates against the real zod
 * schema, swaps the payload, flips the row to PENDING and clears backoff:
 * the re-enqueue and the park-clear are ONE atomic existing method
 * (T-IGH-04-CONFLICT-EDIT). Reusing the id is safe on the wire — the server
 * stores only SUCCESSES in its idempotency store, so the refused id was
 * never consumed.
 *
 * THE ANSWER SPEAKS ONLY THE HALVES THE RULING DECIDES (B002): full/half →
 * `dayMark` alone, night → `nightMark: 'Worked'` alone, plus the identity
 * keys and the chosen engagement id. Every unspoken half is ABSENT — the
 * server amend preserves the stored fact, and restating one here would be
 * this door claiming a half it did not just rule on.
 *
 * CANDIDATES COME FROM LOCAL FACTS, OR NOT AT ALL: the wire refusal carries
 * no candidate list, so the question is rebuilt exactly as the server
 * derived it — this farm's logs on the mark's workDate, engagements whose
 * `attributedOperators` carry the person, `shiftId` in the known vocabulary,
 * report only when MORE than one distinct fact survives (the server's own
 * Distinct>1 rule; `labourAssignmentId` is the client-minted id, so the
 * answer needs no mapping layer). When the rebuild cannot reproduce two
 * facts, NO question is fabricated — the refused mark stays visible as
 * weaker intent and the conflict page remains the fallback door.
 */
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { mutationQueue } from '../../../infrastructure/sync/MutationQueue';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import type { AttendanceMarkPayload } from '../../../application/usecases/sync/MarkAttendanceCommand';
import type { DayShift } from '../attendanceContradiction';
import type { DailyLog } from '../../../types';

export interface ParkedAttendanceContradiction {
    /** The parked queue row's clientRequestId — the handle `replacePayload` takes. */
    clientRequestId: string;
    /** The refused payload, exactly as it sat in the queue. */
    payload: AttendanceMarkPayload;
}

export interface ContradictionFact {
    shift: DayShift;
    labourAssignmentId: string;
}

export interface ContradictionQuestion {
    /** The attach-time snapshot name — never invented. */
    name: string;
    /** One fact per engagement, in log order. */
    facts: ContradictionFact[];
}

/** The RejectionPolicy.normalizeCode rule: the dot-tail, upper-cased. */
const isContradictionCode = (code: string | undefined): boolean => {
    if (!code) return false;
    const tail = code.slice(code.lastIndexOf('.') + 1);
    return tail.toUpperCase() === 'ATTENDANCECONTRADICTION';
};

/**
 * The attendance.mark rows the server parked with the contradiction code,
 * for THIS farm. Matched by the persisted `errorCode`'s dot-tail — never by
 * the English message.
 */
export async function listParkedAttendanceContradictions(
    farmId: string,
): Promise<ParkedAttendanceContradiction[]> {
    const rows = await mutationQueue.getRejectedUserReview();
    return rows
        .filter((r) => r.mutationType === SyncMutationName.AttendanceMark)
        .filter((r) => isContradictionCode(r.errorCode))
        .map((r) => ({ clientRequestId: r.clientRequestId, payload: r.payload as AttendanceMarkPayload }))
        .filter((p) => p.payload.farmId === farmId);
}

const KNOWN_SHIFTS: ReadonlySet<string> = new Set(['full', 'half', 'night']);

/**
 * Rebuilds the question from the device's own log history — the client twin
 * of `GetAttendanceEngagementFactsAsync` + the handler's Distinct>1 rule.
 * Returns null rather than fabricate: fewer than two distinct local facts is
 * a question this device cannot honestly ask.
 */
export function buildContradictionQuestion(
    park: ParkedAttendanceContradiction,
    history: readonly DailyLog[],
): ContradictionQuestion | null {
    const { farmId, fieldOperatorId, workDate } = park.payload;
    const facts: ContradictionFact[] = [];
    let name = '';
    for (const log of history) {
        if (log.date !== workDate) continue;
        // STRICT farm filter — a candidate id from another farm's log must
        // never travel as an answer (the server skips its check on trust).
        if (log.meta?.farmId !== farmId) continue;
        for (const event of log.labour ?? []) {
            const attribution = (event.attributedOperators ?? [])
                .find((a) => a.fieldOperatorId === fieldOperatorId);
            if (!attribution) continue;
            const shift = event.shiftId?.toLowerCase();
            if (!shift || !KNOWN_SHIFTS.has(shift)) continue; // no claim → no fact
            const assignmentId = event.labourAssignmentId || event.id;
            if (!assignmentId) continue;
            facts.push({ shift: shift as DayShift, labourAssignmentId: assignmentId });
            if (name === '') name = attribution.displayNameAtAttach;
        }
    }
    const distinct = new Set(facts.map((f) => f.shift));
    if (distinct.size < 2) return null;
    return { name, facts };
}

/**
 * The farmer's answer: the parked row re-enqueued with
 * `resolvedLabourAssignmentId` and ONLY the half the chosen ruling decides.
 * Returns replacePayload's own verdict (false = the row is gone — e.g.
 * discarded from the conflict page in the meantime; nothing is invented).
 */
export async function answerAttendanceContradiction(
    park: ParkedAttendanceContradiction,
    chosen: ContradictionFact,
): Promise<boolean> {
    const { attendanceMarkId, farmId, fieldOperatorId, workDate } = park.payload;
    const resolution: AttendanceMarkPayload = {
        attendanceMarkId, farmId, fieldOperatorId, workDate,
        ...(chosen.shift === 'night'
            ? { nightMark: 'Worked' as const }
            : { dayMark: chosen.shift === 'half' ? 'Half' as const : 'Full' as const }),
        resolvedLabourAssignmentId: chosen.labourAssignmentId,
    };
    const replaced = await mutationQueue.replacePayload(park.clientRequestId, resolution);
    if (replaced) {
        // the row is PENDING again; clear the stale verdict's code so no
        // reader can mistake the re-enqueued answer for a standing park.
        const db = getDatabase();
        await db.mutationQueue
            .where('[deviceId+clientRequestId]')
            .equals([mutationQueue.getDeviceId(), park.clientRequestId])
            .modify({ errorCode: undefined });
    }
    return replaced;
}
