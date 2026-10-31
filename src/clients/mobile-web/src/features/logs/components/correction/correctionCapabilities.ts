/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF → lane OF-S) — the two things the बदला screen cannot do yet
 * because the SERVER has no route for them, each behind ONE switch that lane OF-S flips when it adds the route:
 *
 *   1. MOVE A SAVED ENTRY to another plot or another day ("प्लॉट बदला" / "दिवस बदला", founder D-61 = 5A + TAP-1). No sync
 *      mutation carries a saved log's plot or date (`revise_log_content` carries the content buckets only), so a move made
 *      on this phone would be undone by the next pull (P10). Until the switch is on, the plot and the day are shown
 *      read-only with one plain line — never a button that cannot do its job (P5).
 *   2. A WORKER-COUNT change with no internet. A count goes as a labour correction, which is POSTed straight to the server
 *      (`UpdateLog` step 4), not queued. Online it works today; offline the screen says plainly that this one needs the
 *      internet. When the queued route exists, the switch lets it queue like every other change.
 *
 * Nothing else reads these flags: OF-S flips the value here and adds the call in `queueSavedEntryMove`.
 */
import type { DailyLog, LogScope } from '../../../../types';

const SWITCHES = {
    /** OF-S: true once a queued, offline-safe "move a saved log's plot / date" mutation exists. */
    moveSavedEntry: false,
    /** OF-S: true once a labour-count correction can be queued (sent later) instead of POSTed now. */
    queueLabourCountOffline: false,
} as const;

/** Can this phone move a SAVED entry to another plot / day? */
export const canMoveSavedEntry = (): boolean => SWITCHES.moveSavedEntry;

/** Can a worker-count change be made with no internet (queued)? */
export const canQueueLabourCountOffline = (): boolean => SWITCHES.queueLabourCountOffline;

/** Where he chose to move a saved entry (either part may be absent: only the plot, or only the day). */
export interface SavedEntryMove { scope?: LogScope; dateKey?: string }

/**
 * OF-S adds the queued call here (mutation, payload, local write). Until then the switch is off, the screen offers no move,
 * and this is never reached; reaching it anyway is an error, never a silent no-op.
 */
export async function queueSavedEntryMove(log: DailyLog, move: SavedEntryMove): Promise<never> {
    throw new Error(`move of a saved entry is not available yet (log ${log.id}, ${move.dateKey ?? '-'}, ${move.scope?.selectedPlotIds.join(',') ?? '-'})`);
}
