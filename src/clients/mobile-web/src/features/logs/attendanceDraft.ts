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

/**
 * The हजेरी view of a parsed draft: labour only.
 *
 * `null` in, `null` out — the caller renders the ordinary empty form.
 * Everything the farmer can still see and edit (transcript, summary, the
 * questions the parser asked) is deliberately preserved; only the operational
 * buckets that belong to the other door are emptied.
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
        // A disturbance is a blocker on the DAY, not on who turned up, and it
        // has its own screen. Dropped here rather than shown under a हजेरी
        // heading it does not belong to.
        disturbance: undefined,
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
