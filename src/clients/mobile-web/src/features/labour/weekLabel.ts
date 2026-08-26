/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Is a week label something a farmer can read, or is it a machine date?
 *
 * `GetLabourDataHandler.cs:261` returns a bare ISO date as `weekLabel`, so the
 * heading over "या आठवड्यात" ("this week") rendered as `2026-08-24` — a machine
 * date presenting itself as a week, to a Marathi-first farmer. Truth audit
 * T1.12b finding 10, doctrine `P5`.
 *
 * EXTRACTED, not copied. The guard first shipped inside `WeeklyDashboard.tsx`
 * and `HajeriLedger.tsx:42` was left rendering `{L.weekLabel} · हजेरी वही`
 * unguarded — the same defect surviving on a second screen because the fix
 * lived in only one place. A truth guard with two copies is two things that can
 * drift apart; the Rule of Three tolerates duplication, but not for the check
 * that decides whether the app states something it cannot back.
 *
 * The day the server sends a real range, both screens render it with no further
 * change. This suppresses; it never invents a label.
 */

/** A machine date starts `YYYY-MM-DD`. */
const MACHINE_DATE_PREFIX = /^\d{4}-\d{2}-\d{2}/;

/**
 * A week is a SPAN, so its label needs a range dash. Deliberately NOT the ASCII
 * hyphen: that is the character machine dates are built from, and accepting it
 * would let `2026-08-24` straight back through.
 */
const RANGE_DASH = /[–—]/;

export function isReadableWeekRange(label: string | null | undefined): boolean {
    if (!label) return false;
    const trimmed = label.trim();
    if (trimmed.length === 0) return false;
    if (MACHINE_DATE_PREFIX.test(trimmed)) return false;
    return RANGE_DASH.test(trimmed);
}
