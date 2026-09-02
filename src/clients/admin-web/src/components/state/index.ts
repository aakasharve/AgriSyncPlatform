/**
 * THE HONEST-STATE VOCABULARY — one barrel, one import line.
 *
 * Every panel on every screen renders its absence through one of these. If a
 * screen needs a word that is not here, the word is wrong or the vocabulary is
 * missing one — add it here, with its reason, rather than writing a sentence
 * into a page.
 *
 * ── Which one ─────────────────────────────────────────────────────────────
 *   The request broke                   -> LoadFailed
 *   The feed stopped                    -> FeedDown        (names WHEN)
 *   The filter excluded everything      -> NoMatch
 *   We looked and there is none         -> MeasuredZero    (names the window)
 *   There is no source at all           -> NotMeasuredPanel (always shown)
 *   The screen's own standing caveats   -> StandingNote     (folded shut)
 *   One value is absent, in a cell      -> NotMeasured     (the ONLY component
 *                                                           allowed to print a
 *                                                           missing value)
 *   One value is hidden by permission   -> Masked
 *   It is still loading                 -> LoadingState    (name the block)
 *
 * `EmptyState` and `ErrorState` were promoted here because ten farmer-health
 * call sites still used them at Task 5. Counted again at Task 27, after the
 * migration: `EmptyState` has ONE (`InterventionQueueEmpty`) and `ErrorState`
 * has NONE — Task 23 moved its last two panels to `LoadFailed`, whose Retry is
 * required rather than optional. Both are kept: `ErrorState` because the
 * Preservation Register carries its working Retry and `formatError` ladder as
 * A41, and a registered guarantee is not dropped because the count reached
 * zero. They remain the generic forms this vocabulary exists to replace — read
 * their file headers before using either on anything new.
 *
 * ⚠️ IMPORT DEPTH. A screen imports from this barrel. A shared PRIMITIVE
 * (KpiCard) imports `./honestState` directly, so the whole vocabulary — and
 * lucide, and Button — does not follow the words into every chunk that only
 * needed the words.
 */

/* the vocabulary itself — no components, no JSX */
export { INTERVENTION_EMPTY, STATE_WORD, formatError, stateWord } from './honestState';
export type { HonestState } from './honestState';
export { REDACTED, isPartlyMasked, isRedacted, maskState } from './redaction';
export type { MaskState } from './redaction';

/* the four causes, plus the no-source panel */
export { FeedDown, LoadFailed, MeasuredZero, NoMatch, NotMeasuredPanel } from './causes';
export type {
  FeedDownProps,
  LoadFailedProps,
  MeasuredZeroProps,
  NoMatchProps,
  NotMeasuredPanelProps,
} from './causes';

/* the screen's own caveats, folded shut. Read its file header before
   putting anything in one: a caveat that changes how the number beside it
   should be read is NOT allowed in here. */
export { StandingNote } from './StandingNote';
export type { StandingNoteProps } from './StandingNote';

/* the value-level forms */
export { NotMeasured } from './NotMeasured';
export type { NotMeasuredProps } from './NotMeasured';
export { Masked } from './Masked';
export type { MaskedProps } from './Masked';

/* promoted from features/farmer-health — see each file's header */
export { EmptyState } from './EmptyState';
export type { EmptyStateProps } from './EmptyState';
export { LoadingState } from './LoadingState';
export type { LoadingStateProps } from './LoadingState';
export { ErrorState } from './ErrorState';
export type { ErrorStateProps } from './ErrorState';

/* mandatory copy, and the one empty that has two truths */
export { ScoringActiveBanner } from './ScoringActiveBanner';
export type { ScoringActiveBannerProps } from './ScoringActiveBanner';
export { InterventionQueueEmpty } from './InterventionQueueEmpty';
export type { InterventionQueueEmptyProps } from './InterventionQueueEmpty';
