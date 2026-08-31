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

  it('falls back to a word, not a number, when there is no timestamp at all', () => {
    // NOTE: this pins TODAY's behaviour, which is still wrong for a different
    // reason — D13: a chip with no timestamp still claims freshness ("now" /
    // "recent"). That is a visible change to Schedule Templates and belongs to
    // Task 24, which ports that screen. When Task 24 lands, this expectation
    // changes in the same commit as the code, never quietly.
    render(<FreshnessChip source="materialized" />);

    const text = screen.getByText(/Nightly/).textContent ?? '';
    expect(text).toBe('Nightly · recent');
    expect(text).not.toMatch(/NaN/);
  });
});
