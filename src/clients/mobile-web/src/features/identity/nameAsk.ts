/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, S6; founder's A6.3 note; CTO ruling Q5 = A) - the 8-day ask, pure. His OWN
 * card asks once, on or after day 8, "तुमचं नाव मराठीत असं लिहायचं का? ‹suggestion›" when the second name is still empty and a suggestion exists;
 * "नंतर" waits 8 more days (a device preference, P10 allows it: it is not farm truth).
 *
 * Day 0 is his card's last save (`updatedAtUtc`). The account's creation date is not on the phone, so a card that was never saved counts from the
 * first time THIS phone saw it (asks later rather than sooner; the contract's "first visit after the new app" for old accounts is not met).
 */
import type { OtherScript } from '../../domain/names/otherScriptName';

export const ASK_AFTER_DAYS = 8;
const DAY_MS = 24 * 60 * 60 * 1000;

/** When the ask may come again after "नंतर" at `tapped`. */
export function laterUntil(tapped: Date): string {
    return new Date(tapped.getTime() + ASK_AFTER_DAYS * DAY_MS).toISOString();
}

export function nameAskDue(input: {
    target: OtherScript | null;
    /** The second name is already on the server (his own or confirmed). */
    secondNameSaved: boolean;
    suggestion: string | null;
    updatedAtUtc: string | null;
    firstSeenAt: string | null;
    laterUntilAt: string | null;
    now: Date;
}): boolean {
    const { target, secondNameSaved, suggestion, updatedAtUtc, firstSeenAt, laterUntilAt, now } = input;
    if (!target || secondNameSaved || !suggestion) return false;
    const day0 = Date.parse(updatedAtUtc ?? firstSeenAt ?? '');
    if (!Number.isFinite(day0)) return false;
    if (now.getTime() < day0 + ASK_AFTER_DAYS * DAY_MS) return false;
    const later = Date.parse(laterUntilAt ?? '');
    return !Number.isFinite(later) || now.getTime() >= later;
}
