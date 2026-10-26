/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I13) — founder decision 2026-09-02:
 * "auto-save immediately on a successful parse; captured is not reviewed".
 *
 * Two pure rules the voice auto-save leans on, kept out of the hooks so they can be read and tested alone.
 */
import { LogVerificationStatus, type AgriLogResponse, type DailyLog } from '../../types';

/**
 * Is this parse worth saving without a review? Only when Sathi understood SOMETHING of the day: at least
 * one item in one of the eight parts, or a stoppage. A parse with nothing in it (or one the parser called
 * unrelated) is NOT auto-saved — it keeps today's review form, so an empty record is never written for him.
 */
export function isAutoSavableVoiceDraft(draft: AgriLogResponse): boolean {
    if (draft.dayOutcome === 'IRRELEVANT_INPUT') return false;
    const items = draft.cropActivities.length + draft.irrigation.length + draft.labour.length + draft.inputs.length
        + draft.machinery.length + (draft.activityExpenses?.length ?? 0) + (draft.observations?.length ?? 0)
        + (draft.plannedTasks?.length ?? 0);
    return items > 0 || !!draft.disturbance;
}

/**
 * Mark a freshly built voice log as auto-saved. Two things change, both to tell the truth:
 *   - `autoSavedFromVoice: true` rides `create_daily_log`, so the server keeps it unconfirmed;
 *   - the PHONE's own copy starts as a draft too. `LogFactory` stamps an owner's log "approved" at creation,
 *     which would show this record as confirmed on his phone until the next pull says otherwise. Only his
 *     own "पक्कं आहे" (verify) may make it confirmed.
 */
export function markAutoSavedFromVoice(log: DailyLog): DailyLog {
    return {
        ...log,
        autoSavedFromVoice: true,
        verification: { status: LogVerificationStatus.DRAFT, required: true },
    };
}
