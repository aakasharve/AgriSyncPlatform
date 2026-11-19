import { INTERVENTION_EMPTY } from './honestState';
import { EmptyState } from './EmptyState';

/**
 * TWO DIFFERENT TRUTHS, AND A DESIGN THAT SUPPLIES ONE EMPTY STATE PER TABLE
 * COLLAPSES THEM INTO A CELEBRATION (Preservation Register A36).
 *
 *   understated (the cohort itself is empty — nothing has been scored yet)
 *     -> "No farms in intervention bucket yet."   with NO hint.
 *
 *   normal      (the cohort has rows, and every one of them clears the bar)
 *     -> "No farms in intervention bucket."
 *        plus "All scored farms are above the 40-pt intervention threshold."
 *
 * The word `yet` and the presence of the hint are the entire difference, and
 * they carry the entire meaning. The first says "we have not looked at anyone
 * yet". The second says "we looked at everyone and they are all fine". Showing
 * the second sentence over an unscored cohort is a claim about farms nobody
 * has measured — the exact fabrication class this redesign removes.
 *
 * Lifted verbatim from `InterventionQueueTable.tsx:72-81`, which now calls
 * this instead of holding its own copy. It lives in the state vocabulary
 * because the rule it encodes is the vocabulary's whole thesis: an absence
 * has a cause, and the cause changes the words.
 */
export interface InterventionQueueEmptyProps {
  /** True when the cohort is empty (Mode B first-deploy), so the copy makes
   *  no claim about farms that have not been scored. */
  understated?: boolean;
}

export function InterventionQueueEmpty({ understated }: InterventionQueueEmptyProps) {
  const copy = understated ? INTERVENTION_EMPTY.understated : INTERVENTION_EMPTY.normal;
  return <EmptyState message={copy.message} hint={copy.hint} />;
}
