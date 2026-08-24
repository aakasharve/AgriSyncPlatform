/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop (findings F2 + F3)
 *
 * Two cross-tree "open this surface" requests, so a control that looks
 * usable actually lands somewhere.
 *
 * WHY WINDOW EVENTS AND NOT PROPS
 * --------------------------------
 * The two surfaces this feature needs to reach are mounted on OPPOSITE sides
 * of `AppContent.tsx`'s provider boundary, and neither has a prop path to
 * the other:
 *
 *   - The waiting drawer (`OversightOverlay`) is owned by `AppHeader`, which
 *     renders as a SIBLING of `<AppFeatureProviders>` — see
 *     `app/helpers/appContentOversightInputs.ts`'s header for why it was
 *     deliberately left there.
 *   - The review inbox (`ReviewInboxSheet`) is owned by `AppRouter`'s
 *     `showReviewInbox` state, INSIDE that provider tree
 *     (`core/navigation/globalSheets.tsx`).
 *
 * `useFarmContextState.ts`'s `OPEN_CREATE_FARM_WIZARD_EVENT` /
 * `requestCreateFarmWizard()` already solve exactly this problem in the
 * mirror-image direction (deep inside `AppRouter` -> `AppContent`), with the
 * reasoning written out in that file. This module is the same pattern, same
 * naming convention, for the two hops findings F2/F3 need — not a second,
 * differently-shaped mechanism.
 *
 * DELIVERY ORDERING (checked, not assumed): React commits passive effects
 * depth-first, siblings left-to-right, so `AppHeader`'s listener (an earlier
 * sibling in `AppContent.tsx`'s JSX) is attached before `AppRouter`'s
 * `useNudgeRouteEffect` runs and dispatches. A dispatch is therefore never
 * fired into an empty room on first paint. Both listeners are pinned by
 * named tests — see `AppHeader.oversight.test.tsx`
 * (`the_header_opens_the_waiting_drawer_when_another_surface_requests_it`)
 * and `useNudgeRouteEffect.test.ts`.
 *
 * These are plain `Event`s with no payload: "open X" carries no data, and a
 * `CustomEvent` detail would invite one to grow.
 */

/** Asks whoever owns the waiting drawer (`AppHeader`) to open it. */
export const OPEN_WAITING_DRAWER_EVENT = 'agrisync:open-waiting-drawer';

/** Asks whoever owns the review inbox (`AppRouter`) to open it. */
export const OPEN_REVIEW_INBOX_EVENT = 'agrisync:open-review-inbox';

/** Dispatches {@link OPEN_WAITING_DRAWER_EVENT}. Safe anywhere, including
 * SSR (no-ops without `window`). */
export function requestOpenWaitingDrawer(): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new Event(OPEN_WAITING_DRAWER_EVENT));
}

/** Dispatches {@link OPEN_REVIEW_INBOX_EVENT}. Safe anywhere, including SSR
 * (no-ops without `window`). */
export function requestOpenReviewInbox(): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new Event(OPEN_REVIEW_INBOX_EVENT));
}
