/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (Part 03, B1 + B5) — the 24-hour change window of a talk, as the SERVER states it.
 *
 * The server rule (B5, `TalkEditWindow` / `DailyLog.IsEditWindowClosedFor`): a voice talk may be changed by its OWN speaker (the
 * signed-in user is the log's `operatorUserId`) for 24 hours from the server's create time; after that HIS changes of what he said
 * (a content revision, a move of its plot or day, a headcount / hours correction) are refused with `ShramSafal.LogEditWindow.Conflict`.
 * It binds ONLY the speaker — the owner on his own talk too — and nobody else: the owner or a grant holder changing someone else's
 * talk, a product check, an answer and a confirmation are never stopped by it.
 *
 * The server sends the end of the window on the daily log as `editableUntilUtc` (ISO UTC; mapped by the pull's `logsReconciler`). The
 * phone never works the window out itself (P10): it only compares that instant with the clock. A log without it (not a talk, or not
 * yet told to this phone), or with a value it cannot read, has no window (fail closed: no line, and no door is closed by it).
 */
import type { DailyLog } from '../../../../types';

/** ISO 8601 with a time and an explicit zone ("Z" or "+05:30"): a value without a zone would be read in the phone's own zone. */
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})$/i;

/** The server's end of the change window for this log; null when the log carries none, or one that cannot be read. */
export function editableUntilOf(log: DailyLog | null | undefined): Date | null {
    const raw: unknown = log?.editableUntilUtc;
    if (typeof raw !== 'string') return null;
    const value = raw.trim();
    if (!ISO_WITH_ZONE.test(value)) return null;
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? new Date(ms) : null;
}

/** True only while the server's window is still open at `nowMs`. No field, or a past one = false. */
export function isEditableAt(log: DailyLog | null | undefined, nowMs: number = Date.now()): boolean {
    const until = editableUntilOf(log);
    return until !== null && until.getTime() > nowMs;
}

/** The signed-in user spoke this log (the server's own rule: he is its `operatorUserId`). Unknown either way = not the speaker. */
export const isSpeakerOf = (log: DailyLog | null | undefined, userId: string | null | undefined): boolean =>
    !!userId && !!log?.meta?.createdByOperatorId && log.meta.createdByOperatorId === userId;

/**
 * The window as it stands for THIS viewer on one talk (all its logs, one per plot):
 *   - `open`   — he is the talk's speaker and every log's window is still open: "बदल करता येतो · २४ तास";
 *   - `closed` — he is the speaker and a log's window has passed: his own edit doors on it close (the server would refuse them);
 *   - `none`   — he is not the speaker, or the server stated no window: nothing is shown and nothing is closed by it.
 */
export type TalkWindow = 'open' | 'closed' | 'none';

export function talkWindowFor(logs: readonly (DailyLog | null | undefined)[], userId: string | null | undefined, nowMs: number = Date.now()): TalkWindow {
    const mine = logs.filter((l): l is DailyLog => !!l && isSpeakerOf(l, userId) && editableUntilOf(l) !== null);
    if (mine.length === 0) return 'none';
    return mine.every(l => isEditableAt(l, nowMs)) ? 'open' : 'closed';
}
