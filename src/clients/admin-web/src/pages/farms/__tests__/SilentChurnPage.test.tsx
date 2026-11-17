import { expect, it } from 'vitest';
import SilentChurnPage from '../SilentChurnPage';

/**
 * Silent Churn (S1-S3 are ideas) after B24 (founder, 2026-11-17): every number on this page is an idea shown as "Not built yet" with its two lines
 * and no number, and the page asks its old feed for nothing. The old rendering tests are retired, one line each:
 */
// B24 (founder, 2026-11-17): S1-S3 are ideas shown as Not built yet (the page reads no feed). Retired: "does not count it as a long silence, does not list it, and names it se".
// B24 (founder, 2026-11-17): S1-S3 are ideas shown as Not built yet (the page reads no feed). Retired: "never prints the word "Never" into a watchlist cell, the way the old s".
// B24 (founder, 2026-11-17): S1-S3 are ideas shown as Not built yet (the page reads no feed). Retired: "reports the number of held-out farms as NOT MEASURED, never as zero".
// B24 (founder, 2026-11-17): S1-S3 are ideas shown as Not built yet (the page reads no feed). Retired: "says "Last contacted — not measured" and does not soften it".
// B24 (founder, 2026-11-17): S1-S3 are ideas shown as Not built yet (the page reads no feed). Retired: "renders a 500 as a failure with a retry — and NOT as "0 farms" over a ".
// B24 (founder, 2026-11-17): S1-S3 are ideas shown as Not built yet (the page reads no feed). Retired: "renders a TIMEOUT as its own failure, not as an empty watchlist".
// B24 (founder, 2026-11-17): S1-S3 are ideas shown as Not built yet (the page reads no feed). Retired: "renders a 403 as a PERMISSION fact, distinct from both a 500 and an em".
// B24 (founder, 2026-11-17): S1-S3 are ideas shown as Not built yet (the page reads no feed). Retired: "renders a GENUINE empty as a measured zero that names its window".
// B24 (founder, 2026-11-17): S1-S3 are ideas shown as Not built yet (the page reads no feed). Retired: "shows a skeleton shaped like this table while the first request is in ".
// B24 (founder, 2026-11-17): S1-S3 are ideas shown as Not built yet (the page reads no feed). Retired: "opens on the summary, opens the rows on Show all, and has no pager".
// B24 (founder, 2026-11-17): S1-S3 are ideas shown as Not built yet (the page reads no feed). Retired: "states the rule it applies, in the terms the query actually uses (A57)".
// B24 (founder, 2026-11-17): S1-S3 are ideas shown as Not built yet (the page reads no feed). Retired: "cross-filters every count, so a button says what pressing it would giv".
// B24 (founder, 2026-11-17): S1-S3 are ideas shown as Not built yet (the page reads no feed). Retired: "fixes the silence bands longest-first, not in count order".
// B24 (founder, 2026-11-17): S1-S3 are ideas shown as Not built yet (the page reads no feed). Retired: "drops the plan filter entirely when every farm is on the same plan".
// B24 (founder, 2026-11-17): S1-S3 are ideas shown as Not built yet (the page reads no feed). Retired: "renders the three phone shapes, the Marathi font and the churn date fo".
// B24 (founder, 2026-11-17): S1-S3 are ideas shown as Not built yet (the page reads no feed). Retired: "finds a Devanagari farm from a romanised phone-call spelling".
// B24 (founder, 2026-11-17): S1-S3 are ideas shown as Not built yet (the page reads no feed). Retired: "says what the box actually searches when nothing matches".

// The new behaviour is covered by src/__tests__/b24.ideas.test.tsx.
it('still has a page component to mount', () => {
  expect(typeof SilentChurnPage).toBe('function');
});
