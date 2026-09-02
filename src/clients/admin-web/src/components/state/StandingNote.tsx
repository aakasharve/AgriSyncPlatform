import type { ReactNode } from 'react';
import { Info } from 'lucide-react';
import { Disclosure } from '@/components/ui/Disclosure';

/**
 * STANDING NOTE — the thing every screen says about itself, folded shut.
 *
 * ── What this replaces, and why it is not the same component ─────────────
 * Ten screens ended with a `NotMeasuredPanel` carrying two hundred words
 * about what the screen cannot tell you. That was always slightly the wrong
 * component: CONTRACT.md §6.4's `NotMeasuredPanel` means *"this panel has no
 * data source at all"* — it stands IN PLACE OF data, and it must be seen. A
 * standing note stands BESIDE data and explains it. Two different jobs that
 * happened to look alike.
 *
 * Splitting them is what makes the founder's instruction safe to follow. He
 * asked for the long text to be *"expandable when user wants to know"*; if
 * the two had stayed one component, collapsing the note would have collapsed
 * the "there is no source for this" panel with it, and a screen would have
 * quietly stopped saying it had nothing to show.
 *
 * So `NotMeasuredPanel` is untouched and still always visible. This is the
 * one that folds.
 *
 * ── What did NOT change ──────────────────────────────────────────────────
 * The words. Every caveat is passed straight through to `Disclosure`, which
 * renders its children whether it is open or shut — see the properties in
 * that file. Nothing was shortened to fit a collapsed control and nothing was
 * dropped.
 *
 * ── What is NOT allowed in here ──────────────────────────────────────────
 * 🛑 A CAVEAT THAT CHANGES HOW THE NUMBER BESIDE IT SHOULD BE READ STAYS
 * VISIBLE. "Events counted, not errors" is a correction to a column header;
 * "this is a measured zero, not a missing feed" is a correction to the zero
 * it sits under. Fold either and the misreading comes straight back, which is
 * the opposite of what a caveat is for. Those live on the screen, in the
 * open, beside their figure — never in here. The ones that belong in here are
 * the ones a reader needs ONCE: provenance, scope, what a feed does not
 * carry, why a list is ordered the way it is.
 *
 * ── The role went, deliberately ──────────────────────────────────────────
 * The old panel carried `role="status"` and `aria-live="polite"`. A standing
 * note is not a status: it never changes, it is not the result of anything,
 * and a live region that announces a fixed paragraph on every render is noise
 * a screen-reader user has to sit through. It is a disclosure now — a
 * control, announced as one, with a truthful expanded state.
 */
export interface StandingNoteProps {
  /**
   * The caveats. Required — a note that says "there are caveats" and stops
   * has told the reader nothing they did not already suspect.
   */
  why: ReactNode;
  /** The button label. */
  title?: ReactNode;
  /**
   * ONE PLAIN SENTENCE, ALWAYS VISIBLE. Say what is inside in words a new
   * support hire could read on day one, so nobody has to click to find out
   * whether clicking is worth it.
   */
  summary?: ReactNode;
  className?: string;
}

export function StandingNote({
  why,
  title = 'What this screen cannot tell you',
  summary,
  className,
}: StandingNoteProps) {
  return (
    <Disclosure
      name="standing-note"
      variant="panel"
      label={title}
      summary={summary}
      icon={<Info size={20} strokeWidth={1.8} aria-hidden="true" />}
      className={className}
    >
      {why}
    </Disclosure>
  );
}
