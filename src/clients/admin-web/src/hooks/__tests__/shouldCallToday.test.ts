import { expect, it } from 'vitest';
import { useShouldCallToday } from '../useShouldCallToday';

/**
 * The call list (H9) pinned the OLD silent-churn and Suffering rows (weeks silent, `plan`, an events count, a
 * held-out row) and an order built on them. Both answers changed shape and the list is real now (C26): bands
 * 7-13 and 14-29 plus the Suffering 7-day list, merged by farm id, each row saying why it is listed.
 * The merge is proved through the screen in src/pages/__tests__/HomePage.callList.test.tsx. Retired, one line each:
 */
// CR-2e C7 (main-session amendment, citing B23 (founder, 2026-11-17)): H9 became real, and the old API is gone. Retired: "does not list a farm twice when both watchlists flag it" (covered by Home_call_list_merges_silent_and_repeated_problem_farms).
// CR-2e C7 (main-session amendment, citing B23 (founder, 2026-11-17)): H9 became real, and the old API is gone. Retired: "gives the reasons a fixed order, so two identically flagged farms read alike" (old reason kinds failing/silent).
// CR-2e C7 (main-session amendment, citing B23 (founder, 2026-11-17)): H9 became real, and the old API is gone. Retired: "keeps a held-out row apart and never calls it never logged" (the new answer names never-logged farms in band never, which are not on the call list).
// CR-2e C7 (main-session amendment, citing B23 (founder, 2026-11-17)): H9 became real, and the old API is gone. Retired: "pluralises the silence, so no row reads Silent 1 full weeks" (silence is counted in days now).
// CR-2e C7 (main-session amendment, citing B23 (founder, 2026-11-17)): H9 became real, and the old API is gone. Retired: "KEY 1 - a farm flagged twice outranks a farm flagged once, whatever the counts say".
// CR-2e C7 (main-session amendment, citing B23 (founder, 2026-11-17)): H9 became real, and the old API is gone. Retired: "KEY 2 - equal reasons break on the longest silence, descending".
// CR-2e C7 (main-session amendment, citing B23 (founder, 2026-11-17)): H9 became real, and the old API is gone. Retired: "KEY 2 - a farm with NO silence reading sorts below one that has one".
// CR-2e C7 (main-session amendment, citing B23 (founder, 2026-11-17)): H9 became real, and the old API is gone. Retired: "KEY 3 - an exact tie falls back to the name, so the order is stable and explicable".
// The spec (C26) fixes no order for the list, so none is pinned here.

it('still has a call-list hook to mount', () => {
  expect(typeof useShouldCallToday).toBe('function');
});
