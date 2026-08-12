/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Labour Phase 2 -> Phase 1 (honesty backstop).
 *
 * ONE number, in a module with ZERO imports.
 *
 * It was duplicated: `MutationQueue.ts` applies the cap, `syncHonestyState.ts`
 * turns the same number into the chip's `NEEDS_FIX` claim, and each carried its
 * own literal `5` plus a comment asking whoever came next to collapse them. A
 * drift between the two would make the chip shout "stuck, go check" at rows the
 * worker was still cheerfully retrying, or stay quiet about rows it had already
 * abandoned — the exact class of half-truth Phase 1 exists to remove.
 *
 * Collapsing them by having the chip import `MutationQueue` would have worked,
 * and it is what the first attempt did — at the cost of pulling Dexie into the
 * import graph of a module whose header advertises it as pure and Dexie-free.
 * A leaf with no imports keeps both properties: one definition, and nothing
 * dragged along behind it.
 *
 * Do not add an import to this file.
 */

/**
 * How many SERVER-ANSWERED refusals a row may collect before the background
 * worker stops retrying it by itself and the farmer is asked to act.
 *
 * Applied in `MutationQueue.markFailedAsPending`. Read by
 * `syncHonestyState.deriveSyncHonestyState` (to decide `NEEDS_FIX`) and by
 * `stuckMutations.needsFarmerAction` (to decide what the drawer lists).
 *
 * TRANSPORT FAILURES DO NOT COUNT TOWARD IT (Task T3): a row that failed
 * because the tower dropped out has not been refused by anyone, and charging it
 * would let ~75 seconds of bad rural signal latch the chip red permanently.
 *
 * A row past the cap is NOT abandoned. `retryAllFailedByUser()` and the per-row
 * retry both ignore it, because the cap exists to stop the WORKER asking
 * forever, not to refuse the farmer.
 */
export const MAX_AUTO_RETRY_COUNT = 5;
