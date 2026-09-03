/* eslint-disable @typescript-eslint/no-explicit-any --
 * PRE-EXISTING legacy debt, moved here WITH the interface it covers.
 * `handleManualSubmit` and `handleUpdateNote` take loose form-data
 * payloads typed `any`; that predates the 2026-05-17 eslint tightening
 * and retyping them is an out-of-scope refactor with real behaviour
 * risk. The directive lived on `useLogCommands.ts` until this split;
 * it belongs wherever the `any`s are, not wherever they used to be. */
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
import type { AgriLogResponse, DailyLog } from '../../types';
import type { LogProvenance } from '../../domain/ai/LogProvenance';
import type { LogCommandServiceImpl } from '../../application/services/LogCommandService';


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
 *                              duplicate — but unless the CALLER says so on
 *                              its own surface he is told nothing anywhere.
 *
 *                              ROUND 4 (finding N2) — this used to claim
 *                              `setError` here "only renders on the main log
 *                              screen's `AudioRecorder` (`mainView.tsx`)".
 *                              That is false for this path. `setError` is the
 *                              voice hook's setter, and its `error` has
 *                              exactly one reader: `mainView.tsx:388`/`:405`,
 *                              as `externalError` on `AudioRecorder` /
 *                              `AudioRecorderStreaming` — both mounted ONLY
 *                              in the `mode === 'voice'` branch, while
 *                              `ManualEntry`, the sole caller of
 *                              `handleManualSubmit`, is the OTHER branch. So
 *                              at the moment of a manual post-write failure
 *                              this message is mounted on no surface at all,
 *                              the main log screen included. Nothing clears
 *                              `error` on a mode change either, so it can
 *                              only appear later, decontextualised, if the
 *                              farmer switches to voice.
 *
 *                              Round 2 collapsed this into plain `'saved'`,
 *                              which let `AiDraftsPage` mark the draft
 *                              reviewed and refresh with NOTHING said and
 *                              NOTHING queued to sync — the row simply
 *                              vanished. A caller that cannot tell this from
 *                              a clean save cannot warn about it; that is why
 *                              this is its own outcome, not a shared one.
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

export interface UseLogCommandsResult {
    handleAutoSave: (logData: AgriLogResponse, provenance?: LogProvenance) => Promise<void>;
    handleFinalConfirm: (editedData: AgriLogResponse | null, draftLog: AgriLogResponse | null) => Promise<void>;
    // Pre-existing `any` (predates Task 3.5; tracked project-wide by
    // Sub-plan 04 Task 10 per eslint.config.js) — not introduced by this
    // change, left as-is to avoid retyping the ManualEntry payload contract
    // out of scope.
    //
    // spec: 2026-08-14-founder-decisions-launch-cohort-and-scope — return
    // type widened from `Promise<void>` (round 0) to `Promise<boolean>`
    // (round 1) to `Promise<ManualSubmitOutcome>` (round 2 — see the type's
    // own doc comment for why boolean was not enough). The function ALWAYS
    // resolves — no-context guard, the double-tap lock, and a thrown save
    // error are each caught and turned into a toast/error state, never a
    // rejection — so "the promise resolved" was never proof a log was
    // written, and (round 2) "it returned false" was never proof it wasn't.
    // No existing caller inspected the old `void`/`boolean` return, so this
    // stays additive: `mainView.tsx` still passes this straight through as
    // `ManualEntry`'s `onSubmit`, whose prop type returns `void` —
    // TypeScript's void-return compatibility rule accepts a function that
    // returns MORE than void there unchanged.
     
    handleManualSubmit: (data: any) => Promise<ManualSubmitOutcome>;
    handleWizardSubmit: (logs: DailyLog[]) => Promise<void>;
     
    handleUpdateNote: (logId: string, noteId: string, updates: any) => void;
    // Exposed for testing/advanced usage
    service: LogCommandServiceImpl;
}
