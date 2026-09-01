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
 *   There is no source at all           -> NotMeasuredPanel
 *   One value is absent, in a cell      -> NotMeasured     (the ONLY component
 *                                                           allowed to print a
 *                                                           missing value)
 *   One value is hidden by permission   -> Masked
 *   It is still loading                 -> LoadingState    (name the block)
 *
 * `EmptyState` and `ErrorState` are here because ten farmer-health call sites
 * still use them and do not migrate until Tasks 22-23. They are the generic
 * forms this task exists to replace — read their file headers before using
 * either on anything new.
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
