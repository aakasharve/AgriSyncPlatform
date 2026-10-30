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
    // A parse can arrive WITHOUT one of these lists (`normalizeDriftedParsedLog` leaves a missing list missing).
    // Missing reads as empty — never a throw, which would reach him as the English "Could not process log…".
    const parts = [draft.cropActivities, draft.irrigation, draft.labour, draft.inputs, draft.machinery,
        draft.activityExpenses, draft.observations, draft.plannedTasks];
    return parts.some(part => (part?.length ?? 0) > 0) || !!draft.disturbance;
}

/**
 * Mark a freshly built voice log as auto-saved. Two things change, both to tell the truth:
 *   - `autoSavedFromVoice: true` rides `create_daily_log`, so the server keeps it unconfirmed;
 *   - the PHONE's own copy starts as a draft too. `LogFactory` stamps an owner's log "approved" at creation,
 *     which would show this record as confirmed on his phone until the next pull says otherwise. Only an
 *     authorised confirmation may make it confirmed (spec I27: the primary owner's "save and confirm", or a
 *     review by him or a member holding his grant — never the speaker's own I13 tap).
 */
export function markAutoSavedFromVoice(log: DailyLog): DailyLog {
    return {
        ...log,
        autoSavedFromVoice: true,
        verification: { status: LogVerificationStatus.DRAFT, required: true },
    };
}

/** The log of a recording that carries his words (one record holds the day's facts); else the first. */
export const primaryLogOf = (logs: readonly DailyLog[]): DailyLog | undefined => logs.find(l => !!l.fullTranscript) ?? logs[0];

/**
 * PLR-D10 I27 (founder D-31) — stamp the recording's server id on the ONE log that carries his words (the same
 * log the phone links its clip to). The other plots of the same recording get no link: a reviewer of those may
 * not hear the whole recording through them. No id = the logs unchanged.
 */
export function withVoiceClipOnPrimary(logs: DailyLog[], voiceClipId: string | undefined): DailyLog[] {
    if (!voiceClipId) return logs;
    const primary = primaryLogOf(logs);
    return logs.map(l => (l === primary ? { ...l, voiceClipId } : l));
}

/**
 * Is this HIS OWN voice log, saved by this phone with no review tap? `youIds` is who "you" are here: the
 * active operator and the signed-in user (the same pair the result screen uses).
 *
 * Founder decision 2026-09-02: the record counts even if he never confirms it. So it may not be held up as
 * work waiting on him (P5: his "पक्कं आहे" exists only on the result screen, and the review inbox shows only
 * other people's logs). Everywhere else it stays honest: unconfirmed on its card, no confirmation credit.
 *
 * Read off the phone's own marker: the server keeps its marker off the wire, and the pull keeps this one.
 */
export function isOwnAutoSavedVoiceLog(log: DailyLog, youIds: ReadonlySet<string>): boolean {
    const creator = log.meta?.createdByOperatorId;
    return log.autoSavedFromVoice === true && !!creator && youIds.has(creator);
}
