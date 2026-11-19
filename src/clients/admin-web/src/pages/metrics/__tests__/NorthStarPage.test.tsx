import { expect, it } from 'vitest';
import NorthStarPage from '../NorthStarPage';

/**
 * WVFD (W1-W4, W6, W7 real since CR-2e Task 6, C32; W5 stays "Goal not set yet") after B24 (founder, 2026-11-17): the old rendering
 * tests are retired, one line each, and the page's new behaviour is covered by NorthStarPage.c32.test.tsx:
 */
// B24 (founder, 2026-11-17): the old W1-W7 rendering tests were retired. Retired: "changes the request, the cache entry and the title — and refuses a val".
// B24 (founder, 2026-11-17): the old W1-W7 rendering tests were retired. Retired: "draws, tabulates and describes them all without collapsing any two".
// B24 (founder, 2026-11-17): the old W1-W7 rendering tests were retired. Retired: "names a non-adjacent comparison, and says when the headline is not thi".
// B24 (founder, 2026-11-17): the old W1-W7 rendering tests were retired. Retired: "serves the endpoint’s own failure payload and prints not one figure fr".
// B24 (founder, 2026-11-17): the old W1-W7 rendering tests were retired. Retired: "with no stamp either: there is no axis, and the shell says so".
// B24 (founder, 2026-11-17): the old W1-W7 rendering tests were retired. Retired: "shows the failure with a working retry, and no tile shows a number it ".

// The new behaviour is covered by NorthStarPage.c32.test.tsx (W5 by src/__tests__/b24.ideas.test.tsx).
it('still has a page component to mount', () => {
  expect(typeof NorthStarPage).toBe('function');
});
