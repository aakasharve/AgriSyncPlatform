/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * labourWindow — the four time windows the labour read-model can be asked
 * for, and the one Marathi word each is called by.
 *
 * THE SERVER OWNS THE ARITHMETIC, THIS FILE OWNS THE VOCABULARY.
 * `ShramSafal.Application.UseCases.Labour.GetLabourData.LabourTimeWindow`
 * resolves each of these wire values to an inclusive range of FARM-LOCAL
 * calendar dates and applies it. Nothing here computes a date, a week start
 * or a month start: doing so would put a second, drifting definition of "this
 * week" on the device, which is exactly what that type's own doc-comment
 * exists to prevent (its Monday anchor matches Postgres `date_trunc('week')`;
 * a browser's `Date` would not, and the farmer would read two different weeks
 * on two screens).
 *
 * WHY THE VALUES ARE STRINGS AND NOT AN ENUM: they ARE the wire. Each string
 * below is the literal value `LabourTimeWindow.Resolve` accepts
 * (`AllTime`/`Today`/`Week`/`Month` constants); an unrecognised value is
 * REJECTED there rather than quietly served as all-time, so a typo here
 * surfaces as an error, never as a silently wrong period under a confident
 * heading. `labourClient.window.test.ts` pins the four against that contract.
 *
 * THE MARATHI IS CLOSED AND FOUNDER-APPROVED. आजपर्यंत · आज · हा आठवडा ·
 * हा महिना — these four and no others. `आज` already ships inside sentences
 * (`AttentionPage.tsx`, `Attendance.tsx`); its use as a standalone label here
 * is founder-confirmed. Adding a fifth label, or rewording one of these, is a
 * founder decision and not a code change.
 */

/** The wire value sent as `?window=` — see `LabourTimeWindow.Resolve`. */
export type LabourWindow = 'alltime' | 'today' | 'week' | 'month';

/**
 * आजपर्यंत — everything on record.
 *
 * The founder's choice, in his words: *"everything at a glance, I think I
 * would love to watch"*. It is also what the server already answers when the
 * parameter is omitted, so the screen opens on the same picture a client that
 * predates the window would have received — the default is not a second,
 * competing definition of "no filter".
 */
export const DEFAULT_LABOUR_WINDOW: LabourWindow = 'alltime';

/**
 * Display order, left to right: widest first, so the control opens with its
 * selection at the start rather than mid-track, and reads as "everything,
 * then narrower".
 */
export const LABOUR_WINDOW_ORDER: readonly LabourWindow[] = ['alltime', 'today', 'week', 'month'];

/**
 * A TOTAL map, deliberately — a `Record<LabourWindow, string>` cannot compile
 * with a window missing, so no lookup here can ever need a fallback label. A
 * fallback is how an unnamed period ends up under a confident heading.
 */
export const LABOUR_WINDOW_LABELS: Record<LabourWindow, string> = {
    alltime: 'आजपर्यंत',
    today: 'आज',
    week: 'हा आठवडा',
    month: 'हा महिना',
};
