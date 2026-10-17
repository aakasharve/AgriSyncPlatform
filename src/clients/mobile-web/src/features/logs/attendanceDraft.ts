/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * FOUNDER RULING 2026-08-31 — TWO DOORS, TWO RECORDS.
 *
 * "no mic from labour ui should touch the buckets of legacy logs"
 *
 * The labour hub's hero and the log page's mic are the same recorder, but they
 * are not the same act. Coming from Labour Management the farmer is taking
 * हजेरी — saying WHO was there. Coming from the log page he is recording the
 * day — WHAT was done. The parser answers both at once (it fills every bucket
 * it can), so without this the हजेरी door quietly wrote Crop Activity,
 * Irrigation and Inputs entries the farmer never came to that screen to make.
 *
 * NOTHING SPOKEN IS LOST HERE, and that is the only reason this is allowed to
 * drop buckets. When a task IS stated alongside the people, the parser puts it
 * on the labour entry itself — verified against the live pipeline:
 *
 *     "रोकडेचे दहा लोक आले, द्राक्षावर फवारणी केली"
 *       labour:         [{ count: 10, activity: "spraying", ... }]
 *       cropActivities: [{ title: "फवारणी", ... }]
 *
 * The activity survives on the labour row. Emptying `cropActivities` therefore
 * removes a DUPLICATE of what the labour entry already carries, not the fact
 * itself. If that ever stops being true — if the parser stops putting the
 * activity on the labour row — this helper starts destroying evidence, which
 * is why `attendance_draft_never_touches_the_labour_array` pins the half it
 * must never take away.
 *
 * The bridge runs the other way and needs no code: a NORMAL work log that
 * happens to name people still produces labour entries, and those already flow
 * into Labour Management. Only this direction needed a gate.
 */
import type { AgriLogResponse } from '../../types';
import type { LogProvenance } from '../../domain/ai/LogProvenance';
import { getDateKey } from '../../core/domain/services/DateKeyService';

/**
 * The हजेरी view of a parsed draft: labour only.
 *
 * `null` in, `null` out — the caller renders the ordinary empty form.
 * Everything the farmer can still see and edit (transcript, summary, the
 * questions the parser asked) is deliberately preserved; only the operational
 * buckets that belong to the other door are emptied.
 *
 * The disturbance SURVIVES this filter (see below): on a no-work day it is the
 * reason the day had no work, and the हजेरी confirm screen shows it beside WHO came.
 */
export function toAttendanceOnlyDraft(draft: AgriLogResponse | null): AgriLogResponse | null {
    if (!draft) return null;

    return {
        ...draft,
        // Untouched — this IS the हजेरी.
        labour: draft.labour,
        // The other door's buckets. Emptied, never reassigned to labour:
        // guessing that an irrigation entry "was really attendance" would be
        // exactly the fabrication this branch exists to stop.
        cropActivities: [],
        irrigation: [],
        inputs: [],
        machinery: [],
        activityExpenses: [],
        // PRESERVED — Phase 4 Task 4.2 (spec D11, no-work door "काम झालं नाही,
        // पण मजूर आले"). Attendance says WHO was there; the disturbance says
        // WHAT blocked the day. They are the two halves of ONE fact about a
        // no-work day and neither collapses into the other — the earlier
        // version dropped it here, which severed the flow the parse feeds
        // (AgriLogResponseSchema.ts:731) from the day it describes. The sync
        // payload carries it end to end (create_daily_log.zod.ts:126,130 →
        // CreateDailyLogPayload.cs:83-84), verified 2026-09-02.
        disturbance: draft.disturbance,
    };
}

/**
 * The day a labour-door record is filed under: the day the farmer SPOKE, not the
 * day he pressed बरोबर.
 *
 * That is the local (IST) date of the parse's `provenance.timestamp`, which the
 * parser stamps the moment the parse comes back, seconds after he spoke. With no
 * parse provenance (or an unreadable timestamp) it is today. Words he says about
 * time are NOT interpreted: "काल चार जण आले" ("four came yesterday") is filed on
 * the day he said it, not the day before. The attendance marks the same tap
 * queues use this same day.
 */
export function attendanceCaptureDay(provenance: LogProvenance | null | undefined): string {
    const stamp = provenance?.timestamp;
    return stamp && !Number.isNaN(Date.parse(stamp)) ? getDateKey(stamp) : getDateKey();
}

/** What बरोबर hands the save path: labour, and only the facts about this record. */
export interface AttendanceSubmission {
    labour: AgriLogResponse['labour'];
    /** New record only. See `attendanceCaptureDay`. */
    date?: string;
    /** New record only, and only the draft's OWN parse provenance. */
    provenance?: LogProvenance;
    /** New record only. See `DailyLog.captureScope`. */
    captureScope?: 'labour';
    /** Edit only: the record whose labour this replaces. */
    originalLogId?: string;
}

/**
 * What बरोबर hands the one manual save path (`useLogCommands.handleManualSubmit`).
 *
 * APK 1.0.14 founder report: "I can't tap बरोबर; it doesn't save the name". The
 * confirm passed the raw parse (`AgriLogResponse`) straight to the save path,
 * which builds the record from the MANUAL-ENTRY shape and needs a `date`. A
 * parse has none, so `create_daily_log` was refused at the queue
 * (`logDate Required`), nothing reached the server, the screen stayed where it
 * was, and with no queued work the names in the record were hidden on read.
 *
 * LABOUR ONLY (founder ruling 2026-08-31): the record carries what the
 * confirmation card showed, which is the labour, and nothing else from the parse.
 * Observations, planned tasks, the parser's `dayOutcome`, the disturbance and the
 * full transcript are not on the card, so they are not saved by it.
 *
 *   - NEW record: `labour`, `date` (`attendanceCaptureDay`), `captureScope:
 *     'labour'`, and `provenance` only when the caller passes the draft's own
 *     (`draftProvenance(draft)`). Never a 'manual' claim for a parse (P8), and
 *     never another parse's provenance.
 *   - EDIT of an existing record (`originalLogId`): `labour` only. No date (the
 *     record keeps its own day), no provenance, no scope, and no empty buckets:
 *     the update merges what is sent, so sending `[]` would erase the record's
 *     other work.
 */
export function toAttendanceSubmission(
    draft: AgriLogResponse,
    provenance: LogProvenance | null | undefined,
): AttendanceSubmission {
    if (draft.originalLogId) {
        return { originalLogId: draft.originalLogId, labour: draft.labour };
    }
    return {
        labour: draft.labour,
        date: attendanceCaptureDay(provenance),
        ...(provenance ? { provenance } : {}),
        captureScope: 'labour',
    };
}

/**
 * True when this draft carries nothing but attendance — used to decide whether
 * the confirm screen may hide the other buckets outright rather than render
 * eight "Tap to add details" rows the farmer did not come here for.
 */
export function isAttendanceOnlyDraft(draft: AgriLogResponse | null): boolean {
    if (!draft) return false;
    return draft.labour.length > 0
        && draft.cropActivities.length === 0
        && (draft.irrigation?.length ?? 0) === 0
        && draft.inputs.length === 0
        && draft.machinery.length === 0
        && (draft.activityExpenses?.length ?? 0) === 0;
}
