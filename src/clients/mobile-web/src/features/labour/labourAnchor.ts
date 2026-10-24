/**
 * Labour V2 R1 Task 3.1 — the labour mic anchor.
 *
 * "Labour mic is a verification instrument. No explicit labour anchor → no
 * mic." (Global Constraints.) The anchor is the CLIENT mirror of the server
 * rule — DailyLog.CurrentVerificationStatus != Draft AND a stated
 * LabourAssignment.WorkerCount — expressed over the local history the hub
 * already receives. It gates ONLY the recorder: never the Labour route, the
 * hub, the हजेरी वही tile, or HajeriLedger (Correction 11).
 *
 * The two-state union is deliberate: Phase 4's explicitly-entered no-work-day
 * flow ("काम झालं नाही, पण मजूर आले") ADDS its own entry without reshaping this.
 */
import { LogVerificationStatus, type DailyLog } from '../../domain/types/log.types';
import { resolveLabourHeadcount } from '../../domain/logs/labourHeadcount';

export type LabourAnchor =
    | {
        state: 'anchored'; headcount: number; logId: string;
        /**
         * Set only when THIS device holds no accepted log for today but the
         * server's read-out of the day states a headcount (a Mukadam on
         * another phone). The count is real; there is just no local log id.
         */
        source?: 'server';
    }
    | { state: 'no-anchor' };

export const NO_ANCHOR_TEST_IDS = { reason: 'labour-no-anchor-reason' } as const;

/** The client's "nobody accepted this yet" statuses. Everything else — V2
 *  CONFIRMED/VERIFIED/DISPUTED/CORRECTION_PENDING and the V1 approved tiers —
 *  is a human having taken the count on. */
const UNACCEPTED = new Set<LogVerificationStatus>([
    LogVerificationStatus.DRAFT,
    LogVerificationStatus.PENDING,
]);

export function resolveLabourAnchor(
    history: readonly DailyLog[], todayKey: string,
): LabourAnchor {
    let headcount = 0;
    let anchorLogId: string | null = null;
    for (const log of history) {
        if (log.date !== todayKey || log.deletion) continue;
        const status = log.verification?.status;
        // No verification record = unknown = not accepted (rule 3: unknown is not zero).
        if (!status || UNACCEPTED.has(status)) continue;
        const stated = log.labour
            .map((e) => resolveLabourHeadcount(e))
            .filter((n): n is number => n != null);
        if (stated.length === 0) continue; // labour with no stated count anchors nothing
        headcount += stated.reduce((a, b) => a + b, 0);
        anchorLogId = anchorLogId ?? log.id;
    }
    return anchorLogId ? { state: 'anchored', headcount, logId: anchorLogId } : { state: 'no-anchor' };
}

/**
 * The anchor the Labour screen must act on: this device's own accepted log
 * when it has one, else the day as the SERVER states it.
 *
 * Journey fix D4. `resolveLabourAnchor` reads only the history on this device,
 * so a Mukadam on another phone saw the voice hero grey ("the count is not
 * known yet") directly above "आज कामावर 3 जण" - the screen contradicting
 * itself - and was offered the no-work tile on a day the server says people
 * worked. A headcount > 0 in the server's read-out IS a stated count. Unknown
 * (null) and zero stay no-anchor: unknown is not zero (rule 3), and a zero
 * statement is not an anchor either.
 */
export function resolveEffectiveLabourAnchor(
    history: readonly DailyLog[], todayKey: string, serverOnFarmToday: number | null,
): LabourAnchor {
    const local = resolveLabourAnchor(history, todayKey);
    if (local.state === 'anchored') return local;
    if (serverOnFarmToday !== null && serverOnFarmToday > 0) {
        return { state: 'anchored', headcount: serverOnFarmToday, logId: '', source: 'server' };
    }
    return local;
}

/**
 * Does the server's read-out say labour was recorded today for this farm?
 * (a stated headcount > 0, or a labour assignment dated today.) The no-work
 * declaration `काम झालं नाही, पण मजूर आले` must never be offered over such a
 * day - it would contradict the record it sits on.
 */
export function serverStatesLabourToday(data: {
    home: { onFarmToday: number | null };
    attendance: { todaysLabourAssignmentId: string };
}): boolean {
    return (data.home.onFarmToday !== null && data.home.onFarmToday > 0)
        || data.attendance.todaysLabourAssignmentId !== '';
}
