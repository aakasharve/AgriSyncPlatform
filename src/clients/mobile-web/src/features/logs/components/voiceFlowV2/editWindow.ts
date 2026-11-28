/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (Part 03, B1 + B5) — the 24-hour change window of a talk, as the SERVER states it.
 *
 * The server rule (B5, another builder): a talk can be changed for 24 hours from its creation, then it is locked. The server writes the
 * end of that window on the daily log as `editableUntil` (ISO 8601, UTC). The phone never works the window out itself (P10: the
 * server is the truth): it only reads that field and compares it with the clock, so a log without it, or with a value it cannot read,
 * shows NO window line (fail closed).
 *
 * Wiring later (not done here): the pull does not carry the field onto the phone's log yet. When the server sends it, map it in
 * `infrastructure/api/dtos.ts` (`DailyLogDto`), `domain/types/log.server.types.ts` and the pull's `logsReconciler.ts`; this
 * accessor already reads it from the log as it is stored.
 */
import type { DailyLog } from '../../../../types';

/** A daily log that may carry the server's window end (the type does not list it until it is wired). */
type WithEditWindow = DailyLog & { editableUntil?: unknown };

/** ISO 8601 with a time and an explicit zone ("Z" or "+05:30"): a value without a zone would be read in the phone's own zone. */
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})$/i;

/** The server's end of the change window for this log; null when the log carries none, or one that cannot be read. */
export function editableUntilOf(log: DailyLog | null | undefined): Date | null {
    const raw = (log as WithEditWindow | null | undefined)?.editableUntil;
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

/** A talk that became several logs (one per plot) is changeable only while EVERY one of its logs is. None = false. */
export function talkEditableAt(logs: readonly (DailyLog | null | undefined)[], nowMs: number = Date.now()): boolean {
    return logs.length > 0 && logs.every(l => isEditableAt(l, nowMs));
}
