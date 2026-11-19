import { expect, it } from 'vitest';
import SufferingPage from '../SufferingPage';

/**
 * Suffering (U1-U2 are ideas) after B24 (founder, 2026-11-17): every number on this page is an idea shown as "Not built yet" with its two lines
 * and no number, and the page asks its old feed for nothing. The old rendering tests are retired, one line each:
 */
// B24 (founder, 2026-11-17): U1-U2 are ideas shown as Not built yet (the page reads no feed). Retired: "renders a 500 as a failure with a retry — not as "great!", and not as ".
// B24 (founder, 2026-11-17): U1-U2 are ideas shown as Not built yet (the page reads no feed). Retired: "renders a TIMEOUT as its own failure, not as an empty watchlist".
// B24 (founder, 2026-11-17): U1-U2 are ideas shown as Not built yet (the page reads no feed). Retired: "renders a 403 as a PERMISSION fact, distinct from both a 500 and an em".
// B24 (founder, 2026-11-17): U1-U2 are ideas shown as Not built yet (the page reads no feed). Retired: "renders a GENUINE empty as a measured zero that states the rule and th".
// B24 (founder, 2026-11-17): U1-U2 are ideas shown as Not built yet (the page reads no feed). Retired: "shows a skeleton shaped like this table while the first request is in ".
// B24 (founder, 2026-11-17): U1-U2 are ideas shown as Not built yet (the page reads no feed). Retired: "says that an empty list is not proof the pipeline is healthy".
// B24 (founder, 2026-11-17): U1-U2 are ideas shown as Not built yet (the page reads no feed). Retired: "says "Resolved — not measured" and does not soften it into a status".
// B24 (founder, 2026-11-17): U1-U2 are ideas shown as Not built yet (the page reads no feed). Retired: "keeps every count answering "how many are there" when a filter is pres".
// B24 (founder, 2026-11-17): U1-U2 are ideas shown as Not built yet (the page reads no feed). Retired: "says in words that the three channels overlap and do not add up".
// B24 (founder, 2026-11-17): U1-U2 are ideas shown as Not built yet (the page reads no feed). Retired: "states the rule the query applies, not the one the old screen claimed".
// B24 (founder, 2026-11-17): U1-U2 are ideas shown as Not built yet (the page reads no feed). Retired: "names the figure for what it counts, falls back on a nameless farm, an".
// B24 (founder, 2026-11-17): U1-U2 are ideas shown as Not built yet (the page reads no feed). Retired: "finds a Devanagari farm from a romanised phone-call spelling".
// B24 (founder, 2026-11-17): U1-U2 are ideas shown as Not built yet (the page reads no feed). Retired: "says what the box actually searches when nothing matches".

// The new behaviour is covered by src/__tests__/b24.ideas.test.tsx.
it('still has a page component to mount', () => {
  expect(typeof SufferingPage).toBe('function');
});
