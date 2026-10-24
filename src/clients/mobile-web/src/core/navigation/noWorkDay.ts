/**
 * The ONE payload shape for declaring a no-work day through
 * `handleManualSubmit` (Founder Decision 8, 2026-08-16): a real DailyLog with
 * `dayOutcome: 'NO_WORK_PLANNED'`, NO buckets, a genuine `source: 'manual'`
 * provenance, and — only when he chose a reason chip — a FULL_DAY disturbance
 * carrying HIS chip as the reason (P9: no chip, no disturbance).
 *
 * Shared by the main screen's `आज काम नाही` sheet (`globalSheets.tsx`) and the
 * Labour screen's `काम झालं नाही, पण मजूर आले` door (`simpleRoutes.tsx`), so the
 * two can never record a rest day differently. The explicit `dayOutcome` is
 * essential: without it a draft that carries a labour event derives
 * `WORK_RECORDED` (LogFactory), which would turn a rest day into a work day.
 */
import type { BucketIssueType } from '../../types';

export function buildNoWorkDayPayload(dateKey: string, cause?: BucketIssueType) {
    return {
        date: dateKey,
        dayOutcome: 'NO_WORK_PLANNED' as const,
        // DisturbanceEvent.Create requires a non-empty reason, so an empty one
        // would be dropped server-side; sending nothing is the honest form.
        disturbance: cause
            ? { scope: 'FULL_DAY' as const, group: 'no_work', reason: cause, cause, blockedSegments: [] }
            : undefined,
        provenance: { source: 'manual' as const, timestamp: new Date().toISOString() },
    };
}

/** Has today already been declared a no-work day? (Suppresses a second declaration.) */
export function hasDeclaredNoWorkDay(
    history: ReadonlyArray<{ date: string; dayOutcome?: string | null }>,
    dateKey: string,
): boolean {
    return history.some((l) => l.date === dateKey && l.dayOutcome === 'NO_WORK_PLANNED');
}
