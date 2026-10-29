/**
 * Labour V2 R1 Task 3.1 — the labour mic anchor.
 *
 * "Labour mic is a verification instrument. No explicit labour anchor → no
 * mic." (Global Constraints.) The anchor is a STATED
 * LabourAssignment.WorkerCount on today's log, expressed over the local history
 * the hub already receives. It gates ONLY the recorder: never the Labour route,
 * the hub, the हजेरी वही tile, or HajeriLedger (Correction 11).
 *
 * FOUNDER D-46 (2026-10-27, PLR-D10 L3a): "Pending approval must not prevent the
 * हजेरी mic from opening merely because the headcount has not been confirmed. It
 * may use the latest captured headcount as provisional context." A voice log is
 * saved at once as Draft ("खात्री बाकी") until the owner confirms it, so a count
 * nobody has accepted yet DOES open the mic now — carried as `provisional: true`,
 * and every screen that shows it must say so (never present it as confirmed).
 * The owner's confirmation itself is lane L6; nothing here confirms anything.
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
         * D-46 — present (true) when any part of the count comes from a log nobody has accepted yet
         * (Draft / legacy Pending / no verification record): the mic opens on it as PROVISIONAL
         * context, and it is shown as "खात्री बाकी", never as confirmed. Absent = every counted log
         * was accepted by a person.
         */
        provisional?: true;
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
    let provisional = false;
    for (const log of history) {
        if (log.date !== todayKey || log.deletion) continue;
        // `?? []`: a stored log can lack the array (an old no-work declaration); no labour anchors nothing.
        const stated = (log.labour ?? [])
            .map((e) => resolveLabourHeadcount(e))
            .filter((n): n is number => n != null);
        if (stated.length === 0) continue; // labour with no stated count anchors nothing
        const status = log.verification?.status;
        // No verification record = unknown = not accepted (rule 3) — captured, so it opens the mic
        // (D-46), but only as provisional context.
        if (!status || UNACCEPTED.has(status)) provisional = true;
        headcount += stated.reduce((a, b) => a + b, 0);
        anchorLogId = anchorLogId ?? log.id;
    }
    if (!anchorLogId) return { state: 'no-anchor' };
    return provisional
        ? { state: 'anchored', headcount, logId: anchorLogId, provisional: true }
        : { state: 'anchored', headcount, logId: anchorLogId };
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
