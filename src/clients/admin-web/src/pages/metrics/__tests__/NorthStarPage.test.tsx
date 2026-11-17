import { expect, it } from 'vitest';
import NorthStarPage from '../NorthStarPage';

/**
 * WVFD (W1-W7 are ideas) after B24 (founder, 2026-11-17): every number on this page is an idea shown as "Not built yet" with its two lines
 * and no number, and the page asks its old feed for nothing. The old rendering tests are retired, one line each:
 */
// B24 (founder, 2026-11-17): W1-W7 are ideas shown as Not built yet (the page reads no feed). Retired: "changes the request, the cache entry and the title — and refuses a val".
// B24 (founder, 2026-11-17): W1-W7 are ideas shown as Not built yet (the page reads no feed). Retired: "draws, tabulates and describes them all without collapsing any two".
// B24 (founder, 2026-11-17): W1-W7 are ideas shown as Not built yet (the page reads no feed). Retired: "names a non-adjacent comparison, and says when the headline is not thi".
// B24 (founder, 2026-11-17): W1-W7 are ideas shown as Not built yet (the page reads no feed). Retired: "serves the endpoint’s own failure payload and prints not one figure fr".
// B24 (founder, 2026-11-17): W1-W7 are ideas shown as Not built yet (the page reads no feed). Retired: "with no stamp either: there is no axis, and the shell says so".
// B24 (founder, 2026-11-17): W1-W7 are ideas shown as Not built yet (the page reads no feed). Retired: "shows the failure with a working retry, and no tile shows a number it ".

// The new behaviour is covered by src/__tests__/b24.ideas.test.tsx.
it('still has a page component to mount', () => {
  expect(typeof NorthStarPage).toBe('function');
});
