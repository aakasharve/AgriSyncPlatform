import { Masked } from '@/components/state/Masked';
import { isRedacted } from '@/components/state/redaction';
import { hasDevanagari } from '@/lib/searchKey';

/**
 * PersonName — THE ONE PLACE A PERSON'S NAME IS RENDERED.
 *
 * ── The duplication this replaces (Preservation Register A34) ──────────────
 * The identical `HAS_DEVANAGARI` + `fontFor` pair is copy-pasted at FOUR call
 * sites today, all verified in the tree on 2026-08-31:
 *
 *   src/features/farmer-health/FarmerHealthDrilldown.tsx:30-36
 *   src/features/farmer-health/components/InterventionQueueTable.tsx:27-33
 *   src/features/farmer-health/components/WatchlistTable.tsx:17-23
 *   src/features/farmer-health/components/WorkerSummaryList.tsx:20-26
 *
 * Those four are NOT re-pointed here. They die with their screens in Tasks 22
 * and 23, which is the sequencing discipline that has kept this branch green.
 *
 * ── Why a mockup cannot catch this ────────────────────────────────────────
 * The project font rule is hard (root CLAUDE.md, Font Rules): Marathi body
 * text is 'Noto Sans Devanagari'; English, brand and numbers are 'DM Sans';
 * `system-ui`, `Arial` and generic fallbacks are never used for visible text.
 *
 * The v3 prototype is drawn in English with Latin sample names, so a port that
 * quietly drops the script check looks perfect in review and is wrong the
 * moment it reaches production: a farmer's name renders in a face that was
 * never designed for the script it is written in. That is the entire reason
 * this component exists rather than a `className`.
 *
 * ── Why an inline style and not a Tailwind utility ────────────────────────
 * The face is chosen per VALUE, at render time, from the content of the
 * string. `font-devanagari` as a static class cannot express "this row is
 * Marathi and the one above it is not", and a class name is also not evidence:
 * `vitest.config.ts` sets `css: false`, so a test asserting a utility class
 * proves only that a string was spelled right. An inline `fontFamily` is real
 * in jsdom and is therefore assertable. The literals below are checked against
 * `--font-devanagari` / `--font-sans` in the token layer by
 * `PersonName.test.tsx`, so the two cannot drift.
 *
 * ── Redaction is Task 5's, not ours ───────────────────────────────────────
 * A name the caller may not see arrives as the literal marker `**redacted**`.
 * It is routed through `Masked`, which shows the fallback (a farm id, an
 * account id) and NEVER the marker. `isRedacted`/`Masked` are imported, not
 * re-implemented.
 *
 * Note the live bug this does not fix: `FarmerHealthDrilldown.tsx:55` still
 * prints the raw marker into a page title. That screen migrates in Task 23.
 *
 * ── Import depth ──────────────────────────────────────────────────────────
 * A shared primitive imports `./Masked` and `./redaction` directly rather than
 * the `@/components/state` barrel, so the whole honest-state vocabulary — and
 * lucide, and Button — does not follow a name into every chunk that only
 * needed to render one. Same rule KpiCard follows.
 */

/** Marathi body text. Charter rule; mirrors `--font-devanagari`. */
const FONT_DEVANAGARI = "'Noto Sans Devanagari', sans-serif";

/** A Latin name is set in the DISPLAY face, and that is the deliberate half
 *  of the 2026-09-02 font split. `--font-sans` became Nunito Sans for prose;
 *  `--font-display` stayed DM Sans for the places the console speaks in its
 *  own name, and a person's name in a table is one of them — it sits beside
 *  every other name, in a column, and a proper noun is not prose.
 *
 *  This mirrors `--font-display`. `PersonName.test.tsx` asserts the two
 *  against each other, so the component and the token cannot drift. */
const FONT_LATIN = "'DM Sans', sans-serif";

export interface PersonNameProps {
  /** The name as the server sent it — Devanagari, Latin, `**redacted**`,
   *  partly masked, empty or absent. All six are handled. */
  name: string | null | undefined;
  /**
   * What to show when the name is withheld or missing. Give it something that
   * identifies the ROW without naming the person — a farm id, an account id.
   *
   * Deliberately has NO default. The plan's sketch defaulted it to an em dash,
   * which quietly defeats `Masked`: given any truthy fallback, Masked prints
   * it, so a redacted name with no row id would have rendered as a bare `—`
   * and collapsed two different facts — "there is no name" and "you may not
   * see this name" — into the same character. Left undefined, Masked reaches
   * its own affordance and says `— hidden` with the reason in the title.
   */
  fallback?: string;
  className?: string;
}

export function PersonName({ name, fallback, className }: PersonNameProps) {
  /* A withheld name is a permission fact, not a string, and it is rendered the
     same way on every surface. `Masked` prints the fallback; the marker itself
     never reaches the DOM. */
  if (isRedacted(name)) {
    return <Masked value={name} fallback={fallback} className={className} />;
  }

  /* Only a name that is genuinely ABSENT lands on the em dash. */
  const text = name?.trim() || fallback || '—';
  const deva = hasDevanagari(text);

  return (
    <span
      /* The contract, on the DOM: which script this name was rendered in.
         Tests and future screens assert on this rather than on a font string
         or a class, so restyling cannot silently break the font rule. */
      data-script={deva ? 'devanagari' : 'latin'}
      className={className}
      style={{ fontFamily: deva ? FONT_DEVANAGARI : FONT_LATIN }}
    >
      {text}
    </span>
  );
}
