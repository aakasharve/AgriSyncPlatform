/**
 * 🛑 SHIM. This file holds no implementation any more.
 *
 * Task 5 moved EmptyState, LoadingState, ErrorState and ScoringActiveBanner
 * into `@/components/state`, where they sit beside the four honest causes
 * (MeasuredZero, NoMatch, FeedDown, LoadFailed) that every new screen uses.
 *
 * ── Why the shim exists ───────────────────────────────────────────────────
 * Nine files in this feature folder still import from this path, and they are
 * not migrated until Tasks 22-23 — seventeen tasks away. Moving the exports
 * without leaving this file behind would leave the build RED from Task 5 to
 * Task 23, which breaks the plan's "shippable at every task" invariant
 * outright. A console that cannot be built is not a console that can be
 * shipped in an emergency.
 *
 * ── Note on the plan ──────────────────────────────────────────────────────
 * The migration plan's shim line names only three exports:
 *   export { EmptyState, LoadingState, ErrorState } from '<new path>';
 * That would have broken the build immediately: `FarmerHealthPage.tsx:14`
 * imports ScoringActiveBanner from here too. Verified against the tree, not
 * against the plan.
 *
 * ── When it goes ──────────────────────────────────────────────────────────
 * Task 27 deletes this file, after its last importer moves and `npm run build`
 * is clean. Do NOT add anything to it, and do not import from it in new code —
 * import from `@/components/state`.
 */
export {
  EmptyState,
  ErrorState,
  LoadingState,
  ScoringActiveBanner,
} from '@/components/state';

export type {
  EmptyStateProps,
  ErrorStateProps,
  LoadingStateProps,
  ScoringActiveBannerProps,
} from '@/components/state';
