import { expect, it } from 'vitest';
import homeSource from '../HomePage.tsx?raw';

/**
 * HOME after B24 (founder, 2026-11-17).
 *
 * The six mount tests that used to live here pinned the old board, and every number on it is now either
 * a removed double or an idea shown as "Not built yet":
 *
 *   // B24 (founder, 2026-11-17): H1 (Active alerts) is a double of Live Health "Alert rules".
 *   // B24 (founder, 2026-11-17): H2 (API errors, last 2 hours) is a double of Live Health "Recent events".
 *   // B24 (founder, 2026-11-17): H3 (AI call success) is a double of MIS Quality #43 "Voice recordings saved".
 *   // B24 (founder, 2026-11-17): H4 (Logs today) is a double of MIS Overview #8 "Entries saved".
 *   // B24 (founder, 2026-11-17): H5 (WVFD) is a double of the WVFD page "Verified farm-days per farm".
 *   // B24 (founder, 2026-11-17): H6 (Farms on record) is a double of MIS Farms #55 "Farms registered".
 *   // B24 (founder, 2026-11-17): H7 (D30 retention) is a double of MIS Retention #34 "Active on day 30".
 *   // B24 (founder, 2026-11-17): H8 (MRR) and H9 (call list) are ideas shown as Not built yet.
 *
 * Retired, with their reason: "every feed answering" (tiles H1-H7 and chips over the old feeds), "the voice tile
 * takes its tone from the rule" (H3), "the one ungated screen asks for nothing it may not read" (the page now
 * asks for nothing at all; asserted in src/__tests__/b24.ideas.test.tsx), "a substituted answer is not a
 * reading" (H1-H7), "an empty call list" (H9 old rendering), "a chip may only state an age it has" (chips over
 * the old feeds).
 *
 * The new behaviour (H8 and H9 as ideas, no doubles, no request to the old feeds) is covered by
 * src/__tests__/b24.ideas.test.tsx.
 */

it('read the real source, not an empty stub', () => {
  expect(homeSource.length).toBeGreaterThan(500);
  expect(homeSource).toContain('export default function HomePage');
});
