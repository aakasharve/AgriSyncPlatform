/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop (§P-I — "the recording path stays sacred")
 *
 * ONE expression, two callers — deliberately.
 *
 * The tap path into Log/Reflect/Compare has always been guarded: `AppContent`
 * passes this condition to `AppHeader` as `disabled`, which forwards it to
 * `OversightNavCards` (and to the profile button). The SWIPE path
 * (`MainViewTransition`) had no equivalent, so a horizontal swipe mid-record
 * called `onChangeView` and `renderLogView` (`core/navigation/mainView.tsx`)
 * returned `null` on the very next render — unmounting `AudioRecorder`, and
 * with it the live `MediaRecorder`, under the farmer's thumb.
 *
 * Both paths now call THIS function, so they cannot drift: widening or
 * narrowing the guard is a single edit here, and it moves tap and swipe
 * together by construction.
 *
 * WHY ONLY `recording` AND `processing`, and not `confirming`/`success`:
 * this is the pre-existing tap-path condition, kept byte-for-byte. It is also
 * the honest boundary — `draftLog`, `status` and the parse promise all live in
 * `useAgriLogApp()` state held by `AppContent`, which is ABOVE the unmount
 * boundary, so leaving and returning to the confirm/success screen re-renders
 * the same draft. `AudioRecorder`'s `MediaRecorder` is the one thing that lives
 * INSIDE the unmounted subtree and is genuinely destroyed. Widening this to the
 * later states would also silently change the tap path's behaviour, which is a
 * founder-facing UX call, not an implementation detail.
 */
import type { AppStatus } from '../../domain/types/farm.types';

/**
 * True while a view change would destroy work in progress on the recording
 * path. Never read `status` inline at a call site — call this.
 */
export function isRecordingPathBusy(status: AppStatus): boolean {
    return status === 'processing' || status === 'recording';
}
