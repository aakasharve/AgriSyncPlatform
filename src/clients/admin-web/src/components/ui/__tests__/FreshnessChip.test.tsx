import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FreshnessChip } from '../FreshnessChip';

/**
 * Regression cover for the "NaNd ago" bug fixed 2026-08-31.
 *
 * The chip used to compute `Date.now() - new Date(iso).getTime()` itself. For
 * an unparseable timestamp that is NaN, every threshold comparison is false,
 * and the final branch rendered the literal text "NaNd ago" — a freshness age
 * the chip does not have. Nothing tested this component before.
 */
describe('FreshnessChip — it may only state an age it actually has', () => {
  it.each([
    ['not a date', 'not-a-date'],
    ['an empty string', ''],
    ['a half-formed ISO string', '2026-13-45T99:99:99Z'],
    ['a number where a date belongs', '99999999999999999999'],
  ])('renders no fabricated age for %s', (_label, bad) => {
    render(<FreshnessChip source="live" lastRefreshed={bad} />);

    const text = screen.getByText(/Live/).textContent ?? '';
    expect(text).not.toMatch(/NaN/);
    expect(text).not.toMatch(/Infinity/);
    expect(text).not.toMatch(/-\d/);
  });

  it('still shows a real age when the timestamp is real', () => {
    const twoMinutesAgo = new Date(Date.now() - 120_000).toISOString();
    render(<FreshnessChip source="live" lastRefreshed={twoMinutesAgo} />);

    expect(screen.getByText(/Live · 2m ago/)).toBeInTheDocument();
  });

  /**
   * D13, CLOSED IN TASK 24 — and this is the expectation that changed.
   *
   * It used to read `expect(text).toBe('Nightly · recent')` under a note saying
   * that pinning "recent" pinned a defect: a chip with no timestamp still
   * claimed freshness, and on Schedule Templates it printed a permanent
   * "Nightly · recent" over an endpoint with no clock at all. That note promised
   * the expectation would change in the same commit as the code. It has.
   */
  it('states the absence, not an age, when there is no timestamp at all', () => {
    render(<FreshnessChip source="materialized" lastRefreshed={undefined} />);

    const text = screen.getByText(/Nightly/).textContent ?? '';
    expect(text).toBe('Nightly · age not reported');

    // The words that made the two cases indistinguishable. "recent" and "now"
    // are what this chip says when it HAS a reading; neither may be reachable
    // without one.
    expect(text).not.toMatch(/recent/);
    expect(text).not.toMatch(/\bnow\b/);
    expect(text).not.toMatch(/NaN/);
  });

  it('cannot be given an age it does not have on the live source either', () => {
    render(<FreshnessChip source="live" lastRefreshed={undefined} />);

    expect(screen.getByText(/Live/).textContent).toBe('Live · age not reported');
  });
});
