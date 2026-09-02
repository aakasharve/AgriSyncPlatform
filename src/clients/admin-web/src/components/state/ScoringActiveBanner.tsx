/**
 * ScoringActiveBanner: MANDATORY copy per C5 — do not paraphrase.
 *
 * The comment line above is carried VERBATIM from the file this component was
 * promoted out of (`features/farmer-health/components/EmptyAndErrorStates.tsx:12`).
 * A red-line comment that does not travel with the code it guards stops being
 * a red line — it becomes a note about a file somebody else is maintaining.
 *
 * The exact string is:
 *
 *     Scoring active from {DEPLOY_DATE}; data accumulating.
 *
 * It is a compliance sentence, not UI copy: it is what tells an operator that
 * the scores on screen are a partial window rather than a settled reading, in
 * the pre-accumulation period after a deploy. Rewording it — even to something
 * that reads better — changes what was said. `__tests__/honestStates.test.tsx`
 * asserts it byte-for-byte, including the semicolon and the full stop.
 *
 * The markup splits the sentence across two spans so the date is emphasised
 * and the rest is not. That split is preserved from the original: the two
 * spans concatenate to the exact string, which is what the test reads.
 */

const DEPLOY_DATE_FALLBACK = 'first deploy';

export interface ScoringActiveBannerProps {
  deployDate?: string;
}

export function ScoringActiveBanner({ deployDate }: ScoringActiveBannerProps) {
  const date = deployDate?.trim() || DEPLOY_DATE_FALLBACK;
  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-panel border border-line bg-tint-grey px-4 py-3 text-caption font-semibold text-text-1"
    >
      <span className="font-extrabold">Scoring active from {date};</span>{' '}
      <span className="text-text-2">data accumulating.</span>
    </div>
  );
}
