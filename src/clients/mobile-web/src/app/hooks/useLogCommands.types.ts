/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Extracted from `useLogCommands.ts` to keep that file under the mobile-web
 * 800-line budget (`npm run check:file-sizes`). Pure code move — no
 * behavior change; `useLogCommands.ts` re-exports this type so existing
 * `from './useLogCommands'` imports keep working.
 *
 * spec: 2026-08-14-founder-decisions-launch-cohort-and-scope — fix round 3.
 */

/**
 * `handleManualSubmit`'s outcome, honestly. A plain boolean collapsed four
 * different situations into one `false`/`true`, and callers cannot treat them
 * the same:
 *   - `'saved'`               a log was created or updated AND every step
 *                              after the write (sync enqueue, summary calc)
 *                              also succeeded. Clean.
 *   - `'saved_with_warning'`  (round 3) — the write itself succeeded, but a
 *                              step AFTER it (same `try`, e.g. sync enqueue)
 *                              threw. The record IS durably in the ledger —
 *                              never tell the farmer to retry, that mints a
 *                              duplicate — but he was not told AT ALL on
 *                              every surface: `setError` here only renders on
 *                              the main log screen's `AudioRecorder`
 *                              (`mainView.tsx`), not on `AiDraftsPage`. Round
 *                              2 collapsed this into plain `'saved'`, which
 *                              let `AiDraftsPage` mark the draft reviewed and
 *                              refresh with NOTHING said and NOTHING queued
 *                              to sync — the row simply vanished. A caller
 *                              that cannot tell this from a clean save cannot
 *                              warn about it; that is why this is its own
 *                              outcome, not a shared one.
 *   - `'not_saved'`            nothing was written — no active context, or
 *                              the write itself failed/threw before
 *                              completing.
 *   - `'already_saving'`       this call LOST a double-tap race; another call
 *                              is (or already did) performing the save.
 *                              Silent by design (`saveLock`, in
 *                              `useLogCommands.ts`) — showing an alert here
 *                              would contradict a save that is succeeding.
 */
export type ManualSubmitOutcome = 'saved' | 'saved_with_warning' | 'not_saved' | 'already_saving';
